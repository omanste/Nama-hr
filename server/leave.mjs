/* Leave rules — pure functions, no I/O. All amounts are integer minutes; dates are ISO "YYYY-MM-DD". */
import { isOmani } from "../public/js/countries.js";

export const DAY = 480;            // 8-hour working day, 09:00–17:00
export const ANNUAL = 30 * DAY;    // yearly entitlement
export const CAP = 60 * DAY;       // total balance cap, applied when a yearly credit is posted
export const MAX_RANGE_DAYS = 60;
export const DAY_END = 17 * 60;    // 17:00

/** Leave types. effect: "deduct" reduces the annual balance, "credit" adds to it, "record" is history only.
 * Limits follow Oman's Labour Law (Royal Decree 53/2023, articles 78–84) — see docs/compliance/.
 *   maxDays: per request (per birth for maternity/paternity) · yearCap: per calendar year · once: once in the whole service
 *   proof: a document must be attached before approval (Art. 84; Art. 47 for sickness) · paid: false = without wage */
export const TYPES = {
  annual: { effect: "deduct", range: true, maxDays: 60 },
  // permissions (attendance policy §8): short absences inside a working day. The manager approves, then HR classifies each one
  // (statutory paid / special paid / unpaid / taken from annual leave) — nothing is deducted automatically, no monthly free balance
  early: { effect: "hours", hours: true, permission: true },      // leave before the end of the day
  late: { effect: "hours", hours: true, permission: true },       // arrive after the start of the day
  break: { effect: "hours", hours: true, permission: true },      // step out for a while during the day
  emergency: { effect: "deduct", range: true, maxDays: 60 },      // company policy: taken from annual leave (not in the 2023 law)
  sick: { effect: "record", range: true, proof: true, yearCap: 182, maxDays: 182 },
  bereavement: { effect: "record", range: true, proof: true, relation: "list", event: "death" },
  marriage: { effect: "record", range: true, proof: true, maxDays: 3, once: true },
  paternity: { effect: "record", range: true, proof: true, maxDays: 7, gender: "male", event: "birth" },
  maternity: { effect: "record", range: true, proof: true, maxDays: 98, gender: "female", event: "birth" },
  hajj: { effect: "record", range: true, proof: true, maxDays: 15, once: true, minServiceMonths: 12 },
  exam: { effect: "record", range: true, proof: true, yearCap: 15, maxDays: 15, omani: true },
  patient_care: { effect: "record", range: true, proof: true, yearCap: 15, maxDays: 15, omani: true, relation: "text" },
  childcare: { effect: "record", range: true, maxDays: 365, gender: "female", paid: false, event: "child" },
  unpaid: { effect: "record", range: true, maxDays: 365, paid: false },
  comp_day: { effect: "credit" },
  // attendance requests (policy §5, §10): a forgotten fingerprint (manager verifies, HR confirms) and an external task (counts as work)
  correction: { effect: "record", attendance: true },
  mission: { effect: "record", attendance: true },
};
export const ATTENDANCE_TYPES = Object.keys(TYPES).filter((k) => TYPES[k].attendance);
/** How HR classifies an approved permission (§8), and confirms a fingerprint correction (§5). */
export const PERM_CLASSES = ["statutory", "special", "unpaid", "leave"];
export const CORRECTION_CLASSES = ["confirmed", "refused"];

/** Art. 84: days of paid bereavement leave by relation. A widow's leave (iddah) is for women. */
export const BEREAVEMENT_DAYS = Object.freeze({
  wife: 10, son: 10, daughter: 10,
  father: 3, mother: 3, grandfather: 3, grandmother: 3, brother: 3, sister: 3,
  uncle: 2, aunt: 2,
  husband_muslim: 130, husband_other: 14,
});

