/* Work schedules (attendance policy §3): two shifts of 8 actual hours with a one-hour unpaid break, Sunday–Thursday,
 * and special shifts 3 (10:00–17:00) and 4 (10:00–18:00) that only HR/Admin assign. HR assigns each person a shift on their profile. In Ramadan the day is shorter (6 hours by default, no break). */
import { getSetting } from "./db.mjs";

export const SHIFTS = [1, 2, 3, 4];
export const SELF_SHIFTS = [1, 2]; // the ones staff may pick themselves; 3 and 4 are special cases HR/Admin assign
export const SHIFT_DEFAULTS = { 1: ["08:30", "17:30"], 2: ["09:00", "18:00"], 3: ["10:00", "17:00"], 4: ["10:00", "18:00"] };
export const REST_DAYS = [5, 6]; // Friday, Saturday
const hm = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; };

export function shiftTimes(db) {
  const out = {};
  for (const n of SHIFTS) out[n] = { start: getSetting(db, `shift_${n}_start`, SHIFT_DEFAULTS[n][0]), end: getSetting(db, `shift_${n}_end`, SHIFT_DEFAULTS[n][1]) };
  return out;
}
export const inRamadan = (db, date) => {
  const rs = getSetting(db, "ramadan_start", null), re = getSetting(db, "ramadan_end", null);
  return !!(rs && re && date >= rs && date <= re);
};

/* Flexible hours (Admin › Settings, on by default, for all staff and every shift): arriving between flex_start and flex_end
 * (08:30–09:15) is on time; late counts from flex_end; an arrival before flex_start counts as flex_start; the day ends
 * flex_hours (8) after that arrival — the person's own check-out time (in 08:45 → out 16:45). */
export const FLEX_DEFAULTS = { flex_on: true, flex_start: "08:30", flex_end: "09:15", flex_hours: 8 };
let flexDefault = true; // set from the environment when the server starts (the older tests start with it off: FLEX_DEFAULT=off)
export const setFlexDefault = (on) => { flexDefault = !!on; };
export const flexOn = (db) => getSetting(db, "flex_on", flexDefault) !== false;
export function flexRules(db) {
  if (!flexOn(db)) return null;
  const from = hm(getSetting(db, "flex_start", FLEX_DEFAULTS.flex_start)), to = hm(getSetting(db, "flex_end", FLEX_DEFAULTS.flex_end));
  return { from, to: Math.max(from, to), hours: Number(getSetting(db, "flex_hours", FLEX_DEFAULTS.flex_hours)) || 8 };
}

/** The working day of a person on a date, in minutes after midnight: {no, start, end, expected, ramadan}.
 * With flexible hours, start is the latest on-time arrival (late counts from it) and end the person's own check-out time,
 * from their arrival `inMin` (unknown: the earliest arrival; `latest` asks for the latest instead). */
export function shiftFor(db, emp, date, inMin = null, { latest = false } = {}) {
  const no = emp && SHIFTS.includes(Number(emp.shift)) ? Number(emp.shift) : 2;
  const s = shiftTimes(db)[no];
  const ramadan = inRamadan(db, date);
  const f = flexRules(db);
  if (f) {
    const need = (ramadan ? Number(getSetting(db, "ramadan_hours", 6)) : f.hours) * 60;
    const known = inMin !== null && inMin !== undefined;
    const effIn = known ? Math.max(inMin, f.from) : latest ? f.to : f.from;
    return { no, start: f.to, end: effIn + need, expected: need, ramadan, flex: { from: f.from, to: f.to, hours: need / 60, effIn: known ? effIn : null } };
  }
  const start = hm(s.start);
  if (ramadan) {
    const hours = Number(getSetting(db, "ramadan_hours", 6));
    return { no, start, end: start + hours * 60, expected: hours * 60, ramadan: true };
  }
  const end = hm(s.end);
  return { no, start, end, expected: Math.max(0, end - start - 60), ramadan: false };
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
/** The day as it stands for the person: with flexible hours, its end is their own check-out time from today's arrival. */
export const dayShift = (db, emp, date, opts) => shiftFor(db, emp, date, firstArrival(db, emp, date), opts);
