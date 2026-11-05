/* Génère public/js/i18n-data.js : traductions EN/ZH des données
   (titres d'actifs, descriptions, émetteurs, pays, échéances, documents,
   besoins de financement, offres bancaires, instruments de marché). */
const fs = require("fs");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function extractArray(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error("marker not found: " + marker);
  const from = src.indexOf("[", start);
  const end = src.indexOf("\n];", from);
  if (end < 0) throw new Error("array end not found: " + marker);
  const literal = src.slice(from, end + 2);
  // eslint-disable-next-line no-new-func
  return new Function("return " + literal)();
}

const server = read("server.cjs");
const seedAssets = extractArray(server, "const seedAssets = [");
const seedNeeds = extractArray(server, "const seedNeeds = [");
const seedBankOffers = extractArray(server, "const seedBankOffers = [");

const strings = new Set();
function add(v) {
  if (typeof v !== "string") return;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s) return;
  if (!/[A-Za-zÀ-ÿ]/.test(s)) return;
  strings.add(s);
}

// Actifs
for (const a of seedAssets) {
  add(a.title);
  add(a.emetteur);
  add(a.pays);
  add(a.maturite);
  add(a.description);
  add(a.typeLabel);
  try {
    (JSON.parse(a.documents) || []).forEach(add);
  } catch (e) {
    /* ignore */
  }
}
// Besoins de financement
for (const n of seedNeeds) {
  add(n.title);
  add(n.purpose);
  add(n.description);
  add(n.region);
}
// Offres bancaires
for (const o of seedBankOffers) {
  add(o.product);
  add(o.purpose);
  add(o.region);
}

// Données de secours (public/data/assets.js)
try {
  const fallbackSrc = read("public/data/assets.js");
  const fallback = new Function(fallbackSrc + "; return window.RWA_DATA;")();
  for (const a of fallback.assets || []) {
    add(a.title);
    add(a.emetteur);
    add(a.pays);
    add(a.maturite);
    add(a.description);
    add(a.typeLabel);
    (a.documents || []).forEach(add);
  }
} catch (e) {
  console.warn("fallback assets: ", e.message);
}

// Instruments de marché + libellés (app.js)
const app = read("public/js/app.js");
const marketStart = app.indexOf("const MARKETS = [");
const marketEnd = app.indexOf("\n];", marketStart);
if (marketStart >= 0 && marketEnd >= 0) {
  const literal = app.slice(app.indexOf("[", marketStart), marketEnd + 2);
  const markets = new Function("return " + literal)();
  for (const m of markets) {
    add(m.cat);
    add(m.name);
  }
}
// Libellés de types et secteurs
[
  "Indices", "Devises", "Matières", "Taux",
  "Énergie", "Céréales", "Métaux", "Agriculture", "Engrais", "Matière Première",
  "Obligation", "Crédit", "Fonds Immobilier", "Immobilier", "Usine", "Marque",
  "Fusion-Acquisition", "Matières Premières",
  "Vente", "Cession de marque", "Mandat M&A", "Fonds ouvert",
  "Cession", "Partenariat", "Financement", "Levée de fonds", "Levée",
  "Vente / partenariat", "Levée / partenariat", "Cession / licence",
  "Levée / partenaire", "Partenariat / levée", "Partenariat industriel",
  "Fusion / rapprochement", "Vente / clés en main", "Cession / management",
  "Vente aux enchères / récolte", "Recherche acquéreur"
].forEach(add);

const all = [...strings].sort((a, b) => a.localeCompare(b, "fr"));
console.log("Chaînes à traduire :", all.length, "| caractères :", all.join("").length);

async function translateBlock(lines, tl) {
  const q = lines.join("\n");
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=fr&tl=" +
    tl +
    "&dt=t&q=" +
    encodeURIComponent(q);
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const j = await res.json();
  const text = (j[0] || []).map((s) => s[0]).join("");
  return text.split("\n");
}

async function translateLines(lines, tl) {
  const out = [];
  const CHUNK = 2200;
  let i = 0;
  while (i < lines.length) {
    const chunk = [];
    let size = 0;
    while (i < lines.length && (size + lines[i].length < CHUNK || chunk.length === 0)) {
      chunk.push(lines[i]);
      size += lines[i].length + 1;
      i++;
    }
    let translated = null;
    for (let attempt = 0; attempt < 4 && !translated; attempt++) {
      try {
        const r = await translateBlock(chunk, tl);
        if (r.length === chunk.length) translated = r;
      } catch (e) {
        console.warn(tl, "chunk failed:", e.message);
      }
    }
    if (!translated) {
      translated = [];
      for (const line of chunk) {
        let one = null;
        for (let attempt = 0; attempt < 4 && !one; attempt++) {
          try {
            const r = await translateBlock([line], tl);
            if (r.length === 1) one = r[0];
          } catch (e) {
            console.warn(tl, "line failed:", e.message);
          }
        }
        translated.push(one || line);
      }
    }
    out.push(...translated);
    process.stdout.write(`\r${tl}: ${out.length}/${lines.length}`);
  }
  process.stdout.write("\n");
  return out;
}

(async () => {
  console.log("Traduction EN...");
  const en = await translateLines(all, "en");
  console.log("Traduction ZH...");
  const zh = await translateLines(all, "zh-CN");

  const lines = [];
  lines.push("/* Dictionnaire de DONNÉES — traductions EN/ZH générées pour les actifs,");
  lines.push("   besoins de financement, offres bancaires et instruments de marché. */");
  lines.push("window.I18N_TRIPLES.push(");
  const entries = [];
  for (let i = 0; i < all.length; i++) {
    const fr = all[i];
    const e = en[i] || fr;
    const z = zh[i] || e;
    if (e === fr && z === fr) continue;
    entries.push("  [" + JSON.stringify(fr) + ", " + JSON.stringify(e) + ", " + JSON.stringify(z) + "]");
  }
  lines.push(entries.join(",\n"));
  lines.push(");");
  lines.push("");
  fs.writeFileSync("public/js/i18n-data.js", lines.join("\n"), "utf8");
  console.log("Écrit public/js/i18n-data.js —", entries.length, "entrées.");
})();
