/* Attendance (policy 007/2026): HR uploads the fingerprint machine's export; each machine number is linked to a person once,
 * and staff can also check in and out online from the portal (server/checkin.mjs) — both are punches here.
 * Each working day is measured against the person's shift — late only after the grace minutes (Settings, 15 by default;
 * then counted from the shift start), leaving early,
 * a missing punch (a correction request, never an automatic deduction), absence, leave, external tasks.
 * Nothing here applies a penalty: the sheet and reports inform people, HR and managers. */
import { tx, nowIso, getSetting, setSetting } from "./db.mjs";
import { send, sendRaw, readJson, HttpError } from "./http.mjs";
import { can, approvedDepartments } from "./perm.mjs";
import { audit } from "./audit.mjs";
import { notify, hrTeam } from "./notify.mjs";
import { getEmployee } from "./employees.mjs";
import { TYPES, PERMISSION_TYPES, isIsoDate, addDays, clockMin, permissionSpan } from "./leave.mjs";
import { shiftFor, isRestDay, flexRules } from "./shifts.mjs";
import { readStamp } from "../public/js/punches.js";
import { verifyFor, checksOff } from "./verify.mjs";

const err = (status, code, message, field) => Object.assign(new HttpError(status, code, message), field ? { field } : {});
const forbidden = () => new HttpError(403, "forbidden", "You do not have permission for this");
const DUP_GAP = 15; // punches closer than this (minutes) are one punch pressed twice
const parseJson = (x, d) => { try { return x ? JSON.parse(x) : d; } catch { return d; } };
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

