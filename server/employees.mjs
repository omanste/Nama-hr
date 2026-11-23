/* Staff profiles: list, view, create, edit, balance adjustments, logins from a profile. */
import fs from "node:fs";
import path from "node:path";
import { nowIso, tx, getSetting } from "./db.mjs";
import { send, readJson, HttpError } from "./http.mjs";
import { can, canViewEmployee, approvedDepartments } from "./perm.mjs";
import { audit } from "./audit.mjs";
import { isIsoDate, ANNUAL, DAY, fmtDays, addDays, TYPES } from "./leave.mjs";
import { postLedger, leaveSummary, ledgerRows, yearStartFor, balanceOf, pendingMinutes } from "./ledger.mjs";
import { tempPassword, hashPassword } from "./auth.mjs";
import { toCountryCode } from "../public/js/countries.js";
import { permissionSummary } from "./permissions.mjs";
import { rerouteFallbacks, rerouteFor } from "./requests.mjs";
import { SHIFTS, SELF_SHIFTS, defaultShiftNo, shiftOn } from "./shifts.mjs";
import { PHONE_FIELDS, cleanPhone, cleanRelation } from "./phone.mjs";
import { recordSelfChange, pendingChangesOf } from "./profile-changes.mjs";
import { removeUpload } from "./files.mjs";

const CONTACT = ["mobile", "personal_phone", "personal_email", "perm_wilayat", "current_area", "address", "emergency_name", "emergency_relation", "emergency_phone"];
const BANK = ["bank_name", "bank_account", "bank_iban"];
/** A consultant sees how the company is organised, not people's private papers: these stay out of what they're sent. */
const PRIVATE = ["civil_id", "civil_id_expiry", "passport_no", "passport_expiry", "visa_expiry", "dob", "personal_email", "personal_phone", "address",
  "perm_wilayat", "current_area", "emergency_name", "emergency_relation", "emergency_phone", ...BANK];
export const isConsultant = (sess) => sess.user.role === "consultant";
/** Who sees bank details: the person, HR, Admin and Accounts (salary transfer). */
const seesBank = (sess, emp) => ["hr", "admin", "accounts"].includes(sess.user.role) || (sess.employee && sess.employee.id === emp.id);
/** Oman IBAN: OM + 2 check digits + 3-digit bank code + 16 characters, checked with mod 97. */
export function validIban(s) {
  if (!/^OM\d{2}\d{3}[0-9A-Z]{16}$/.test(s)) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let m = 0; for (const d of r) m = (m * 10 + Number(d)) % 97;
  return m === 1;
}
export const STATUSES = ["active", "on_leave", "resigned", "terminated", "disabled"];
const GONE = ["resigned", "terminated", "disabled"]; // no access to the portal
const LEFT = ["resigned", "terminated"]; // left the company: the last working day is kept
const TEXT = ["name_ar", "name_en", "civil_id", "passport_no", "nationality", "mobile", "address", "emergency_name", "emergency_relation", "emergency_phone", "job_title", "contract_type"];
const DATES = ["civil_id_expiry", "passport_expiry", "visa_expiry", "dob", "join_date", "contract_end", "last_working_day"];
export const LONG = ["education", "specialization", "experience", "languages", "skills", "certifications", "main_tasks"];
export const FIELDS = ["emp_no", ...TEXT, ...LONG, "email", ...DATES, "department_id", "manager_employee_id", "status", "gender", "shift", "shift_locked", "faceid_exempt", "verify_photo", "verify_faceid", "verify_location", "att_mode", "reports_to_top", "personal_email", "personal_phone", "perm_wilayat", "current_area", ...BANK];
export const GENDERS = ["male", "female"];
const EXPIRIES = ["civil_id_expiry", "passport_expiry", "visa_expiry"];
/** An email as typed on any keyboard: without invisible direction marks, zero-width characters and spaces, in lower case. */
export const cleanEmail = (v) => String(v ?? "").replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\s]/g, "").replace(/＠/g, "@").replace(/。|．/g, ".").toLowerCase();
export const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/;

const bad = (field, message) => Object.assign(new HttpError(400, "invalid", message), { field });

