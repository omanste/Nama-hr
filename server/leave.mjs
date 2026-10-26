/* Leave rules — pure functions, no I/O. All amounts are integer minutes; dates are ISO "YYYY-MM-DD". */

export const DAY = 480;            // 8-hour working day, 09:00–17:00
export const ANNUAL = 30 * DAY;    // yearly entitlement
export const CAP = 60 * DAY;       // total balance cap, applied when a yearly credit is posted
export const MAX_RANGE_DAYS = 60;
export const DAY_END = 17 * 60;    // 17:00

/** effect: "deduct" reduces the balance, "credit" adds to it, "record" is history only. */
export const TYPES = {
  annual: { effect: "deduct", range: true },
  early: { effect: "deduct" },
  emergency: { effect: "record", range: true },
  bereavement: { effect: "record", range: true },
  sick: { effect: "record", range: true },
  comp_day: { effect: "credit" },
};

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

export function annualMinutes(start, end) {
  const days = daysBetweenInclusive(start, end);
  if (days < 1) throw new RangeError("end date is before start date");
  if (days > MAX_RANGE_DAYS) throw new RangeError(`range is longer than ${MAX_RANGE_DAYS} days`);
  return days * DAY;
}

export function earlyMinutes(time) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(time || ""));
  if (!m) throw new RangeError("invalid time");
  const t = +m[1] * 60 + +m[2];
  if (+m[2] % 30 !== 0 || t < 9 * 60 + 30 || t > 16 * 60 + 30) throw new RangeError("time must be 09:30–16:30 in 30-minute steps");
  return DAY_END - t;
}

export function requestMinutes(type, { start, end, time } = {}) {
  const T = TYPES[type];
  if (!T) throw new RangeError("unknown leave type");
  if (type === "early") return earlyMinutes(time);
  if (type === "comp_day") return DAY;
  return annualMinutes(start, end);
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

/** Leave-year starts from the join date up to today that have no credit yet (optionally only from firstCreditFrom on). */
export function dueCredits(joinDate, today, credited, firstCreditFrom) {
  if (!isIsoDate(joinDate)) return [];
  const out = [];
  for (let y = +joinDate.slice(0, 4); y <= +today.slice(0, 4); y++) {
    const a = anniversaryOn(joinDate, y);
    if (a < joinDate || a > today) continue;
    if (firstCreditFrom && a < firstCreditFrom) continue;
    if (!credited.has(a)) out.push(a);
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
