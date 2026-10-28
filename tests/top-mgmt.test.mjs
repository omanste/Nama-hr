// Top management: the CEO and the Chairman — who reports to them, what they may do, and what they're outside of.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { runMonthlySummary } from "../server/jobs.mjs";

let t, admin, ceo, chair, mgr, staff, hr, dept;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-10-26" });
  admin = await adminClient(t.base);
  dept = (await admin.post("/api/departments", { name_ar: "المبيعات", name_en: "Sales" })).data.department;
  ceo = await makePerson(t.base, admin, { emp_no: "C1", name_ar: "الرئيس التنفيذي", join_date: "2015-01-01" }, "ceo");
  chair = await makePerson(t.base, admin, { emp_no: "CH1", name_ar: "رئيس المجلس", join_date: "2015-01-01" }, "chairman");
  mgr = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "مدير", join_date: "2018-01-01", department_id: dept.id }, "manager");
  await admin.put(`/api/departments/${dept.id}`, { approver_employee_id: mgr.emp.id });
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2018-01-01" }, "hr");
  staff = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف", join_date: "2020-01-01", department_id: dept.id, opening_days: 20 }, "staff");
});
after(async () => { await t.close(); });

test("Settings: the CEO and the Chairman are two people; their offices are created with them as approvers", async () => {
  assert.equal((await admin.put("/api/settings", { managers_approver_employee_id: ceo.emp.id, chairman_employee_id: ceo.emp.id })).status, 400);
  assert.equal((await hr.c.put("/api/settings", { chairman_employee_id: chair.emp.id })).status, 403);
  const r = await admin.put("/api/settings", { managers_approver_employee_id: ceo.emp.id, chairman_employee_id: chair.emp.id });
  assert.equal(r.status, 200); assert.deepEqual(r.data.ceo_final_types, ["unpaid"]);
  const depts = (await admin.get("/api/departments")).data.items;
  assert.equal(depts.find((d) => d.name_en === "CEO Office").approver_employee_id, ceo.emp.id);
  assert.equal(depts.find((d) => d.name_en === "Chairman's Office").approver_employee_id, chair.emp.id);
  // saving again doesn't make them twice
  await admin.put("/api/settings", { chairman_employee_id: chair.emp.id });
  assert.equal((await admin.get("/api/departments")).data.items.filter((d) => d.name_en === "CEO Office").length, 1);
});

test("reporting: managers and HR → CEO; the CEO → the Chairman; the Chairman has no leave; the CEO Office → the CEO", async () => {
  const m = await mgr.c.post("/api/requests", { type: "annual", start: "2026-12-06", end: "2026-12-07", deputy_user_id: hr.user.id });
  assert.equal(m.data.request.approver_user_id, ceo.user.id);
  const c = await ceo.c.post("/api/requests", { type: "annual", start: "2026-12-06", end: "2026-12-07", deputy_user_id: hr.user.id });
  assert.equal(c.data.request.approver_user_id, chair.user.id); assert.equal(c.data.request.route_reason, "chairman");
  assert.equal((await chair.c.post("/api/requests", { type: "annual", start: "2026-12-06", end: "2026-12-07" })).status, 400);
  const office = (await admin.get("/api/departments")).data.items.find((d) => d.name_en === "CEO Office");
  const sec = await makePerson(t.base, admin, { emp_no: "SEC1", name_ar: "سكرتير", join_date: "2020-01-01", department_id: office.id, opening_days: 10 }, "staff");
  assert.equal((await sec.c.post("/api/requests", { type: "annual", start: "2026-12-08", end: "2026-12-08" })).data.request.approver_user_id, ceo.user.id);
  assert.equal((await chair.c.post(`/api/requests/${c.data.request.id}/approve`, {})).status, 200);
  const me = (await chair.c.get("/api/me")).data;
  assert.equal(me.noLeave, true); assert.equal(me.attendanceExempt, true);
  assert.equal((await ceo.c.get("/api/me")).data.attendanceExempt, true);
  assert.equal((await staff.c.get("/api/me")).data.attendanceExempt, false);
});

