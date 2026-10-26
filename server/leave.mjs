/* Leave rules — pure functions, no I/O. All amounts are integer minutes; dates are ISO "YYYY-MM-DD". */

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
  early: { effect: "record", hours: true },                       // company permission, recorded in hours (not annual leave)
  emergency: { effect: "record", range: true, maxDays: 60 },      // company benefit; not in the 2023 law
  sick: { effect: "record", range: true, proof: true, yearCap: 182, maxDays: 182 },
  bereavement: { effect: "record", range: true, proof: true, relation: "list" },
  marriage: { effect: "record", range: true, proof: true, maxDays: 3, once: true },
  paternity: { effect: "record", range: true, proof: true, maxDays: 7, gender: "male", event: "birth" },
  maternity: { effect: "record", range: true, proof: true, maxDays: 98, gender: "female", event: "birth" },
  hajj: { effect: "record", range: true, proof: true, maxDays: 15, once: true, minServiceMonths: 12 },
  exam: { effect: "record", range: true, proof: true, yearCap: 15, maxDays: 15, omani: true },
  patient_care: { effect: "record", range: true, proof: true, yearCap: 15, maxDays: 15, omani: true, relation: "text" },
  childcare: { effect: "record", range: true, maxDays: 365, gender: "female", paid: false },
  unpaid: { effect: "record", range: true, maxDays: 365, paid: false },
  comp_day: { effect: "credit" },
};

/** Art. 84: days of paid bereavement leave by relation. A widow's leave (iddah) is for women. */
export const BEREAVEMENT_DAYS = {
  wife: 10, son: 10, daughter: 10,
  father: 3, mother: 3, grandfather: 3, grandmother: 3, brother: 3, sister: 3,
  uncle: 2, aunt: 2,
  husband_muslim: 130, husband_other: 14,
};

/** Art. 82: sick-leave pay by cumulative day of the year — {percent: days}. */
export function sickPayBands(priorDays, days) {
  const out = { 100: 0, 75: 0, 50: 0, 35: 0 };
  for (let d = priorDays + 1; d <= Math.min(priorDays + days, 182); d++) out[d <= 21 ? 100 : d <= 35 ? 75 : d <= 70 ? 50 : 35]++;
  return out;
}

export class RuleError extends Error {
  constructor(code, message, field) { super(message); this.code = code; this.field = field; }
}
const isOmani = (nat) => /oman|عمان|عماني/i.test(String(nat || ""));

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
    if (!(relation in BEREAVEMENT_DAYS)) throw new RuleError("invalid", "Choose the relation", "relation");
    if (relation.startsWith("husband") && emp.gender === "male") throw new RuleError("not_entitled", "This leave is for a widow", "relation");
    if (relation === "wife" && emp.gender === "female") throw new RuleError("not_entitled", "Choose the correct relation", "relation");
    max = BEREAVEMENT_DAYS[relation];
  }
  if (T.relation === "text" && !String(relation || "").trim()) throw new RuleError("invalid", "Name the patient's relation to you", "relation");
  if (T.event) {
    if (!isIsoDate(eventDate)) throw new RuleError("invalid", "Enter the date of birth", "event_date");
    // paternity: from the birth up to the child's 98th day · maternity: starts at most 14 days before the birth
    const ok = type === "paternity" ? start >= eventDate && end <= addDays(eventDate, 97) : start >= addDays(eventDate, -14);
    if (!ok) throw new RuleError("outside_window", type === "paternity" ? "Paternity leave must be taken within 98 days of the birth" : "Maternity leave can start at most 14 days before the birth", "start");
    if (days + (used.forEvent || 0) > max) throw new RuleError("too_long", `At most ${max} days`, "end");
  }
  if (max && days > max) throw new RuleError("too_long", `At most ${max} days`, "end");
  if (T.yearCap && days + (used.inYear || 0) > T.yearCap) throw new RuleError("year_limit", `At most ${T.yearCap} days a year (${Math.max(0, T.yearCap - (used.inYear || 0))} left)`, "end");
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

export function annualMinutes(start, end, maxDays = MAX_RANGE_DAYS) {
  const days = daysBetweenInclusive(start, end);
  if (days < 1) throw new RangeError("end date is before start date");
  if (days > Math.max(maxDays, MAX_RANGE_DAYS)) throw new RangeError(`range is longer than ${Math.max(maxDays, MAX_RANGE_DAYS)} days`);
  return days * DAY;
}

/** Minutes from the leave time to the end of the working day (17:00, or the Ramadan end time). 30-minute steps, from 09:30. */
export function earlyMinutes(time, dayEnd = DAY_END) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(time || ""));
  if (!m) throw new RangeError("invalid time");
  const t = +m[1] * 60 + +m[2];
  if (+m[2] % 30 !== 0 || t < 9 * 60 + 30 || t > dayEnd - 30) throw new RangeError("time must be from 09:30 to 30 minutes before the end of the day, in 30-minute steps");
  return dayEnd - t;
}

export function requestMinutes(type, { start, end, time, dayEnd } = {}) {
  const T = TYPES[type];
  if (!T) throw new RangeError("unknown leave type");
  if (type === "early") return earlyMinutes(time, dayEnd);
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
    used: -sum(of("annual_leave", "early_leave", "reversal").filter((r) => r.kind !== "reversal" || r.minutes > 0)),
    adjustments: sum(of("adjustment")),
    remaining,
    pending: pendingMinutes,
    available: remaining - pendingMinutes,
  };
}

export function fmtDays(min) {
  const v = Math.round((min / DAY) * 100) / 100;
  return String(Object.is(v, -0) ? 0 : v);
}
