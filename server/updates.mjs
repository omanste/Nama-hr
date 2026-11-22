/* HR system updates: what changed in the HR portal, for management. Every deploy ships CHANGELOG-HR.md (written in plain
 * English · Arabic with each change); at start-up the server adds its new entries, notes the environment it is running in
 * (dev / test / production) with the time, version and who deployed, and records the deploy itself. An update that later
 * reaches another environment is the same entry with one more date. Admin adds, rewords or hides entries; HR views and
 * downloads. Only HR areas are recorded — anything else in the file (Sales, Rental, …) is left out. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { nowIso, tx } from "./db.mjs";
import { send, readJson, HttpError } from "./http.mjs";
import { audit } from "./audit.mjs";

export const AREAS = ["profiles", "attendance", "shifts", "verification", "permissions", "leave", "calendar", "reports", "backup", "general"];
export const TYPES = ["feature", "improvement", "fix"];
export const ENVS = ["dev", "test", "production"];
const TYPE_WORDS = { "new feature": "feature", feature: "feature", new: "feature", improvement: "improvement", improved: "improvement", fix: "fix", fixed: "fix" };

/** dev / test / production from APP_ENV (staging counts as test, anything else as production). */
export const envName = (v) => { const s = String(v || "production").toLowerCase(); return s === "dev" || s === "development" ? "dev" : s === "test" || s === "staging" ? "test" : "production"; };

/** A Muscat date and time ("2026-11-22 19:13", or a date alone) → ISO time. */
const muscat = (s) => {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(Z)?)?$/.exec(String(s || "").trim());
  if (!m) return null;
  return new Date(Date.parse(`${m[1]}T${m[2] || "12"}:${m[3] || "00"}:00${m[4] ? "Z" : "+04:00"}`)).toISOString();
};

/**
 * The changelog, one entry per change:
 *   ## 2026-11-22
 *   - [Attendance · New feature] English title | العنوان بالعربية
 *     English description | الوصف بالعربية
 *     key: some-key · commit: 8ec3c77 · dev: 2026-11-22 19:13 · production: 2026-11-25 10:00
 * Times are Muscat time (a "Z" after the time: UTC). The description and the last line are optional; without a key the
 * date and English title make one.
 */
export function parseChangelog(text) {
  const out = [], skipped = [];
  let day = null, cur = null;
  const split = (s) => { const i = s.lastIndexOf(" | "); return i < 0 ? [s.trim(), ""] : [s.slice(0, i).trim(), s.slice(i + 3).trim()]; };
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    let m;
    if ((m = /^##\s+(\d{4}-\d{2}-\d{2})\b/.exec(line))) { day = m[1]; cur = null; continue; }
    if ((m = /^- \[([^\]·|]+?)\s*[·|]\s*([^\]]+?)\]\s*(.+)$/.exec(line)) && day) {
      const area = m[1].trim().toLowerCase(), type = TYPE_WORDS[m[2].trim().toLowerCase()];
      const [title_en, title_ar] = split(m[3]);
      cur = { day, area, type, title_en, title_ar, desc_en: "", desc_ar: "", key: null, commit: null, envs: {} };
      if (!AREAS.includes(area) || !type) { skipped.push({ day, area, title: title_en }); cur = { skip: true }; continue; }
      out.push(cur); continue;
    }
    if (!cur || cur.skip || !/^\s{2,}\S/.test(line)) continue;
    const body = line.trim();
    if (/^(key|commit|dev|test|production)\s*:/i.test(body)) {
      for (const part of body.split(/\s+·\s+/)) {
        const p = /^(\w+)\s*:\s*(.+)$/.exec(part.trim()); if (!p) continue;
        const k = p[1].toLowerCase(), v = p[2].trim();
        if (k === "key") cur.key = v; else if (k === "commit") cur.commit = v; else if (ENVS.includes(k)) { const at = muscat(v); if (at) cur.envs[k] = at; }
      }
    } else if (!cur.desc_en && !cur.desc_ar) { [cur.desc_en, cur.desc_ar] = split(body); }
  }
  for (const e of out) if (!e.key) e.key = `${e.day}-${e.title_en.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}`;
  return { entries: out, skipped };
}