/** One day of one person. ctx: {shift, rest, holiday, leave, pending, punches[min] (machine), onlineIn, onlineOut (labelled check-ins), excused[[a,b]], missions[[a,b]], correction:{in,out}|null, covered, grace} */
export function computeDay(c) {
  if (!c.shift && c.shiftAt) c = { ...c, shift: c.shiftAt(null) };
  const d = { status: "", in: null, out: null, late: 0, early: 0, onSite: 0, missing: null };
  if (!c.covered) return { ...d, status: "no_data" };
  // punches pressed twice within a few minutes count once
  const p = [];
  for (const m of [...c.punches].sort((a, b) => a - b)) if (!p.length || m - p[p.length - 1] >= DUP_GAP) p.push(m);
  let inn = p.length ? p[0] : null, out = p.length > 1 ? p[p.length - 1] : null;
  if (p.length === 1) { // one punch: before the middle of the shift it's the arrival, after it the leaving
    if (p[0] >= (c.shift.start + c.shift.end) / 2) { out = p[0]; inn = null; }
  }
  // where each of the day's two times came from: the fingerprint device, an online check-in, or an approved correction
  let inSrc = inn !== null ? "fingerprint" : null, outSrc = out !== null ? "fingerprint" : null;
  // online check-ins say themselves whether they are an arrival or a leaving: never guessed, never merged as a double press
  const oIn = c.onlineIn ?? null, oOut = c.onlineOut ?? null;
  if (oIn !== null) {
    if (inn === null && out !== null && out <= oIn) { inn = out; out = null; inSrc = outSrc; outSrc = null; } // a lone machine punch before the online arrival was an arrival
    if (inn === null || oIn < inn) { inn = oIn; inSrc = "online"; }
  }
  if (oOut !== null && (out === null || oOut > out)) { out = oOut; outSrc = "online"; }
  if (inn !== null && out !== null && out < inn) { out = null; outSrc = null; }
  if (c.correction) { if (c.correction.in !== null) { inn = c.correction.in; inSrc = "correction"; } if (c.correction.out !== null) { out = c.correction.out; outSrc = "correction"; } }
  d.in = inn; d.out = out; d.inSrc = inSrc; d.outSrc = outSrc;
  // flexible hours: the day's end follows the arrival (in 08:45 → out 16:45), so the shift and the permissions are worked out now
  if (c.shiftAt) { c = { ...c, shift: c.shiftAt(inn) }; if (c.excusedAt) c.excused = c.excusedAt(c.shift); }
  d.expectedOut = c.shift.end; // the expected check-out (on the Flexible shift it follows the arrival)
  if (c.shift.flex) d.flex = true;
  const any = inn !== null || out !== null;
  if (inn !== null && out !== null) d.onSite = Math.max(0, out - inn);
  // hours attended: time on site minus the break (included automatically, never punched) and any time away in between
  if (d.onSite) d.worked = Math.max(0, d.onSite - (c.shift.brk || 0) - (c.awayMin || 0));
  // time worked after the official end of the shift (a rest day or holiday: all the time on site). Shown for information;
  // what is paid as overtime is the approved, HR-confirmed extra time.
  if (c.rest || c.holiday) d.after = d.onSite;
  else if (out !== null && out > c.shift.end && (inn === null || inn < out)) d.after = out - Math.max(c.shift.end, inn ?? c.shift.end);
  if (c.leave) return { ...d, status: "leave", leave: c.leave };
  if (c.holiday) return { ...d, status: any ? "holiday_worked" : "holiday" };
  if (c.rest) return { ...d, status: any ? "rest_worked" : "rest" };
  // today, before the shift has ended: not judged yet — "not yet" with no punch, "on duty" once arrived and not yet left
  const open = c.now !== null && c.now !== undefined && c.now < c.shift.end;
  if (!any) {
    if (c.missions.length) return { ...d, status: "mission" };
    // the day's check-ins were rejected by the manager: a missing punch (asked to be corrected), not an absence
    if (c.rejected && c.rejected.length && !(open && !c.pending)) return { ...d, status: "missing", missing: c.rejected.includes("in") ? "in" : "out" };
    if (open && !c.pending) return { ...d, status: "today" };
    return { ...d, status: c.pending ? "pending" : "absent" };
  }
  const ok = [...c.excused, ...c.missions];
  // arriving within the grace minutes isn't late; after them, lateness counts from the shift start (09:20 → 20 minutes)
  if (inn !== null) d.late = inn <= c.shift.start + (c.shift.grace ?? (c.grace || 0)) ? 0 : uncovered(c.shift.start, Math.min(inn, c.shift.end), ok);
  if (out !== null) d.early = uncovered(Math.max(out, c.shift.start), c.shift.end, ok);
  // the other punch is an outside-the-sites check-in waiting for the manager: "pending", not "missing"
  if (open && inn !== null && out === null) return { ...d, status: "on_duty" }; // arrived, the day isn't over: lateness shows, no "missing"
  if (inn === null || out === null) return { ...d, status: c.waitingCheckin ? "pending" : "missing", missing: inn === null ? "in" : "out" };
  return { ...d, status: "present" };
}

/** Which punches a report counts: online check-ins only, the fingerprint device only, or both combined. Late, early, missing,
 * hours and compliance are worked out from the chosen punches only. ("machine" and "all" are the older words.) */