test("the CEO and the Chairman see everything and may decide any request — but never edit data", async () => {
  const r = await staff.c.post("/api/requests", { type: "annual", start: "2026-12-13", end: "2026-12-13" });
  assert.equal(r.data.request.approver_user_id, mgr.user.id);
  assert.equal((await chair.c.get(`/api/requests/${r.data.request.id}`)).data.canDecide, true);
  assert.equal((await chair.c.post(`/api/requests/${r.data.request.id}/approve`, {})).status, 200);
  for (const c of [ceo.c, chair.c]) {
    assert.equal((await c.get(`/api/employees/${staff.emp.id}`)).status, 200);
    assert.equal((await c.get("/api/requests?scope=all")).status, 200);
    assert.equal((await c.put(`/api/employees/${staff.emp.id}`, { name_ar: "x" })).status, 403);
    assert.equal((await c.put("/api/settings", { contract_types: ["x"] })).status, 403);
  }
});

test("an exception (special unpaid leave): the manager approves, then the CEO has the final word", async () => {
  const r = await staff.c.post("/api/requests", { type: "unpaid", start: "2027-01-03", end: "2027-01-07", reason: "سفر" });
  assert.equal((await mgr.c.post(`/api/requests/${r.data.request.id}/approve`, {})).status, 200);
  let got = (await staff.c.get(`/api/requests/${r.data.request.id}`)).data;
  assert.equal(got.request.status, "pending"); assert.equal(got.request.approver_user_id, ceo.user.id); assert.equal(got.request.route_reason, "ceo_final");
  assert.ok(got.events.some((e) => e.action === "approved_first"));
  assert.ok((await ceo.c.get("/api/notifications")).data.items.some((n) => /final approval/.test(n.title_en)));
  assert.equal((await mgr.c.post(`/api/requests/${r.data.request.id}/approve`, {})).status, 403, "the manager has already decided");
  assert.equal((await ceo.c.post(`/api/requests/${r.data.request.id}/approve`, {})).status, 200);
  got = (await staff.c.get(`/api/requests/${r.data.request.id}`)).data;
  assert.equal(got.request.status, "approved");
  // annual leave is not an exception (unless chosen in Settings): one approval is enough
  const a = await staff.c.post("/api/requests", { type: "annual", start: "2027-01-10", end: "2027-01-10" });
  await mgr.c.post(`/api/requests/${a.data.request.id}/approve`, {});
  assert.equal((await staff.c.get(`/api/requests/${a.data.request.id}`)).data.request.status, "approved");
});

test("attendance: the CEO and the Chairman aren't measured or listed", async () => {
  const people = (await hr.c.get("/api/attendance/report?from=2026-10-18&to=2026-10-24")).data;
  const ids = JSON.stringify(people);
  assert.ok(!ids.includes(`"C1"`) && !ids.includes(`"CH1"`));
  assert.equal((await hr.c.get(`/api/attendance/employee/${ceo.emp.id}`)).data.exempt, true);
});

test("monthly summary on the 1st, to the CEO and the Chairman only, once a month", async () => {
  assert.equal(runMonthlySummary(t.app.ctx, "2026-11-02"), null, "not the 1st");
  const s = runMonthlySummary(t.app.ctx, "2026-11-01");
  assert.equal(s.month, "2026-10"); assert.ok(s.staff >= 5);
  assert.equal(runMonthlySummary(t.app.ctx, "2026-11-01"), null, "once");
  for (const c of [ceo.c, chair.c]) assert.ok((await c.get("/api/notifications")).data.items.some((n) => /Summary for 10\/2026/.test(n.title_en)));
  assert.ok(!(await staff.c.get("/api/notifications")).data.items.some((n) => /Summary for/.test(n.title_en)));
});