/** Art. 82: sick-leave pay by cumulative day of the year — {percent: days}. */
export function sickPayBands(priorDays, days) {
  const out = { 100: 0, 75: 0, 50: 0, 35: 0 };
  for (let d = priorDays + 1; d <= Math.min(priorDays + days, 182); d++) out[d <= 21 ? 100 : d <= 35 ? 75 : d <= 70 ? 50 : 35]++;
  return out;
}

export class RuleError extends Error {
  constructor(code, message, field) { super(message); this.code = code; this.field = field; }
}

/** Check one request against the legal limits. used = {inYear, ever, forEvent} days already requested (pending or approved). */
export function checkLeaveRules(type, { emp, start, end, relation, eventDate, used = {} }) {
  const T = TYPES[type];
  const days = daysBetweenInclusive(start, end);
  if (T.gender && emp.gender !== T.gender) {
    if (!emp.gender) throw new RuleError("gender_required", "HR must record the employee's gender first");
    throw new RuleError("not_entitled", "This leave is not available for this employee", "type");
  }
  if (T.omani && !isOmani(emp.nationality)) throw new RuleError("not_entitled", "This leave is for Omani staff (Art. 84)", "type");
  if (T.minServiceMonths) {
    const from = isIsoDate(emp.join_date) ? addMonths(emp.join_date, T.minServiceMonths) : null;
    if (!from || start < from) throw new RuleError("not_eligible_yet", `Available after ${T.minServiceMonths} months of service${from ? ` (${from})` : ""}`, "start");
  }
  if (T.once && used.ever > 0) throw new RuleError("already_taken", "This leave can be taken once during the service", "type");
  let max = T.maxDays;
  if (T.relation === "list") {
    if (typeof relation !== "string" || !Object.hasOwn(BEREAVEMENT_DAYS, relation)) throw new RuleError("invalid", "Choose the relation", "relation");
    if (relation.startsWith("husband") && emp.gender === "male") throw new RuleError("not_entitled", "This leave is for a widow", "relation");
    if (relation === "wife" && emp.gender === "female") throw new RuleError("not_entitled", "Choose the correct relation", "relation");
    max = BEREAVEMENT_DAYS[relation];
  }
  if (T.relation === "text" && !String(relation || "").trim()) throw new RuleError("invalid", "Name the patient's relation to you", "relation");
  if (T.event) {
    if (!isIsoDate(eventDate)) throw new RuleError("invalid", T.event === "death" ? "Enter the date of death" : "Enter the date of birth", "event_date");
    // paternity: from the birth up to the child's 98th day · maternity: from 14 days before the birth, starting by the birth
    // bereavement: starts within 2 days of the death · child care: any time after the birth
    const ok = type === "paternity" ? start >= eventDate && end <= addDays(eventDate, 97)
      : type === "maternity" ? start >= addDays(eventDate, -14) && start <= eventDate
      : type === "bereavement" ? start >= eventDate && start <= addDays(eventDate, 2)
      : start >= eventDate;
    if (!ok) throw new RuleError("outside_window", { paternity: "Paternity leave must be taken within 98 days of the birth", maternity: "Maternity leave starts between 14 days before the birth and the birth", bereavement: "Bereavement leave starts at the death (within 2 days)", childcare: "Child-care leave starts after the birth" }[type], "start");
    // another birth within 9 months is not credible — a second paternity/maternity needs HR
    if ((type === "paternity" || type === "maternity") && used.otherEventNear) throw new RuleError("already_taken", "Leave for this birth was already requested", "event_date");
    if (days + (used.forEvent || 0) > max) throw new RuleError("too_long", `At most ${max} days`, "end");
  }
  if (max && days > max) throw new RuleError("too_long", `At most ${max} days`, "end");
  // yearInfo: the calendar year this request strains most — {used: days already requested in it, add: this request's days in it}
  const yi = used.yearInfo || { used: used.inYear || 0, add: days };
  if (T.yearCap && yi.used + yi.add > T.yearCap) throw new RuleError("year_limit", `At most ${T.yearCap} days a year (${Math.max(0, T.yearCap - yi.used)} left)`, "end");
  return days;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
export function parseIso(s) {
  const m = ISO.exec(String(s || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null;
}
export const isIsoDate = (s) => parseIso(s) !== null;
const toIso = (d) => d.toISOString().slice(0, 10);
const daysInMonth = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

export function todayMuscat(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(iso, n) { const d = parseIso(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); }

/** Add calendar months, clamping the day to the target month's last day (31 Aug + 6 → 28 Feb). */
export function addMonths(iso, n) {
  const d = parseIso(iso); if (!d) return null;
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + n;
  const y = Math.floor(total / 12), m0 = total % 12;
  return toIso(new Date(Date.UTC(y, m0, Math.min(d.getUTCDate(), daysInMonth(y, m0)))));
}

export const eligibleFrom = (joinDate) => (isIsoDate(joinDate) ? addMonths(joinDate, 6) : null);
export const probationEnd = (joinDate) => (isIsoDate(joinDate) ? addMonths(joinDate, 3) : null);

export function daysBetweenInclusive(start, end) {
  const a = parseIso(start), b = parseIso(end);
  if (!a || !b) throw new RangeError("invalid date");
  return Math.round((b - a) / 86400000) + 1;
}

/** Days of a range that are not official holidays (holidays inside annual leave are not deducted). */
export function daysExcludingHolidays(start, end, holidays) {
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) if (!holidays.has(d)) n++;
  return n;
}

export function annualMinutes(start, end, maxDays = MAX_RANGE_DAYS) {
  const days = daysBetweenInclusive(start, end);
  if (days < 1) throw new RangeError("end date is before start date");
  if (days > Math.max(maxDays, MAX_RANGE_DAYS)) throw new RangeError(`range is longer than ${Math.max(maxDays, MAX_RANGE_DAYS)} days`);
  return days * DAY;
}

/** Minutes from the leave time to the end of the working day (the shift's end, or the Ramadan end time). 30-minute steps,
 * from 30 minutes after the start of the day. */
export function earlyMinutes(time, dayEnd = DAY_END, dayStart = 9 * 60) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(time || ""));
  if (!m) throw new RangeError("invalid time");
  const t = +m[1] * 60 + +m[2];
  if (+m[2] % 30 !== 0 || t < dayStart + 30 || t > dayEnd - 30) throw new RangeError("time must be from 30 minutes after the start of the day to 30 minutes before its end, in 30-minute steps");
  return dayEnd - t;
}

/** "HH:MM" → minutes after midnight, or null (any minute, for punches, corrections and tasks). */
export const clockMin = (s) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s || "")); return m ? +m[1] * 60 + +m[2] : null; };
export const PERMISSION_TYPES = Object.keys(TYPES).filter((k) => TYPES[k].permission);
const toMin = (time) => { const m = /^(\d{2}):(\d{2})$/.exec(String(time || "")); if (!m || +m[2] % 30 !== 0) throw new RangeError("invalid time (30-minute steps)"); return +m[1] * 60 + +m[2]; };
/** Late arrival: minutes from the start of the day to the arrival time (09:30 at the earliest, 30 minutes before the end at the latest). */
export function lateMinutes(time, dayStart = 9 * 60, dayEnd = DAY_END) {
  const t = toMin(time);
  if (t < dayStart + 30 || t > dayEnd - 30) throw new RangeError("arrival must be from 30 minutes after the start of the day to 30 minutes before its end");
  return t - dayStart;
}
/** Personal break: from–to inside working hours. */
export function breakMinutes(from, to, dayStart = 9 * 60, dayEnd = DAY_END) {
  const a = toMin(from), b = toMin(to);
  if (a < dayStart || b > dayEnd || b <= a) throw new RangeError("the break must be inside working hours and end after it starts");
  return b - a;
}
/** The part of the working day a permission covers, as [from, to] minutes — used to stop two permissions overlapping. */
export function permissionSpan(type, { time, endTime, dayStart = 9 * 60, dayEnd = DAY_END }) {
  if (type === "early") return [toMin(time), dayEnd];
  if (type === "late") return [dayStart, toMin(time)];
  return [toMin(time), toMin(endTime)];
}