/** The commit this build came from: SOURCE_COMMIT / GIT_COMMIT, else the git files shipped with the image (or the checkout). */
export function gitVersion(root, env = process.env) {
  const given = env.SOURCE_COMMIT || env.GIT_COMMIT || env.COMMIT_SHA;
  if (given) return String(given).trim().slice(0, 12);
  for (const dir of [path.join(root, ".gitmeta"), path.join(root, ".git")]) {
    try {
      const head = fs.readFileSync(path.join(dir, "HEAD"), "utf8").trim();
      if (/^[0-9a-f]{40}$/.test(head)) return head.slice(0, 7);
      const ref = /^ref:\s*(.+)$/.exec(head); if (!ref) continue;
      try { return fs.readFileSync(path.join(dir, ref[1]), "utf8").trim().slice(0, 7); } catch { /* packed */ }
      const packed = fs.readFileSync(path.join(dir, "packed-refs"), "utf8").split("\n").find((l) => l.endsWith(" " + ref[1]));
      if (packed) return packed.slice(0, 7);
    } catch { /* not there */ }
  }
  return null;
}

/** Add what the changelog has that this environment hasn't recorded yet; record this deploy. Returns what was done. */
export function syncChangelog(ctx, { file, root, now = nowIso() } = {}) {
  const { db } = ctx;
  const env = envName(ctx.appEnv);
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return { env, added: 0, stamped: 0, skipped: 0, missing: true }; }
  const { entries, skipped } = parseChangelog(text);
  const version = gitVersion(root, ctx.env || {}) || `cl-${crypto.createHash("sha1").update(text).digest("hex").slice(0, 7)}`;
  const by = (ctx.env && ctx.env.DEPLOYED_BY) || "auto";
  let added = 0, stamped = 0;
  tx(db, () => {
    for (const e of entries) {
      let row = db.prepare("SELECT id, edited_at FROM hr_updates WHERE key=?").get(e.key);
      if (!row) {
        const r = db.prepare(`INSERT INTO hr_updates(key,day,area,type,title_en,title_ar,desc_en,desc_ar,commit_sha,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,'file',?)`)
          .run(e.key, e.day, e.area, e.type, e.title_en, e.title_ar, e.desc_en, e.desc_ar, e.commit, now);
        row = { id: Number(r.lastInsertRowid) }; added++;
      } else if (!row.edited_at) { // reworded in the file (and not by Admin in the portal): the new words
        db.prepare("UPDATE hr_updates SET day=?, area=?, type=?, title_en=?, title_ar=?, desc_en=?, desc_ar=?, commit_sha=coalesce(?,commit_sha) WHERE id=?")
          .run(e.day, e.area, e.type, e.title_en, e.title_ar, e.desc_en, e.desc_ar, e.commit, row.id);
      }
      const has = (en) => db.prepare("SELECT 1 FROM hr_update_envs WHERE update_id=? AND env=?").get(row.id, en);
      // dates written in the file (the history, or a move to production noted there)
      for (const [en, at] of Object.entries(e.envs)) if (!has(en)) db.prepare("INSERT INTO hr_update_envs(update_id,env,at,version,by) VALUES(?,?,?,?,?)").run(row.id, en, at, e.commit, "auto");
      // dev came first: on another environment an entry without a dev date has the date it was written
      if (env !== "dev" && !has("dev") && !e.envs.dev) db.prepare("INSERT INTO hr_update_envs(update_id,env,at,version,by) VALUES(?,?,?,?,?)").run(row.id, "dev", muscat(e.day), e.commit, "auto");
      // and the environment this server runs in: now, with this deploy's version
      if (!has(env)) { db.prepare("INSERT INTO hr_update_envs(update_id,env,at,version,by) VALUES(?,?,?,?,?)").run(row.id, env, now, version, by); stamped++; }
    }
    const last = db.prepare("SELECT version FROM hr_deploys WHERE env=? ORDER BY id DESC LIMIT 1").get(env);
    if (!last || last.version !== version || stamped) db.prepare("INSERT INTO hr_deploys(env,at,version,by,entries) VALUES(?,?,?,?,?)").run(env, now, version, by, stamped);
  });
  return { env, version, added, stamped, skipped: skipped.length };
}

