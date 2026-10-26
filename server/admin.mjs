/* Admin: departments (with approvers), settings, user accounts. */
import { tx, getSetting, setSetting } from "./db.mjs";
import { send, readJson, HttpError } from "./http.mjs";
import { can } from "./perm.mjs";
import { audit } from "./audit.mjs";
import { createUser, ROLES, getEmployee } from "./employees.mjs";
import { tempPassword, setPassword } from "./auth.mjs";
import { isIsoDate } from "./leave.mjs";

export const DEFAULT_CONTRACT_TYPES = ["Unlimited", "Limited", "Probation", "Part-time"];
export function readSettings(db) {
  return {
    managers_approver_employee_id: getSetting(db, "managers_approver_employee_id", null),
    managers_approver_title: getSetting(db, "managers_approver_title", "ceo"),
    contract_types: getSetting(db, "contract_types", DEFAULT_CONTRACT_TYPES),
    work_day_end: getSetting(db, "work_day_end", "17:00"),
    ramadan_start: getSetting(db, "ramadan_start", null),
    ramadan_end: getSetting(db, "ramadan_end", null),
    ramadan_day_end: getSetting(db, "ramadan_day_end", "15:00"),
  };
}

export function registerAdmin(api, ctx) {
  const { db } = ctx;
  const need = (sess, action) => { if (!can(sess, action)) throw new HttpError(403, "forbidden", "You do not have permission for this"); };
  const invalid = (field, message) => Object.assign(new HttpError(400, "invalid", message), { field });

  // ---- departments
  const cleanDept = (b, cur) => {
    const out = {};
    for (const k of ["name_ar", "name_en"]) if (k in b) out[k] = String(b[k] ?? "").trim().slice(0, 100);
    if ("approver_employee_id" in b) {
      const v = b.approver_employee_id === null || b.approver_employee_id === "" ? null : Number(b.approver_employee_id);
      if (v !== null) { const e = getEmployee(db, v); if (!e || e.status === "resigned" || e.status === "terminated") throw invalid("approver_employee_id", "unknown or inactive employee"); }
      out.approver_employee_id = v;
    }
    if ("active" in b) out.active = b.active ? 1 : 0;
    if (!({ ...(cur || {}), ...out }).name_ar) throw invalid("name_ar", "Arabic name is required");
    return out;
  };
  api.get("/api/departments", (req, res) => {
    const items = db.prepare(`SELECT d.*, e.name_ar approver_name_ar, e.name_en approver_name_en,
      (SELECT count(*) FROM employees x WHERE x.department_id=d.id AND x.status IN ('active','on_leave')) staff_count
      FROM departments d LEFT JOIN employees e ON e.id=d.approver_employee_id ORDER BY d.name_ar`).all();
    send(req, res, 200, { items });
  });
  api.post("/api/departments", async (req, res) => {
    need(req.sess, "settings.edit");
    const v = cleanDept(await readJson(req));
    const d = tx(db, () => {
      const cols = Object.keys(v);
      const r = db.prepare(`INSERT INTO departments(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`).run(...cols.map((c) => v[c]));
      const row = db.prepare("SELECT * FROM departments WHERE id=?").get(r.lastInsertRowid);
      audit(db, req.sess.user.id, "department.create", "department", row.id, null, row);
      return row;
    });
    send(req, res, 201, { department: d });
  });
  api.put("/api/departments/:id", async (req, res) => {
    need(req.sess, "settings.edit");
    const cur = db.prepare("SELECT * FROM departments WHERE id=?").get(Number(req.params.id));
    if (!cur) throw new HttpError(404, "not_found", "Department not found");
    const v = cleanDept(await readJson(req), cur);
    const d = tx(db, () => {
      const cols = Object.keys(v);
      if (cols.length) db.prepare(`UPDATE departments SET ${cols.map((c) => `${c}=?`).join(",")} WHERE id=?`).run(...cols.map((c) => v[c]), cur.id);
      const row = db.prepare("SELECT * FROM departments WHERE id=?").get(cur.id);
      audit(db, req.sess.user.id, "department.update", "department", cur.id, cur, row);
      return row;
    });
    send(req, res, 200, { department: d });
  });

  // ---- settings
  api.get("/api/settings", (req, res) => send(req, res, 200, readSettings(db)));
  api.put("/api/settings", async (req, res) => {
    need(req.sess, "settings.edit");
    const b = await readJson(req);
    const allowed = ["managers_approver_employee_id", "managers_approver_title", "contract_types", "work_day_end", "ramadan_start", "ramadan_end", "ramadan_day_end"];
    for (const k of ["work_day_end", "ramadan_day_end"]) if (k in b && !/^(1[0-9]|2[0-3]):(00|30)$/.test(String(b[k]))) throw invalid(k, "time must be HH:MM (on the hour or half hour)");
    for (const k of ["ramadan_start", "ramadan_end"]) if (k in b && b[k] !== null && b[k] !== "" && !isIsoDate(b[k])) throw invalid(k, "must be a date");
    if ("ramadan_start" in b && b.ramadan_start === "") b.ramadan_start = null;
    if ("ramadan_end" in b && b.ramadan_end === "") b.ramadan_end = null;
    for (const k of Object.keys(b)) if (!allowed.includes(k)) throw invalid(k, `unknown setting ${k}`);
    if ("managers_approver_employee_id" in b && b.managers_approver_employee_id !== null && !getEmployee(db, b.managers_approver_employee_id)) throw invalid("managers_approver_employee_id", "unknown employee");
    if ("managers_approver_title" in b && !["ceo", "chairman"].includes(b.managers_approver_title)) throw invalid("managers_approver_title", "title must be ceo or chairman");
    if ("contract_types" in b && (!Array.isArray(b.contract_types) || !b.contract_types.every((x) => typeof x === "string" && x.trim()))) throw invalid("contract_types", "contract types must be a list of names");
    const before = readSettings(db);
    tx(db, () => {
      for (const k of Object.keys(b)) setSetting(db, k, k === "managers_approver_employee_id" && b[k] !== null ? Number(b[k]) : k === "contract_types" ? b[k].map((x) => x.trim()) : b[k]);
      audit(db, req.sess.user.id, "settings.update", "settings", null, before, readSettings(db));
    });
    send(req, res, 200, readSettings(db));
  });

  // ---- users
  api.get("/api/users", (req, res) => {
    need(req.sess, "users.manage");
    const items = db.prepare(`SELECT u.id,u.username,u.role,u.active,u.must_change,u.employee_id,u.last_login_at,u.auth_provider,e.emp_no,e.name_ar,e.name_en
      FROM users u LEFT JOIN employees e ON e.id=u.employee_id ORDER BY u.username`).all();
    send(req, res, 200, { items });
  });
  api.post("/api/users", async (req, res) => {
    need(req.sess, "users.manage");
    const b = await readJson(req);
    send(req, res, 201, tx(db, () => createUser(db, req.sess, { username: b.username, role: b.role || "staff", employee_id: b.employee_id ? Number(b.employee_id) : null })));
  });
  api.put("/api/users/:id", async (req, res) => {
    need(req.sess, "users.manage");
    const cur = db.prepare("SELECT id,username,role,active,employee_id FROM users WHERE id=?").get(Number(req.params.id));
    if (!cur) throw new HttpError(404, "not_found", "User not found");
    const b = await readJson(req);
    if ("role" in b && !ROLES.includes(b.role)) throw invalid("role", "unknown role");
    if (cur.id === req.sess.user.id && (b.active === false || (b.role && b.role !== "admin"))) throw invalid("role", "You cannot remove your own admin access");
    tx(db, () => {
      if ("role" in b) db.prepare("UPDATE users SET role=? WHERE id=?").run(b.role, cur.id);
      if ("active" in b) { db.prepare("UPDATE users SET active=? WHERE id=?").run(b.active ? 1 : 0, cur.id); if (!b.active) db.prepare("DELETE FROM sessions WHERE user_id=?").run(cur.id); }
      audit(db, req.sess.user.id, "user.update", "user", cur.id, cur, db.prepare("SELECT id,username,role,active,employee_id FROM users WHERE id=?").get(cur.id));
    });
    send(req, res, 200, { user: db.prepare("SELECT id,username,role,active,employee_id FROM users WHERE id=?").get(cur.id) });
  });
  api.post("/api/users/:id/reset", (req, res) => {
    need(req.sess, "users.manage");
    const cur = db.prepare("SELECT id FROM users WHERE id=?").get(Number(req.params.id));
    if (!cur) throw new HttpError(404, "not_found", "User not found");
    const pw = tempPassword();
    tx(db, () => {
      setPassword(db, cur.id, pw, true);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(cur.id);
      audit(db, req.sess.user.id, "user.reset_password", "user", cur.id);
    });
    send(req, res, 200, { tempPassword: pw });
  });
}
