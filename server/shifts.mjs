/* Work schedules (attendance policy §3): two shifts of 8 actual hours with a one-hour unpaid break, Sunday–Thursday.
 * HR assigns each person a shift on their profile. In Ramadan the day is shorter (6 hours by default, no break). */
import { getSetting } from "./db.mjs";

export const SHIFT_DEFAULTS = { 1: ["08:30", "17:30"], 2: ["09:00", "18:00"] };
export const REST_DAYS = [5, 6]; // Friday, Saturday
const hm = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; };

export function shiftTimes(db) {
  const out = {};
  for (const n of [1, 2]) out[n] = { start: getSetting(db, `shift_${n}_start`, SHIFT_DEFAULTS[n][0]), end: getSetting(db, `shift_${n}_end`, SHIFT_DEFAULTS[n][1]) };
  return out;
}
export const inRamadan = (db, date) => {
  const rs = getSetting(db, "ramadan_start", null), re = getSetting(db, "ramadan_end", null);
  return !!(rs && re && date >= rs && date <= re);
};

/** The working day of a person on a date, in minutes after midnight: {no, start, end, expected, ramadan}. */
export function shiftFor(db, emp, date) {
  const no = emp && Number(emp.shift) === 1 ? 1 : 2;
  const s = shiftTimes(db)[no];
  const start = hm(s.start);
  if (inRamadan(db, date)) {
    const hours = Number(getSetting(db, "ramadan_hours", 6));
    return { no, start, end: start + hours * 60, expected: hours * 60, ramadan: true };
  }
  const end = hm(s.end);
  return { no, start, end, expected: Math.max(0, end - start - 60), ramadan: false };
}

export const isRestDay = (date) => REST_DAYS.includes(new Date(date + "T00:00:00Z").getUTCDay());