/** Staff IDs are written one way: NAMA- and at least three digits ("nama 7", "NAMA-07" → "NAMA-007"). Others stay as typed. */
export function normEmpNo(v) {
  const s = String(v ?? "").trim();
  const m = /^nama\s*[-_ ]?\s*(\d{1,6})$/i.exec(s);
  return m ? `NAMA-${String(Number(m[1])).padStart(3, "0")}` : s;
}
/** The record that already has this staff ID — NAMA-07 and NAMA-007 are the same number. */
export function empNoHolder(db, empNo, exceptId = 0) {
  const key = normEmpNo(empNo).toUpperCase();
  return db.prepare("SELECT id, emp_no, name_ar, name_en FROM employees WHERE id<>?").all(exceptId || 0).find((e) => normEmpNo(e.emp_no).toUpperCase() === key) || null;
}

export function nextEmpNo(db) {
  const rows = db.prepare("SELECT emp_no FROM employees WHERE emp_no LIKE 'NAMA-%'").all();
  const max = rows.reduce((m, r) => Math.max(m, Number((/^NAMA-(\d+)$/i.exec(r.emp_no) || [0, 0])[1])), 0);
  return `NAMA-${String(max + 1).padStart(3, "0")}`;
}

/** Validate and clean a profile payload; `cur` is the existing row on update. */
export function cleanEmployee(db, body, cur = null, { today = null, form = false } = {}) {
  const out = {};
  for (const k of FIELDS) {
    if (!(k in body)) continue;
    let v = body[k];
    if (typeof v === "string") v = v.trim();
    if (v === "" || v === undefined) v = null;
    if (DATES.includes(k) && v !== null && !isIsoDate(v)) throw bad(k, `${k} must be a valid date (YYYY-MM-DD)`);
    // an ID / passport / visa expiring today is nearly always a phone's date picker filling in today: it must be confirmed
    if (today && EXPIRIES.includes(k) && v === today && (!cur || cur[k] !== v) && !body.confirm_past)
      throw Object.assign(new HttpError(409, "expiry_today", "Today as the expiry date? Check the date on the document"), { field: k });
    if ((k === "email" || k === "personal_email") && v !== null) {
      v = cleanEmail(v) || null; // invisible marks a phone keyboard adds, spaces, a full-width ＠
      if (v !== null && !EMAIL_RE.test(v)) throw bad(k, "email is not valid");
    }
    if (k === "bank_account" && v !== null) { v = v.replace(/[\s-]/g, ""); if (!/^\d{6,20}$/.test(v)) throw bad(k, "The account number is 6–20 digits"); }
    if (k === "bank_iban" && v !== null) { v = v.replace(/\s/g, "").toUpperCase(); if (!validIban(v)) throw bad(k, "Not a valid Oman IBAN (OM + 21 characters)"); }
    if (k === "status" && !STATUSES.includes(v ?? "active")) throw bad(k, "unknown status");
    if (k === "status" && v === null) v = "active";
    if (k === "gender" && v !== null && !GENDERS.includes(v)) throw bad(k, "gender must be male or female");
    if (k === "shift") { if (v === null) continue; v = Number(v); if (!SHIFTS.includes(v)) throw bad(k, "shift must be Flexible (5), 10–5 (6) or 10–6 (7)"); }
    if (k === "shift_locked" || k === "faceid_exempt") v = v === true || v === 1 || v === "1" || v === "on" ? 1 : 0;
    if (["verify_photo", "verify_faceid", "verify_location"].includes(k)) { if (v === "" || v === "default") v = null; if (v !== null && !["on", "off"].includes(v)) throw bad(k, "Default, On or Off"); }
    if (k === "reports_to_top" && v !== null && !["ceo", "chairman", "both"].includes(v)) throw bad(k, "reports to must be the CEO, the Chairman or both");
    if (k === "att_mode") { if (v === null) v = "both"; if (!["machine", "online", "both"].includes(v)) throw bad(k, "attendance method must be machine, online or both"); }
    if ((k === "name_ar" || k === "name_en") && v === null) v = ""; // names are never NULL, just empty
    // every phone: the full international number (+96899123456); an 8-digit number is Omani
    if (PHONE_FIELDS.includes(k)) { const p = cleanPhone(v); if (p.error) throw bad(k, p.error); v = p.value; }
    if (k === "emergency_relation") { const r = cleanRelation(db, v); if (r.error) throw bad(k, r.error); v = r.value; }
    if (k === "nationality" && v !== null) v = toCountryCode(v); // stored as a country code, e.g. "OM"
    if (k === "department_id" && v !== null && !db.prepare("SELECT 1 FROM departments WHERE id=?").get(Number(v))) throw bad(k, "unknown department");
    if (k === "manager_employee_id" && v !== null) {
      if (!db.prepare("SELECT 1 FROM employees WHERE id=?").get(Number(v))) throw bad(k, "unknown manager");
      if (cur && Number(v) === cur.id) throw bad(k, "an employee cannot be their own manager");
      // no loops: the new manager can't report (directly or higher up) to this person
      for (let m = Number(v), n = 0; m && n < 50; n++) {
        const up = db.prepare("SELECT manager_employee_id FROM employees WHERE id=?").get(m);
        m = up && up.manager_employee_id;
        if (cur && m === cur.id) throw bad(k, "This person is already above the chosen manager — choose someone else");
      }
    }
    if ((k === "department_id" || k === "manager_employee_id") && v !== null) v = Number(v);
    if (typeof v === "string" && v.length > (LONG.includes(k) ? 4000 : 300)) throw bad(k, `${k} is too long`);
    out[k] = v;
  }
  // a status set by hand: no longer the automatic "On leave"; Resigned / Terminated keep the last working day (needed on
  // the form), back to Active or On leave clears it
  if ("status" in out) {
    out.status_auto = 0;
    if (!LEFT.includes(out.status) && out.status !== "disabled" && !("last_working_day" in out)) out.last_working_day = null;
  }
  const merged = { ...(cur || {}), ...out };
  if (form && "status" in out && LEFT.includes(merged.status) && !merged.last_working_day) throw bad("last_working_day", "Enter the last working day");
  // the emergency contact: name, relationship and phone together (when any of them is given)
  const EM = ["emergency_name", "emergency_relation", "emergency_phone"];
  if (form && EM.some((k) => k in out && out[k] !== null)) for (const k of EM) if (!merged[k]) throw bad(k, "The emergency contact needs a name, a relationship and a phone number");
  if (!merged.name_ar && !merged.name_en) throw bad("name_ar", "Arabic or English name is required");
  if ("emp_no" in out || !cur) {
    if (!out.emp_no && !cur) out.emp_no = nextEmpNo(db);
    if ("emp_no" in out && !out.emp_no) throw bad("emp_no", "Employee ID is required");
    out.emp_no = normEmpNo(out.emp_no);
    // already used (the same number written another way counts too): say by whom, so it can be sorted out
    const dup = empNoHolder(db, out.emp_no, cur ? cur.id : 0);
    if (dup) throw Object.assign(new HttpError(409, "duplicate_emp_no", `Employee ID ${out.emp_no} is already used by ${dup.name_en || dup.name_ar} (${dup.emp_no}) — change that record first`), { field: "emp_no", extra: { holder: dup } });
  }
  return out;
}

