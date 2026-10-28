/* Attendance (policy 007/2026): HR uploads the fingerprint machine's export; each machine number is linked to a person once.
 * Each working day is measured against the person's shift — late from the first minute (no grace period), leaving early,
 * a missing punch (a correction request, never an automatic deduction), absence, leave, external tasks.
 * Nothing here applies a penalty: the sheet and reports inform people, HR and managers. */
import { tx, nowIso, getSetting, setSetting } from "./db.mjs";
import { send, sendRaw, readJson, HttpError } from "./http.mjs";
import { can, approvedDepartments } from "./perm.mjs";
import { audit } from "./audit.mjs";
import { notify } from "./notify.mjs";
import { getEmployee } from "./employees.mjs";
import { TYPES, PERMISSION_TYPES, isIsoDate, addDays, clockMin, permissionSpan } from "./leave.mjs";
import { shiftFor, isRestDay } from "./shifts.mjs";
import { readStamp } from "../public/js/punches.js";

const err = (status, code, message, field) => Object.assign(new HttpError(status, code, message), field ? { field } : {});
const forbidden = () => new HttpError(403, "forbidden", "You do not have permission for this");
const DUP_GAP = 15; // punches closer than this (minutes) are one punch pressed twice
const toMin = (at) => +at.slice(11, 13) * 60 + +at.slice(14, 16);
const MANAGERS = ["hr", "admin"]; // see everyone's attendance with names (policy §7, §18)
/** The CEO and the Chairman are outside the fingerprint policy: not measured, not in the reports. */
export const attendanceExempt = (db) => [getSetting(db, "managers_approver_employee_id", null), getSetting(db, "chairman_employee_id", null)].filter(Boolean).map(Number);