export function requestMinutes(type, { start, end, time, endTime, dayStart = 9 * 60, dayEnd } = {}) {
  const T = TYPES[type];
  if (!T) throw new RangeError("unknown leave type");
  if (type === "early") return earlyMinutes(time, dayEnd, dayStart);
  if (type === "correction") return 0;
  if (type === "mission") { const a = clockMin(time), b = clockMin(endTime); if (a === null || b === null || b <= a) throw new RangeError("the task must end after it starts"); return b - a; }
  if (type === "late") return lateMinutes(time, dayStart, dayEnd);
  if (type === "break") return breakMinutes(time, endTime, dayStart, dayEnd);
  if (type === "comp_day") return DAY;
  // the per-type legal limits (maxDays, relation, yearCap) are checked by checkLeaveRules; this only bounds a request to a year
  return annualMinutes(start, end, type === "annual" ? MAX_RANGE_DAYS : 366);
}

export function anniversaryOn(joinDate, year) {
  const d = parseIso(joinDate);
  const m0 = d.getUTCMonth();
  return toIso(new Date(Date.UTC(year, m0, Math.min(d.getUTCDate(), daysInMonth(year, m0)))));
}

/** Latest anniversary on or before today (the join date itself if today is before it). */
export function leaveYearStart(joinDate, today) {
  if (today < joinDate) return joinDate;
  const y = +today.slice(0, 4);
  const a = anniversaryOn(joinDate, y);
  return a <= today ? a : anniversaryOn(joinDate, y - 1);
}