export const SOURCES = ["all", "machine", "online"];
export const sourceOf = (q) => ({ online: "online", fingerprint: "machine", machine: "machine", combined: "all", all: "all" })[q] || "all";
/** The name used in files and titles: online / fingerprint / combined. */
export const sourceName = (s) => ({ online: "online", machine: "fingerprint", all: "combined" })[s] || "combined";
/** Days of a person between two dates, with what explains each. */
export function employeeDays(db, emp, from, to, today, source = "all", nowMin = null) {
  const useMachine = source !== "online", useOnline = source !== "machine";
  const nos = db.prepare("SELECT machine_no, first_date FROM att_devices WHERE employee_id=? AND ignored=0").all(emp.id);
  const dataFrom = nos.map((n) => n.first_date).filter(Boolean).sort()[0] || null;
  const dataTo = db.prepare("SELECT max(to_date) d FROM att_uploads").get().d;
  const punches = new Map();
  if (nos.length && useMachine) {
    for (const r of db.prepare(`SELECT at FROM att_punches WHERE machine_no IN (${nos.map(() => "?").join(",")}) AND source='fingerprint' AND at>=? AND at<?`).all(...nos.map((n) => n.machine_no), from, addDays(to, 1))) {
      const k = r.at.slice(0, 10);
      if (!punches.has(k)) punches.set(k, []);
      punches.get(k).push(toMin(r.at));
    }
  }
  // online check-ins (portal): punches too; they cover each day from the person's first one up to today
  // (an untagged older check-in counts nowhere: it is on HR's list to sort out)
  const online = db.prepare("SELECT * FROM att_checkins WHERE employee_id=? AND source='online' AND at>=? AND at<? ORDER BY at, id").all(emp.id, from, addDays(to, 1));
  const firstOnline = (db.prepare("SELECT min(substr(at,1,10)) d FROM att_checkins WHERE employee_id=? AND source='online'").get(emp.id) || {}).d || null;
  const sites = new Map(getSetting(db, "att_sites", []).map((s) => [s.id, s]));
  const byDay = new Map(), waiting = new Set(), labelled = new Map(), rejected = new Map(), seq = new Map();
  for (const c of online) {
    const k = c.at.slice(0, 10);
    // outside the work sites it counts once the manager approves it; waiting, the day reads "pending", not "absent"
    if (useOnline && c.approval === "pending") waiting.add(k);
    if (useOnline && (c.approval === "rejected" || c.flag_status === "rejected")) { if (!rejected.has(k)) rejected.set(k, []); rejected.get(k).push(c.kind); }
    // counted (inside a site, or approved outside): the day's first arrival and last leaving, by their own label
    if (useOnline && c.approval !== "pending" && c.approval !== "rejected" && c.flag_status !== "rejected") {
      if (!seq.has(k)) seq.set(k, []);
      seq.get(k).push({ kind: c.kind, m: toMin(c.at) });
      const m = toMin(c.at), o = labelled.get(k) || { in: null, out: null };
      if (c.kind === "in" && (o.in === null || m < o.in)) o.in = m;
      if (c.kind === "out" && (o.out === null || m > o.out)) o.out = m;
      labelled.set(k, o);
    }
    if (!byDay.has(k)) byDay.set(k, []);
    const s = c.site_id && sites.get(c.site_id);
    byDay.get(k).push({ id: c.id, kind: c.kind, time: c.at.slice(11, 16), outside: !!c.outside, reason: c.reason, site_ar: s ? s.name_ar : null, site_en: s ? s.name_en : null,
      photo_file_id: c.photo_file_id, lat: c.lat, lng: c.lng, accuracy: c.accuracy_m, approval: c.approval, decision_note: c.decision_note, verified: !!c.verified,
      checks: parseJson(c.checks, null), flags: parseJson(c.flags, []), flag_status: c.flag_status || null, flag_note: c.flag_note || null });
  }
  const grace = Number(getSetting(db, "late_grace_min", 15)) || 0;
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
    const machine = useMachine && !!(dataFrom && dataTo && date >= dataFrom && date <= dataTo);
    const viaPortal = useOnline && !!(firstOnline && (emp.att_mode || "both") !== "machine" && date >= firstOnline);
    const covered = (machine || viaPortal) && date <= today && (!emp.join_date || date >= emp.join_date);
    // time away: a check-out and a check-in again the same day, not covered by an approved permission, break or task
    const steps = seq.get(date) || [], gaps = [];
    for (let i = 0; i + 1 < steps.length; i++) if (steps[i].kind === "out" && steps[i + 1].kind === "in" && steps[i + 1].m > steps[i].m) gaps.push([steps[i].m, steps[i + 1].m]);
    const covers = [...approved.filter((r) => PERMISSION_TYPES.includes(r.type)).map((r) => permissionSpan(r.type, { time: r.early_time, endTime: r.end_time, dayStart: shift.start, dayEnd: shift.end })),
      ...approved.filter((r) => r.type === "mission").map((r) => [clockMin(r.early_time), clockMin(r.end_time)])];
    const awayMin = gaps.reduce((a, [x, y]) => a + uncovered(x, y, covers), 0);
    const excusedAt = (sh) => approved.filter((r) => PERMISSION_TYPES.includes(r.type)).map((r) => permissionSpan(r.type, { time: r.early_time, endTime: r.end_time, dayStart: sh.start, dayEnd: sh.end }));
    const day = computeDay({
      shift, shiftAt: shift.flex ? (inn) => shiftFor(db, emp, date, inn) : null, excusedAt, covered, grace, rest: isRestDay(date), holiday: holidays.has(date), leave: leaveReq ? leaveReq.type : null,
      pending: on.some((r) => r.status === "pending" && r.type !== "comp_day") || waiting.has(date),
      waitingCheckin: waiting.has(date), rejected: rejected.get(date) || [], awayMin,
      now: date === today ? nowMin : null, // today's time: the day isn't judged before its shift ends
      punches: punches.get(date) || [],
      onlineIn: labelled.has(date) ? labelled.get(date).in : null, onlineOut: labelled.has(date) ? labelled.get(date).out : null,
      excused: excusedAt(shift),
      missions: approved.filter((r) => r.type === "mission").map((r) => [clockMin(r.early_time), clockMin(r.end_time)]),
      correction: corr ? { in: clockMin(corr.early_time), out: clockMin(corr.end_time) } : null,
    });
    day.date = date;
    if (awayMin) day.away = awayMin; // ⚠️ time away without an approved permission or break
    const brk = approved.find((r) => r.type === "break" && r.start_date === date);
    if (brk) { const dt = (() => { try { return JSON.parse(brk.details || "{}"); } catch { return {}; } })(); if (dt.actual_minutes !== undefined) day.breakTaken = { from: dt.actual_start, to: dt.actual_end, minutes: dt.actual_minutes }; }
    day.shift = { no: shift.no, start: shift.start, end: day.expectedOut ?? shift.end, brk: shift.brk || 0, ramadan: shift.ramadan, ...(shift.flex ? { flex: true, from: shift.flex.from, to: shift.flex.to, hours: shift.flex.hours } : {}) };
    day.info = !start || date < start; // before the policy applies: for information only (§17)
    if (holidays.has(date)) day.holiday = holidays.get(date);
    if (useOnline && byDay.has(date)) day.checkins = byDay.get(date);
    day.requests = on.map((r) => ({ id: r.id, type: r.type, status: r.status, hr_class: r.hr_class, minutes: r.minutes, end_time: r.end_time }));
    // extra time after hours approved by the manager and confirmed by HR (paid as overtime: see overtime.mjs)
    const extra = on.filter((r) => r.type === "overtime" && r.status === "approved" && r.hr_class === "confirmed").reduce((a, r) => a + (r.minutes || 0), 0);
    if (extra) day.extra = extra;
    // the correction waits on the manager or HR
    const pc = on.find((r) => r.type === "correction" && (r.status === "pending" || !r.hr_class));
    if (pc) day.correctionPending = pc.id;
    days.push(day);
  }
  return { days, dataFrom, dataTo };
}

