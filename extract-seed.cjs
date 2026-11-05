const fs = require("fs");
const src = fs.readFileSync("server.cjs", "utf8");
const start = src.indexOf("const seedAssets = [");
const seg = src.slice(start, src.indexOf("];", start));
const re = /\{ type: "([^"]+)", title: "([^"]+)", emetteur: "([^"]*)", pays: "([^"]*)", devise: "([^"]*)", montant: [^,]+, rendement: [^,]+, maturite: "([^"]*)", risque: "([^"]*)", token: "([^"]*)", description: "([^"]*)"/g;
let m, rows=[];
while ((m = re.exec(seg))) rows.push({type:m[1], title:m[2], emetteur:m[3], pays:m[4], devise:m[5], maturite:m[6], risque:m[7], token:m[8], description:m[9]});
console.log("parsed:", rows.length);
const uniq = k => [...new Set(rows.map(r=>r[k]))];
for (const k of ["title","description","emetteur","pays","maturite"]) {
  const u = uniq(k);
  console.log(k, "unique:", u.length, "chars:", u.join("").length);
}
console.log("maturites:", uniq("maturite").join(" | "));
console.log("pays:", uniq("pays").join(" | "));
fs.writeFileSync("seed_full.json", JSON.stringify(rows, null, 2), "utf8");
