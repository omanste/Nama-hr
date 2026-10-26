// Permissions: early leave, late arrival and personal break — reason required, manager decides,
// shared monthly free hours then annual leave; counted on the profile and in the report.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson, client } from "./helpers.mjs";

let t, admin, hr, mgr, s, other, outsider;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-10-26" });
  admin = await adminClient(t.base);
  const d = (await admin.post("/api/departments", { name_ar: "المبيعات", name_en: "Sales" })).data.department;
  const d2 = (await admin.post("/api/departments", { name_ar: "المالية", name_en: "Finance" })).data.department;
  mgr = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "مدير", join_date: "2020-01-01", department_id: d.id }, "staff");
  await admin.put(`/api/departments/${d.id}`, { approver_employee_id: mgr.emp.id });
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  s = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف", name_en: "Staff", join_date: "2022-01-10", department_id: d.id, opening_days: 10 }, "staff");
  other = await makePerson(t.base, admin, { emp_no: "S2", name_ar: "زميل", join_date: "2022-01-10", department_id: d.id }, "staff");
  outsider = await makePerson(t.base, admin, { emp_no: "F1", name_ar: "مالية", join_date: "2022-01-10", department_id: d2.id }, "staff");
});
after(async () => { await t.close(); });
const ask = (c, b) => c.post("/api/requests", { reason: "موعد", ...b });

test("late arrival and personal break are measured in hours inside the working day", async () => {
  const late = await ask(s.c, { type: "late", date: "2026-11-02", time: "10:30" });
  assert.equal(late.status, 201); assert.equal(late.data.request.minutes, 90);
  const br = await ask(s.c, { type: "break", date: "2026-11-02", time: "12:00", end_time: "13:00" });
  assert.equal(br.status, 201); assert.equal(br.data.request.minutes, 60); assert.equal(br.data.request.end_time, "13:00");
  // overlapping hours on the same day are refused; separate hours are fine
  assert.equal((await ask(s.c, { type: "break", date: "2026-11-02", time: "10:00", end_time: "11:00" })).status, 409); // inside the late arrival
  assert.equal((await ask(s.c, { type: "early", date: "2026-11-02", time: "12:30" })).status, 409);                    // covers the break
  assert.equal((await ask(s.c, { type: "early", date: "2026-11-02", time: "16:00" })).status, 201);
  // bad times
  for (const b of [{ type: "late", date: "2026-11-03", time: "09:00" }, { type: "late", date: "2026-11-03", time: "10:15" },
    { type: "break", date: "2026-11-03", time: "13:00", end_time: "12:00" }, { type: "break", date: "2026-11-03", time: "16:30", end_time: "17:30" }])
    assert.equal((await ask(s.c, b)).status, 400, JSON.stringify(b));
  // a reason is required
  assert.equal((await s.c.post("/api/requests", { type: "late", date: "2026-11-04", time: "10:00" })).status, 400);
  // not on a day already taken as leave
  assert.equal((await s.c.post("/api/requests", { type: "annual", start: "2026-11-05", end: "2026-11-05" })).status, 201);
  assert.equal((await ask(s.c, { type: "late", date: "2026-11-05", time: "10:00" })).status, 409);
});

test("the manager decides; free hours are shared by all three each month, the rest comes from annual leave", async () => {
  const before = (await hr.c.get(`/api/employees/${other.emp.id}`)).data.leave.remaining;
  const ids = [];
  for (const b of [{ type: "late", date: "2026-11-09", time: "11:00" }, { type: "break", date: "2026-11-10", time: "12:00", end_time: "13:00" }, { type: "early", date: "2026-11-11", time: "15:00" }]) {
    const r = await ask(other.c, b); assert.equal(r.status, 201); ids.push(r.data.request.id);
  }
  assert.equal((await outsider.c.post(`/api/requests/${ids[0]}/approve`, {})).status, 403);
  for (const id of ids) assert.equal((await mgr.c.post(`/api/requests/${id}/approve`, {})).status, 200);
  // 2 h + 1 h + 2 h = 5 h; 4 h free → 1 h from annual leave
  const p = (await hr.c.get(`/api/employees/${other.emp.id}`)).data;
  assert.equal(p.leave.remaining, before - 60);
  assert.equal(p.permissions.month.total.count, 0); // October summary: these are in November
  const rejected = await ask(other.c, { type: "late", date: "2026-11-12", time: "10:00" });
  assert.equal((await mgr.c.post(`/api/requests/${rejected.data.request.id}/reject`, {})).status, 400); // reason needed
  assert.equal((await mgr.c.post(`/api/requests/${rejected.data.request.id}/reject`, { comment: "ضغط عمل" })).status, 200);
});