const clean = (v, max) => String(v ?? "").trim().slice(0, max);
function cleanEntry(b, cur = {}) {
  const o = {};
  for (const k of ["title_en", "title_ar"]) if (k in b) o[k] = clean(b[k], 200);
  for (const k of ["desc_en", "desc_ar"]) if (k in b) o[k] = clean(b[k], 2000);
  if ("area" in b) { if (!AREAS.includes(b.area)) throw Object.assign(new HttpError(400, "invalid", "Choose an HR area"), { field: "area" }); o.area = b.area; }
  if ("type" in b) { if (!TYPES.includes(b.type)) throw Object.assign(new HttpError(400, "invalid", "Choose a type"), { field: "type" }); o.type = b.type; }
  if ("hidden" in b) o.hidden = b.hidden ? 1 : 0;
  const m = { ...cur, ...o };
  if (!m.title_en && !m.title_ar) throw Object.assign(new HttpError(400, "invalid", "A title is needed (English or Arabic)"), { field: "title_en" });
  return o;
}
const isoDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

/** The entries with their environments; `from`–`to` (Muscat days) keep entries with a date in the range (in `env`, if given). */
export function listUpdates(db, { from, to, env, area, type, q, hidden = false } = {}) {
  const rows = db.prepare(`SELECT * FROM hr_updates ${hidden ? "" : "WHERE hidden=0"} ORDER BY day DESC, id DESC`).all();
  const envs = db.prepare("SELECT update_id, env, at, version, by FROM hr_update_envs ORDER BY at").all();
  const byId = new Map(); for (const e of envs) { if (!byId.has(e.update_id)) byId.set(e.update_id, []); byId.get(e.update_id).push(e); }
  const day = (at) => new Date(Date.parse(at) + 4 * 3600e3).toISOString().slice(0, 10); // the Muscat date
  const s = String(q || "").trim().toLowerCase();
  const out = [];
  for (const r of rows) {
    const all = (byId.get(r.id) || []).sort((a, b) => ENVS.indexOf(a.env) - ENVS.indexOf(b.env));
    const pick = all.filter((e) => !env || e.env === env);
    const inRange = pick.filter((e) => (!from || day(e.at) >= from) && (!to || day(e.at) <= to));
    if ((env || from || to) && !inRange.length) continue;
    if (area && r.area !== area) continue;
    if (type && r.type !== type) continue;
    if (s && ![r.title_en, r.title_ar, r.desc_en, r.desc_ar].some((v) => String(v || "").toLowerCase().includes(s))) continue;
    // listed under the first date that falls in the period
    const first = (inRange.length ? inRange : pick.length ? pick : all).map((e) => day(e.at)).sort()[0] || r.day;
    out.push({ ...r, hidden: !!r.hidden, date: first, envs: all.map((e) => ({ ...e, day: day(e.at) })) });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  return out;
}

export function registerUpdates(api, ctx) {
  const { db } = ctx;
  const view = (sess) => { if (!["hr", "admin"].includes(sess.user.role)) throw new HttpError(403, "forbidden", "You do not have permission for this"); };
  const admin = (sess) => { if (sess.user.role !== "admin") throw new HttpError(403, "forbidden", "Only Admin can change the updates list"); };
  const one = (id) => { const r = db.prepare("SELECT * FROM hr_updates WHERE id=?").get(Number(id)); if (!r) throw new HttpError(404, "not_found", "Update not found"); return r; };

  api.get("/api/hr-updates", (req, res) => {
    view(req.sess);
    const g = (k) => req.query.get(k) || "";
    for (const k of ["from", "to"]) if (g(k) && !isoDay(g(k))) throw new HttpError(400, "invalid", `${k} must be a date`);
    const items = listUpdates(db, { from: g("from"), to: g("to"), env: ENVS.includes(g("env")) ? g("env") : "", area: g("area"), type: g("type"), q: g("q"),
      hidden: req.sess.user.role === "admin" && g("hidden") === "1" });
    const first = db.prepare("SELECT min(at) at FROM hr_update_envs").get().at;
    const deploys = db.prepare("SELECT env, at, version, by, entries FROM hr_deploys ORDER BY id DESC LIMIT 20").all();
    send(req, res, 200, { items, env: envName(ctx.appEnv), first, deploys, areas: AREAS, types: TYPES, envs: ENVS, generated_at: nowIso(),
      by: req.sess.employee ? { name_ar: req.sess.employee.name_ar, name_en: req.sess.employee.name_en } : { name_en: req.sess.user.username, name_ar: req.sess.user.username } });
  });

  // Admin: an update added by hand (with the environment and date it reached)
  api.post("/api/hr-updates", async (req, res) => {
    admin(req.sess);
    const b = await readJson(req);
    const o = cleanEntry(b);
    const env = ENVS.includes(b.env) ? b.env : envName(ctx.appEnv);
    const day = isoDay(b.date) ? b.date : ctx.today();
    if (!o.area || !o.type) throw Object.assign(new HttpError(400, "invalid", "Choose an HR area and a type"), { field: o.area ? "type" : "area" });
    const id = tx(db, () => {
      const r = db.prepare(`INSERT INTO hr_updates(key,day,area,type,title_en,title_ar,desc_en,desc_ar,source,hidden,edited_by,edited_at,created_at) VALUES(?,?,?,?,?,?,?,?,'manual',0,?,?,?)`)
        .run(`manual-${crypto.randomUUID()}`, day, o.area, o.type, o.title_en || "", o.title_ar || "", o.desc_en || "", o.desc_ar || "", req.sess.user.id, nowIso(), nowIso());
      const id = Number(r.lastInsertRowid);
      db.prepare("INSERT INTO hr_update_envs(update_id,env,at,version,by) VALUES(?,?,?,?,?)").run(id, env, muscat(day), null, req.sess.user.username);
      audit(db, req.sess.user.id, "hr_update.add", "hr_update", id, null, { ...o, env, day });
      return id;
    });
    send(req, res, 201, { item: listUpdates(db, { hidden: true }).find((x) => x.id === id) });
  });

  // Admin: reword, re-file, hide or show an update; set the date an environment was reached (or remove it)
  api.put("/api/hr-updates/:id", async (req, res) => {
    admin(req.sess);
    const cur = one(req.params.id);
    const b = await readJson(req);
    const o = cleanEntry(b, cur);
    tx(db, () => {
      const cols = Object.keys(o);
      if (cols.length) db.prepare(`UPDATE hr_updates SET ${cols.map((c) => `${c}=?`).join(",")}, edited_by=?, edited_at=? WHERE id=?`).run(...cols.map((c) => o[c]), req.sess.user.id, nowIso(), cur.id);
      if (b.envs && typeof b.envs === "object") for (const [en, d] of Object.entries(b.envs)) {
        if (!ENVS.includes(en)) continue;
        if (d === null || d === "") db.prepare("DELETE FROM hr_update_envs WHERE update_id=? AND env=?").run(cur.id, en);
        else if (isoDay(d)) {
          const ex = db.prepare("SELECT at FROM hr_update_envs WHERE update_id=? AND env=?").get(cur.id, en);
          if (!ex) db.prepare("INSERT INTO hr_update_envs(update_id,env,at,version,by) VALUES(?,?,?,?,?)").run(cur.id, en, muscat(d), null, req.sess.user.username);
          else if (new Date(Date.parse(ex.at) + 4 * 3600e3).toISOString().slice(0, 10) !== d) db.prepare("UPDATE hr_update_envs SET at=? WHERE update_id=? AND env=?").run(muscat(d), cur.id, en);
        }
      }
      audit(db, req.sess.user.id, "hr_update.edit", "hr_update", cur.id, { title_en: cur.title_en, hidden: cur.hidden }, { ...o, envs: b.envs });
    });
    send(req, res, 200, { item: listUpdates(db, { hidden: true }).find((x) => x.id === cur.id) });
  });
}
