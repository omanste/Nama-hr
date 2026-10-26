// Nama company policies on top of the Labour Law (decided 2026-10-26)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";

let t, admin, hr, mgr, s, junior;
const days = (n) => n * 480;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-10-26" });
  admin = await adminClient(t.base);
  const d = (await admin.post("/api/departments", { name_ar: "المبيعات" })).data.department;
  mgr = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "مدير", join_date: "2020-01-01", department_id: d.id }, "staff");
  await admin.put(`/api/departments/${d.id}`, { approver_employee_id: mgr.emp.id });
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  s = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف", join_date: "2022-01-10", department_id: d.id, opening_days: 10 }, "staff");
  junior = await makePerson(t.base, admin, { emp_no: "J1", name_ar: "جديد", join_date: "2026-08-01", department_id: d.id }, "staff");
});
after(async () => { await t.close(); });
const remaining = async (id) => (await hr.c.get(`/api/employees/${id}`)).data.leave.remaining;
const approve = (id) => mgr.c.post(`/api/requests/${id}/approve`, {});

test("official holidays inside annual leave are not deducted", async () => {
  const bad = await admin.put("/api/settings", { official_holidays: [{ date: "2026-11-31", name: "x" }] });
  assert.equal(bad.status, 400);
  assert.equal((await admin.put("/api/settings", { official_holidays: [{ date: "2026-11-18", name: "اليوم الوطني" }, { date: "2026-11-19", name: "اليوم الوطني" }] })).status, 200);
  assert.equal((await hr.c.get("/api/settings")).data.official_holidays.length, 2);
  const r = await s.c.post("/api/requests", { type: "annual", start: "2026-11-16", end: "2026-11-20" });
  assert.equal(r.status, 201);
  assert.equal(r.data.request.minutes, days(3));
  const only = await s.c.post("/api/requests", { type: "annual", start: "2026-11-18", end: "2026-11-19" });
  assert.equal(only.status, 400);
  await s.c.post(`/api/requests/${r.data.request.id}/cancel`, {});
});

test("emergency leave is deducted from annual leave (and follows the 6-month rule)", async () => {
  const before = await remaining(s.emp.id);
  const r = await s.c.post("/api/requests", { type: "emergency", start: "2026-12-01", end: "2026-12-02" });
  assert.equal(r.status, 201);
  assert.equal((await approve(r.data.request.id)).status, 200);
  assert.equal(await remaining(s.emp.id), before - days(2));
  assert.equal((await junior.c.post("/api/requests", { type: "emergency", start: "2026-11-01", end: "2026-11-01" })).data.error, "not_eligible_yet");
  assert.equal((await s.c.post("/api/requests", { type: "emergency", start: "2027-01-01", end: "2027-01-30" })).data.error, "insufficient_balance");
});

test("early leave: free hours each month, the rest deducted from annual leave", async () => {
  assert.equal((await admin.put("/api/settings", { early_free_hours_month: 3 })).status, 200);
  assert.equal((await admin.put("/api/settings", { early_free_hours_month: -1 })).status, 400);
  const before = await remaining(s.emp.id);
  const a = await s.c.post("/api/requests", { type: "early", date: "2026-12-07", time: "15:00" }); // 2 h, free
  assert.equal((await approve(a.data.request.id)).status, 200);
  assert.equal(await remaining(s.emp.id), before);
  const b = await s.c.post("/api/requests", { type: "early", date: "2026-12-08", time: "14:00" }); // 3 h: 1 free + 2 deducted
  assert.equal((await approve(b.data.request.id)).status, 200);
  assert.equal(await remaining(s.emp.id), before - 120);
  const c = await s.c.post("/api/requests", { type: "early", date: "2027-01-05", time: "16:00" }); // new month, free again
  assert.equal((await approve(c.data.request.id)).status, 200);
  assert.equal(await remaining(s.emp.id), before - 120);
  await mgr.c.post(`/api/requests/${b.data.request.id}/cancel`, {});
  assert.equal(await remaining(s.emp.id), before);
  const d = (await s.c.get(`/api/requests/${b.data.request.id}`)).data;
  assert.equal(typeof d.earlyFreeHours, "number");
});

test("worked on a holiday: the employee chooses a day off or payment", async () => {
  const before = await remaining(s.emp.id);
  assert.equal((await s.c.post("/api/requests", { type: "comp_day", date: "2026-10-23", comp_choice: "cash" })).status, 400);
  const pay = await s.c.post("/api/requests", { type: "comp_day", date: "2026-10-23", comp_choice: "pay" });
  assert.equal(pay.status, 201);
  assert.equal(pay.data.request.comp_choice, "pay");
  assert.equal((await approve(pay.data.request.id)).status, 200);
  assert.equal(await remaining(s.emp.id), before, "payment adds no leave");
  const leave = await s.c.post("/api/requests", { type: "comp_day", date: "2026-10-24" });
  assert.equal(leave.data.request.comp_choice, "leave");
  assert.equal((await approve(leave.data.request.id)).status, 200);
  assert.equal(await remaining(s.emp.id), before + 480);
});
