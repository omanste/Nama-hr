import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson, client } from "./helpers.mjs";

let t, admin, hr, acc, staff, staff2, sales;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-10-26" });
  admin = await adminClient(t.base);
  sales = (await admin.post("/api/departments", { name_ar: "المبيعات", name_en: "Sales" })).data.department;
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "مدير الموارد", join_date: "2020-01-01" }, "hr");
  acc = await makePerson(t.base, admin, { emp_no: "A1", name_ar: "محاسب", join_date: "2020-01-01" }, "accounts");
  staff = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف", name_en: "Staff One", department_id: sales.id, join_date: "2026-03-01" }, "staff");
  staff2 = await makePerson(t.base, admin, { emp_no: "S2", name_ar: "موظف٢", department_id: sales.id, join_date: "2025-01-01" }, "staff");
});
after(async () => { await t.close(); });

test("HR creates an employee who starts with 30 days for the current leave year", async () => {
  const r = await hr.c.post("/api/employees", { emp_no: "E100", name_ar: "أحمد", name_en: "Ahmed", join_date: "2024-05-05", email: "a@nama.om", department_id: sales.id });
  assert.equal(r.status, 201);
  const p = await hr.c.get(`/api/employees/${r.data.employee.id}`);
  assert.equal(p.status, 200);
  assert.equal(p.data.leave.remaining, 14400);
  assert.equal(p.data.leave.yearStart, "2026-05-05");
  assert.equal(p.data.leave.eligibleFrom, "2024-11-05");
  assert.equal(p.data.leave.probationEnd, "2024-08-05");
  assert.equal(p.data.ledger.length, 1);
  assert.equal(p.data.ledger[0].kind, "annual_credit");
});

test("an opening balance replaces the first credit", async () => {
  const r = await hr.c.post("/api/employees", { emp_no: "E101", name_ar: "قديم", join_date: "2019-05-05", opening_days: 45.5 });
  const p = await hr.c.get(`/api/employees/${r.data.employee.id}`);
  assert.equal(p.data.leave.remaining, 45.5 * 480);
  assert.deepEqual(p.data.ledger.map((x) => x.kind), ["opening"]);
});

test("an empty employee ID is generated as NAMA-###", async () => {
  const a = await hr.c.post("/api/employees", { name_ar: "بدون رقم" });
  const b = await hr.c.post("/api/employees", { emp_no: "  ", name_ar: "بدون رقم ٢" });
  assert.equal(a.data.employee.emp_no, "NAMA-001");
  assert.equal(b.data.employee.emp_no, "NAMA-002");
});

test("validation: names, duplicate IDs, dates, email and manager", async () => {
  assert.equal((await hr.c.post("/api/employees", { emp_no: "E200" })).status, 400);
  const dup = await hr.c.post("/api/employees", { emp_no: "e100", name_ar: "x" });
  assert.equal(dup.status, 409); assert.equal(dup.data.error, "duplicate_emp_no");
  const bad = await hr.c.post("/api/employees", { emp_no: "E201", name_ar: "x", join_date: "2026-02-30" });
  assert.equal(bad.status, 400); assert.equal(bad.data.field, "join_date");
  assert.equal((await hr.c.post("/api/employees", { emp_no: "E202", name_ar: "x", email: "not-an-email" })).data.field, "email");
  assert.equal((await hr.c.post("/api/employees", { emp_no: "E203", name_ar: "x", department_id: 9999 })).data.field, "department_id");
  assert.equal((await hr.c.post("/api/employees", { emp_no: "E204", name_ar: "x", status: "gone" })).data.field, "status");
});

test("accounts can read everything but write nothing", async () => {
  assert.equal((await acc.c.get("/api/employees")).status, 200);
  assert.equal((await acc.c.get(`/api/employees/${staff.emp.id}`)).status, 200);
  assert.equal((await acc.c.post("/api/employees", { name_ar: "x" })).status, 403);
  assert.equal((await acc.c.put(`/api/employees/${staff.emp.id}`, { job_title: "x" })).status, 403);
  assert.equal((await acc.c.post(`/api/employees/${staff.emp.id}/adjust`, { minutes: 480, note: "x" })).status, 403);
});

test("staff see only themselves", async () => {
  assert.equal((await staff.c.get("/api/employees")).status, 403);
  assert.equal((await staff.c.get(`/api/employees/${staff2.emp.id}`)).status, 403);
  const me = await staff.c.get(`/api/employees/${staff.emp.id}`);
  assert.equal(me.status, 200);
  assert.equal(me.data.ledger, undefined); // ledger rows only for HR/admin
  assert.equal(me.data.leave.remaining, 14400);
});

test("a department approver sees their department's staff", async () => {
  const appr = await makePerson(t.base, admin, { emp_no: "T1", name_ar: "توفيق", join_date: "2022-03-01" }, "staff");
  assert.equal((await admin.put(`/api/departments/${sales.id}`, { approver_employee_id: appr.emp.id })).status, 200);
  const list = await appr.c.get("/api/employees");
  assert.equal(list.status, 200);
  const nos = list.data.items.map((e) => e.emp_no).sort();
  assert.ok(nos.includes("S1") && nos.includes("S2") && nos.includes("T1"));
  assert.ok(!nos.includes("H1"));
  assert.equal((await appr.c.get(`/api/employees/${staff.emp.id}`)).status, 200);
  assert.equal((await appr.c.get(`/api/employees/${hr.emp.id}`)).status, 403);
  assert.equal((await appr.c.get("/api/me")).data.isApprover, true);
});

