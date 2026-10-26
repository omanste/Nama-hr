/* Permissions report: how many times and how many hours each person used early leave, late arrival and personal breaks. */
import { getSetting } from "./db.mjs";
import { send, sendRaw, HttpError } from "./http.mjs";
import { can, approvedDepartments } from "./perm.mjs";
import { PERMISSION_TYPES, isIsoDate } from "./leave.mjs";

const IN = `(${PERMISSION_TYPES.map((t) => `'${t}'`).join(",")})`;

/** {early:{count,minutes}, late:…, break:…, total:{count,minutes}, deducted} for one person between two dates (approved only). */
export function permissionStats(db, empId, from, to) {
  const out = Object.fromEntries([...PERMISSION_TYPES, "total"].map((k) => [k, { count: 0, minutes: 0 }]));
  for (const r of db.prepare(`SELECT type, count(*) n, sum(minutes) m FROM leave_requests WHERE employee_id=? AND status='approved' AND type IN ${IN}
      AND start_date>=? AND start_date<=? GROUP BY type`).all(empId, from, to)) {
    out[r.type] = { count: r.n, minutes: r.m };
    out.total.count += r.n; out.total.minutes += r.m;
  }
  out.deducted = -db.prepare(`SELECT coalesce(sum(l.minutes),0) n FROM leave_ledger l JOIN leave_requests r ON r.id=l.request_id
      WHERE l.employee_id=? AND r.type IN ${IN} AND r.start_date>=? AND r.start_date<=?`).get(empId, from, to).n;
  return out;
}

/** This month and this year, plus the free hours left this month (pending requests already count against them). */
export function permissionSummary(db, empId, today) {
  const month = today.slice(0, 7), year = today.slice(0, 4);
  const free = Math.round(Number(getSetting(db, "early_free_hours_month", 4)) * 60);
  const usedThisMonth = db.prepare(`SELECT coalesce(sum(minutes),0) n FROM leave_requests WHERE employee_id=? AND type IN ${IN} AND status IN ('pending','approved')
      AND substr(start_date,1,7)=?`).get(empId, month).n;
  return { month: permissionStats(db, empId, `${month}-01`, `${month}-31`), year: permissionStats(db, empId, `${year}-01-01`, `${year}-12-31`),
    freeMonthly: free, freeLeft: Math.max(0, free - usedThisMonth) };
}

export function registerPermissionReports(api, ctx) {
  const { db } = ctx;
  api.get("/api/reports/permissions", (req, res) => {
    const sess = req.sess;
    const all = can(sess, "employee.viewAll");
    const mine = approvedDepartments(db, sess.employee && sess.employee.id);
    if (!all && !mine.length) throw new HttpError(403, "forbidden", "You do not have permission for this");
    const today = ctx.today();
    const from = req.query.get("from") || `${today.slice(0, 7)}-01`, to = req.query.get("to") || today;
    if (!isIsoDate(from) || !isIsoDate(to) || to < from) throw new HttpError(400, "invalid", "Choose a valid period");
    const where = ["e.status IN ('active','on_leave')"], args = [];
    const dept = Number(req.query.get("department_id") || 0);
    if (dept) { where.push("e.department_id=?"); args.push(dept); }
    if (!all) { where.push(`e.department_id IN (${mine.map(() => "?").join(",")})`); args.push(...mine); } // managers see their own departments
    const emps = db.prepare(`SELECT e.id, e.emp_no, e.name_ar, e.name_en, e.department_id, d.name_ar dept_ar, d.name_en dept_en
      FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE ${where.join(" AND ")} ORDER BY e.name_ar`).all(...args);
    const rows = emps.map((e) => ({ employee: e, ...permissionStats(db, e.id, from, to) }));
    const onlyUsed = req.query.get("only_used") === "1";
    const items = onlyUsed ? rows.filter((r) => r.total.count > 0) : rows;
    if (req.query.get("format") === "csv") {
      const h = (m) => (m / 60).toFixed(1);
      const lines = [["Employee ID", "Name (Arabic)", "Name (English)", "Department", ...PERMISSION_TYPES.flatMap((t) => [`${t} count`, `${t} hours`]), "Total count", "Total hours", "Hours taken from annual leave"].join(",")];
      for (const r of items) lines.push([r.employee.emp_no, r.employee.name_ar, r.employee.name_en, r.employee.dept_en || r.employee.dept_ar || "",
        ...PERMISSION_TYPES.flatMap((t) => [r[t].count, h(r[t].minutes)]), r.total.count, h(r.total.minutes), h(r.deducted)]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
      // BOM so Excel opens Arabic names correctly
      return sendRaw(req, res, 200, Buffer.from("﻿" + lines.join("\r\n"), "utf8"), "text/csv; charset=utf-8",
        { "Content-Disposition": `attachment; filename="permissions-${from}-to-${to}.csv"`, "Cache-Control": "no-store" });
    }
    send(req, res, 200, { from, to, items, types: PERMISSION_TYPES, freeMonthlyHours: Number(getSetting(db, "early_free_hours_month", 4)) });
  });
}
