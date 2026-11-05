// HR assigns a person's direct manager on the profile: their requests then go to that manager (then HR), pending ones follow a change.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { approverFor } from "../server/routing.mjs";

let t, admin, hr, head, lead, lead2, s, ceo, top;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-11-05" });
  admin = await adminClient(t.base);
  const d = (await admin.post("/api/departments", { name_ar: "المشاريع" })).data.department;
  head = await makePerson(t.base, admin, { emp_no: "D1", name_ar: "رئيس القسم", join_date: "2020-01-01", department_id: d.id }, "manager");
  await admin.put(`/api/departments/${d.id}`, { approver_employee_id: head.emp.id });
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  lead = await makePerson(t.base, admin, { emp_no: "L1", name_ar: "قائد الفريق", join_date: "2020-01-01", department_id: d.id }, "staff");
  lead2 = await makePerson(t.base, admin, { emp_no: "L2", name_ar: "قائد آخر", join_date: "2020-01-01", department_id: d.id }, "staff");
  s = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف", join_date: "2022-01-01", department_id: d.id, opening_days: 20 }, "staff");
  ceo = await makePerson(t.base, admin, { emp_no: "C1", name_ar: "التنفيذي", join_date: "2015-01-01" }, "ceo");
  await admin.put("/api/settings", { managers_approver_employee_id: ceo.emp.id });
  top = await makePerson(t.base, admin, { emp_no: "T1", name_ar: "يتبع التنفيذي", join_date: "2022-01-01", department_id: d.id, reports_to_top: "ceo", opening_days: 10 }, "staff");
});
after(async () => { await t.close(); });
const ask = (p, start) => p.c.post("/api/requests", { type: "annual", start, end: start, reason: "x" });

test("routing rule: a direct manager with a login comes first; without a login the usual rules apply", () => {
  const ctx = { departments: [{ id: 10, approver_employee_id: 2 }], managersApproverEmployeeId: 1, adminUserId: 100, userIdByEmployee: (id) => ({ 2: 102, 7: 107 })[id] || null };
  assert.deepEqual(approverFor({ employee: { id: 5, department_id: 10, manager_employee_id: 7 }, role: "staff" }, ctx), { userId: 107, reason: "direct" });
  assert.deepEqual(approverFor({ employee: { id: 5, department_id: 10, manager_employee_id: 8 }, role: "staff" }, ctx), { userId: 102, reason: "dept" }, "no login");
  assert.deepEqual(approverFor({ employee: { id: 5, department_id: 10 }, role: "staff" }, ctx), { userId: 102, reason: "dept" });
});

test("without a direct manager the request goes to the department's approver", async () => {
  const r = (await ask(s, "2026-11-22")).data.request;
  assert.equal(r.route_reason, "dept"); assert.equal(r.approver_user_id, head.user.id);
});

test("HR assigns a direct manager: the waiting request moves to them, they see and approve it, then HR decides", async () => {
  const waiting = (await s.c.get("/api/requests")).data.items.find((x) => x.start_date === "2026-11-22");
  assert.equal((await hr.c.put(`/api/employees/${s.emp.id}`, { manager_employee_id: lead.emp.id })).status, 200);
  let r = (await hr.c.get(`/api/requests/${waiting.id}`)).data.request;
  assert.equal(r.approver_user_id, lead.user.id); assert.equal(r.route_reason, "direct");
  assert.ok((await lead.c.get("/api/notifications")).data.items.some((n) => n.link === `#/leave/${waiting.id}`));
  // the direct manager is an approver: Approvals, the team list, the person's profile
  assert.equal((await lead.c.get("/api/me")).data.isApprover, true);
  assert.ok((await lead.c.get("/api/requests?scope=approvals")).data.items.some((x) => x.id === waiting.id));
  assert.ok((await lead.c.get("/api/requests?scope=team")).data.items.some((x) => x.id === waiting.id));
  assert.equal((await lead.c.get(`/api/employees/${s.emp.id}`)).status, 200);
  assert.equal((await head.c.post(`/api/requests/${waiting.id}/approve`, {})).status, 403, "the department approver no longer decides it");
  const a = await lead.c.post(`/api/requests/${waiting.id}/approve`, {});
  assert.equal(a.data.request.route_reason, "hr_final");
  // changing the manager now doesn't take it away from HR
  assert.equal((await hr.c.put(`/api/employees/${s.emp.id}`, { manager_employee_id: lead2.emp.id })).status, 200);
  r = (await hr.c.get(`/api/requests/${waiting.id}`)).data.request;
  assert.equal(r.route_reason, "hr_final");
  assert.equal((await hr.c.post(`/api/requests/${waiting.id}/approve`, {})).data.request.status, "approved");
  // a new request goes straight to the new direct manager
  const n = (await ask(s, "2026-11-29")).data.request;
  assert.equal(n.approver_user_id, lead2.user.id); assert.equal(n.route_reason, "direct");
});

test("no loops, not oneself; reporting to the CEO still wins over a direct manager", async () => {
  assert.equal((await hr.c.put(`/api/employees/${lead2.emp.id}`, { manager_employee_id: s.emp.id })).data.field, "manager_employee_id", "s reports to lead2");
  assert.equal((await hr.c.put(`/api/employees/${s.emp.id}`, { manager_employee_id: s.emp.id })).status, 400);
  assert.equal((await hr.c.put(`/api/employees/${top.emp.id}`, { manager_employee_id: lead.emp.id })).status, 200);
  const r = (await ask(top, "2026-11-23")).data.request;
  assert.equal(r.approver_user_id, ceo.user.id);
  assert.equal((await s.c.put(`/api/employees/${s.emp.id}`, { manager_employee_id: null })).status, 403, "only HR / Admin assign it");
});