test("profile shows times and hours this month and this year", async () => {
  const r = await ask(other.c, { type: "late", date: "2026-10-28", time: "10:00" });
  await mgr.c.post(`/api/requests/${r.data.request.id}/approve`, {});
  const p = (await other.c.get(`/api/employees/${other.emp.id}`)).data.permissions;
  assert.equal(p.month.late.count, 1); assert.equal(p.month.late.minutes, 60);
  assert.equal(p.year.total.count, 4); assert.equal(p.year.total.minutes, 360);
  assert.equal(p.freeMonthly, 240); assert.equal(p.freeLeft, 180);
});

test("report: per person times and hours by type; HR sees all, a manager only their departments, staff nothing", async () => {
  const r = (await hr.c.get("/api/reports/permissions?from=2026-11-01&to=2026-11-30")).data;
  const row = r.items.find((x) => x.employee.id === other.emp.id);
  assert.deepEqual([row.late.count, row.late.minutes, row.break.count, row.early.count, row.total.minutes, row.deducted], [1, 120, 1, 1, 300, 60]);
  assert.ok(r.items.some((x) => x.employee.id === outsider.emp.id));
  const m = (await mgr.c.get("/api/reports/permissions?from=2026-11-01&to=2026-11-30")).data;
  assert.ok(!m.items.some((x) => x.employee.id === outsider.emp.id));
  assert.ok(m.items.some((x) => x.employee.id === other.emp.id));
  assert.equal((await s.c.get("/api/reports/permissions")).status, 403);
  assert.equal((await hr.c.get("/api/reports/permissions?from=2026-12-01&to=2026-11-01")).status, 400);
  const csv = await fetch(`${t.base}/api/reports/permissions?from=2026-11-01&to=2026-11-30&format=csv&only_used=1`, { headers: { cookie: hr.c.cookie } });
  assert.equal(csv.status, 200);
  const text = await csv.text();
  assert.match(text, /late hours/); assert.match(text, /"زميل"/);
});

test("leave and permission lists can be separated", async () => {
  const perms = (await other.c.get("/api/requests?scope=mine&kind=permission")).data.items;
  assert.ok(perms.length && perms.every((x) => ["early", "late", "break"].includes(x.type)));
  const leave = (await s.c.get("/api/requests?scope=mine&kind=leave")).data.items;
  assert.ok(leave.length && leave.every((x) => !["early", "late", "break"].includes(x.type)));
});

test("a request sent before the manager had a login moves to the manager once they get one", async () => {
  const d = (await admin.post("/api/departments", { name_ar: "التأجير" })).data.department;
  const boss = (await admin.post("/api/employees", { name_ar: "مدير التأجير", join_date: "2020-01-01", department_id: d.id })).data.employee;
  await admin.put(`/api/departments/${d.id}`, { approver_employee_id: boss.id });
  const w = await makePerson(t.base, admin, { emp_no: "R1", name_ar: "موظف تأجير", join_date: "2022-01-01", department_id: d.id }, "staff");
  const r = (await ask(w.c, { type: "late", date: "2026-11-16", time: "10:00" })).data.request;
  assert.equal(r.route_reason, "admin");
  const u = await admin.post(`/api/employees/${boss.id}/login`, {});
  assert.equal(u.status, 201);
  const now = (await admin.get(`/api/requests/${r.id}`)).data.request;
  assert.equal(now.approver_user_id, u.data.user.id);
  assert.equal(now.route_reason, "dept");
});
