global.window = { I18N_TRIPLES: [], I18N_PATTERNS: [] };
const fs = require("fs");
for (const f of fs.readdirSync("public/js").filter((x) => /^i18n-.*\.js$/.test(x))) {
  if (f === "i18n-ui.js") continue;
  new Function("window", fs.readFileSync("public/js/" + f, "utf8"))(global.window);
}
const keys = [
  "Obligation", "Crédit", "Fonds Immobilier", "Immobilier", "Usine", "Marque",
  "Fusion-Acquisition", "Matières Premières", "Indices", "Devises", "Matières", "Taux",
  "Énergie", "Céréales", "Métaux", "Agriculture", "Engrais", "Matière Première", "Prix",
  "Crédit Commercial Pêche — Mauritanie", "Vente", "Partenariat", "Financement"
];
for (const k of keys) {
  const t = window.I18N_TRIPLES.slice().reverse().find((x) => x[0] === k);
  console.log(k, "=>", t ? JSON.stringify([t[1], t[2]]) : "MISSING");
}
