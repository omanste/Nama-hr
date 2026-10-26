// Disable / enable / delete a staff record, and the Manager role.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson, client, login } from "./helpers.mjs";

let t, admin, hr, ceo, mgr, s;
before(async () => {
  t = await boot({ APP_ENV: "dev", FAKE_TODAY: "2026-10-26" });
  admin = await adminClient(t.base);
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  ceo = await makePerson(t.base, admin, { emp_no: "C1", name_ar: "إسحاق", join_date: "2015-01-01" }, "ceo");
  await admin.put("/api/settings", { managers_approver_employee_id: ceo.emp.id });
  const d = (await admin.post("/api/departments", { name_ar: "المبيعات" })).data.department;
  mgr = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "مدير", join_date: "2020-01-01", department_id: d.id }, "manager");
  await admin.put(`/api/departments/${d.id}`, { approver_employee_id: mgr.emp.id });
  s = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف", join_date: "2022-01-01", department_id: d.id }, "staff");
});
after(async () => { await t.close(); });
const names = async () => (await client(t.base).get("/api/login-options")).data.people.map((p) => p.id);

test("Manager role: can be given and taken; their own leave goes to the CEO", async () => {
  assert.equal(mgr.user.role, "manager");
  const r = await mgr.c.post("/api/requests", { type: "late", date: "2026-11-02", time: "10:00", reason: "x" });
  assert.equal(r.data.request.approver_user_id, ceo.user.id);
  assert.equal((await admin.put(`/api/users/${mgr.user.id}`, { role: "manager" })).status, 200);
  assert.equal((await admin.put(`/api/users/${mgr.user.id}`, { role: "boss" })).status, 400);
});

test("disable: no access, gone from the login list and the active staff list; enable brings it back", async () => {
  assert.ok((await names()).includes(s.emp.id));
  assert.equal((await s.c.post(`/api/employees/${s.emp.id}/disable`)).status, 403); // staff can't
  const r = await hr.c.post(`/api/employees/${s.emp.id}/disable`);
  assert.equal(r.status, 200); assert.equal(r.data.employee.status, "disabled");
  assert.equal((await s.c.get("/api/me")).status, 401);                               // signed out at once
  assert.equal((await client(t.base).post("/api/login", { employee_id: s.emp.id, password: "2026" })).status, 401);
  assert.ok(!(await names()).includes(s.emp.id));
  assert.ok(!(await hr.c.get("/api/employees?status=active")).data.items.some((e) => e.id === s.emp.id));
  assert.ok((await hr.c.get("/api/employees?status=disabled")).data.items.some((e) => e.id === s.emp.id));
  assert.equal((await hr.c.post(`/api/employees/${ceo.emp.id}/disable`)).status, 403); // only Admin for the CEO
  assert.equal((await hr.c.post(`/api/employees/${s.emp.id}/enable`)).status, 200);
  assert.ok((await names()).includes(s.emp.id));
  assert.equal((await client(t.base).post("/api/login", { employee_id: s.emp.id, password: "2026" })).status, 200);
});

test("delete: Admin only, and only without history", async () => {
  const dup = (await admin.post("/api/employees", { name_ar: "مكرر", join_date: "2024-01-01", opening_days: 5 })).data.employee;
  await admin.post(`/api/employees/${dup.id}/login`, {});
  await admin.upload(`/api/employees/${dup.id}/files?kind=doc&doc_type=other&name=x.pdf`, Buffer.from("%PDF-1.4"), "application/pdf");
  assert.equal((await hr.c.del(`/api/employees/${dup.id}`)).status, 403);
  // a person with a request (even one sent by a colleague of theirs) can't be deleted
  const again = client(t.base); // the old session ended when they were disabled
  assert.equal((await again.post("/api/login", { employee_id: s.emp.id, password: "2026" })).status, 200);
  assert.equal((await again.post("/api/requests", { type: "late", date: "2026-11-03", time: "10:00", reason: "x" })).status, 201);
  assert.equal((await admin.del(`/api/employees/${s.emp.id}`)).status, 409);
});

test("delete removes a mistaken record completely; anyone with history must be disabled instead", async () => {
  const dup = (await admin.post("/api/employees", { name_ar: "مكرر٢", join_date: "2024-01-01", opening_days: 5 })).data.employee;
  await admin.post(`/api/employees/${dup.id}/login`, {});
  assert.equal((await admin.del(`/api/employees/${dup.id}`)).status, 200);
  assert.equal((await admin.get(`/api/employees/${dup.id}`)).status, 404);
  assert.ok(!(await names()).includes(dup.id));
  // the manager has a request → refused
  const res = await admin.del(`/api/employees/${mgr.emp.id}`);
  assert.equal(res.status, 409); assert.equal(res.data.error, "has_history");
});
