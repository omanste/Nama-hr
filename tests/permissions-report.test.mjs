// Permissions report: counts and hours per person (early leave, late arrival, personal break) and by HR's paid category,
// with totals; each permission listed (from–to, approved by, comment) for the PDF / Excel; HR and the direct manager only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";

let t, admin, hr, mgr, a, b, other;
const LONG = { ar: "أحمد بن عبدالله بن محمد بن سالم العبيداني", en: "Ahmed Abdullah Mohammed Salim Al Obaidani" };
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-11-25", FLEX_DEFAULT: "on" });
  admin = await adminClient(t.base);
  const d = (await admin.post("/api/departments", { name_ar: "المبيعات", name_en: "Sales" })).data.department;
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  mgr = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "مدير", join_date: "2020-01-01" }, "manager");
  a = await makePerson(t.base, admin, { emp_no: "NAMA-008", name_ar: LONG.ar, name_en: LONG.en, join_date: "2022-01-01", department_id: d.id, manager_employee_id: mgr.emp.id, opening_days: 20 }, "staff");
  b = await makePerson(t.base, admin, { emp_no: "NAMA-009", name_ar: "بدون استئذان", join_date: "2022-01-01", manager_employee_id: mgr.emp.id }, "staff");
  other = await makePerson(t.base, admin, { emp_no: "NAMA-010", name_ar: "قسم آخر", join_date: "2022-01-01" }, "staff");
  // four permissions: early (statutory), late (special), break (unpaid), early (awaiting HR); one rejected with a comment
  const ask = (body) => a.c.post("/api/requests", { reason: "موعد", ...body }).then((r) => { assert.equal(r.status, 201, JSON.stringify(body) + " " + JSON.stringify(r.data)); return r.data.request; });
  const p1 = await ask({ type: "early", date: "2026-11-02", time: "16:00" });  // Flexible, latest end 18:15 → 135 min
  const p2 = await ask({ type: "late", date: "2026-11-03", time: "10:00" });   // from 09:15 → 45 min
  const p3 = await ask({ type: "break", date: "2026-11-04", time: "12:00", end_time: "13:30" }); // 90 min
  const p4 = await ask({ type: "early", date: "2026-11-05", time: "17:30" });  // 45 min
  const p5 = await ask({ type: "late", date: "2026-11-09", time: "10:00" });
  for (const p of [p1, p2, p3, p4]) assert.equal((await mgr.c.post(`/api/requests/${p.id}/approve`, { comment: p === p1 ? "موافق" : "" })).status, 200);
  assert.equal((await mgr.c.post(`/api/requests/${p5.id}/reject`, { comment: "ضغط عمل" })).status, 200);
  for (const [p, c] of [[p1, "statutory"], [p2, "special"], [p3, "unpaid"]]) assert.equal((await hr.c.post(`/api/requests/${p.id}/hr`, { class: c })).status, 200, c);
});
after(async () => { await t.close(); });

test("per person: counts and hours by type and by HR's category, awaiting HR; zero rows kept when asked", async () => {
  const r = (await hr.c.get("/api/reports/permissions?from=2026-11-01&to=2026-11-30")).data;
  const x = r.items.find((i) => i.employee.id === a.emp.id);
  assert.equal(x.employee.name_en, LONG.en, "the full stored name");
  assert.deepEqual([x.early.count, x.early.minutes, x.late.count, x.late.minutes, x.break.count, x.break.minutes, x.total.count, x.total.minutes], [2, 180, 1, 45, 1, 90, 4, 315]);
  assert.deepEqual([x.classes.statutory, x.classes.special, x.classes.unpaid, x.classes.unclassified], [135, 45, 90, 45]);
  assert.deepEqual([x.classCounts.statutory, x.classCounts.special, x.classCounts.unpaid, x.classCounts.leave, x.classCounts.unclassified], [1, 1, 1, 0, 1]);
  assert.ok(r.items.some((i) => i.employee.id === b.emp.id && i.total.count === 0), "a person with none");
  assert.ok(!(await hr.c.get("/api/reports/permissions?from=2026-11-01&to=2026-11-30&only_used=1")).data.items.some((i) => i.employee.id === b.emp.id));
  assert.ok(r.generated_at && r.by);
});

test("each permission: date, type, from–to (by the person's shift), hours, category, status, approved by, comment", async () => {
  const r = (await hr.c.get("/api/reports/permissions?from=2026-11-01&to=2026-11-30&details=1")).data;
  const mine = r.details.filter((d) => d.employee.id === a.emp.id);
  assert.equal(mine.length, 5);
  const e1 = mine.find((d) => d.date === "2026-11-02");
  assert.deepEqual([e1.type, e1.from, e1.to, e1.minutes, e1.hr_class, e1.status, e1.comment, e1.decided_by.name_ar], ["early", "16:00", "18:15", 135, "statutory", "approved", "موافق", "مدير"]);
  const late = mine.find((d) => d.date === "2026-11-03");
  assert.deepEqual([late.from, late.to], ["09:15", "10:00"]);
  const rej = mine.find((d) => d.status === "rejected");
  assert.equal(rej.comment, "ضغط عمل");
  assert.ok(mine.find((d) => d.date === "2026-11-05").hr_class === null, "awaiting HR");
});

test("HR and the direct manager only: the manager sees their own people; staff and others are refused", async () => {
  const m = (await mgr.c.get("/api/reports/permissions?from=2026-11-01&to=2026-11-30")).data;
  assert.deepEqual(m.items.map((i) => i.employee.id).sort(), [a.emp.id, b.emp.id].sort());
  assert.equal((await a.c.get("/api/reports/permissions")).status, 403);
  assert.equal((await other.c.get("/api/reports/permissions?details=1")).status, 403);
  assert.equal((await hr.c.get("/api/reports/permissions?from=2026-11-30&to=2026-11-01")).status, 400);
});