/** Totals over days (policy §18: approved leave and tasks are left out of the compliance rate). */
export function summarize(days) {
  const s = { worked: 0, awayDays: 0, awayMin: 0, flagged: 0, unverified: 0, afterMin: 0, afterDays: 0, extraMin: 0, outside: 0, workDays: 0, present: 0, onTime: 0, late: 0, lateMin: 0, early: 0, earlyMin: 0, missing: 0, absent: 0, pending: 0, leave: 0, mission: 0, restWorked: 0, onSite: 0, onSiteDays: 0, compliance: null };
  for (const d of days) {
    if (["rest_worked", "holiday_worked"].includes(d.status)) s.restWorked++;
    if (d.status === "leave") s.leave++;
    if (d.status === "mission") s.mission++;
    if (d.extra) s.extraMin += d.extra;
    if (d.after && d.status !== "leave") { s.afterMin += d.after; s.afterDays++; }
    if (d.status === "on_duty" && d.late) { s.late++; s.lateMin += d.late; } // today's lateness shows already; the day counts once over
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
    if (d.worked) s.worked += d.worked;
    if (d.away) { s.awayDays++; s.awayMin += d.away; }
    if (d.checkins && d.checkins.some((c) => c.outside)) s.outside++; // a day with an online check-in outside the work sites
    if (d.checkins) s.flagged += d.checkins.filter((c) => c.flags && c.flags.length).length; // check-ins with a failed check (⚠️)
    if (d.checkins) s.unverified += d.checkins.filter((c) => c.flags && c.flags.some((f) => f.code === "unverified")).length;
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
export function teamOf(db, sess) {
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
export function attendanceReport(db, sess, from, to, today, deptId = 0, source = "all", nowMin = null) {
  const ex = new Set(attendanceExempt(db));
  const all = db.prepare("SELECT e.*, d.name_ar dept_ar, d.name_en dept_en FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.status IN ('active','on_leave') ORDER BY e.name_ar").all()
    .filter((e) => (!deptId || e.department_id === deptId) && !ex.has(e.id));
  const named = new Set(teamOf(db, sess).map((e) => e.id));
  const mineDepts = MANAGERS.includes(sess.user.role) || ["ceo", "chairman", "consultant", "accounts"].includes(sess.user.role) ? null : approvedDepartments(db, sess.employee && sess.employee.id);
  const depts = new Map();
  const people = [];
  for (const e of all) {
    if (mineDepts && !mineDepts.includes(e.department_id) && !named.has(e.id)) continue; // a manager: their departments and the people who report to them
    const { days } = employeeDays(db, e, from, to, today, source, nowMin);
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
  const ids = all.filter((e) => !mineDepts || mineDepts.includes(e.department_id) || named.has(e.id)).map((e) => e.id);
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
    const source = sourceOf(req.query.get("source"));
    const { days, dataFrom, dataTo } = employeeDays(db, emp, from, to, today, source, clockMin(ctx.clock()));
    const review = db.prepare("SELECT r.*, u.username FROM att_reviews r LEFT JOIN users u ON u.id=r.user_id WHERE r.employee_id=? AND r.month=?").get(emp.id, month) || null;
    const linked = db.prepare("SELECT machine_no FROM att_devices WHERE employee_id=? AND ignored=0").all(emp.id).map((r) => r.machine_no);
    send(req, res, 200, { employee: { id: emp.id, emp_no: emp.emp_no, name_ar: emp.name_ar, name_en: emp.name_en, shift: emp.shift, join_date: emp.join_date, att_mode: emp.att_mode || "both" },
      verify: verifyFor(db, emp), checksOff: checksOff(db, emp),
      grace: Number(getSetting(db, "late_grace_min", 15)) || 0,
      flex: (() => { const f = flexRules(db); return f ? { from: f.from, to: f.to, hours: f.hours } : null; })(),
      month, source, days, summary: summarize(days), review, linked, dataFrom, dataTo, start: getSetting(db, "attendance_start", null),
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
      const hr = hrTeam(db, { except: [req.sess.user.id] });
      notify(ctx, hr, { title_ar: "ملاحظة على كشف الحضور", title_en: "A note on an attendance sheet", body_ar: `${emp.name_ar || emp.name_en} · ${b.month}: ${note}`, body_en: `${emp.name_en || emp.name_ar} · ${b.month}: ${note}`, link: `#/attendance?emp=${emp.id}&m=${b.month}` });
    }
    send(req, res, 200, { ok: true });
  });

  // ---- the monthly report (PDF / Excel, built in the page): the company (or team) summary, a row per person, and each
  // person's days. HR / Admin see everyone, a direct manager or department approver their people (§7); one person: whoever
  // may open that person's sheet — themselves included, never a colleague.
  api.get("/api/attendance/monthly", (req, res) => {
    const sess = req.sess, today = ctx.today();
    const month = req.query.get("month") || today.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw err(400, "invalid", "month must be YYYY-MM", "month");
    const from = `${month}-01`, to = lastDayOf(month), source = sourceOf(req.query.get("source")), nowMin = clockMin(ctx.clock());
    let list, scope;
    if (req.query.get("employee_id")) {
      const emp = getEmployee(db, req.query.get("employee_id"));
      if (!emp) throw new HttpError(404, "not_found", "Not found");
      if (!canSeeAttendance(db, sess, emp)) throw forbidden();
      const d = emp.department_id ? db.prepare("SELECT name_ar, name_en FROM departments WHERE id=?").get(emp.department_id) : null;
      list = [{ ...emp, dept_ar: d && d.name_ar, dept_en: d && d.name_en }]; scope = "person";
    } else {
      list = teamOf(db, sess);
      if (!list.length) throw forbidden();
      scope = MANAGERS.includes(sess.user.role) ? "company" : "team";
    }
    const people = [];
    for (const e of list) {
      const { days } = employeeDays(db, e, from, to, today, source, nowMin);
      const summary = summarize(days);
      if (scope !== "person" && !summary.workDays && !summary.leave && !summary.mission && !summary.restWorked) continue; // nothing this month
      people.push({ employee: { id: e.id, emp_no: e.emp_no, name_ar: e.name_ar, name_en: e.name_en, dept_ar: e.dept_ar || null, dept_en: e.dept_en || null, shift: e.shift, job: e.job_title || null },
        summary, days: days.map((x) => ({ date: x.date, status: x.status, leave: x.leave || null, missing: x.missing, in: x.in, out: x.out, inSrc: x.inSrc || null, outSrc: x.outSrc || null, expectedOut: x.expectedOut ?? null,
          requests: (x.requests || []).map((r) => ({ type: r.type, status: r.status })),
          onSite: x.onSite || 0, worked: x.worked || 0, away: x.away || 0, breakTaken: x.breakTaken || null, late: x.late || 0, early: x.early || 0, after: x.after || 0, extra: x.extra || 0, holiday: x.holiday || null, info: !!x.info,
          shift: x.shift, outside: !!(x.checkins && x.checkins.some((c) => c.outside)),
          flags: (x.checkins || []).filter((c) => c.flags && c.flags.length).map((c) => ({ kind: c.kind, time: c.time, flags: c.flags, status: c.flag_status })),
          checks: (x.checkins || []).map((c) => ({ kind: c.kind, time: c.time, checks: c.checks })) })),
        verify: verifyFor(db, e), checksOff: checksOff(db, e) });
    }
    const total = summarize([]);
    for (const p of people) for (const k of Object.keys(total)) if (typeof p.summary[k] === "number" && k !== "compliance") total[k] += p.summary[k];
    total.compliance = total.workDays ? Math.round((total.onTime / total.workDays) * 1000) / 10 : null;
    const holidays = new Set(getSetting(db, "official_holidays", []).map((x) => x.date));
    let calendarDays = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) if (!isRestDay(d) && !holidays.has(d)) calendarDays++;
    const f = flexRules(db);
    audit(db, sess.user.id, "attendance.monthly", "attendance", null, null, { month, scope, people: people.length });
    send(req, res, 200, { month, from, to, today, source, scope, own: scope === "person" && !!(sess.employee && people[0] && people[0].employee.id === sess.employee.id), generated_at: nowIso(), working_days: calendarDays, total, people,
      rules: f ? { flex: true, from: f.from, to: f.to, hours: f.hours } : { flex: false, grace: Number(getSetting(db, "late_grace_min", 15)) || 0 },
      dataTo: db.prepare("SELECT max(to_date) d FROM att_uploads").get().d });
  });

  // ---- the people I can open (for the sheet's person picker)
  api.get("/api/attendance/people", (req, res) => {
    send(req, res, 200, { items: teamOf(db, req.sess).map((e) => ({ id: e.id, emp_no: e.emp_no, name_ar: e.name_ar, name_en: e.name_en })) });
  });

  // ---- weekly report (§18): by department without names; HR and managers also get their people
  api.get("/api/attendance/report", (req, res) => {
    const sess = req.sess;
    const mine = approvedDepartments(db, sess.employee && sess.employee.id);
    if (!["hr", "admin", "ceo", "chairman", "consultant", "accounts"].includes(sess.user.role) && !mine.length && !teamOf(db, sess).length) throw forbidden(); // a direct manager: their own people
    const today = ctx.today();
    let [from, to] = lastWeek(today);
    if (req.query.get("from")) from = req.query.get("from");
    if (req.query.get("to")) to = req.query.get("to");
    if (!isIsoDate(from) || !isIsoDate(to) || to < from) throw err(400, "invalid", "Choose a valid period");
    if (addDays(from, 500) < to) throw err(400, "invalid", "At most about 16 months at a time");
    const source = sourceOf(req.query.get("source"));
    const r = attendanceReport(db, sess, from, to, today, Number(req.query.get("department_id") || 0), source, clockMin(ctx.clock()));
    r.source = source;
    if (req.query.get("format") === "csv") {
      const h = (m) => (m / 60).toFixed(1);
      const head = ["Work days", "On time", "Compliance %", "Late (times)", "Late (hours)", "Left early (times)", "Left early (hours)", "Missing punch", "Absent (unexcused)", "Absence pending a request", "Leave days", "External task days", "Worked on a rest day", "Outside work sites (days)", "Worked after official hours (days)", "Worked after official hours (hours)", "Approved extra time (hours)", "Flagged check-ins", "Unverified check-ins"];
      const vals = (s) => [s.workDays, s.onTime, s.compliance ?? "", s.late, h(s.lateMin), s.early, h(s.earlyMin), s.missing, s.absent, s.pending, s.leave, s.mission, s.restWorked, s.outside || 0, s.afterDays || 0, h(s.afterMin || 0), h(s.extraMin || 0), s.flagged || 0, s.unverified || 0];
      const lines = [["Department", "Staff", ...head].join(",")];
      for (const d of r.departments) lines.push([d.name_en || d.name_ar || "—", d.staff, ...vals(d)].join(","));
      if (r.people.length) {
        lines.push("", ["Employee ID", "Name (Arabic)", "Name (English)", "Department", "Shift", ...head].join(","));
        for (const p of r.people) lines.push([p.employee.emp_no, p.employee.name_ar, p.employee.name_en, p.employee.dept_en || p.employee.dept_ar || "", p.employee.shift, ...vals(p)].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
      }
      return sendRaw(req, res, 200, Buffer.from("﻿" + lines.join("\r\n"), "utf8"), "text/csv; charset=utf-8",
        { "Content-Disposition": `attachment; filename="attendance${source === "all" ? "" : "-" + (source === "machine" ? "fingerprint" : "online")}-${from}-to-${to}.csv"`, "Cache-Control": "no-store" });
    }
    send(req, res, 200, r);
  });

  // ---- punch sources (HR / Admin): how many punches each source has, and the older check-ins that couldn't be tagged
  api.get("/api/attendance/punch-sources", (req, res) => {
    if (!can(req.sess, "employee.edit")) throw forbidden();
    const fingerprint = db.prepare("SELECT count(*) n FROM att_punches WHERE source='fingerprint'").get().n;
    const online = db.prepare("SELECT count(*) n FROM att_checkins WHERE source='online'").get().n;
    const unclear = db.prepare(`SELECT c.id, c.kind, c.at, e.id employee_id, e.emp_no, e.name_ar, e.name_en FROM att_checkins c JOIN employees e ON e.id=c.employee_id
      WHERE c.source IS NULL OR c.source NOT IN ('online','fingerprint') ORDER BY c.at`).all();
    send(req, res, 200, { fingerprint, online, unclear });
  });

  // ---- what HR still has to settle: permissions to classify (§8), corrections to confirm (§5)
  api.get("/api/attendance/hr-queue", (req, res) => {
    if (!can(req.sess, "employee.edit")) throw forbidden();
    const items = db.prepare(`SELECT r.*, e.emp_no, e.name_ar, e.name_en FROM leave_requests r JOIN employees e ON e.id=r.employee_id
      WHERE r.status='approved' AND r.hr_class IS NULL AND r.type IN ('early','late','break','correction','overtime') ORDER BY r.start_date, r.id`).all();
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
  const to_ = [...new Set([...hrTeam(db), ...db.prepare("SELECT id FROM users WHERE role IN ('ceo','chairman') AND active=1").all().map((u) => u.id)])];
  const dmy = (iso) => iso.split("-").reverse().join("/");
  notify(ctx, to_, { title_ar: "تقرير الحضور الأسبوعي جاهز", title_en: "The weekly attendance report is ready", body_ar: `${dmy(from)} – ${dmy(to)}`, body_en: `${dmy(from)} – ${dmy(to)}`, link: `#/attendance/report?from=${from}&to=${to}` });
  return to_.length;
}

/** Where a person is right now, from today's attendance: on duty (checked in), checked out, on a break, excused (an
 * approved permission covering now), on leave, on an external task, holiday / weekly rest, not in yet, absent.
 * Combined sources (fingerprint and online). Returns { code, in?, out?, since? }. */
export function presenceNow(db, emp, today, nowMin) {
  try { return presence(db, emp, today, nowMin); } catch { return { code: "unknown" }; } // never nothing: the screen always has a word
}
function presence(db, emp, today, nowMin) {
  if (attendanceExempt(db).includes(emp.id)) return { code: "exempt" };
  const d = employeeDays(db, emp, today, today, "all", nowMin).days[0];
  if (!d) return { code: "unknown" };
  // a weekend or an official holiday reads as one even when today has no attendance data yet (unless they came in)
  const offDay = isRestDay(today) ? "rest" : getSetting(db, "official_holidays", []).some((x) => x.date === today) ? "holiday" : null;
  const reqs = db.prepare("SELECT type, early_time, end_time, details FROM leave_requests WHERE employee_id=? AND status='approved' AND start_date<=? AND end_date>=?").all(emp.id, today, today);
  // "I'm still working" (extra time after hours, waiting or approved): they are expected to be there after the shift
  const stayingOn = !!db.prepare("SELECT 1 FROM leave_requests WHERE employee_id=? AND type='overtime' AND status IN ('pending','approved') AND start_date<=? AND end_date>=?").get(emp.id, today, today);
  const within = (a, b) => a !== null && b !== null && nowMin !== null && nowMin >= a && nowMin < b;
  const sh = d.shift || { start: 540, end: 1020 };
  const brk = reqs.find((r) => r.type === "break");
  if (brk) { let dt = {}; try { dt = JSON.parse(brk.details || "{}"); } catch {} if (dt.actual_start && !dt.actual_end) return { code: "on_break", since: dt.actual_start }; }
  if (d.status === "leave") return { code: "on_leave", leave: d.leave };
  if (reqs.some((r) => r.type === "mission" && (!r.early_time || within(clockMin(r.early_time), clockMin(r.end_time)))) || d.status === "mission") return { code: "mission" };
  const excused = reqs.some((r) => PERMISSION_TYPES.includes(r.type) && r.type !== "break" && (() => { try { const [a, b] = permissionSpan(r.type, { time: r.early_time, endTime: r.end_time, dayStart: sh.start, dayEnd: sh.end }); return within(a, b); } catch { return false; } })());
  if (d.in !== null && d.out !== null) return { code: "checked_out", in: d.in, out: d.out };
  if (d.in !== null) {
    if (excused) return { code: "excused", in: d.in };
    // past the expected check-out (Flexible: arrival + 9 h; otherwise the shift's end) with no check-out
    const expectedOut = d.expectedOut ?? sh.end;
    if (nowMin !== null && nowMin >= expectedOut && !stayingOn) return { code: "no_checkout", in: d.in, expectedOut };
    return { code: "on_duty", in: d.in };
  }
  if (excused) return { code: "excused" };
  if (offDay) return { code: offDay };
  if (d.status === "holiday" || d.status === "holiday_worked") return { code: "holiday" };
  if (d.status === "rest" || d.status === "rest_worked") return { code: "rest" };
  if (d.status === "pending") return { code: "pending" };
  if (nowMin !== null && nowMin < sh.end && ["today", "no_data", "absent", "missing"].includes(d.status)) return { code: "not_in", from: sh.start };
  if (d.status === "absent") return { code: "absent" };
  if (d.status === "missing") return { code: "missing_in" };
  // nothing recorded for today: no online check-in, and the fingerprint file doesn't reach today yet
  return { code: "no_record", lastUpload: db.prepare("SELECT max(to_date) d FROM att_uploads").get().d || null };
}
