const fs = require("fs");
global.window = { I18N_TRIPLES: [], I18N_PATTERNS: [] };
for (const f of fs.readdirSync("public/js").filter((x) => /^i18n-.*\.js$/.test(x))) {
  if (f === "i18n-ui.js") continue;
  new Function("window", fs.readFileSync("public/js/" + f, "utf8"))(global.window);
}
const badEn = /[éèêàçùôûîïœ]|\b(Crédit|Fonds|Marché|Pêche|Café|Cacao|Immobilier|Entreprise|Société|Obligation|Contrat|Usine|Marque|Réseau|Unité|Vente|Levée|Cession|Partenariat|Financement|Prêt|Montant|Rendement|Échéance|Prix|Dossier|Besoins?|Créances?|Valeur|Taux)\b/;
const badZh = /\b(Crédit|Fonds|Marché|Pêche|Café|Immobilier|Entreprise|Société|Obligation|Contrat|Usine|Marque|Réseau|Unité|Vente|Levée|Cession|Partenariat|Financement|Prêt|Montant|Rendement|Échéance|Prix|Dossier|Besoins?|Créances?|Valeur|Taux)\b/;
const seen = new Set();
console.log("=== EN contenant encore du français ===");
for (const [fr, en, zh] of window.I18N_TRIPLES) {
  if (seen.has(fr)) continue;
  if (en && badEn.test(en)) {
    seen.add(fr);
    console.log(JSON.stringify(fr) + "  =>  " + JSON.stringify(en) + "  |  " + JSON.stringify(zh));
  }
}
console.log("\n=== ZH contenant des mots français ===");
const seen2 = new Set();
for (const [fr, en, zh] of window.I18N_TRIPLES) {
  if (seen2.has(fr)) continue;
  if (zh && badZh.test(zh)) {
    seen2.add(fr);
    console.log(JSON.stringify(fr) + "  =>  " + JSON.stringify(zh));
  }
}
