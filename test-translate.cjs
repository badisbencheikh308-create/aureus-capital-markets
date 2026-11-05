const lines = [
  "Contrat Charbon Thermique — Indonésie",
  "Récolte en cours",
  "Obligation Souveraine Sénégal 2032",
  "Réseau de 5 cliniques dentaires à Dubaï et Abu Dhabi, patientèle premium, équipement dernière génération."
];
const q = lines.join("\n");
async function tr(tl) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=fr&tl=" +
    tl +
    "&dt=t&q=" +
    encodeURIComponent(q);
  const r = await fetch(url);
  const j = await r.json();
  const text = j[0].map((s) => s[0]).join("");
  return text.split("\n");
}
(async () => {
  const en = await tr("en");
  const zh = await tr("zh-CN");
  console.log("EN lines", en.length, JSON.stringify(en, null, 1));
  console.log("ZH lines", zh.length, JSON.stringify(zh, null, 1));
})();
