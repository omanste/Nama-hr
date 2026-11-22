/* Work schedules (attendance policy §3), Sunday–Thursday; in Ramadan the day is shorter (6 hours by default, no break). */
import { getSetting } from "./db.mjs";

/* Shifts (Admin › Settings › Shifts) — exactly three are offered:
 *   5 Flexible (the default): arrive 08:30–09:15 (on time), the day ends work hours + break after the arrival
 *     (in 08:45 → out 17:45); an arrival before 08:30 counts from 08:30; late counts from 09:15.
 *   6 Shift 10–5 and 7 Shift 10–6: fixed times; late after the start, early before the end.
 * Each stores its start, end, flexible window, work hours and break (Admin edits them). The older shifts 1–4 stay readable
 * so past attendance keeps the shift it was recorded under; who was on which shift from which day is in shift_history
 * (a change by HR / Admin applies from the next day). The one-hour break is included automatically. */
export const LEGACY_SHIFTS = [1, 2, 3, 4];
export const NEW_SHIFTS = [5, 6, 7];
export const FLEX_SHIFT = 5;
export const SHIFTS = [...LEGACY_SHIFTS, ...NEW_SHIFTS];
export const SELF_SHIFTS = []; // staff don't choose their shift: HR / Admin assign it
export const SHIFT_DEFAULTS = { 1: ["08:30", "17:30"], 2: ["09:00", "18:00"], 3: ["10:00", "17:00"], 4: ["10:00", "18:00"] };
export const SHIFT_DEFS = {
  5: { kind: "flex", start: "08:30", end: "17:30", flex_from: "08:30", flex_to: "09:15", work_hours: 8, break_min: 60 },
  6: { kind: "fixed", start: "10:00", end: "17:00", flex_from: null, flex_to: null, work_hours: 6, break_min: 60 },
  7: { kind: "fixed", start: "10:00", end: "18:00", flex_from: null, flex_to: null, work_hours: 7, break_min: 60 },
};
export const REST_DAYS = [5, 6]; // Friday, Saturday
const hm = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; };

/** The older shifts' times (for past attendance and the older tests). */
export function shiftTimes(db) {
  const out = {};
  for (const n of LEGACY_SHIFTS) out[n] = { start: getSetting(db, `shift_${n}_start`, SHIFT_DEFAULTS[n][0]), end: getSetting(db, `shift_${n}_end`, SHIFT_DEFAULTS[n][1]) };
  return out;
}
/** The three shifts as Admin set them. */
export function shiftDefs(db) {
  const saved = getSetting(db, "shifts", null) || {};
  return Object.fromEntries(NEW_SHIFTS.map((n) => [n, { ...SHIFT_DEFS[n], ...(saved[n] || {}), kind: SHIFT_DEFS[n].kind }]));
}
export const inRamadan = (db, date) => {
  const rs = getSetting(db, "ramadan_start", null), re = getSetting(db, "ramadan_end", null);
  return !!(rs && re && date >= rs && date <= re);
};

// new staff start on the Flexible shift (the older tests start on shift 2: FLEX_DEFAULT=off)
let defaultShift = FLEX_SHIFT;
export const setFlexDefault = (on) => { defaultShift = on ? FLEX_SHIFT : 2; };
export const defaultShiftNo = () => defaultShift;
/** The Flexible shift's window and hours (for notes in reports). */
export function flexRules(db) {
  const d = shiftDefs(db)[FLEX_SHIFT];
  const from = hm(d.flex_from), to = Math.max(from, hm(d.flex_to));
  return { from, to, hours: Number(d.work_hours), break: Number(d.break_min) };
}

/** The shift a person was on that day: shift_history (latest change on or before it), else their current one. */
export function shiftOn(db, emp, date) {
  if (!emp) return defaultShift;
  const r = emp.id ? db.prepare("SELECT shift FROM shift_history WHERE employee_id=? AND from_date<=? ORDER BY from_date DESC, id DESC LIMIT 1").get(emp.id, date) : null;
  if (r) return r.shift;
  return SHIFTS.includes(Number(emp.shift)) ? Number(emp.shift) : defaultShift;
}

/** The working day of a person on a date, in minutes after midnight: {no, start (late after it), end (expected
 * check-out), expected (work minutes), brk (break minutes), grace, ramadan, flex?}. On the Flexible shift the end
 * follows the arrival `inMin` (unknown: the earliest; `latest` asks for the latest instead). */
export function shiftFor(db, emp, date, inMin = null, { latest = false } = {}) {
  const no = shiftOn(db, emp, date);
  const ramadan = inRamadan(db, date), rHours = Number(getSetting(db, "ramadan_hours", 6));
  if (NEW_SHIFTS.includes(no)) {
    const d = shiftDefs(db)[no], brk = ramadan ? 0 : Number(d.break_min) || 0;
    if (d.kind === "flex") {
      const from = hm(d.flex_from), to = Math.max(from, hm(d.flex_to)), need = (ramadan ? rHours : Number(d.work_hours) || 8) * 60;
      const known = inMin !== null && inMin !== undefined;
      const effIn = known ? Math.max(inMin, from) : latest ? to : from;
      return { no, start: to, end: effIn + need + brk, expected: need, brk, grace: 0, ramadan, flex: { from, to, hours: need / 60, effIn: known ? effIn : null } };
    }
    const start = hm(d.start);
    if (ramadan) return { no, start, end: start + rHours * 60, expected: rHours * 60, brk: 0, grace: 0, ramadan: true };
    const end = hm(d.end);
    return { no, start, end, expected: Math.max(0, end - start - brk), brk, grace: 0, ramadan: false };
  }
  // an older shift (past attendance)
  const s = shiftTimes(db)[no] || shiftTimes(db)[2];
  const start = hm(s.start);
  if (ramadan) return { no, start, end: start + rHours * 60, expected: rHours * 60, brk: 0, ramadan: true };
  const end = hm(s.end);
  return { no, start, end, expected: Math.max(0, end - start - 60), brk: 60, ramadan: false };
}

export const isRestDay = (date) => REST_DAYS.includes(new Date(date + "T00:00:00Z").getUTCDay());

/** The person's first arrival on a date, in minutes (an online check-in that isn't refused, or a fingerprint punch), or null. */
export function firstArrival(db, emp, date) {
  const c = db.prepare("SELECT min(substr(at,12,5)) t FROM att_checkins WHERE employee_id=? AND kind='in' AND substr(at,1,10)=? AND coalesce(approval,'approved')<>'rejected'").get(emp.id, date);
  const nos = db.prepare("SELECT machine_no FROM att_devices WHERE employee_id=? AND ignored=0").all(emp.id).map((r) => r.machine_no);
  const m = nos.length ? db.prepare(`SELECT min(substr(at,12,5)) t FROM att_punches WHERE machine_no IN (${nos.map(() => "?").join(",")}) AND substr(at,1,10)=?`).get(...nos, date) : null;
  const ts = [c && c.t, m && m.t].filter(Boolean).map(hm);
  return ts.length ? Math.min(...ts) : null;
}
/** The day as it stands for the person: on the Flexible shift, its end is their own check-out time from today's arrival. */
export const dayShift = (db, emp, date, opts) => shiftFor(db, emp, date, firstArrival(db, emp, date), opts);
