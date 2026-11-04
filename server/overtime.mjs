// Overtime pay: extra time after hours counts once the manager has approved it and HR has confirmed it. The portal holds
// no salaries, so it gives Accounts the hours: each request's minutes split into daytime and night (or rest day /
// official holiday) hours, with the multiplier for each, and the "paid hours" (hours × multiplier). Accounts multiply by the
// person's hourly basic wage in payroll.
import { getSetting } from "./db.mjs";
import { send, sendRaw, HttpError } from "./http.mjs";
import { clockMin } from "./leave.mjs";
import { isRestDay } from "./shifts.mjs";

export const OT_DEFAULTS = { overtime_rate_day: 1.25, overtime_rate_night: 1.5, overtime_night_start: "21:00" };

export const overtimeRates = (db) => Object.fromEntries(Object.entries(OT_DEFAULTS).map(([k, v]) => [k, getSetting(db, k, v)]));

/** The rates a confirmed request is paid at: those stored when HR confirmed it, else today's. */
export function ratesFor(db, r) {
  const d = typeof r.details === "string" ? JSON.parse(r.details || "{}") : r.details || {};
  if (d.ot_rates) return d.ot_rates;
  const s = overtimeRates(db);
  return { day: s.overtime_rate_day, night: s.overtime_rate_night, night_start: s.overtime_night_start };
}

/** Split one overtime request into daytime / night minutes and the paid minutes. Rest days and holidays: all at the night rate. */
export function overtimePay(r, rates, holidays) {
  const from = clockMin(r.early_time), to = clockMin(r.end_time);
  const minutes = from !== null && to !== null && to > from ? to - from : r.minutes || 0;
  const offDay = isRestDay(r.start_date) || holidays.has(r.start_date);
  let night = 0;
  if (offDay) night = minutes;
  else if (from !== null && to !== null) {
    const ns = clockMin(rates.night_start) ?? 21 * 60;
    night = Math.max(0, to - Math.max(from, ns)) + Math.max(0, Math.min(to, 6 * 60) - from); // after night start, or before 06:00
    night = Math.min(night, minutes);
  }
  const day = minutes - night;
  return { minutes, day_min: day, night_min: night, off_day: offDay, paid_min: Math.round(day * rates.day + night * rates.night) };
}

export function registerOvertime(api, ctx) {
  const { db } = ctx;
  api.get("/api/reports/overtime", (req, res) => {
    if (!["hr", "admin", "accounts", "ceo", "chairman"].includes(req.sess.user.role)) throw new HttpError(403, "forbidden", "You do not have permission for this");
    const month = /^\d{4}-\d{2}$/.test(req.query.get("month") || "") ? req.query.get("month") : ctx.today().slice(0, 7);
    const holidays = new Set(getSetting(db, "official_holidays", []).map((h) => h.date));
    const rows = db.prepare(`SELECT r.*, e.emp_no, e.name_ar, e.name_en, d.name_ar dept_ar, d.name_en dept_en FROM leave_requests r
      JOIN employees e ON e.id=r.employee_id LEFT JOIN departments d ON d.id=e.department_id
      WHERE r.type='overtime' AND r.status='approved' AND r.hr_class='confirmed' AND substr(r.start_date,1,7)=? ORDER BY e.name_ar, r.start_date`).all(month).map((r) => {
      const rates = ratesFor(db, r);
      return { id: r.id, employee: { id: r.employee_id, emp_no: r.emp_no, name_ar: r.name_ar, name_en: r.name_en, dept_ar: r.dept_ar, dept_en: r.dept_en },
        date: r.start_date, from: r.early_time, to: r.end_time, rates, ...overtimePay(r, rates, holidays) };
    });
    const sum = (k) => rows.reduce((a, x) => a + x[k], 0);
    const totals = { minutes: sum("minutes"), day_min: sum("day_min"), night_min: sum("night_min"), paid_min: sum("paid_min") };
    if (req.query.get("format") === "csv") {
      const hrs = (m) => (m / 60).toFixed(2);
      const lines = [["Employee ID", "Name (Arabic)", "Name (English)", "Department", "Date", "From", "To", "Rest day / holiday", "Hours", "Daytime hours", "Day rate", "Night / rest-day hours", "Night rate", "Paid hours (x rate)"].join(",")];
      for (const x of rows) lines.push([x.employee.emp_no, x.employee.name_ar, x.employee.name_en, x.employee.dept_en || x.employee.dept_ar || "", x.date, x.from, x.to,
        x.off_day ? "Yes" : "No", hrs(x.minutes), hrs(x.day_min), x.rates.day, hrs(x.night_min), x.rates.night, hrs(x.paid_min)].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
      lines.push("", `"Total","","","","","","","","${hrs(totals.minutes)}","${hrs(totals.day_min)}","","${hrs(totals.night_min)}","","${hrs(totals.paid_min)}"`);
      return sendRaw(req, res, 200, Buffer.from("﻿" + lines.join("\r\n"), "utf8"), "text/csv; charset=utf-8",
        { "Content-Disposition": `attachment; filename="overtime-${month}.csv"`, "Cache-Control": "no-store" });
    }
    send(req, res, 200, { month, rows, totals, rates: overtimeRates(db) });
  });
}