/** Leave-year starts from the join date up to today that have no credit yet (optionally only from firstCreditFrom on).
 * `credited` holds leave-year starts already credited; one credit per calendar year of the anniversary. */
export function dueCredits(joinDate, today, credited, firstCreditFrom) {
  if (!isIsoDate(joinDate)) return [];
  const years = new Set([...credited].map((d) => String(d).slice(0, 4)));
  const out = [];
  for (let y = +joinDate.slice(0, 4); y <= +today.slice(0, 4); y++) {
    const a = anniversaryOn(joinDate, y);
    if (a < joinDate || a > today) continue;
    if (firstCreditFrom && a < firstCreditFrom) continue;
    if (!years.has(a.slice(0, 4))) out.push(a);
  }
  return out;
}

export const capForfeit = (balance) => Math.max(0, balance - CAP);

const sum = (rows) => rows.reduce((n, r) => n + r.minutes, 0);

/** Profile figures for the leave year starting at yearStart. Rows: {kind, minutes, leave_year_start}. */
export function summarize(rows, pendingMinutes, yearStart) {
  const inYear = rows.filter((r) => r.leave_year_start === yearStart);
  const before = rows.filter((r) => !r.leave_year_start || r.leave_year_start < yearStart);
  const of = (...kinds) => inYear.filter((r) => kinds.includes(r.kind));
  const remaining = sum(rows);
  return {
    carried: sum(before) + sum(of("cap_forfeit")),
    entitlement: sum(of("annual_credit", "opening")),
    extra: sum(of("comp_credit")),
    used: -sum(of("annual_leave", "emergency_leave", "early_leave", "reversal").filter((r) => r.kind !== "reversal" || r.minutes > 0)),
    adjustments: sum(of("adjustment")),
    encashed: -sum(of("encashment")),
    remaining,
    pending: pendingMinutes,
    available: remaining - pendingMinutes,
  };
}

export function fmtDays(min) {
  const v = Math.round((min / DAY) * 100) / 100;
  return String(Object.is(v, -0) ? 0 : v);
}