test("HR edits a profile and the change is audited", async () => {
  const r = await hr.c.put(`/api/employees/${staff.emp.id}`, { job_title: "Sales Executive", mobile: "+968 9000 0000" });
  assert.equal(r.status, 200);
  assert.equal(r.data.employee.job_title, "Sales Executive");
  const row = t.db.prepare("SELECT * FROM audit_log WHERE action='employee.update' AND entity_id=?").get(String(staff.emp.id));
  assert.ok(row && JSON.parse(row.after).job_title === "Sales Executive");
});

test("staff cannot edit even their own profile", async () => {
  assert.equal((await staff.c.put(`/api/employees/${staff.emp.id}`, { job_title: "CEO" })).status, 403);
});

test("balance adjustments need a note and change the remaining balance", async () => {
  assert.equal((await hr.c.post(`/api/employees/${staff2.emp.id}/adjust`, { minutes: 480 })).status, 400);
  assert.equal((await hr.c.post(`/api/employees/${staff2.emp.id}/adjust`, { minutes: 0, note: "x" })).status, 400);
  const r = await hr.c.post(`/api/employees/${staff2.emp.id}/adjust`, { minutes: 480, note: "تصحيح" });
  assert.equal(r.status, 200);
  assert.equal(r.data.leave.remaining, 14400 + 480);
});

test("documents: allowed types upload and download; others are refused", async () => {
  const pdf = Buffer.from("%PDF-1.4\n%test\n");
  const up = await hr.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=civil_id&expiry=2027-01-01&name=civil.pdf`, pdf, "application/pdf");
  assert.equal(up.status, 201);
  const got = await fetch(`${t.base}/api/files/${up.data.file.id}`, { headers: { cookie: staff.c.cookie } });
  assert.equal(got.status, 200);
  assert.equal(Buffer.from(await got.arrayBuffer()).toString(), pdf.toString());
  const other = await fetch(`${t.base}/api/files/${up.data.file.id}`, { headers: { cookie: staff2.c.cookie } });
  assert.equal(other.status, 403);
  assert.equal((await hr.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc`, Buffer.from("MZ"), "application/x-msdownload")).status, 415);
  assert.equal((await hr.c.upload(`/api/employees/${staff.emp.id}/files?kind=photo`, pdf, "application/pdf")).status, 415);
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const ph = await hr.c.upload(`/api/employees/${staff.emp.id}/files?kind=photo`, png, "image/png");
  assert.equal(ph.status, 201);
  assert.equal((await hr.c.get(`/api/employees/${staff.emp.id}`)).data.employee.photo_file_id, ph.data.file.id);
  assert.equal((await acc.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc`, pdf, "application/pdf")).status, 403);
  assert.equal((await hr.c.del(`/api/files/${up.data.file.id}`)).status, 200);
  assert.equal((await hr.c.get(`/api/employees/${staff.emp.id}`)).data.files.filter((f) => f.kind === "doc").length, 0);
});

test("settings and departments are admin-only to change", async () => {
  assert.equal((await hr.c.put("/api/settings", { managers_approver_title: "chairman" })).status, 403);
  assert.equal((await hr.c.post("/api/departments", { name_ar: "x" })).status, 403);
  assert.equal((await staff.c.get("/api/departments")).status, 200);
  const r = await admin.put("/api/settings", { managers_approver_employee_id: hr.emp.id, managers_approver_title: "chairman", contract_types: ["Unlimited", "Limited"] });
  assert.equal(r.status, 200);
  const g = await staff.c.get("/api/settings");
  assert.equal(g.data.managers_approver_title, "chairman");
  assert.equal((await admin.put("/api/settings", { managers_approver_title: "king" })).status, 400);
  assert.equal((await admin.put("/api/settings", { unknown_key: 1 })).status, 400);
});

test("users: admin manages roles and resets passwords; HR may only create staff logins", async () => {
  const e = (await hr.c.post("/api/employees", { emp_no: "U1", name_ar: "مستخدم" })).data.employee;
  const viaHr = await hr.c.post(`/api/employees/${e.id}/login`, {});
  assert.equal(viaHr.status, 201);
  assert.equal(viaHr.data.user.role, "staff");
  assert.ok(viaHr.data.tempPassword.length >= 10);
  assert.equal((await hr.c.post(`/api/employees/${e.id}/login`, {})).status, 409);
  assert.equal((await hr.c.get("/api/users")).status, 403);
  assert.equal((await hr.c.put(`/api/users/${viaHr.data.user.id}`, { role: "admin" })).status, 403);
  assert.equal((await admin.put(`/api/users/${viaHr.data.user.id}`, { role: "accounts" })).status, 200);
  const reset = await admin.post(`/api/users/${viaHr.data.user.id}/reset`);
  assert.equal(reset.status, 200);
  const c = client(t.base);
  const l = await c.post("/api/login", { username: "u1", password: reset.data.tempPassword });
  assert.equal(l.status, 200); assert.equal(l.data.mustChange, true);
  assert.equal((await admin.put(`/api/users/${viaHr.data.user.id}`, { active: false })).status, 200);
  assert.equal((await client(t.base).post("/api/login", { username: "u1", password: reset.data.tempPassword })).status, 401);
});

test("resigning an employee disables their login", async () => {
  const p = await makePerson(t.base, admin, { emp_no: "Q1", name_ar: "مستقيل" }, "staff");
  assert.equal((await hr.c.put(`/api/employees/${p.emp.id}`, { status: "resigned" })).status, 200);
  assert.equal((await p.c.get("/api/me")).status, 401);
});

test("employee list supports search and filters", async () => {
  const r = await hr.c.get(`/api/employees?q=staff%20one`);
  assert.deepEqual(r.data.items.map((e) => e.emp_no), ["S1"]);
  const d = await hr.c.get(`/api/employees?dept=${sales.id}&status=active`);
  assert.ok(d.data.items.every((e) => e.department_id === sales.id));
  assert.ok(typeof d.data.items[0].remaining === "number");
});
