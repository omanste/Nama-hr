import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { runAnniversaries, runExpiryCheck, backup } from "../server/jobs.mjs";

let t, admin, hr, ctx;
const create = async (fields, today) => {
  ctx.fakeToday = today;
  const r = await admin.post("/api/employees", fields);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.employee;
};
const kinds = (id) => t.db.prepare("SELECT kind, minutes, leave_year_start FROM leave_ledger WHERE employee_id=? ORDER BY id").all(id);
const balance = (id) => t.db.prepare("SELECT sum(minutes) n FROM leave_ledger WHERE employee_id=?").get(id).n;

before(async () => {
  t = await boot({ FAKE_TODAY: "2026-10-26" });
  ctx = t.app.ctx;
  admin = await adminClient(t.base);
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "الموارد", join_date: "2020-01-01" }, "hr");
});
after(async () => { await t.close(); });

test("29 February joiner gets missed credits on 28 February, once", async () => {
  const e = await create({ emp_no: "L1", name_ar: "كبيسة", join_date: "2024-02-29" }, "2024-03-01");
  assert.deepEqual(kinds(e.id).map((k) => k.leave_year_start), ["2024-02-29"]);
  runAnniversaries(ctx, "2026-03-01");
  assert.deepEqual(kinds(e.id).filter((k) => k.kind === "annual_credit").map((k) => k.leave_year_start), ["2024-02-29", "2025-02-28", "2026-02-28"]);
  assert.equal(balance(e.id), 3 * 14400 - capOver(3 * 14400));
  const n = runAnniversaries(ctx, "2026-03-01");
  assert.equal(n.credits, 0);
});
const capOver = (b) => Math.max(0, b - 28800);

test("a credit that takes the balance over 60 days forfeits the excess", async () => {
  const e = await create({ emp_no: "L2", name_ar: "رصيد كبير", join_date: "2020-06-01", opening_days: 50 }, "2026-05-01");
  runAnniversaries(ctx, "2026-06-01");
  const rows = kinds(e.id);
  assert.deepEqual(rows.map((r) => r.kind), ["opening", "annual_credit", "cap_forfeit"]);
  assert.equal(rows[2].minutes, -20 * 480);
  assert.equal(rows[2].leave_year_start, "2026-06-01");
  assert.equal(balance(e.id), 28800);
});

test("imported staff get their first credit on the next anniversary after the import", async () => {
  const e = await create({ emp_no: "L3", name_ar: "مستورد", join_date: "2019-05-05", opening_days: 12 }, "2026-10-01");
  runAnniversaries(ctx, "2026-10-26");
  assert.deepEqual(kinds(e.id).map((r) => r.kind), ["opening"]);
  runAnniversaries(ctx, "2027-05-05");
  assert.deepEqual(kinds(e.id).map((r) => r.kind), ["opening", "annual_credit"]);
  assert.equal(balance(e.id), 12 * 480 + 14400);
});

test("imported balance over 60 is kept until the next credit, then capped", async () => {
  const e = await create({ emp_no: "L4", name_ar: "١٠٦ يوم", join_date: "2020-11-01", opening_days: 106 }, "2026-10-26");
  runAnniversaries(ctx, "2026-10-31");
  assert.equal(balance(e.id), 106 * 480);
  runAnniversaries(ctx, "2026-11-01");
  assert.equal(balance(e.id), 28800);
});

test("no join date or resigned staff get no credit", async () => {
  const a = await create({ emp_no: "L5", name_ar: "بدون تاريخ", opening_days: 30 }, "2026-01-01");
  const b = await create({ emp_no: "L6", name_ar: "مستقيل", join_date: "2020-01-01", status: "resigned" }, "2026-01-01");
  const before = [kinds(a.id).length, kinds(b.id).length];
  runAnniversaries(ctx, "2027-02-01");
  assert.deepEqual([kinds(a.id).length, kinds(b.id).length], before);
});

test("the employee is notified about a new credit", async () => {
  const p = await makePerson(t.base, admin, { emp_no: "L7", name_ar: "إشعار", join_date: "2025-12-01" }, "staff");
  runAnniversaries(ctx, "2026-12-01");
  const n = await p.c.get("/api/notifications");
  assert.ok(n.data.items.some((x) => /رصيد|balance/i.test(x.title_ar + x.title_en)));
});

test("HR is told once about civil IDs expiring within 30 days and probation ending", async () => {
  await create({ emp_no: "X1", name_ar: "بطاقة", civil_id: "123", civil_id_expiry: "2026-11-15" }, "2026-10-26");
  await create({ emp_no: "X2", name_ar: "تجربة", join_date: "2026-07-26" }, "2026-10-26");
  await create({ emp_no: "X3", name_ar: "بعيدة", civil_id_expiry: "2027-06-01" }, "2026-10-26");
  const count = () => t.db.prepare("SELECT count(*) n FROM notifications WHERE user_id=?").get(hr.user.id).n;
  const c0 = count();
  runExpiryCheck(ctx, "2026-10-26");
  const c1 = count();
  assert.equal(c1 - c0, 2);
  runExpiryCheck(ctx, "2026-10-27");
  assert.equal(count(), c1);
});

test("backup writes a dated copy and prunes old ones", async () => {
  const dir = path.join(t.dataDir, "backups");
  fs.writeFileSync(path.join(dir, "hr-2026-01-01.db"), "old");
  const file = backup(ctx, "2026-10-26", 14);
  assert.equal(path.basename(file), "hr-2026-10-26.db");
  assert.ok(fs.statSync(file).size > 1000);
  assert.ok(!fs.existsSync(path.join(dir, "hr-2026-01-01.db")));
  backup(ctx, "2026-10-26", 14); // same day twice is fine
  const r = await fetch(`${t.base}/api/admin/backup`, { headers: { cookie: admin.cookie } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /attachment/);
  assert.equal((await hr.c.get("/api/admin/backup")).status, 403);
});

test("staff created in the app with an old join date get no back-filled credits", async () => {
  const e = await create({ emp_no: "B1", name_ar: "قديم يدوي", join_date: "2019-05-05" }, "2026-10-26");
  runAnniversaries(ctx, "2026-10-26");
  assert.equal(balance(e.id), 14400);
  runAnniversaries(ctx, "2027-05-05");
  assert.equal(balance(e.id), 28800);
});

test("correcting a join date does not give a second credit for the same year", async () => {
  const e = await create({ emp_no: "B2", name_ar: "تصحيح", join_date: "2026-01-10" }, "2026-10-26");
  await admin.put(`/api/employees/${e.id}`, { join_date: "2026-01-12" });
  runAnniversaries(ctx, "2026-10-26");
  assert.equal(balance(e.id), 14400);
});

test("a join date set later posts this year's credit once and nothing older", async () => {
  const e = await create({ emp_no: "B3", name_ar: "بدون تاريخ أولاً" }, "2026-10-26");
  assert.equal(balance(e.id) ?? 0, 0);
  await admin.put(`/api/employees/${e.id}`, { join_date: "2015-03-01" });
  runAnniversaries(ctx, "2026-10-26");
  assert.equal(balance(e.id), 14400);
});
