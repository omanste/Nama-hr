/* Append-only audit log: who did what, when, with before/after snapshots. */
import { nowIso } from "./db.mjs";
import { send, HttpError } from "./http.mjs";
import { can } from "./perm.mjs";

const strip = (o) => (o && typeof o === "object" ? JSON.stringify(o, (k, v) => (/^pw_/.test(k) ? undefined : v)) : o == null ? null : JSON.stringify(o));

export function audit(db, actorUserId, action, entity = null, entityId = null, before = null, after = null) {
  db.prepare("INSERT INTO audit_log(at,actor_user_id,action,entity,entity_id,before,after) VALUES(?,?,?,?,?,?,?)")
    .run(nowIso(), actorUserId ?? null, action, entity, entityId == null ? null : String(entityId), strip(before), strip(after));
}

export function registerAudit(api, ctx) {
  const { db } = ctx;
  api.get("/api/audit", (req, res) => {
    if (!can(req.sess, "audit.view")) throw new HttpError(403, "forbidden", "You do not have permission for this");
    const where = [], args = [];
    const q = req.query;
    if (q.get("entity")) { where.push("a.entity=?"); args.push(q.get("entity")); }
    if (q.get("entity_id")) { where.push("a.entity_id=?"); args.push(q.get("entity_id")); }
    if (q.get("before")) { where.push("a.id<?"); args.push(Number(q.get("before"))); }
    const rows = db.prepare(`SELECT a.*, u.username actor_username, e.name_ar actor_name, e.name_en actor_name_en
      FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id LEFT JOIN employees e ON e.id=u.employee_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY a.id DESC LIMIT 51`).all(...args);
    send(req, res, 200, { items: rows.slice(0, 50), more: rows.length > 50 });
  });
}
