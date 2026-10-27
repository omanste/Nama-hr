/* Ledger access: post rows and compute an employee's balance summary. */
import { nowIso } from "./db.mjs";
import { summarize, leaveYearStart, eligibleFrom, probationEnd, isIsoDate, TYPES } from "./leave.mjs";

/** Leave-year bucket for a date: the join anniversary, or the calendar year when no join date is known. */
export function yearStartFor(emp, date) {
  return isIsoDate(emp.join_date) ? leaveYearStart(emp.join_date, date) : `${date.slice(0, 4)}-01-01`;
}

export function postLedger(db, emp, { kind, minutes, date, requestId = null, note = null, by = null, yearStart }) {
  const r = db.prepare("INSERT INTO leave_ledger(employee_id,kind,minutes,leave_year_start,effective_date,request_id,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(emp.id, kind, minutes, yearStart || yearStartFor(emp, date), date, requestId, note, by, nowIso());
  return Number(r.lastInsertRowid);
}

export const ledgerRows = (db, empId) => db.prepare("SELECT * FROM leave_ledger WHERE employee_id=? ORDER BY effective_date, id").all(empId);
export const balanceOf = (db, empId) => db.prepare("SELECT coalesce(sum(minutes),0) n FROM leave_ledger WHERE employee_id=?").get(empId).n;

const DEDUCT = Object.keys(TYPES).filter((k) => TYPES[k].effect === "deduct");
export function pendingMinutes(db, empId, excludeRequestId = 0) {
  return db.prepare(`SELECT coalesce(sum(minutes),0) n FROM leave_requests WHERE employee_id=? AND status='pending' AND id<>? AND type IN (${DEDUCT.map(() => "?").join(",")})`)
    .get(empId, excludeRequestId, ...DEDUCT).n;
}

export function leaveSummary(db, emp, today) {
  const yearStart = yearStartFor(emp, today);
  const s = summarize(ledgerRows(db, emp.id), pendingMinutes(db, emp.id), yearStart);
  const byType = Object.fromEntries(Object.keys(TYPES).filter((k) => !TYPES[k].attendance).map((k) => [k, 0]));
  for (const r of db.prepare("SELECT type, sum(minutes) n FROM leave_requests WHERE employee_id=? AND status='approved' AND start_date>=? GROUP BY type").all(emp.id, yearStart)) if (r.type in byType) byType[r.type] = r.n;
  return { ...s, yearStart, eligibleFrom: eligibleFrom(emp.join_date), probationEnd: probationEnd(emp.join_date), byType };
}
