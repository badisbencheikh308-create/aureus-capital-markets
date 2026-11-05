const path = require("path");
process.chdir(__dirname);
const Database = require("better-sqlite3");
const db = new Database(path.join(__dirname, "data.db"), { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
console.log("tables:", tables.join(", "));
const users = db.prepare("SELECT id,name,email,role,subscription,is_admin FROM users LIMIT 10").all().catch(() => []);
console.log(JSON.stringify(users, null, 1));
