const fs = require("fs");
global.window = { I18N_TRIPLES: [], I18N_PATTERNS: [] };
for (const f of fs.readdirSync("public/js").filter((x) => /^i18n-fr-en-zh-\d\.js$/.test(x))) {
  new Function("window", fs.readFileSync("public/js/" + f, "utf8"))(global.window);
}
const app = fs.readFileSync("public/js/app.js", "utf8");
const src = app.match(/Cotes à titre[^<]*/)[0];
const triple = window.I18N_TRIPLES.find((t) => t[0] === src);
console.log("found exact:", !!triple, "| src len", src.length);
if (!triple) {
  const near = window.I18N_TRIPLES.find((t) => t[0].startsWith("Cotes à titre"));
  console.log("near:", near && near[0].length, near && JSON.stringify(near[0]));
  if (near) {
    for (let i = 0; i < Math.max(src.length, near[0].length); i++) {
      if (src[i] !== near[0][i]) {
        console.log("diff at", i, JSON.stringify(src.slice(i - 12, i + 12)), JSON.stringify(near[0].slice(i - 12, i + 12)), src.charCodeAt(i), near[0].charCodeAt(i));
        break;
      }
    }
  }
}
