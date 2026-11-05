const fs = require("fs");
const path = require("path");

const DB = path.join(__dirname, "data.db");
const BKP = path.join(__dirname, "backups");

if (!fs.existsSync(BKP)) fs.mkdirSync(BKP, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dest = path.join(BKP, `data-${stamp}.db`);
fs.copyFileSync(DB, dest);
const keep = fs.readdirSync(BKP).filter((f) => f.endsWith(".db")).sort();
while (keep.length > 14) fs.unlinkSync(path.join(BKP, keep.shift()));
console.log("[BACKUP] Copie effectuée :", dest);
