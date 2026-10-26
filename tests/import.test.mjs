import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson, client } from "./helpers.mjs";
import { normalizeRow, cutAtFirstNameless } from "../server/importer.mjs";
import { runAnniversaries } from "../server/jobs.mjs";

let t, admin, hr, acc;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-10-26" });
  admin = await adminClient(t.base);
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "الموارد" }, "hr");
  acc = await makePerson(t.base, admin, { emp_no: "A1", name_ar: "حسابات" }, "accounts");
  await admin.post("/api/departments", { name_ar: "المبيعات", name_en: "Sales" });
});
after(async () => { await t.close(); });

// columns: 0 #, 1 name_ar, 2 join date, 3 department, 4 remaining balance, 5 emp no
const mapping = { name_ar: 1, join_date: 2, department: 3, opening_days: 4, emp_no: 5 };

test("cells are normalised: Excel serials, d/m/y text, Arabic digits, spaces", () => {
  const n = normalizeRow([1, "  أمجد ", 45658, " sales ", "٤٤", " E001 "], mapping);
  assert.equal(n.values.name_ar, "أمجد");
  assert.equal(n.values.join_date, "2025-01-01");
  assert.equal(n.values.emp_no, "E001");
  assert.equal(n.values.opening_days, 44);
  assert.equal(n.values.department, "sales");
  assert.equal(normalizeRow([1, "x", "٢٥/١٢/٢٠٢٤"], mapping).values.join_date, "2024-12-25");
  assert.equal(normalizeRow([1, "x", "1-4-2022"], mapping).values.join_date, "2022-04-01");
  assert.equal(normalizeRow([1, "x", "2020-11-01T00:00:00.000Z"], mapping).values.join_date, "2020-11-01");
  assert.equal(normalizeRow([1, "x", "31/02/2024"], mapping).issues[0].code, "invalid_date");
  assert.equal(normalizeRow([1, "x", null, null, "abc"], mapping).issues[0].code, "invalid_number");
  assert.equal(normalizeRow([1, "x", null, null, "12.5"], mapping).values.opening_days, 12.5);
});

test("rows end at the first row with no name", () => {
  const rows = [[1, "أ"], [2, "ب"], [null, null], [null, "إسم الموظف", "التاريخ"], ["extra", "توفيق"]];
  assert.equal(cutAtFirstNameless(rows, mapping).length, 2);
});

const rows = [
  [1, "اليقظان", "2020-11-01", "Sales", 106, ""],
  [2, "عبد الرحمن", "2022-04-01", "الإيجار", 53, ""],
  [3, "عبد الرحيم", "", "", "", ""],
  [4, "جديد", "2024-07-01", "الصيانة", 30, "E9"],
  [5, "مكرر", "2024-07-01", "", 30, "E9"],
  [6, "قديم", "2024-07-01", "", 30, "H1"],
  [7, "تاريخ خطأ", "32/13/2020", "", 30, ""],
  [8, "سالب", "2020-01-01", "", -3, ""],
  [9, "", "", "", "", ""],
  [null, "إسم الموظف", "التاريخ", "", "", ""],
];

test("preview flags errors and warnings per row", async () => {
  const r = await hr.c.post("/api/import/preview", { rows, mapping, asOf: "2026-10-26" });
  assert.equal(r.status, 200);
  const res = r.data.rows;
  assert.equal(res.length, 8); // stops at the first nameless row
  const codes = (i, k) => res[i][k].map((x) => x.code);
  assert.deepEqual(codes(0, "errors"), []);
  assert.ok(codes(0, "warnings").includes("over_cap"));
  assert.ok(codes(0, "warnings").includes("generated_id"));
  assert.equal(res[0].values.emp_no, "NAMA-001");
  assert.equal(res[1].values.emp_no, "NAMA-002");
  assert.ok(codes(2, "warnings").includes("missing_join_date"));
  assert.ok(codes(2, "warnings").includes("empty_balance"));
  assert.ok(codes(3, "warnings").includes("unknown_department"));
  assert.ok(codes(4, "errors").includes("duplicate_in_file"));
  assert.ok(codes(3, "errors").includes("duplicate_in_file"));
  assert.ok(codes(5, "errors").includes("exists"));
  assert.ok(codes(6, "errors").includes("invalid_date"));
  assert.ok(codes(7, "errors").includes("negative_balance"));
  assert.equal(r.data.summary.ok, 3);
  assert.equal(r.data.summary.errors, 5);
});

