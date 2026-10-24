/* Render start-up: restore the database, save it every 2 minutes and on shutdown, then start RISEUP OPS. */
const fs = require("fs"), crypto = require("crypto"), path = require("path");
const DB = path.join(__dirname, "data.db");
async function main() {
  const url = process.env.DATABASE_URL; let pool = null;
  if (url) {
    const { Pool } = require("pg"); pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });
    await pool.query("CREATE TABLE IF NOT EXISTS snapshots (id SERIAL PRIMARY KEY, at TIMESTAMPTZ DEFAULT now(), data BYTEA)");
    const r = await pool.query("SELECT data FROM snapshots ORDER BY id DESC LIMIT 1");
    if (r.rows[0]) { fs.writeFileSync(DB, r.rows[0].data); console.log("[boot] restored saved data", r.rows[0].data.length); }
  }
  if (!fs.existsSync(DB) && fs.existsSync(DB + ".enc") && process.env.DB_KEY) {
    const b = fs.readFileSync(DB + ".enc"); const key = crypto.createHash("sha256").update(process.env.DB_KEY).digest();
    const d = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28));
    fs.writeFileSync(DB, Buffer.concat([d.update(b.subarray(28)), d.final()])); console.log("[boot] starting data unpacked");
  }
  process.env.NODE_ENV = "production";
  require("./dist/index.cjs");
  if (pool) {
    const Database = require("better-sqlite3"); let last = "";
    const save = async () => { try { const tmp = "/tmp/snap.db"; try { fs.unlinkSync(tmp); } catch {}
      const c = new Database(DB, { readonly: true }); c.exec(`VACUUM INTO '${tmp}'`); c.close(); const data = fs.readFileSync(tmp);
      const h = crypto.createHash("md5").update(data).digest("hex"); if (h === last) return; last = h;
      await pool.query("INSERT INTO snapshots (data) VALUES ($1)", [data]); await pool.query("DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT 20)");
      console.log("[boot] saved", data.length); } catch (e) { console.error("[boot] save failed", e.message); } };
    setTimeout(save, 30000); setInterval(save, 120000);
    const stop = async () => { await save(); process.exit(0); }; process.on("SIGTERM", stop); process.on("SIGINT", stop);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
