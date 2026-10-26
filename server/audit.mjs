/* Append-only audit log: who did what, when, with before/after snapshots. */
import { nowIso } from "./db.mjs";

const strip = (o) => (o && typeof o === "object" ? JSON.stringify(o, (k, v) => (/^pw_/.test(k) ? undefined : v)) : o == null ? null : JSON.stringify(o));

export function audit(db, actorUserId, action, entity = null, entityId = null, before = null, after = null) {
  db.prepare("INSERT INTO audit_log(at,actor_user_id,action,entity,entity_id,before,after) VALUES(?,?,?,?,?,?,?)")
    .run(nowIso(), actorUserId ?? null, action, entity, entityId == null ? null : String(entityId), strip(before), strip(after));
}