test("Employee Voice: staff can write to the Chairman; only he (and the sender) reads it", async () => {
  const to = (await staff.c.get("/api/voice/recipients")).data.items.map((x) => x.kind);
  assert.ok(to.includes("chairman") && to.includes("ceo"));
  const m = await staff.c.post("/api/voice", { category: "suggestion", to: "chairman", subject: "اقتراح", body: "نص" });
  assert.equal(m.status, 201);
  const id = (m.data.message || m.data.item || m.data).id;
  assert.equal((await chair.c.get(`/api/voice/${id}`)).status, 200);
  assert.equal((await ceo.c.get(`/api/voice/${id}`)).status, 403);
});

test("a consultant: sees staff, requests and reports — not documents, IDs, bank or the audit log; access ends with the contract", async () => {
  const office = (await admin.get("/api/departments")).data.items.find((d) => d.name_en === "CEO Office");
  const con = await makePerson(t.base, admin, { emp_no: "CON1", name_ar: "مستشار", join_date: "2026-10-01", department_id: office.id, contract_type: "Limited", contract_end: "2099-12-31" }, "staff");
  assert.equal((await admin.put(`/api/users/${con.user.id}`, { role: "consultant" })).status, 200);
  await admin.put(`/api/employees/${staff.emp.id}`, { civil_id: "11223344", dob: "1990-01-01" });
  const doc = (await hr.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=passport&name=p.pdf`, Buffer.from("%PDF-1.4"), "application/pdf")).data.file;
  assert.equal((await con.c.get("/api/employees")).status, 200);
  const p = (await con.c.get(`/api/employees/${staff.emp.id}`)).data;
  assert.equal(p.employee.civil_id, undefined); assert.equal(p.employee.dob, undefined); assert.deepEqual(p.files, []);
  assert.ok(p.employee.job_title !== undefined || p.employee.name_ar);
  assert.equal((await con.c.get(`/api/files/${doc.id}`)).status, 403);
  assert.equal((await con.c.get("/api/requests?scope=all")).status, 200);
  assert.equal((await con.c.get("/api/attendance/report?from=2026-10-18&to=2026-10-24")).status, 200);
  assert.equal((await con.c.get("/api/audit")).status, 403);
  assert.equal((await con.c.put(`/api/employees/${staff.emp.id}`, { name_ar: "x" })).status, 403);
  const r = await staff.c.post("/api/requests", { type: "annual", start: "2027-02-07", end: "2027-02-07" });
  assert.equal((await con.c.post(`/api/requests/${r.data.request.id}/approve`, {})).status, 403, "view only");
  // the day after the contract ends, the login stops working
  await admin.put(`/api/employees/${con.emp.id}`, { contract_end: "2020-01-31" });
  assert.equal((await con.c.get("/api/me")).status, 401);
});

test("a Management department is in the list, approved by the CEO", async () => {
  const m = (await admin.get("/api/departments")).data.items.filter((d) => d.name_en === "Management");
  assert.equal(m.length, 1); assert.equal(m[0].name_ar, "الإدارة"); assert.equal(m[0].approver_employee_id, ceo.emp.id);
});

test("the CEO, the Chairman and the consultant are placed in Management; reporting lines stay the same", async () => {
  const m = (await admin.get("/api/departments")).data.items.find((d) => d.name_en === "Management");
  for (const p of [ceo, chair]) assert.equal((await admin.get(`/api/employees/${p.emp.id}`)).data.employee.department_id, m.id);
  const c2 = await makePerson(t.base, admin, { emp_no: "CON2", name_ar: "مستشار ثان", join_date: "2026-10-01", department_id: dept.id, contract_end: "2099-01-01" }, "staff");
  await admin.put(`/api/users/${c2.user.id}`, { role: "consultant" });
  assert.equal((await admin.get(`/api/employees/${c2.emp.id}`)).data.employee.department_id, m.id);
  // the consultant's leave goes to the CEO (Management's approver); the CEO's still to the Chairman
  assert.equal((await c2.c.post("/api/requests", { type: "sick", start: "2027-03-01", end: "2027-03-01" })).data.request.approver_user_id, ceo.user.id);
  assert.equal((await ceo.c.post("/api/requests", { type: "annual", start: "2027-03-07", end: "2027-03-07", deputy_user_id: hr.user.id })).data.request.approver_user_id, chair.user.id);
});
