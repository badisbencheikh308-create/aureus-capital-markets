const http = require("http");

const BASE = process.env.BASE || "http://localhost:3000";

function req(method, url, body, cookie) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(new URL(url), {
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": data ? Buffer.byteLength(data) : 0,
        ...(cookie ? { Cookie: cookie } : {})
      }
    }, (res) => {
      let out = "";
      res.on("data", (c) => out += c);
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(out); } catch (e) {}
        resolve({ status: res.statusCode, json, setCookie: res.headers["set-cookie"] || [] });
      });
    });
    r.on("error", (e) => resolve({ status: 0, json: { err: e.message }, setCookie: [] }));
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const failures = [];
  const check = (label, cond, extra) => {
    if (cond) console.log("  OK  " + label + (extra ? " (" + extra + ")" : ""));
    else { failures.push(label); console.log(" FAIL " + label + " " + (extra || "")); }
  };

  const assets = await req("GET", BASE + "/api/assets");
  check("GET /api/assets", assets.status === 200 && Array.isArray(assets.json) && assets.json.length > 0, assets.json.length + " actifs");

  const email = "smoke_" + Date.now() + "@test.com";
  const reg = await req("POST", BASE + "/api/register", { name: "Smoke Test", email, password: "secret123" });
  check("POST /api/register", reg.status === 200 && reg.json.ok);

  const log = await req("POST", BASE + "/api/login", { email, password: "secret123" });
  const cookie = (log.setCookie[0] || "").split(";")[0];
  check("POST /api/login", log.status === 200 && log.json.user, cookie ? "session ok" : "no cookie");

  const me = await req("GET", BASE + "/api/me", null, cookie);
  check("GET /api/me", me.json.user && me.json.user.email === email);

  const sub = await req("POST", BASE + "/api/subscribe", { plan: "verifie" }, cookie);
  check("POST /api/subscribe", sub.status === 200 && sub.json.invoice, "ref=" + (sub.json.invoice && sub.json.invoice.reference));

  const adminLog = await req("POST", BASE + "/admin/api/login", { email: "admin@aureusrwa.com", password: "admin2026" });
  const acookie = (adminLog.setCookie[0] || "").split(";")[0];
  check("admin login", adminLog.status === 200, "ok");

  const activate = await req("POST", BASE + "/admin/api/subscriptions", { id: sub.json.invoice.id, action: "activer" }, acookie);
  check("admin activer abonnement", activate.status === 200 && activate.json.ok);

  const mySub = await req("GET", BASE + "/api/my-subscription", null, cookie);
  check("GET /api/my-subscription", mySub.json.subscription && mySub.json.subscription.statut === "actif");

  const kyc = await req("POST", BASE + "/api/kyc", { nom: "Smoke Test Legal", pays: "France" }, cookie);
  check("POST /api/kyc", kyc.status === 200 && kyc.json.ok);

  const kycList = await req("GET", BASE + "/admin/api/kyc", null, acookie);
  const kycRow = (kycList.json || []).find((u) => u.email === email);
  const kycVal = await req("POST", BASE + "/admin/api/kyc", { id: kycRow.id, action: "valider" }, acookie);
  check("admin valider KYC", kycVal.status === 200 && kycVal.json.ok);

  const fee = await req("POST", BASE + "/api/fee", { conversation_id: null }, cookie);
  check("POST /api/fee", fee.status === 200 && fee.json.fee, "ref=" + fee.json.fee.reference);

  const feeAct = await req("POST", BASE + "/admin/api/fees", { id: fee.json.fee.id, action: "activer" }, acookie);
  check("admin activer frais", feeAct.status === 200 && feeAct.json.ok);

  const conv = await req("POST", BASE + "/api/conversations", { asset_id: 1, subject: "Test" }, cookie);
  const convId = conv.json.conversation ? conv.json.conversation.id : null;
  check("POST /api/conversations", conv.status === 200 && convId, "id=" + convId);

  const msg = await req("POST", BASE + "/api/messages", { conversation_id: convId, body: "Bonjour" }, cookie);
  check("POST /api/messages", msg.status === 200 && msg.json.ok);

  const thread = await req("GET", BASE + "/api/conversation?id=" + convId, null, cookie);
  check("GET /api/conversation", thread.json.messages.length >= 1);

  const notif0 = await req("GET", BASE + "/api/notifications", null, cookie);
  check("GET /api/notifications", notif0.status === 200);

  const reply = await req("POST", BASE + "/admin/api/messages", { conversation_id: convId, body: "Réponse équipe" }, acookie);
  check("admin reply", reply.status === 200 && reply.json.ok);

  const notif1 = await req("GET", BASE + "/api/notifications", null, cookie);
  check("notification reçue", notif1.json.unread >= 1, "unread=" + notif1.json.unread);

  const rate = await req("POST", BASE + "/api/contact", { name: "x", contact: "x", message: "y" }, null);
  check("POST /api/contact", rate.status === 200 || rate.status === 429);

  const badLogin = await req("POST", BASE + "/api/login", { email, password: "wrong" });
  check("mauvais login 401", badLogin.status === 401);

  const unauthConv = await req("POST", BASE + "/api/messages", { conversation_id: convId, body: "x" });
  check("messages sans session 401", unauthConv.status === 401);

  const freeEmail = "free_" + Date.now() + "@test.com";
  await req("POST", BASE + "/api/register", { name: "Free User", email: freeEmail, password: "secret123" });
  const freeLog = await req("POST", BASE + "/api/login", { email: freeEmail, password: "secret123" });
  const freeCookie = (freeLog.setCookie[0] || "").split(";")[0];
  const blocked = await req("POST", BASE + "/api/conversations", { asset_id: 1, subject: "x" }, freeCookie);
  check("contact bloqué sans abonnement 402", blocked.status === 402 && blocked.json.code === "SUB_REQUIRED");

  console.log("");
  if (failures.length) { console.log("ÉCHECS : " + failures.length); process.exit(1); }
  console.log("Smoke test : TOUT EST OK (" + email + ")");
})().catch((e) => { console.log("FATAL", e); process.exit(1); });