export function insertEmployee(db, values, by) {
  const now = nowIso();
  if (values.shift === undefined || values.shift === null) values = { ...values, shift: defaultShiftNo() }; // new staff: the Flexible shift
  const cols = Object.keys(values);
  const r = db.prepare(`INSERT INTO employees(${cols.join(",")},created_at,updated_at) VALUES(${cols.map(() => "?").join(",")},?,?)`).run(...cols.map((c) => values[c]), now, now);
  return getEmployee(db, Number(r.lastInsertRowid));
}
export const getEmployee = (db, id) => db.prepare("SELECT * FROM employees WHERE id=?").get(Number(id));

function deactivateIfLeft(db, emp) {
  if (GONE.includes(emp.status)) {
    db.prepare("UPDATE users SET active=0 WHERE employee_id=?").run(emp.id);
    db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE employee_id=?)").run(emp.id);
  }
}

/** May this person pick their own shift? Company switch on (default) and not locked by HR. */
export const maySelfShift = (db, emp) => SELF_SHIFTS.includes(Number(emp.shift)) && getSetting(db, "shift_self_select", true) !== false && !emp.shift_locked; // never now: HR / Admin assign shifts

export function profile(db, sess, emp, today) {
  // archived copies (a renewed ID, passport or visa) only for HR and Admin
  const mine = sess.employee && sess.employee.id === emp.id;
  // archived copies (a renewed ID, passport or visa) only for HR and Admin; a consultant sees nobody's documents but their own
  const files = isConsultant(sess) && !mine ? [] : db.prepare(`SELECT id,kind,doc_type,name,mime,size,expiry,note,uploaded_at,archived_at,replaced_by FROM files WHERE employee_id=? AND request_id IS NULL AND voice_id IS NULL AND kind<>'checkin'
    ${["hr", "admin"].includes(sess.user.role) ? "" : "AND archived_at IS NULL"} ORDER BY uploaded_at DESC`).all(emp.id);
  if (isConsultant(sess) && !mine) { emp = { ...emp }; for (const k of PRIVATE) delete emp[k]; }
  const requests = db.prepare("SELECT * FROM leave_requests WHERE employee_id=? ORDER BY start_date DESC, id DESC").all(emp.id);
  const dept = emp.department_id ? db.prepare("SELECT * FROM departments WHERE id=?").get(emp.department_id) : null;
  const manager = emp.manager_employee_id ? db.prepare("SELECT id,emp_no,name_ar,name_en FROM employees WHERE id=?").get(emp.manager_employee_id) : null;
  const user = db.prepare("SELECT id,username,role,active FROM users WHERE employee_id=?").get(emp.id) || null;
  // bank details only for the person, HR, Admin and Accounts; what they changed themselves and HR hasn't verified yet
  const bank = seesBank(sess, emp);
  if (!bank) { emp = { ...emp }; for (const k of BANK) delete emp[k]; }
  const out = { employee: emp, department: dept, seesBank: bank,
    pendingChanges: mine || ["hr", "admin"].includes(sess.user.role) ? pendingChangesOf(db, emp.id) : undefined, manager, files, requests, leave: leaveSummary(db, emp, today), permissions: permissionSummary(db, emp.id, today),
    shiftSelf: !!(sess.employee && sess.employee.id === emp.id) && maySelfShift(db, emp),
    // the shift today, and a change waiting for a coming day
    shiftToday: shiftOn(db, emp, today), shiftNext: db.prepare("SELECT shift, from_date \"from\" FROM shift_history WHERE employee_id=? AND from_date>? ORDER BY from_date, id DESC LIMIT 1").get(emp.id, today) || null, login: can(sess, "employee.viewAll") ? user : undefined };
  if (can(sess, "ledger.adjust")) out.ledger = ledgerRows(db, emp.id);
  return out;
}