test("accounts cannot import", async () => {
  assert.equal((await acc.c.post("/api/import/preview", { rows, mapping })).status, 403);
  assert.equal((await acc.c.post("/api/import/commit", { rows, mapping })).status, 403);
});

test("commit creates the valid rows with opening balances, departments and logins", async () => {
  const r = await hr.c.post("/api/import/commit", { rows, mapping, asOf: "2026-10-26", createLogins: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.created, 3);
  assert.equal(r.data.skipped, 5);
  assert.equal(r.data.logins.length, 3);
  const list = (await hr.c.get("/api/employees?q=اليقظان")).data.items;
  assert.equal(list.length, 1);
  const p = (await hr.c.get(`/api/employees/${list[0].id}`)).data;
  assert.equal(p.employee.emp_no, "NAMA-001");
  assert.equal(p.leave.remaining, 106 * 480);
  assert.deepEqual(p.ledger.map((l) => l.kind), ["opening"]);
  assert.equal(p.department.name_en, "Sales");
  const depts = (await hr.c.get("/api/departments")).data.items.map((d) => d.name_ar);
  assert.ok(depts.includes("الإيجار"));
  assert.ok(!depts.includes("الصيانة")); // only on a skipped row
  const login = r.data.logins.find((l) => l.emp_no === "NAMA-001");
  const c = client(t.base);
  const l = await c.post("/api/login", { username: login.username, password: login.tempPassword });
  assert.equal(l.status, 200); assert.equal(l.data.mustChange, true);
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE action='import.commit'").get());
});

test("the 60-day cap applies at the next anniversary, not at import", async () => {
  const e = (await hr.c.get("/api/employees?q=اليقظان")).data.items[0];
  runAnniversaries(t.app.ctx, "2026-10-31");
  assert.equal((await hr.c.get(`/api/employees/${e.id}`)).data.leave.remaining, 106 * 480);
  runAnniversaries(t.app.ctx, "2026-11-01");
  assert.equal((await hr.c.get(`/api/employees/${e.id}`)).data.leave.remaining, 28800);
});

test("re-importing the same names with generated IDs continues numbering", async () => {
  const r = await hr.c.post("/api/import/preview", { rows: [[1, "آخر", "", "", 5, ""]], mapping });
  assert.equal(r.data.rows[0].values.emp_no, "NAMA-004");
});

test("mapping is remembered", async () => {
  assert.equal((await hr.c.put("/api/import/mapping", { headers: ["#", "إسم الموظف"], mapping: { name_ar: 1 } })).status, 200);
  assert.deepEqual((await hr.c.get("/api/import/mapping")).data.mapping, { name_ar: 1 });
});

test("a balance dated in the past still gets its first credit only after the import date", async () => {
  t.app.ctx.fakeToday = "2026-10-26";
  const r = await hr.c.post("/api/import/commit", { rows: [[1, "رصيد سابق", "2019-05-05", "", 20, "P1"]], mapping, asOf: "2026-01-01" });
  assert.equal(r.data.created, 1);
  const e = (await hr.c.get("/api/employees?q=رصيد سابق")).data.items[0];
  runAnniversaries(t.app.ctx, "2026-10-26");
  assert.equal((await hr.c.get(`/api/employees/${e.id}`)).data.leave.remaining, 20 * 480);
  runAnniversaries(t.app.ctx, "2027-05-05");
  assert.equal((await hr.c.get(`/api/employees/${e.id}`)).data.leave.remaining, 50 * 480);
});

test("re-importing the same sheet without IDs flags people who already exist", async () => {
  const r = await hr.c.post("/api/import/preview", { rows: [[1, "اليقظان", "2020-11-01", "", 106, ""], [2, "عبد الرحيم", "", "", "", ""], [3, "شخص جديد", "", "", 1, ""]], mapping });
  assert.ok(r.data.rows[0].errors.some((e) => e.code === "already_exists"));
  assert.ok(r.data.rows[1].errors.some((e) => e.code === "already_exists"));
  assert.deepEqual(r.data.rows[2].errors, []);
});

test("departments written 'English | Arabic' become one department with both names", async () => {
  const m = { name_ar: 0, department: 1, emp_no: 2 };
  const r = await hr.c.post("/api/import/commit", { rows: [["أ", "Collections and Contracts | التحصيل والعقود", "D1"], ["ب", "التحصيل والعقود", "D2"], ["ج", "Sales | المبيعات", "D3"]], mapping: m });
  assert.equal(r.status, 200);
  assert.equal(r.data.departments, 1);
  const d = (await hr.c.get("/api/departments")).data.items.find((x) => x.name_ar === "التحصيل والعقود");
  assert.equal(d.name_en, "Collections and Contracts");
  const emps = (await hr.c.get("/api/employees?q=D")).data.items.filter((e) => ["D1", "D2"].includes(e.emp_no));
  assert.ok(emps.every((e) => e.department_id === d.id));
  const sales = (await hr.c.get("/api/employees?q=D3")).data.items[0];
  assert.equal((await hr.c.get("/api/departments")).data.items.find((x) => x.id === sales.department_id).name_en, "Sales");
});

test("direct manager is matched by employee ID or exact name, from the file or existing staff", async () => {
  const m = { emp_no: 0, name_ar: 1, name_en: 2, manager: 3 };
  const rows = [["M1", "مدير", "Boss", ""], ["M2", "موظف أ", "", "M1"], ["M3", "موظف ب", "", "boss"], ["M4", "موظف ج", "", "D1"], ["M5", "موظف د", "", "Unknown Person"]];
  const p = await hr.c.post("/api/import/preview", { rows, mapping: m });
  assert.ok(p.data.rows[4].warnings.some((w) => w.code === "unknown_manager"));
  assert.deepEqual(p.data.rows[1].warnings.filter((w) => w.code === "unknown_manager"), []);
  await hr.c.post("/api/import/commit", { rows, mapping: m });
  const id = async (no) => (await hr.c.get(`/api/employees?q=${no}`)).data.items.find((e) => e.emp_no === no).id;
  const mgrOf = async (no) => (await hr.c.get(`/api/employees/${await id(no)}`)).data.employee.manager_employee_id;
  assert.equal(await mgrOf("M2"), await id("M1"));
  assert.equal(await mgrOf("M3"), await id("M1"));
  assert.equal(await mgrOf("M4"), await id("D1"));
  assert.equal(await mgrOf("M5"), null);
});

test("qualification fields import with long text", async () => {
  const skills = "Communication | التواصل, ".repeat(40);
  const m = { emp_no: 0, name_ar: 1, education: 2, specialization: 3, experience: 4, languages: 5, skills: 6, certifications: 7, main_tasks: 8 };
  const r = await hr.c.post("/api/import/commit", { rows: [["Q1", "مؤهل", "Bachelor’s Degree | بكالوريوس", "Information System", "1–3 years", "Arabic, English", skills, "PMP", "Sales follow-up"]], mapping: m });
  assert.equal(r.data.created, 1);
  const e = (await hr.c.get("/api/employees?q=Q1")).data.items.find((x) => x.emp_no === "Q1");
  const p = (await hr.c.get(`/api/employees/${e.id}`)).data.employee;
  assert.equal(p.education, "Bachelor’s Degree | بكالوريوس");
  assert.equal(p.languages, "Arabic, English");
  assert.equal(p.skills, skills.trim());
  assert.equal(p.main_tasks, "Sales follow-up");
});
