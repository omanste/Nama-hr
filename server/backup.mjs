/* Full backup and restore (Admin): one .db file with every table plus the uploaded documents and photos inside it,
 * so a whole portal (e.g. dev → production) can be moved by downloading it on one and restoring it on the other.
 * Restore replaces everything in this portal; the current data is backed up first (DATA_DIR/backups/before-restore-…). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb, nowIso } from "./db.mjs";
import { sendRaw, send, readBody, HttpError } from "./http.mjs";
import { can } from "./perm.mjs";
import { audit } from "./audit.mjs";

const SKIP = new Set(["schema_migrations", "sessions", "backup_files", "sqlite_sequence"]);

/** Write a full backup (database + uploads) to a file and return its path. */
export function fullBackup(ctx, name) {
  const dir = path.join(ctx.dataDir, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.rmSync(file, { force: true });
  ctx.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const b = new DatabaseSync(file);
  try {
    b.exec("CREATE TABLE backup_files(id INTEGER PRIMARY KEY, data BLOB NOT NULL); CREATE TABLE backup_info(key TEXT PRIMARY KEY, value TEXT)");
    const up = path.join(ctx.dataDir, "uploads");
    const ins = b.prepare("INSERT INTO backup_files(id,data) VALUES(?,?)");
    b.exec("BEGIN");
    let n = 0;
    for (const f of fs.existsSync(up) ? fs.readdirSync(up) : []) if (/^\d+$/.test(f)) { ins.run(Number(f), fs.readFileSync(path.join(up, f))); n++; }
    b.prepare("INSERT INTO backup_info(key,value) VALUES('made_at',?),('env',?),('files',?)").run(nowIso(), ctx.appEnv, String(n));
    b.exec("COMMIT");
  } finally { b.close(); }
  return file;
}

/** Replace this portal's data with a backup file's (tables and uploads). Sessions are cleared: everyone signs in again. */
export function restoreFrom(ctx, buffer) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nama-restore-"));
  try {
    fs.writeFileSync(path.join(tmpDir, "hr.db"), buffer);
    // check it's one of ours, then bring it to this version's tables
    let probe;
    try { probe = new DatabaseSync(path.join(tmpDir, "hr.db")); probe.prepare("SELECT count(*) n FROM employees").get(); probe.prepare("SELECT count(*) n FROM users").get(); }
    catch { throw new HttpError(400, "invalid", "This is not a backup of the HR portal"); }
    finally { if (probe) probe.close(); }
    openDb(tmpDir).close();
    const { db } = ctx;
    const src = path.join(tmpDir, "hr.db").replace(/'/g, "''");
    db.exec("PRAGMA foreign_keys=OFF");
    db.exec(`ATTACH DATABASE '${src}' AS b`);
    let counts = {};
    try {
      const tables = db.prepare("SELECT name FROM main.sqlite_master WHERE type='table'").all().map((r) => r.name).filter((t) => !SKIP.has(t));
      const theirs = new Set(db.prepare("SELECT name FROM b.sqlite_master WHERE type='table'").all().map((r) => r.name));
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const t of tables) {
          db.exec(`DELETE FROM main."${t}"`);
          if (!theirs.has(t)) continue;
          const mine = db.prepare(`PRAGMA main.table_info("${t}")`).all().map((c) => c.name);
          const have = new Set(db.prepare(`PRAGMA b.table_info("${t}")`).all().map((c) => c.name));
          const cols = mine.filter((c) => have.has(c)).map((c) => `"${c}"`).join(",");
          db.exec(`INSERT INTO main."${t}"(${cols}) SELECT ${cols} FROM b."${t}"`);
          counts[t] = db.prepare(`SELECT count(*) n FROM main."${t}"`).get().n;
        }
        db.exec("DELETE FROM main.sessions");
        if (db.prepare("PRAGMA main.foreign_key_check").all().length) throw new HttpError(400, "invalid", "The backup's records don't fit together");
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
      // documents and photos
      const up = path.join(ctx.dataDir, "uploads");
      fs.mkdirSync(up, { recursive: true });
      if (theirs.has("backup_files")) {
        for (const f of fs.readdirSync(up)) if (/^\d+$/.test(f)) fs.rmSync(path.join(up, f), { force: true });
        for (const r of db.prepare("SELECT id, data FROM b.backup_files").iterate()) fs.writeFileSync(path.join(up, String(r.id)), r.data);
        counts.uploads = db.prepare("SELECT count(*) n FROM b.backup_files").get().n;
      }
    } finally {
      db.exec("DETACH DATABASE b");
      db.exec("PRAGMA foreign_keys=ON");
    }
    return counts;
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
}

export function registerBackup(api, ctx) {
  const needAdmin = (sess) => { if (!can(sess, "settings.edit")) throw new HttpError(403, "forbidden", "You do not have permission for this"); };
  // everything: data, settings, attendance, documents and photos
  api.get("/api/admin/backup", (req, res) => {
    needAdmin(req.sess);
    const name = `nama-hr-${ctx.appEnv}-${ctx.today()}-full.db`;
    const file = fullBackup(ctx, name);
    const body = fs.readFileSync(file);
    fs.rmSync(file, { force: true });
    sendRaw(req, res, 200, body, "application/octet-stream", { "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" });
  });
  // replace everything with a backup; a custom header (the browser can't send it cross-site) confirms it's deliberate
  api.post("/api/admin/restore", async (req, res) => {
    needAdmin(req.sess);
    if (req.headers["x-confirm"] !== "RESTORE") throw new HttpError(400, "confirm", "Type RESTORE to confirm");
    const body = await readBody(req, 1024 * 1024 * 1024);
    if (body.length < 100 || body.subarray(0, 16).toString("latin1") !== "SQLite format 3\u0000") throw new HttpError(400, "invalid", "This is not a backup of the HR portal");
    fullBackup(ctx, `before-restore-${ctx.today()}-${Date.now()}.db`); // the current data, in case
    const who = req.sess.user.username;
    const counts = restoreFrom(ctx, body);
    audit(ctx.db, null, "admin.restore", "settings", null, null, { by: who, counts });
    send(req, res, 200, { ok: true, counts });
  });
}