/** Nobody changes their own balance (Admin excepted: there is nobody above them to do it). */
export function notSelf(sess, emp) {
  if (sess.user.role === "admin") return;
  if (sess.employee && sess.employee.id === emp.id) throw new HttpError(403, "forbidden", "You can't do this on your own record");
}

/** The leave types that make a person "On leave" for the day (not short permissions, corrections or external tasks). */
const AWAY_TYPES = Object.keys(TYPES).filter((k) => !TYPES[k].permission && !TYPES[k].attendance && !TYPES[k].hours);
/** "On leave" follows approved leave: set while the person has approved leave today, back to Active when it ends — only
 * for people who are Active (or were put on leave this way); a status HR set by hand is never touched. Logged. */
export function syncLeaveStatus(db, today) {
  const onLeave = new Set(db.prepare(`SELECT DISTINCT employee_id id FROM leave_requests WHERE status='approved' AND start_date<=? AND coalesce(end_date,start_date)>=?
    AND type IN (${AWAY_TYPES.map(() => "?").join(",")})`).all(today, today, ...AWAY_TYPES).map((r) => r.id));
  const changed = [];
  tx(db, () => {
    for (const e of db.prepare("SELECT id, status, status_auto FROM employees WHERE status='active' OR (status='on_leave' AND status_auto=1)").all()) {
      const to = onLeave.has(e.id) ? "on_leave" : "active";
      if (to === e.status) continue;
      db.prepare("UPDATE employees SET status=?, status_auto=?, updated_at=? WHERE id=?").run(to, to === "on_leave" ? 1 : 0, nowIso(), e.id);
      audit(db, null, "employee.status", "employee", e.id, { status: e.status }, { status: to, auto: true, date: today });
      changed.push({ id: e.id, from: e.status, to });
    }
  });
  return changed;
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
    const today = ctx.today(), twoYearsAgo = addDays(today, -730);
    const items = db.prepare(`SELECT e.id,e.emp_no,e.name_ar,e.name_en,e.department_id,e.job_title,e.status,e.photo_file_id,e.join_date,e.civil_id_expiry,e.gender,
        (SELECT coalesce(sum(minutes),0) FROM leave_ledger l WHERE l.employee_id=e.id) remaining,
        (SELECT coalesce(sum(minutes),0) FROM leave_requests r WHERE r.employee_id=e.id AND r.type='annual' AND r.status='approved' AND r.start_date>=? AND r.start_date<=?) annual_taken_2y
      FROM employees e ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY e.name_ar COLLATE NOCASE, e.name_en`).all(twoYearsAgo, today, ...args);
    // Art. 81: at least 30 days of annual leave every 2 years
    for (const e of items) { e.under_30_in_2y = !!e.join_date && e.join_date <= twoYearsAgo && e.annual_taken_2y < 30 * DAY; if (isConsultant(sess)) delete e.civil_id_expiry; }
    send(req, res, 200, { items });
  });

  // the Staff tab (HR and Admin only): every record with its department in both languages, job title, join date, leave left
  // and status — the page filters, sorts and exports; and what is missing on the records
  api.get("/api/staff-list", (req, res) => {
    need(req.sess, "employee.edit");
    syncLeaveStatus(db, ctx.today());
    const items = db.prepare(`SELECT e.id,e.emp_no,e.name_ar,e.name_en,e.department_id,d.name_ar dept_ar,d.name_en dept_en,e.job_title,e.join_date,e.status,e.status_auto,
        e.last_working_day,e.photo_file_id,e.gender,(SELECT coalesce(sum(minutes),0) FROM leave_ledger l WHERE l.employee_id=e.id) remaining
      FROM employees e LEFT JOIN departments d ON d.id=e.department_id ORDER BY e.emp_no`).all();
    const current = items.filter((e) => e.status === "active" || e.status === "on_leave");
    const missing = { department: current.filter((e) => !e.department_id).length, job_title: current.filter((e) => !String(e.job_title || "").trim()).length,
      join_date: current.filter((e) => !e.join_date).length, name_ar: current.filter((e) => !String(e.name_ar || "").trim()).length, name_en: current.filter((e) => !String(e.name_en || "").trim()).length };
    send(req, res, 200, { items, missing, day: DAY, generated_at: nowIso(), by: req.sess.employee ? { name_ar: req.sess.employee.name_ar, name_en: req.sess.employee.name_en } : { name_en: req.sess.user.username, name_ar: req.sess.user.username } });
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
      const e = insertEmployee(db, cleanEmployee(db, body, null, { today: ctx.today(), form: true }), req.sess.user.id);
      const today = ctx.today();
      if (opening !== null) postLedger(db, e, { kind: "opening", minutes: Math.round(opening * DAY), date: today, note: "Opening balance", by: req.sess.user.id });
      else if (e.join_date) postLedger(db, e, { kind: "annual_credit", minutes: ANNUAL, date: today, yearStart: yearStartFor(e, today), note: "Yearly entitlement", by: req.sess.user.id });
      audit(db, req.sess.user.id, "employee.create", "employee", e.id, null, e);
      return e;
    });
    send(req, res, 201, { employee: emp });
  });

  // staff keep their own contact details current; the work e-mail stays with HR/Admin
  // sections people keep up to date themselves (HR/Admin can too): saved at once; their own changes go to HR/Admin to verify
  // `hrOnly`: fields only HR / Admin may change here (the work e-mail on Contact); from anyone else they're ignored
  const selfSection = (name, fields, hrOnly = []) => api.put(`/api/employees/:id/${name}`, async (req, res) => {
    const cur = getEmployee(db, req.params.id);
    if (!cur) throw new HttpError(404, "not_found", "Employee not found");
    if (!can(req.sess, "employee.edit") && cur.id !== req.sess.user.employee_id) throw new HttpError(403, "forbidden", "You do not have permission for this");
    const b = await readJson(req);
    const allowed = can(req.sess, "employee.edit") ? [...fields, ...hrOnly] : fields;
    const body = Object.fromEntries(allowed.filter((k) => k in b).map((k) => [k, b[k]]));
    const values = cleanEmployee(db, { ...body, confirm_past: !!b.confirm_past }, cur, { today: ctx.today(), form: true });
    const emp = tx(db, () => {
      const cols = Object.keys(values);
      if (cols.length) db.prepare(`UPDATE employees SET ${cols.map((c) => `${c}=?`).join(",")},updated_at=? WHERE id=?`).run(...cols.map((c) => values[c]), nowIso(), cur.id);
      const e = getEmployee(db, cur.id);
      audit(db, req.sess.user.id, `employee.${name}`, "employee", cur.id, Object.fromEntries(cols.map((c) => [c, cur[c]])), values);
      recordSelfChange(ctx, req.sess, cur, cur, Object.fromEntries(cols.map((c) => [c, e[c]])), name);
      return e;
    });
    send(req, res, 200, { employee: emp });
  });
  selfSection("contact", CONTACT, ["email"]);
  selfSection("qualifications", LONG);
  selfSection("bank", BANK);
  // ID numbers and dates typed by hand (when a document couldn't be read) — HR verifies them like the rest
  selfSection("identity", ["civil_id", "civil_id_expiry", "passport_no", "passport_expiry", "visa_expiry"]);

  // staff choose their own shift while the company allows it and HR hasn't fixed theirs (policy §3: HR assigns it in writing)
  api.put("/api/employees/:id/shift", async (req, res) => {
    const cur = getEmployee(db, req.params.id);
    if (!cur) throw new HttpError(404, "not_found", "Employee not found");
    if (!(req.sess.employee && req.sess.employee.id === cur.id) || !maySelfShift(db, cur)) throw new HttpError(403, "forbidden", "HR sets your shift");
    const shift = Number((await readJson(req)).shift);
    if (!SELF_SHIFTS.includes(shift)) throw bad("shift", "shift must be 1 or 2");
    const emp = tx(db, () => {
      db.prepare("UPDATE employees SET shift=?, updated_at=? WHERE id=?").run(shift, nowIso(), cur.id);
      audit(db, req.sess.user.id, "employee.shift", "employee", cur.id, { shift: cur.shift }, { shift });
      return getEmployee(db, cur.id);
    });
    send(req, res, 200, { employee: emp });
  });

  api.put("/api/employees/:id", async (req, res) => {
    need(req.sess, "employee.edit");
    const cur = getEmployee(db, req.params.id);
    if (!cur) throw new HttpError(404, "not_found", "Employee not found");
    const values = cleanEmployee(db, await readJson(req), cur, { today: ctx.today(), form: true });
    // a person's check-in verification (Default / On / Off): Admin only
    if (["verify_photo", "verify_faceid", "verify_location"].some((k) => k in values) && req.sess.user.role !== "admin")
      throw new HttpError(403, "forbidden", "Only Admin can change a person's check-in verification");
    if (GONE.includes(values.status) && req.sess.user.role !== "admin"
      && db.prepare("SELECT 1 FROM users WHERE employee_id=? AND role IN ('admin','ceo','chairman')").get(cur.id))
      throw new HttpError(403, "forbidden", "Only Admin can end the service of an Admin or CEO");
    const emp = tx(db, () => {
      const cols = Object.keys(values);
      if (cols.length) db.prepare(`UPDATE employees SET ${cols.map((c) => `${c}=?`).join(",")},updated_at=? WHERE id=?`).run(...cols.map((c) => values[c]), nowIso(), cur.id);
      // a new shift applies from the next day: today (and the days before) keep the shift they were worked under
      if ("shift" in values && Number(values.shift) !== Number(cur.shift)) {
        const from = new Date(Date.parse(ctx.today() + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);
        if (!db.prepare("SELECT 1 FROM shift_history WHERE employee_id=?").get(cur.id))
          db.prepare("INSERT INTO shift_history(employee_id,shift,from_date,changed_by,changed_at) VALUES(?,?,?,?,?)").run(cur.id, cur.shift, "0001-01-01", null, nowIso());
        db.prepare("INSERT INTO shift_history(employee_id,shift,from_date,changed_by,changed_at) VALUES(?,?,?,?,?)").run(cur.id, values.shift, from, req.sess.user.id, nowIso());
        audit(db, req.sess.user.id, "employee.shift", "employee", cur.id, { shift: cur.shift }, { shift: values.shift, from });
      }
      const e = getEmployee(db, cur.id);
      deactivateIfLeft(db, e);
      const hasStart = db.prepare("SELECT 1 FROM leave_ledger WHERE employee_id=? AND kind IN ('annual_credit','opening')").get(e.id);
      if (e.join_date && !hasStart) {
        const today = ctx.today();
        postLedger(db, e, { kind: "annual_credit", minutes: ANNUAL, date: today, yearStart: yearStartFor(e, today), note: "Yearly entitlement", by: req.sess.user.id });
      }
      audit(db, req.sess.user.id, "employee.update", "employee", e.id, cur, e);
      if (e.status !== cur.status) audit(db, req.sess.user.id, "employee.status", "employee", e.id, { status: cur.status }, { status: e.status, last_working_day: e.last_working_day || null });
      return e;
    });
    // a new direct manager: their waiting requests go to them
    if ("manager_employee_id" in values && values.manager_employee_id !== cur.manager_employee_id) rerouteFor(ctx, emp.id);
    send(req, res, 200, { employee: emp });
  });

  api.post("/api/employees/:id/adjust", async (req, res) => {
    need(req.sess, "ledger.adjust");
    const emp = load(req.sess, req.params.id);
    notSelf(req.sess, emp);
    const { minutes, note } = await readJson(req);
    if (!Number.isInteger(minutes) || minutes === 0 || Math.abs(minutes) > 100 * DAY) throw bad("minutes", "Adjustment must be a non-zero whole number of minutes");
    if (!note || !String(note).trim()) throw bad("note", "A reason is required");
    tx(db, () => {
      const id = postLedger(db, emp, { kind: "adjustment", minutes, date: ctx.today(), note: String(note).trim().slice(0, 500), by: req.sess.user.id });
      audit(db, req.sess.user.id, "ledger.adjust", "employee", emp.id, null, { ledger_id: id, minutes, note });
    });
    send(req, res, 200, { leave: leaveSummary(db, emp, ctx.today()) });
  });

  // Art. 81: unused leave may be paid in cash (basic wage) only with the worker's written consent, kept on file.
  api.post("/api/employees/:id/encash", async (req, res) => {
    need(req.sess, "ledger.adjust");
    const emp = load(req.sess, req.params.id);
    notSelf(req.sess, emp);
    const { days, consent_file_id, note } = await readJson(req);
    const doc = consent_file_id && db.prepare("SELECT * FROM files WHERE id=? AND employee_id=? AND doc_type='consent'").get(Number(consent_file_id), emp.id);
    if (!doc) throw Object.assign(new HttpError(409, "consent_required", "Upload the employee's signed consent (document type: consent) first"), { field: "consent_file_id" });
    if (db.prepare("SELECT 1 FROM leave_ledger WHERE kind='encashment' AND file_id=?").get(doc.id))
      throw Object.assign(new HttpError(409, "consent_used", "This consent was already used for a payment; upload a new one"), { field: "consent_file_id" });
    const minutes = Math.round(Number(days) * DAY);
    if (!Number.isFinite(minutes) || minutes <= 0) throw bad("days", "Enter the number of days");
    const available = balanceOf(db, emp.id) - pendingMinutes(db, emp.id);
    if (minutes > available) throw new HttpError(409, "insufficient_balance", `Only ${fmtDays(available)} days are available`);
    tx(db, () => {
      const id = postLedger(db, emp, { kind: "encashment", minutes: -minutes, date: ctx.today(), note: `Paid in cash (basic wage), consent file #${doc.id}${note ? " — " + String(note).slice(0, 300) : ""}`, by: req.sess.user.id });
      db.prepare("UPDATE leave_ledger SET file_id=? WHERE id=?").run(doc.id, id);
      audit(db, req.sess.user.id, "ledger.encash", "employee", emp.id, null, { ledger_id: id, minutes, consent_file_id: doc.id });
    });
    send(req, res, 200, { leave: leaveSummary(db, emp, ctx.today()) });
  });

  // HR or Admin create a login from a profile. HR always creates a staff login; Admin may pick the role.
  // Disable: no access, hidden from the login list and the staff list, history kept. Enable brings the login back.
  api.post("/api/employees/:id/disable", async (req, res) => {
    need(req.sess, "employee.edit");
    const cur = getEmployee(db, req.params.id);
    if (!cur) throw new HttpError(404, "not_found", "Employee not found");
    if (cur.id === req.sess.user.employee_id) throw new HttpError(409, "self", "You cannot disable yourself");
    if (req.sess.user.role !== "admin" && db.prepare("SELECT 1 FROM users WHERE employee_id=? AND role IN ('admin','ceo','chairman')").get(cur.id))
      throw new HttpError(403, "forbidden", "Only Admin can disable an Admin or CEO");
    const e = tx(db, () => {
      db.prepare("UPDATE employees SET status='disabled', updated_at=? WHERE id=?").run(nowIso(), cur.id);
      const row = getEmployee(db, cur.id);
      deactivateIfLeft(db, row);
      audit(db, req.sess.user.id, "employee.disable", "employee", cur.id, { status: cur.status }, { status: "disabled" });
      return row;
    });
    send(req, res, 200, { employee: e });
  });
  api.post("/api/employees/:id/enable", async (req, res) => {
    need(req.sess, "employee.edit");
    const cur = getEmployee(db, req.params.id);
    if (!cur) throw new HttpError(404, "not_found", "Employee not found");
    const e = tx(db, () => {
      db.prepare("UPDATE employees SET status='active', updated_at=? WHERE id=?").run(nowIso(), cur.id);
      db.prepare("UPDATE users SET active=1 WHERE employee_id=?").run(cur.id);
      audit(db, req.sess.user.id, "employee.enable", "employee", cur.id, { status: cur.status }, { status: "active" });
      return getEmployee(db, cur.id);
    });
    rerouteFallbacks(ctx);
    send(req, res, 200, { employee: e });
  });
  // Delete for good: Admin only, and only a record with no leave, permission or message history (a mistake or duplicate)
  api.delete("/api/employees/:id", (req, res) => {
    if (req.sess.user.role !== "admin") throw new HttpError(403, "forbidden", "Only Admin can delete a staff record");
    const cur = getEmployee(db, req.params.id);
    if (!cur) throw new HttpError(404, "not_found", "Employee not found");
    if (cur.id === req.sess.user.employee_id) throw new HttpError(409, "self", "You cannot delete yourself");
    const history = db.prepare("SELECT (SELECT count(*) FROM leave_requests WHERE employee_id=?) + (SELECT count(*) FROM voice_messages WHERE employee_id=? OR to_employee_id=?) n").get(cur.id, cur.id, cur.id).n;
    if (history) throw new HttpError(409, "has_history", "This person has leave, permission or message history — disable instead, so the records are kept");
    const files = db.prepare("SELECT id FROM files WHERE employee_id=?").all(cur.id).map((f) => f.id);
    tx(db, () => {
      const u = db.prepare("SELECT id FROM users WHERE employee_id=?").get(cur.id);
      if (u) {
        if (db.prepare("SELECT 1 FROM leave_requests WHERE approver_user_id=? OR decided_by=? OR created_by=?").get(u.id, u.id, u.id) || db.prepare("SELECT 1 FROM voice_replies WHERE user_id=?").get(u.id))
          throw new HttpError(409, "has_history", "This person has approved or handled requests — disable instead, so the records are kept");
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
        db.prepare("DELETE FROM notifications WHERE user_id=?").run(u.id);
        db.prepare("DELETE FROM approver_cover WHERE approver_user_id=? OR deputy_user_id=?").run(u.id, u.id);
        db.prepare("UPDATE audit_log SET actor_user_id=NULL WHERE actor_user_id=?").run(u.id);
        db.prepare("DELETE FROM users WHERE id=?").run(u.id);
      }
      db.prepare("UPDATE employees SET manager_employee_id=NULL WHERE manager_employee_id=?").run(cur.id);
      db.prepare("UPDATE departments SET approver_employee_id=NULL WHERE approver_employee_id=?").run(cur.id);
      db.prepare("DELETE FROM leave_ledger WHERE employee_id=?").run(cur.id);
      db.prepare("DELETE FROM cap_reviews WHERE employee_id=?").run(cur.id);
      db.prepare("DELETE FROM files WHERE employee_id=?").run(cur.id);
      db.prepare("DELETE FROM employees WHERE id=?").run(cur.id);
      audit(db, req.sess.user.id, "employee.delete", "employee", cur.id, { emp_no: cur.emp_no, name_ar: cur.name_ar, name_en: cur.name_en }, null);
    });
    for (const id of files) removeUpload(ctx, id);
    send(req, res, 200, { ok: true });
  });

  api.post("/api/employees/:id/login", async (req, res) => {
    need(req.sess, "employee.edit");
    const emp = load(req.sess, req.params.id);
    const body = await readJson(req);
    const role = req.sess.user.role === "admin" && body.role ? body.role : "staff";
    const out = createUser(db, req.sess, { username: body.username || emp.emp_no, role, employee_id: emp.id });
    rerouteFallbacks(ctx);
    send(req, res, 201, out);
  });
}

export const ROLES = ["staff", "manager", "hr", "accounts", "ceo", "chairman", "consultant", "admin"];
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
