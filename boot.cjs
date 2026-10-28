/* Render start-up: restore the database, save it every 2 minutes and on shutdown, then start RISEUP OPS.
   Storage order: Postgres (DATABASE_URL) if set, otherwise a private GitHub repo (GH_DATA_KEY + GH_DATA_REPO), encrypted with DB_KEY. */
const fs = require("fs"), crypto = require("crypto"), path = require("path"), { execSync } = require("child_process");
const DB = path.join(__dirname, "data.db");
const KEY = () => crypto.createHash("sha256").update(process.env.DB_KEY || "").digest();
const enc = (buf) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv("aes-256-gcm", KEY(), iv); const d = Buffer.concat([c.update(buf), c.final()]); return Buffer.concat([iv, c.getAuthTag(), d]); };
const dec = (b) => { const d = crypto.createDecipheriv("aes-256-gcm", KEY(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]); };
const GDIR = "/tmp/riseup-data";
const gitEnv = () => ({ ...process.env, GIT_SSH_COMMAND: "ssh -i /tmp/gh-data-key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/tmp/gh-known-hosts" });
const git = (cmd) => execSync(`git ${cmd}`, { cwd: GDIR, env: gitEnv(), stdio: "pipe", timeout: 60000 }).toString();

async function main() {
  const url = process.env.DATABASE_URL; let pool = null; let gh = false;
  if (url) {
    const { Pool } = require("pg"); pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });
    await pool.query("CREATE TABLE IF NOT EXISTS snapshots (id SERIAL PRIMARY KEY, at TIMESTAMPTZ DEFAULT now(), data BYTEA)");
    const r = await pool.query("SELECT data FROM snapshots ORDER BY id DESC LIMIT 1");
    if (r.rows[0]) { fs.writeFileSync(DB, r.rows[0].data); console.log("[boot] restored saved data", r.rows[0].data.length); }
  } else if (process.env.GH_DATA_KEY && process.env.GH_DATA_REPO) {
    try {
      fs.writeFileSync("/tmp/gh-data-key", Buffer.from(process.env.GH_DATA_KEY, "base64").toString("utf8"), { mode: 0o600 });
      fs.rmSync(GDIR, { recursive: true, force: true });
      execSync(`git clone --depth 1 git@github.com:${process.env.GH_DATA_REPO}.git ${GDIR}`, { env: gitEnv(), stdio: "pipe", timeout: 90000 });
      git(`config user.name "RISEUP OPS"`); git(`config user.email "riseup-ops@users.noreply.github.com"`);
      const f = path.join(GDIR, "data.db.enc");
      if (fs.existsSync(f)) { const d = dec(fs.readFileSync(f)); fs.writeFileSync(DB, d); console.log("[boot] restored saved data", d.length); }
      gh = true;
    } catch (e) { console.error("[boot] data store unavailable", e.message); }
  }
  if (!fs.existsSync(DB) && fs.existsSync(DB + ".enc") && process.env.DB_KEY) {
    fs.writeFileSync(DB, dec(fs.readFileSync(DB + ".enc"))); console.log("[boot] starting data unpacked");
  }
  process.env.NODE_ENV = "production";
  require("./dist/index.cjs");
  if (pool || gh) {
    const Database = require("better-sqlite3"); let last = ""; let busy = false;
    const save = async () => { if (busy) return; busy = true; try { const tmp = "/tmp/snap.db"; try { fs.unlinkSync(tmp); } catch {}
      const c = new Database(DB, { readonly: true }); c.exec(`VACUUM INTO '${tmp}'`); c.close(); const data = fs.readFileSync(tmp);
      const h = crypto.createHash("md5").update(data).digest("hex"); if (h === last) return; 
      if (pool) {
        await pool.query("INSERT INTO snapshots (data) VALUES ($1)", [data]); await pool.query("DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT 20)");
      } else {
        fs.writeFileSync(path.join(GDIR, "data.db.enc"), enc(data));
        git("add data.db.enc"); git(`commit -q --allow-empty -m "snapshot ${new Date().toISOString()}"`);
        // keep the history short: every 30 snapshots, replace history with a single commit
        const n = parseInt(git("rev-list --count HEAD").trim(), 10) || 0;
        if (n > 30) { git("checkout -q --orphan fresh"); git(`commit -q -m "snapshot ${new Date().toISOString()}"`); git("branch -D main"); git("branch -m main"); }
        git("push -q -f origin HEAD:main");
      }
      last = h; console.log("[boot] saved", data.length); } catch (e) { console.error("[boot] save failed", e.message); } finally { busy = false; } };
    setTimeout(save, 30000); setInterval(save, 120000);
    const stop = async () => { busy = false; await save(); process.exit(0); }; process.on("SIGTERM", stop); process.on("SIGINT", stop);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