/** Merge [a,b] intervals and count how many minutes of [from,to] they don't cover. */
export function uncovered(from, to, intervals) {
  if (to <= from) return 0;
  let left = to - from;
  const iv = intervals.map(([a, b]) => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let cur = null;
  for (const [a, b] of iv) {
    if (!cur || a > cur[1]) { if (cur) left -= cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) left -= cur[1] - cur[0];
  return left;
}

/** One day of one person. ctx: {shift, rest, holiday, leave, pending, punches[min], excused[[a,b]], missions[[a,b]], correction:{in,out}|null, covered} */
export function computeDay(c) {
  const d = { status: "", in: null, out: null, late: 0, early: 0, onSite: 0, missing: null };
  if (!c.covered) return { ...d, status: "no_data" };
  // punches pressed twice within a few minutes count once
  const p = [];
  for (const m of [...c.punches].sort((a, b) => a - b)) if (!p.length || m - p[p.length - 1] >= DUP_GAP) p.push(m);
  let inn = p.length ? p[0] : null, out = p.length > 1 ? p[p.length - 1] : null;
  if (p.length === 1) { // one punch: before the middle of the shift it's the arrival, after it the leaving
    if (p[0] >= (c.shift.start + c.shift.end) / 2) { out = p[0]; inn = null; }
  }
  if (c.correction) { if (c.correction.in !== null) inn = c.correction.in; if (c.correction.out !== null) out = c.correction.out; }
  d.in = inn; d.out = out;
  const any = inn !== null || out !== null;
  if (inn !== null && out !== null) d.onSite = Math.max(0, out - inn);
  if (c.leave) return { ...d, status: "leave", leave: c.leave };
  if (c.holiday) return { ...d, status: any ? "holiday_worked" : "holiday" };
  if (c.rest) return { ...d, status: any ? "rest_worked" : "rest" };
  if (!any) {
    if (c.missions.length) return { ...d, status: "mission" };
    return { ...d, status: c.pending ? "pending" : "absent" };
  }
  const ok = [...c.excused, ...c.missions];
  if (inn !== null) d.late = uncovered(c.shift.start, Math.min(inn, c.shift.end), ok);
  if (out !== null) d.early = uncovered(Math.max(out, c.shift.start), c.shift.end, ok);
  if (inn === null || out === null) return { ...d, status: "missing", missing: inn === null ? "in" : "out" };
  return { ...d, status: "present" };
}

/** Days of a person between two dates, with what explains each. */
export function employeeDays(db, emp, from, to, today) {
  const nos = db.prepare("SELECT machine_no, first_date FROM att_devices WHERE employee_id=? AND ignored=0").all(emp.id);
  const dataFrom = nos.map((n) => n.first_date).filter(Boolean).sort()[0] || null;
  const dataTo = db.prepare("SELECT max(to_date) d FROM att_uploads").get().d;
  const punches = new Map();
  if (nos.length) {
    for (const r of db.prepare(`SELECT at FROM att_punches WHERE machine_no IN (${nos.map(() => "?").join(",")}) AND at>=? AND at<?`).all(...nos.map((n) => n.machine_no), from, addDays(to, 1))) {
      const k = r.at.slice(0, 10);
      if (!punches.has(k)) punches.set(k, []);
      punches.get(k).push(toMin(r.at));
    }
  }
  const reqs = db.prepare("SELECT * FROM leave_requests WHERE employee_id=? AND status IN ('pending','approved') AND start_date<=? AND end_date>=?").all(emp.id, to, from);
  const holidays = new Map(getSetting(db, "official_holidays", []).map((x) => [x.date, x.name]));
  const start = getSetting(db, "attendance_start", null);
  const days = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const shift = shiftFor(db, emp, date);
    const on = reqs.filter((r) => r.start_date <= date && r.end_date >= date);
    const approved = on.filter((r) => r.status === "approved");
    const leaveReq = approved.find((r) => !TYPES[r.type].permission && !TYPES[r.type].attendance && r.type !== "comp_day");
    const corr = approved.find((r) => r.type === "correction" && r.hr_class === "confirmed");
    const covered = !!(dataFrom && dataTo && date >= dataFrom && date <= dataTo && date <= today && (!emp.join_date || date >= emp.join_date));
    const day = computeDay({
      shift, covered, rest: isRestDay(date), holiday: holidays.has(date), leave: leaveReq ? leaveReq.type : null,
      pending: on.some((r) => r.status === "pending" && r.type !== "comp_day"),
      punches: punches.get(date) || [],
      excused: approved.filter((r) => PERMISSION_TYPES.includes(r.type)).map((r) => permissionSpan(r.type, { time: r.early_time, endTime: r.end_time, dayStart: shift.start, dayEnd: shift.end })),
      missions: approved.filter((r) => r.type === "mission").map((r) => [clockMin(r.early_time), clockMin(r.end_time)]),
      correction: corr ? { in: clockMin(corr.early_time), out: clockMin(corr.end_time) } : null,
    });
    day.date = date;
    day.shift = { no: shift.no, start: shift.start, end: shift.end, ramadan: shift.ramadan };
    day.info = !start || date < start; // before the policy applies: for information only (§17)
    if (holidays.has(date)) day.holiday = holidays.get(date);
    day.requests = on.map((r) => ({ id: r.id, type: r.type, status: r.status, hr_class: r.hr_class }));
    // the correction waits on the manager or HR
    const pc = on.find((r) => r.type === "correction" && (r.status === "pending" || !r.hr_class));
    if (pc) day.correctionPending = pc.id;
    days.push(day);
  }
  return { days, dataFrom, dataTo };
}

/** Totals over days (policy §18: approved leave and tasks are left out of the compliance rate). */
export function summarize(days) {
  const s = { workDays: 0, present: 0, onTime: 0, late: 0, lateMin: 0, early: 0, earlyMin: 0, missing: 0, absent: 0, pending: 0, leave: 0, mission: 0, restWorked: 0, onSite: 0, onSiteDays: 0, compliance: null };
  for (const d of days) {
    if (["rest_worked", "holiday_worked"].includes(d.status)) s.restWorked++;
    if (d.status === "leave") s.leave++;
    if (d.status === "mission") s.mission++;
    if (["present", "missing", "absent", "pending"].includes(d.status)) s.workDays++;
    if (d.status === "present" || d.status === "missing") {
      s.present++;
      if (d.late) { s.late++; s.lateMin += d.late; }
      if (d.early) { s.early++; s.earlyMin += d.early; }
      if (!d.late && !d.early && d.status === "present") s.onTime++;
    }
    if (d.status === "missing") s.missing++;
    if (d.status === "absent") s.absent++;
    if (d.status === "pending") s.pending++;
    if (d.onSite) { s.onSite += d.onSite; s.onSiteDays++; }
  }
  s.compliance = s.workDays ? Math.round((s.onTime / s.workDays) * 1000) / 10 : null;
  return s;
}

/** May this session see this person's attendance with their name? Themselves, HR/Admin, their department's approver or direct manager. */
export function canSeeAttendance(db, sess, emp) {
  if (!emp) return false;
  if (MANAGERS.includes(sess.user.role)) return true;
  if (!sess.employee) return false;
  if (sess.employee.id === emp.id || emp.manager_employee_id === sess.employee.id) return true;
  return approvedDepartments(db, sess.employee.id).includes(emp.department_id);
}
/** The people this session may see by name: everyone (HR/Admin), a manager's team, or nobody. */
function teamOf(db, sess) {
  const base = "SELECT e.*, d.name_ar dept_ar, d.name_en dept_en FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.status IN ('active','on_leave')";
  const ex = new Set(attendanceExempt(db));
  if (MANAGERS.includes(sess.user.role)) return db.prepare(`${base} ORDER BY e.name_ar`).all().filter((e) => !ex.has(e.id));
  if (!sess.employee) return [];
  const depts = approvedDepartments(db, sess.employee.id);
  return db.prepare(`${base} AND (e.manager_employee_id=? ${depts.length ? `OR e.department_id IN (${depts.map(() => "?").join(",")})` : ""}) AND e.id<>? ORDER BY e.name_ar`)
    .all(sess.employee.id, ...depts, sess.employee.id).filter((e) => !ex.has(e.id));
}

const words = (s) => String(s || "").toLowerCase().replace(/[^a-z؀-ۿ ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["al", "bin", "bint", "abdul"].includes(w));
/** The staff member whose name best matches a machine name (HR confirms). The first name must match; the machine may cut
 * names short ("AL OBAIDA" for Al Obaidani), so a machine word may be the start of a longer one, never the other way. */
function suggest(name, emps) {
  const w = words(name);
  if (!w.length) return null;
  const same = (x, y) => x === y || (x.length >= 4 && y.startsWith(x));
  let best = null, score = 0;
  for (const e of emps) {
    const ew = words(e.name_en);
    if (!ew.length || !ew.some((y) => same(w[0], y))) continue;
    const s = w.filter((x) => ew.some((y) => same(x, y))).length / Math.max(w.length, Math.min(ew.length, 3));
    if (s > score) { score = s; best = e; }
  }
  return score >= 0.5 ? { id: best.id, name_ar: best.name_ar, name_en: best.name_en, emp_no: best.emp_no } : null;
}

function lastDayOf(m) { const [y, mo] = m.split("-").map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`; }

/** The last full week (Sunday–Saturday) before today. */
export function lastWeek(today) {
  const dow = new Date(today + "T00:00:00Z").getUTCDay();
  const end = addDays(today, -dow - 1);
  return [addDays(end, -6), end];
}

/** Department totals (no names, §18) and, for HR or a manager, per person. */
export function attendanceReport(db, sess, from, to, today, deptId = 0) {
  const ex = new Set(attendanceExempt(db));
  const all = db.prepare("SELECT e.*, d.name_ar dept_ar, d.name_en dept_en FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.status IN ('active','on_leave') ORDER BY e.name_ar").all()
    .filter((e) => (!deptId || e.department_id === deptId) && !ex.has(e.id));
  const named = new Set(teamOf(db, sess).map((e) => e.id));
  const mineDepts = MANAGERS.includes(sess.user.role) || ["ceo", "chairman", "consultant", "accounts"].includes(sess.user.role) ? null : approvedDepartments(db, sess.employee && sess.employee.id);
  const depts = new Map();
  const people = [];
  for (const e of all) {
    if (mineDepts && !mineDepts.includes(e.department_id)) continue;
    const { days } = employeeDays(db, e, from, to, today);
    const s = summarize(days);
    if (!s.workDays && !s.leave && !s.mission && !s.restWorked) continue; // no data for this person in the period
    const key = e.department_id || 0;
    if (!depts.has(key)) depts.set(key, { id: key, name_ar: e.dept_ar || "", name_en: e.dept_en || "", staff: 0, ...summarize([]) });
    const t = depts.get(key);
    t.staff++;
    for (const k of Object.keys(s)) if (typeof s[k] === "number" && k !== "compliance") t[k] += s[k];
    if (named.has(e.id)) people.push({ employee: { id: e.id, emp_no: e.emp_no, name_ar: e.name_ar, name_en: e.name_en, dept_ar: e.dept_ar, dept_en: e.dept_en, shift: e.shift }, ...s });
  }
  const rows = [...depts.values()].map((t) => ({ ...t, compliance: t.workDays ? Math.round((t.onTime / t.workDays) * 1000) / 10 : null }));
  const total = rows.reduce((a, t) => { for (const k of Object.keys(t)) if (typeof t[k] === "number" && !["id", "compliance"].includes(k)) a[k] = (a[k] || 0) + t[k]; return a; }, {});
  total.compliance = total.workDays ? Math.round((total.onTime / total.workDays) * 1000) / 10 : null;
  // requests still open, and how long HR took to settle fingerprint corrections (§18)
  const ids = all.filter((e) => !mineDepts || mineDepts.includes(e.department_id)).map((e) => e.id);
  const inIds = ids.length ? `(${ids.join(",")})` : "(-1)";
  const open = db.prepare(`SELECT count(*) n FROM leave_requests WHERE employee_id IN ${inIds} AND start_date<=? AND end_date>=?
    AND (status='pending' OR (status='approved' AND hr_class IS NULL AND type IN ('early','late','break','correction')))`).get(to, from).n;
  const turn = db.prepare(`SELECT avg((julianday(hr_at)-julianday(created_at))*24) h, count(*) n FROM leave_requests WHERE employee_id IN ${inIds}
    AND type='correction' AND hr_at IS NOT NULL AND substr(hr_at,1,10)>=? AND substr(hr_at,1,10)<=?`).get(from, to);
  return { from, to, departments: rows, total, people, openRequests: open, correctionHours: turn.n ? Math.round(turn.h * 10) / 10 : null, corrections: turn.n,
    start: getSetting(db, "attendance_start", null), dataTo: db.prepare("SELECT max(to_date) d FROM att_uploads").get().d, named: named.size > 0 };
}

export function registerAttendance(api, ctx) {
  const { db } = ctx;
  const needHr = (sess) => { if (!can(sess, "import.run")) throw forbidden(); };

  // ---- upload: the punches the page read from the machine's file
  api.post("/api/attendance/upload", async (req, res) => {
    needHr(req.sess);
    const b = await readJson(req, 20 * 1024 * 1024);
    if (!Array.isArray(b.punches) || !b.punches.length) throw err(400, "invalid", "The file has no punches", "file");
    if (b.punches.length > 200000) throw err(413, "too_large", "Too many rows in one file");
    const rows = [];
    for (const p of b.punches) {
      const no = String(p && p.no || "").trim(), at = p && readStamp(p.at);
      if (!/^[A-Za-z0-9-]{1,20}$/.test(no) || !at) throw err(400, "invalid", `Unreadable row: ${JSON.stringify(p).slice(0, 80)}`, "file");
      rows.push({ no, at, name: String(p.name || "").trim().slice(0, 100) });
    }
    const dates = rows.map((r) => r.at.slice(0, 10)).sort();
    const out = tx(db, () => {
      const up = db.prepare("INSERT INTO att_uploads(name,rows,added,from_date,to_date,uploaded_by,uploaded_at) VALUES(?,?,0,?,?,?,?)")
        .run(String(b.name || "").slice(0, 200), rows.length, dates[0], dates[dates.length - 1], req.sess.user.id, nowIso());
      const id = Number(up.lastInsertRowid);
      const ins = db.prepare("INSERT OR IGNORE INTO att_punches(machine_no,at,upload_id) VALUES(?,?,?)");
      let added = 0;
      const seen = new Map();
      for (const r of rows) {
        added += ins.run(r.no, r.at, id).changes;
        const s = seen.get(r.no) || { name: "", first: r.at, last: r.at };
        if (r.name && !/^\d+$/.test(r.name)) s.name = r.name;
        if (r.at < s.first) s.first = r.at; if (r.at > s.last) s.last = r.at;
        seen.set(r.no, s);
      }
      for (const [no, s] of seen) {
        db.prepare(`INSERT INTO att_devices(machine_no,machine_name,first_date,last_date,updated_at) VALUES(?,?,?,?,?)
          ON CONFLICT(machine_no) DO UPDATE SET machine_name=coalesce(nullif(excluded.machine_name,''),machine_name),
          first_date=min(coalesce(first_date,excluded.first_date),excluded.first_date), last_date=max(coalesce(last_date,excluded.last_date),excluded.last_date), updated_at=excluded.updated_at`)
          .run(no, s.name, s.first.slice(0, 10), s.last.slice(0, 10), nowIso());
      }
      db.prepare("UPDATE att_uploads SET added=? WHERE id=?").run(added, id);
      audit(db, req.sess.user.id, "attendance.upload", "attendance", id, null, { name: b.name, rows: rows.length, added, from: dates[0], to: dates[dates.length - 1] });
      return { id, rows: rows.length, added, duplicates: rows.length - added, from: dates[0], to: dates[dates.length - 1] };
    });
    const unlinked = db.prepare("SELECT count(*) n FROM att_devices WHERE employee_id IS NULL AND ignored=0").get().n;
    send(req, res, 201, { ...out, unlinked });
  });

  api.get("/api/attendance/uploads", (req, res) => {
    needHr(req.sess);
    send(req, res, 200, { items: db.prepare(`SELECT u.*, us.username FROM att_uploads u LEFT JOIN users us ON us.id=u.uploaded_by ORDER BY u.id DESC LIMIT 20`).all() });
  });

  // ---- machine numbers ↔ staff
  api.get("/api/attendance/devices", (req, res) => {
    needHr(req.sess);
    const emps = db.prepare("SELECT id, emp_no, name_ar, name_en FROM employees WHERE status IN ('active','on_leave','disabled') ORDER BY name_ar").all();
    const items = db.prepare(`SELECT d.*, e.name_ar, e.name_en, e.emp_no, (SELECT count(*) FROM att_punches p WHERE p.machine_no=d.machine_no) punches
      FROM att_devices d LEFT JOIN employees e ON e.id=d.employee_id ORDER BY (d.employee_id IS NOT NULL OR d.ignored=1), CAST(d.machine_no AS INTEGER), d.machine_no`).all()
      .map((d, _i, all) => ({ ...d, suggestion: d.employee_id || d.ignored ? null : suggest(d.machine_name, emps.filter((e) => !all.some((x) => x.employee_id === e.id))) }));
    send(req, res, 200, { items, employees: emps });
  });
  api.put("/api/attendance/devices/:no", async (req, res) => {
    needHr(req.sess);
    const b = await readJson(req);
    const cur = db.prepare("SELECT * FROM att_devices WHERE machine_no=?").get(req.params.no);
    if (!cur) throw new HttpError(404, "not_found", "Unknown machine number");
    const empId = b.employee_id ? Number(b.employee_id) : null;
    if (empId && !getEmployee(db, empId)) throw err(400, "invalid", "Unknown employee", "employee_id");
    const ignored = b.ignored ? 1 : 0;
    db.prepare("UPDATE att_devices SET employee_id=?, ignored=?, updated_at=? WHERE machine_no=?").run(ignored ? null : empId, ignored, nowIso(), cur.machine_no);
    const after = db.prepare("SELECT * FROM att_devices WHERE machine_no=?").get(cur.machine_no);
    audit(db, req.sess.user.id, "attendance.link", "attendance_device", cur.machine_no, cur, after);
    send(req, res, 200, { device: after });
  });

  // ---- one person's month (the monthly sheet, §15)
  api.get("/api/attendance/employee/:id", (req, res) => {
    const emp = getEmployee(db, req.params.id);
    if (!emp) throw new HttpError(404, "not_found", "Not found");
    if (!canSeeAttendance(db, req.sess, emp)) throw forbidden();
    const today = ctx.today();
    const month = req.query.get("month") || today.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw err(400, "invalid", "month must be YYYY-MM", "month");
    const from = `${month}-01`, to = lastDayOf(month);
    const { days, dataFrom, dataTo } = employeeDays(db, emp, from, to, today);
    const review = db.prepare("SELECT r.*, u.username FROM att_reviews r LEFT JOIN users u ON u.id=r.user_id WHERE r.employee_id=? AND r.month=?").get(emp.id, month) || null;
    const linked = db.prepare("SELECT machine_no FROM att_devices WHERE employee_id=? AND ignored=0").all(emp.id).map((r) => r.machine_no);
    send(req, res, 200, { employee: { id: emp.id, emp_no: emp.emp_no, name_ar: emp.name_ar, name_en: emp.name_en, shift: emp.shift, join_date: emp.join_date },
      month, days, summary: summarize(days), review, linked, dataFrom, dataTo, start: getSetting(db, "attendance_start", null),
      own: !!(req.sess.employee && req.sess.employee.id === emp.id), exempt: attendanceExempt(db).includes(emp.id) });
  });
  // the person confirms they reviewed the month, or notes what is wrong (HR is told)
  api.post("/api/attendance/employee/:id/review", async (req, res) => {
    const emp = getEmployee(db, req.params.id);
    if (!emp || !(req.sess.employee && req.sess.employee.id === emp.id)) throw forbidden();
    const b = await readJson(req);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(b.month || ""))) throw err(400, "invalid", "month must be YYYY-MM", "month");
    const note = String(b.note || "").trim().slice(0, 1000) || null;
    db.prepare(`INSERT INTO att_reviews(employee_id,month,user_id,note,at) VALUES(?,?,?,?,?)
      ON CONFLICT(employee_id,month) DO UPDATE SET note=excluded.note, at=excluded.at, user_id=excluded.user_id`).run(emp.id, b.month, req.sess.user.id, note, nowIso());
    if (note) {
      const hr = db.prepare("SELECT id FROM users WHERE role='hr' AND active=1").all().map((u) => u.id);
      notify(ctx, hr, { title_ar: "ملاحظة على كشف الحضور", title_en: "A note on an attendance sheet", body_ar: `${emp.name_ar || emp.name_en} · ${b.month}: ${note}`, body_en: `${emp.name_en || emp.name_ar} · ${b.month}: ${note}`, link: `#/attendance?emp=${emp.id}&m=${b.month}` });
    }
    send(req, res, 200, { ok: true });
  });

  // ---- the people I can open (for the sheet's person picker)
  api.get("/api/attendance/people", (req, res) => {
    send(req, res, 200, { items: teamOf(db, req.sess).map((e) => ({ id: e.id, emp_no: e.emp_no, name_ar: e.name_ar, name_en: e.name_en })) });
  });

  // ---- weekly report (§18): by department without names; HR and managers also get their people
  api.get("/api/attendance/report", (req, res) => {
    const sess = req.sess;
    const mine = approvedDepartments(db, sess.employee && sess.employee.id);
    if (!["hr", "admin", "ceo", "chairman", "consultant", "accounts"].includes(sess.user.role) && !mine.length) throw forbidden();
    const today = ctx.today();
    let [from, to] = lastWeek(today);
    if (req.query.get("from")) from = req.query.get("from");
    if (req.query.get("to")) to = req.query.get("to");
    if (!isIsoDate(from) || !isIsoDate(to) || to < from) throw err(400, "invalid", "Choose a valid period");
    if (addDays(from, 500) < to) throw err(400, "invalid", "At most about 16 months at a time");
    const r = attendanceReport(db, sess, from, to, today, Number(req.query.get("department_id") || 0));
    if (req.query.get("format") === "csv") {
      const h = (m) => (m / 60).toFixed(1);
      const head = ["Work days", "On time", "Compliance %", "Late (times)", "Late (hours)", "Left early (times)", "Left early (hours)", "Missing punch", "Absent (unexcused)", "Absence pending a request", "Leave days", "External task days", "Worked on a rest day"];
      const vals = (s) => [s.workDays, s.onTime, s.compliance ?? "", s.late, h(s.lateMin), s.early, h(s.earlyMin), s.missing, s.absent, s.pending, s.leave, s.mission, s.restWorked];
      const lines = [["Department", "Staff", ...head].join(",")];
      for (const d of r.departments) lines.push([d.name_en || d.name_ar || "—", d.staff, ...vals(d)].join(","));
      if (r.people.length) {
        lines.push("", ["Employee ID", "Name (Arabic)", "Name (English)", "Department", "Shift", ...head].join(","));
        for (const p of r.people) lines.push([p.employee.emp_no, p.employee.name_ar, p.employee.name_en, p.employee.dept_en || p.employee.dept_ar || "", p.employee.shift, ...vals(p)].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
      }
      return sendRaw(req, res, 200, Buffer.from("﻿" + lines.join("\r\n"), "utf8"), "text/csv; charset=utf-8",
        { "Content-Disposition": `attachment; filename="attendance-${from}-to-${to}.csv"`, "Cache-Control": "no-store" });
    }
    send(req, res, 200, r);
  });

  // ---- what HR still has to settle: permissions to classify (§8), corrections to confirm (§5)
  api.get("/api/attendance/hr-queue", (req, res) => {
    if (!can(req.sess, "employee.edit")) throw forbidden();
    const items = db.prepare(`SELECT r.*, e.emp_no, e.name_ar, e.name_en FROM leave_requests r JOIN employees e ON e.id=r.employee_id
      WHERE r.status='approved' AND r.hr_class IS NULL AND r.type IN ('early','late','break','correction') ORDER BY r.start_date, r.id`).all();
    send(req, res, 200, { items });
  });
}

/** Sunday: tell HR, the CEO and Admin last week's attendance report is ready (§18). Once a week. */
export function runWeeklyAttendance(ctx, today) {
  const { db } = ctx;
  if (new Date(today + "T00:00:00Z").getUTCDay() !== 0) return 0;
  if (getSetting(db, "attendance_week_sent", null) === today) return 0;
  if (!db.prepare("SELECT 1 FROM att_uploads LIMIT 1").get()) return 0;
  const [from, to] = lastWeek(today);
  setSetting(db, "attendance_week_sent", today);
  const to_ = db.prepare("SELECT id FROM users WHERE role IN ('hr','ceo','chairman') AND active=1").all().map((u) => u.id);
  const dmy = (iso) => iso.split("-").reverse().join("/");
  notify(ctx, to_, { title_ar: "تقرير الحضور الأسبوعي جاهز", title_en: "The weekly attendance report is ready", body_ar: `${dmy(from)} – ${dmy(to)}`, body_en: `${dmy(from)} – ${dmy(to)}`, link: `#/attendance/report?from=${from}&to=${to}` });
  return to_.length;
}
