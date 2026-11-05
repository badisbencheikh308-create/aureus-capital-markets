/* Génère public/js/i18n-fr-en-zh-7.js : traductions des pages légales
   (CGU, CGV, mentions légales, politique de confidentialité). */
const fs = require("fs");

const app = fs.readFileSync("public/js/app.js", "utf8");
const start = app.indexOf("const LEGAL_DOCS = {");
const end = app.indexOf("\n};", start);
if (start < 0 || end < 0) throw new Error("LEGAL_DOCS not found");
const literal = app.slice(app.indexOf("{", start), end + 2);
// eslint-disable-next-line no-new-func
const LEGAL_DOCS = new Function("return " + literal)();

const strings = new Set();
function add(v) {
  if (typeof v !== "string") return;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s || !/[A-Za-zÀ-ÿ]/.test(s)) return;
  strings.add(s);
}
for (const doc of Object.values(LEGAL_DOCS)) {
  add(doc.title);
  for (const [h, p] of doc.sections) {
    add(h);
    add(p);
  }
}
[
  "Document généré à titre informatif. Faites valider ces conditions par un avocat avant le lancement commercial. © 2026 Aureus Capital Markets — Démo concept. Aucune offre d'investissement.",
  "Document généré à titre informatif par la plateforme Aureus Capital Markets, qui agit uniquement comme intermédiaire de mise en relation et ne détient aucun fonds. Ce modèle ne constitue pas un conseil juridique."
].forEach(add);

const all = [...strings].sort((a, b) => a.localeCompare(b, "fr"));
console.log("Chaînes légales :", all.length, "| caractères :", all.join("").length);

async function translateBlock(lines, tl) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=fr&tl=" +
    tl +
    "&dt=t&q=" +
    encodeURIComponent(lines.join("\n"));
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const j = await res.json();
  return (j[0] || []).map((s) => s[0]).join("").split("\n");
}

async function translateLines(lines, tl) {
  const out = [];
  for (const line of lines) {
    let done = null;
    for (let attempt = 0; attempt < 5 && done === null; attempt++) {
      try {
        const r = await translateBlock([line], tl);
        if (r.length === 1) done = r[0];
      } catch (e) {
        console.warn(tl, "retry:", e.message);
      }
    }
    out.push(done === null ? line : done);
    process.stdout.write(`\r${tl}: ${out.length}/${lines.length}`);
  }
  process.stdout.write("\n");
  return out;
}

(async () => {
  const en = await translateLines(all, "en");
  const zh = await translateLines(all, "zh-CN");
  const entries = [];
  for (let i = 0; i < all.length; i++) {
    const fr = all[i], e = en[i], z = zh[i];
    if (e === fr && z === fr) continue;
    entries.push("  [" + JSON.stringify(fr) + ", " + JSON.stringify(e) + ", " + JSON.stringify(z) + "]");
  }
  const body = [
    "/* Dictionnaire UI — lot 7 : pages légales (CGU, CGV, mentions, confidentialité). */",
    "window.I18N_TRIPLES.push(",
    entries.join(",\n"),
    ");",
    ""
  ].join("\n");
  fs.writeFileSync("public/js/i18n-fr-en-zh-7.js", body, "utf8");
  console.log("Écrit public/js/i18n-fr-en-zh-7.js —", entries.length, "entrées.");
})();
