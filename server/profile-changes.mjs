/* Changes staff make to their own profile (contact, qualifications, bank details, values read from an ID, photo) are saved at
 * once so the profile stays current; each one is listed for HR and Admin with the old and new values to confirm — or undo,
 * which puts the old values back. */
import { tx, nowIso } from "./db.mjs";
import { send, readJson, HttpError } from "./http.mjs";
import { can } from "./perm.mjs";
import { audit } from "./audit.mjs";
import { notify } from "./notify.mjs";

const same = (a, b) => String(a ?? "") === String(b ?? "");
const reviewers = (db, notUserId) => db.prepare("SELECT id FROM users WHERE role IN ('hr','admin') AND active=1 AND id<>?").all(notUserId || 0).map((u) => u.id);
const ownerUser = (db, empId) => (db.prepare("SELECT id FROM users WHERE employee_id=? AND active=1").get(empId) || {}).id;
const SOURCES = { contact: ["بيانات الاتصال", "contact details"], qualifications: ["المؤهلات", "qualifications"], bank: ["البيانات البنكية", "bank details"],
  id: ["بيانات من البطاقة", "details from an ID"], photo: ["الصورة الشخصية", "profile photo"] };

/** After a person saved their own profile: keep what changed for HR/Admin to verify. Changes HR or Admin make to others need no review. */
export function recordSelfChange(ctx, sess, emp, before, after, source) {
  if (!sess.employee || sess.employee.id !== emp.id) return null;
  const changes = {};
  for (const k of Object.keys(after)) if (!same(before[k], after[k])) changes[k] = [before[k] ?? null, after[k] ?? null];
  if (!Object.keys(changes).length) return null;
  const { db } = ctx;
  const id = Number(db.prepare("INSERT INTO profile_changes(employee_id,user_id,source,changes,created_at) VALUES(?,?,?,?,?)")
    .run(emp.id, sess.user.id, source, JSON.stringify(changes), nowIso()).lastInsertRowid);
  const [ar, en] = SOURCES[source] || [source, source];
  notify(ctx, reviewers(db, sess.user.id), { title_ar: "تحديث في ملف موظف بانتظار التحقق", title_en: "A profile update to verify",
    body_ar: `${emp.name_ar || emp.name_en}: ${ar}`, body_en: `${emp.name_en || emp.name_ar}: ${en}`, link: "#/profile-changes" });
  return id;
}

export const pendingChangesOf = (db, empId) => db.prepare("SELECT * FROM profile_changes WHERE employee_id=? AND status='pending' ORDER BY id").all(empId)
  .map((r) => ({ ...r, changes: JSON.parse(r.changes) }));

export function registerProfileChanges(api, ctx) {
  const { db } = ctx;
  const need = (sess) => { if (!["hr", "admin"].includes(sess.user.role)) throw new HttpError(403, "forbidden", "You do not have permission for this"); };

  api.get("/api/profile-changes", (req, res) => {
    need(req.sess);
    const status = req.query.get("status") || "pending";
    if (!["pending", "confirmed", "reverted", "all"].includes(status)) throw new HttpError(400, "invalid", "unknown status");
    const items = db.prepare(`SELECT c.*, e.emp_no, e.name_ar, e.name_en, e.photo_file_id, u.username, d.username decided_username
      FROM profile_changes c JOIN employees e ON e.id=c.employee_id LEFT JOIN users u ON u.id=c.user_id LEFT JOIN users d ON d.id=c.decided_by
      ${status === "all" ? "" : "WHERE c.status=?"} ORDER BY c.id DESC LIMIT 300`).all(...(status === "all" ? [] : [status]))
      .map((r) => ({ ...r, changes: JSON.parse(r.changes) }));
    send(req, res, 200, { items });
  });

  async function decide(req, res, action) {
    const sess = req.sess;
    need(sess);
    const note = String((await readJson(req)).note || "").trim().slice(0, 500);
    if (action === "revert" && !note) throw Object.assign(new HttpError(400, "invalid", "Give a reason for undoing it"), { field: "note" });
    const out = tx(db, () => {
      const c = db.prepare("SELECT * FROM profile_changes WHERE id=?").get(Number(req.params.id));
      if (!c) throw new HttpError(404, "not_found", "Not found");
      if (c.status !== "pending") throw new HttpError(409, "not_pending", "This change has already been reviewed");
      if (sess.employee && sess.employee.id === c.employee_id) throw new HttpError(403, "forbidden", "Someone else verifies changes to your own profile");
      const changes = JSON.parse(c.changes);
      let restored = [];
      if (action === "revert") {
        const cur = db.prepare("SELECT * FROM employees WHERE id=?").get(c.employee_id);
        // put back the old value only where nothing newer replaced it since
        restored = Object.keys(changes).filter((k) => k in cur && same(cur[k], changes[k][1]));
        if (restored.length) db.prepare(`UPDATE employees SET ${restored.map((k) => `${k}=?`).join(",")},updated_at=? WHERE id=?`)
          .run(...restored.map((k) => changes[k][0]), nowIso(), c.employee_id);
      }
      db.prepare("UPDATE profile_changes SET status=?, decided_by=?, decided_at=?, note=? WHERE id=?").run(action === "revert" ? "reverted" : "confirmed", sess.user.id, nowIso(), note || null, c.id);
      audit(db, sess.user.id, `profile_change.${action}`, "employee", c.employee_id, changes, { restored, note });
      return { c, restored };
    });
    const emp = db.prepare("SELECT * FROM employees WHERE id=?").get(out.c.employee_id);
    const [ar, en] = SOURCES[out.c.source] || [out.c.source, out.c.source];
    notify(ctx, [ownerUser(db, emp.id)].filter((id) => id && id !== sess.user.id), action === "revert"
      ? { title_ar: "أُعيد تحديثك في الملف إلى ما كان عليه", title_en: "HR undid your profile update", body_ar: `${ar} — ${note}`, body_en: `${en} — ${note}`, link: "#/me" }
      : { title_ar: "تحققت الموارد البشرية من تحديث ملفك", title_en: "HR verified your profile update", body_ar: ar, body_en: en, link: "#/me", inAppOnly: true });
    send(req, res, 200, { ok: true, restored: out.restored });
  }
  api.post("/api/profile-changes/:id/confirm", (req, res) => decide(req, res, "confirm"));
  api.post("/api/profile-changes/:id/revert", (req, res) => decide(req, res, "revert"));
}
