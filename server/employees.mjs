/* Staff profiles: list, view, create, edit, balance adjustments, logins from a profile. */
import { nowIso, tx } from "./db.mjs";
import { send, readJson, HttpError } from "./http.mjs";
import { can, canViewEmployee, approvedDepartments } from "./perm.mjs";
import { audit } from "./audit.mjs";
import { isIsoDate, ANNUAL, DAY } from "./leave.mjs";
import { postLedger, leaveSummary, ledgerRows, yearStartFor } from "./ledger.mjs";
import { tempPassword, hashPassword } from "./auth.mjs";

export const STATUSES = ["active", "on_leave", "resigned", "terminated"];
const TEXT = ["name_ar", "name_en", "civil_id", "nationality", "mobile", "address", "emergency_name", "emergency_relation", "emergency_phone", "job_title", "contract_type"];
const DATES = ["civil_id_expiry", "dob", "join_date", "contract_end"];
export const FIELDS = ["emp_no", ...TEXT, "email", ...DATES, "department_id", "manager_employee_id", "status"];

const bad = (field, message) => Object.assign(new HttpError(400, "invalid", message), { field });

export function nextEmpNo(db) {
  const rows = db.prepare("SELECT emp_no FROM employees WHERE emp_no LIKE 'NAMA-%'").all();
  const max = rows.reduce((m, r) => Math.max(m, Number((/^NAMA-(\d+)$/i.exec(r.emp_no) || [0, 0])[1])), 0);
  return `NAMA-${String(max + 1).padStart(3, "0")}`;
}

/** Validate and clean a profile payload; `cur` is the existing row on update. */
export function cleanEmployee(db, body, cur = null) {
  const out = {};
  for (const k of FIELDS) {
    if (!(k in body)) continue;
    let v = body[k];
    if (typeof v === "string") v = v.trim();
    if (v === "" || v === undefined) v = null;
    if (DATES.includes(k) && v !== null && !isIsoDate(v)) throw bad(k, `${k} must be a valid date (YYYY-MM-DD)`);
    if (k === "email" && v !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw bad(k, "email is not valid");
    if (k === "status" && !STATUSES.includes(v ?? "active")) throw bad(k, "unknown status");
    if (k === "status" && v === null) v = "active";
    if (k === "department_id" && v !== null && !db.prepare("SELECT 1 FROM departments WHERE id=?").get(Number(v))) throw bad(k, "unknown department");
    if (k === "manager_employee_id" && v !== null) {
      if (!db.prepare("SELECT 1 FROM employees WHERE id=?").get(Number(v))) throw bad(k, "unknown manager");
      if (cur && Number(v) === cur.id) throw bad(k, "an employee cannot be their own manager");
    }
    if ((k === "department_id" || k === "manager_employee_id") && v !== null) v = Number(v);
    if (typeof v === "string" && v.length > 300) throw bad(k, `${k} is too long`);
    out[k] = v;
  }
  const merged = { ...(cur || {}), ...out };
  if (!merged.name_ar && !merged.name_en) throw bad("name_ar", "Arabic or English name is required");
  if ("emp_no" in out || !cur) {
    if (!out.emp_no && !cur) out.emp_no = nextEmpNo(db);
    if ("emp_no" in out && !out.emp_no) throw bad("emp_no", "Employee ID is required");
    const dup = db.prepare("SELECT id FROM employees WHERE emp_no=? AND id<>?").get(out.emp_no, cur ? cur.id : 0);
    if (dup) throw Object.assign(new HttpError(409, "duplicate_emp_no", `Employee ID ${out.emp_no} already exists`), { field: "emp_no" });
  }
  return out;
}

export function insertEmployee(db, values, by) {
  const now = nowIso();
  const cols = Object.keys(values);
  const r = db.prepare(`INSERT INTO employees(${cols.join(",")},created_at,updated_at) VALUES(${cols.map(() => "?").join(",")},?,?)`).run(...cols.map((c) => values[c]), now, now);
  return getEmployee(db, Number(r.lastInsertRowid));
}
export const getEmployee = (db, id) => db.prepare("SELECT * FROM employees WHERE id=?").get(Number(id));

function deactivateIfLeft(db, emp) {
  if (emp.status === "resigned" || emp.status === "terminated") {
    db.prepare("UPDATE users SET active=0 WHERE employee_id=?").run(emp.id);
    db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE employee_id=?)").run(emp.id);
  }
}

