// Staff IDs: one format (NAMA- and three digits), the same number never on two records, new staff numbered in sequence.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { formatEmpNos } from "../server/db.mjs";
import { nextEmpNo, normEmpNo } from "../server/employees.mjs";

let t, admin, hr;
before(async () => { t = await boot(); admin = await adminClient(t.base); hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr"); });
after(async () => { await t.close(); });

test("written one way: NAMA-7, NAMA-07, nama 07 → NAMA-007; other IDs stay as typed", () => {
  assert.equal(normEmpNo("NAMA-07"), "NAMA-007"); assert.equal(normEmpNo("nama 7"), "NAMA-007"); assert.equal(normEmpNo("NAMA-013"), "NAMA-013");
  assert.equal(normEmpNo("NAMA-1234"), "NAMA-1234"); assert.equal(normEmpNo("H1"), "H1");
});

test("the existing short IDs move to three digits once (where free), logged; a clash is left for HR", async () => {
  const ins = t.db.prepare("INSERT INTO employees(emp_no,name_ar,created_at,updated_at) VALUES(?,?,?,?)");
  const now = new Date().toISOString();
  const a = ins.run("NAMA-07", "سبعة", now, now).lastInsertRowid, b = ins.run("NAMA-13", "ثلاثة عشر", now, now).lastInsertRowid;
  ins.run("NAMA-9", "تسعة", now, now); ins.run("NAMA-009", "تسعة أخرى", now, now); // the same number twice
  const changed = formatEmpNos(t.db);
  assert.deepEqual(changed.map((c) => [c.from, c.to]).sort(), [["NAMA-07", "NAMA-007"], ["NAMA-13", "NAMA-013"]]);
  assert.equal(t.db.prepare("SELECT emp_no FROM employees WHERE id=?").get(a).emp_no, "NAMA-007");
  assert.equal(t.db.prepare("SELECT emp_no FROM employees WHERE id=?").get(b).emp_no, "NAMA-013");
  assert.ok(t.db.prepare("SELECT 1 FROM employees WHERE emp_no='NAMA-9'").get(), "a clash isn't touched");
  assert.equal(t.db.prepare("SELECT count(*) n FROM audit_log WHERE action='employee.emp_no_format'").get().n, 2);
});

test("HR changes an ID: typed short, saved in the format; the same number on another record is refused, naming who has it", async () => {
  const p = (await hr.c.post("/api/employees", { emp_no: "NAMA-20", name_ar: "عشرون", name_en: "Twenty", join_date: "2022-01-01" })).data.employee;
  assert.equal(p.emp_no, "NAMA-020");
  assert.equal((await hr.c.put(`/api/employees/${p.id}`, { emp_no: "NAMA-21" })).data.employee.emp_no, "NAMA-021");
  const r = await hr.c.put(`/api/employees/${p.id}`, { emp_no: "NAMA-07" });
  assert.equal(r.status, 409); assert.match(r.data.message, /NAMA-007 is already used by سبعة \(NAMA-007\)/);
  assert.equal((await hr.c.put(`/api/employees/${p.id}`, { emp_no: "NAMA-021" })).status, 200, "its own number again");
});

test("new staff: the next number, three digits", async () => {
  assert.equal(nextEmpNo(t.db), "NAMA-022");
  const n = (await hr.c.post("/api/employees", { name_ar: "جديد", join_date: "2026-01-01" })).data.employee;
  assert.equal(n.emp_no, "NAMA-022");
});