export function profile(db, sess, emp, today) {
  const files = db.prepare("SELECT id,kind,doc_type,name,mime,size,expiry,note,uploaded_at FROM files WHERE employee_id=? AND request_id IS NULL ORDER BY uploaded_at DESC").all(emp.id);
  const requests = db.prepare("SELECT * FROM leave_requests WHERE employee_id=? ORDER BY start_date DESC, id DESC").all(emp.id);
  const dept = emp.department_id ? db.prepare("SELECT * FROM departments WHERE id=?").get(emp.department_id) : null;
  const manager = emp.manager_employee_id ? db.prepare("SELECT id,emp_no,name_ar,name_en FROM employees WHERE id=?").get(emp.manager_employee_id) : null;
  const user = db.prepare("SELECT id,username,role,active FROM users WHERE employee_id=?").get(emp.id) || null;
  const out = { employee: emp, department: dept, manager, files, requests, leave: leaveSummary(db, emp, today), login: can(sess, "employee.viewAll") ? user : undefined };
  if (can(sess, "ledger.adjust")) out.ledger = ledgerRows(db, emp.id);
  return out;
}

export function registerEmployees(api, ctx) {
  const { db } = ctx;
  const need = (sess, action) => { if (!can(sess, action)) throw new HttpError(403, "forbidden", "You do not have permission for this"); };
  const load = (sess, id) => {
    const emp = getEmployee(db, id);
    if (!emp) throw new HttpError(404, "not_found", "Employee not found");
    if (!canViewEmployee(db, sess, emp)) throw new HttpError(403, "forbidden", "You do not have permission for this");
    return emp;
  };

  api.get("/api/employees", (req, res) => {
    const sess = req.sess;
    const where = [], args = [];
    if (!can(sess, "employee.viewAll")) {
      const depts = approvedDepartments(db, sess.employee && sess.employee.id);
      if (!depts.length) throw new HttpError(403, "forbidden", "You do not have permission for this");
      where.push(`(e.department_id IN (${depts.map(() => "?").join(",")}) OR e.id=?)`); args.push(...depts, sess.employee.id);
    }
    const q = (req.query.get("q") || "").trim().toLowerCase();
    if (q) { where.push("(lower(e.name_en) LIKE ? OR e.name_ar LIKE ? OR lower(e.emp_no) LIKE ? OR lower(coalesce(e.job_title,'')) LIKE ?)"); args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
    if (req.query.get("dept")) { where.push("e.department_id=?"); args.push(Number(req.query.get("dept"))); }
    if (req.query.get("status")) { where.push("e.status=?"); args.push(req.query.get("status")); }
    const items = db.prepare(`SELECT e.id,e.emp_no,e.name_ar,e.name_en,e.department_id,e.job_title,e.status,e.photo_file_id,e.join_date,e.civil_id_expiry,
        (SELECT coalesce(sum(minutes),0) FROM leave_ledger l WHERE l.employee_id=e.id) remaining
      FROM employees e ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY e.name_ar COLLATE NOCASE, e.name_en`).all(...args);
    send(req, res, 200, { items });
  });

  api.get("/api/employees/:id", (req, res) => send(req, res, 200, profile(db, req.sess, load(req.sess, req.params.id), ctx.today())));

  api.post("/api/employees", async (req, res) => {
    need(req.sess, "employee.edit");
    const body = await readJson(req);
    let opening = null;
    if (body.opening_days !== undefined && body.opening_days !== null && body.opening_days !== "") {
      opening = Number(body.opening_days);
      if (!Number.isFinite(opening) || opening < 0) throw bad("opening_days", "Opening balance must be a number of days, 0 or more");
    }
    const emp = tx(db, () => {
      const e = insertEmployee(db, cleanEmployee(db, body), req.sess.user.id);
      const today = ctx.today();
      if (opening !== null) postLedger(db, e, { kind: "opening", minutes: Math.round(opening * DAY), date: today, note: "Opening balance", by: req.sess.user.id });
      else if (e.join_date) postLedger(db, e, { kind: "annual_credit", minutes: ANNUAL, date: today, yearStart: yearStartFor(e, today), note: "Yearly entitlement", by: req.sess.user.id });
      audit(db, req.sess.user.id, "employee.create", "employee", e.id, null, e);
      return e;
    });
    send(req, res, 201, { employee: emp });
  });

  api.put("/api/employees/:id", async (req, res) => {
    need(req.sess, "employee.edit");
    const cur = getEmployee(db, req.params.id);
    if (!cur) throw new HttpError(404, "not_found", "Employee not found");
    const values = cleanEmployee(db, await readJson(req), cur);
    const emp = tx(db, () => {
      const cols = Object.keys(values);
      if (cols.length) db.prepare(`UPDATE employees SET ${cols.map((c) => `${c}=?`).join(",")},updated_at=? WHERE id=?`).run(...cols.map((c) => values[c]), nowIso(), cur.id);
      const e = getEmployee(db, cur.id);
      deactivateIfLeft(db, e);
      audit(db, req.sess.user.id, "employee.update", "employee", e.id, cur, e);
      return e;
    });
    send(req, res, 200, { employee: emp });
  });

  api.post("/api/employees/:id/adjust", async (req, res) => {
    need(req.sess, "ledger.adjust");
    const emp = load(req.sess, req.params.id);
    const { minutes, note } = await readJson(req);
    if (!Number.isInteger(minutes) || minutes === 0 || Math.abs(minutes) > 100 * DAY) throw bad("minutes", "Adjustment must be a non-zero whole number of minutes");
    if (!note || !String(note).trim()) throw bad("note", "A reason is required");
    tx(db, () => {
      const id = postLedger(db, emp, { kind: "adjustment", minutes, date: ctx.today(), note: String(note).trim().slice(0, 500), by: req.sess.user.id });
      audit(db, req.sess.user.id, "ledger.adjust", "employee", emp.id, null, { ledger_id: id, minutes, note });
    });
    send(req, res, 200, { leave: leaveSummary(db, emp, ctx.today()) });
  });

  // HR or Admin create a login from a profile. HR always creates a staff login; Admin may pick the role.
  api.post("/api/employees/:id/login", async (req, res) => {
    need(req.sess, "employee.edit");
    const emp = load(req.sess, req.params.id);
    const body = await readJson(req);
    const role = req.sess.user.role === "admin" && body.role ? body.role : "staff";
    const out = createUser(db, req.sess, { username: body.username || emp.emp_no, role, employee_id: emp.id });
    send(req, res, 201, out);
  });
}

export const ROLES = ["staff", "hr", "accounts", "ceo", "admin"];
export function createUser(db, sess, { username, role, employee_id }) {
  username = String(username || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(username)) throw bad("username", "Username may use letters, digits, dot, dash and underscore");
  if (!ROLES.includes(role)) throw bad("role", "unknown role");
  if (employee_id && !db.prepare("SELECT 1 FROM employees WHERE id=?").get(employee_id)) throw bad("employee_id", "unknown employee");
  if (db.prepare("SELECT 1 FROM users WHERE username=?").get(username)) throw new HttpError(409, "duplicate_username", `Username ${username} is taken`);
  if (employee_id && db.prepare("SELECT 1 FROM users WHERE employee_id=?").get(employee_id)) throw new HttpError(409, "has_login", "This employee already has a login");
  const pw = tempPassword(), h = hashPassword(pw);
  const r = db.prepare("INSERT INTO users(username,employee_id,role,pw_hash,pw_salt,pw_iter,must_change,created_at) VALUES(?,?,?,?,?,?,1,?)")
    .run(username, employee_id || null, role, h.hash, h.salt, h.iter, nowIso());
  const user = db.prepare("SELECT id,username,role,employee_id,active FROM users WHERE id=?").get(r.lastInsertRowid);
  audit(db, sess ? sess.user.id : null, "user.create", "user", user.id, null, user);
  return { user, tempPassword: pw };
}
