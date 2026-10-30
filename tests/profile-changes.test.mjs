// Staff keep their own profile current (contact, qualifications, bank, values from an ID, photo); each change is saved at once
// and listed for HR/Admin with before and after, to confirm or undo. Bank details are seen only by the person, HR, Admin, Accounts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { validIban } from "../server/employees.mjs";

const IBAN = "OM380181234567890123456";
let t, admin, hr, s, mgr, acc, other;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-10-28" });
  admin = await adminClient(t.base);
  const d = (await admin.post("/api/departments", { name_ar: "المبيعات" })).data.department;
  mgr = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "مدير", join_date: "2020-01-01", department_id: d.id }, "staff");
  await admin.put(`/api/departments/${d.id}`, { approver_employee_id: mgr.emp.id });
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  acc = await makePerson(t.base, admin, { emp_no: "A1", name_ar: "حسابات", join_date: "2020-01-01" }, "accounts");
  s = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف", mobile: "91111111", join_date: "2022-01-10", department_id: d.id }, "staff");
  other = await makePerson(t.base, admin, { emp_no: "S2", name_ar: "زميل", join_date: "2022-01-10", department_id: d.id }, "staff");
});
after(async () => { await t.close(); });

test("Oman IBAN check", () => {
  assert.equal(validIban(IBAN), true);
  assert.equal(validIban("OM390181234567890123456"), false);
  assert.equal(validIban("GB82WEST12345698765432"), false);
});

test("staff update contact, qualifications and bank; HR sees each change with before and after", async () => {
  assert.equal((await s.c.put(`/api/employees/${s.emp.id}/contact`, { mobile: "92222222", personal_email: "me@example.com", personal_phone: "93333333" })).status, 200);
  assert.equal((await s.c.put(`/api/employees/${s.emp.id}/contact`, { personal_email: "not-an-email" })).status, 400);
  assert.equal((await s.c.put(`/api/employees/${s.emp.id}/qualifications`, { education: "Bachelor | بكالوريوس", skills: "Excel" })).status, 200);
  assert.equal((await s.c.put(`/api/employees/${s.emp.id}/bank`, { bank_name: "Bank Muscat", bank_account: "0123-4567-8901", bank_iban: "OM39 0181 2345 6789 0123 456" })).status, 400, "bad IBAN");
  const b = await s.c.put(`/api/employees/${s.emp.id}/bank`, { bank_name: "Bank Muscat", bank_account: "0123-4567-8901", bank_iban: "om38 0181 2345 6789 0123 456" });
  assert.equal(b.status, 200); assert.equal(b.data.employee.bank_iban, IBAN); assert.equal(b.data.employee.bank_account, "012345678901");
  assert.equal((await other.c.put(`/api/employees/${s.emp.id}/bank`, { bank_name: "X" })).status, 403, "not someone else's");
  const list = (await hr.c.get("/api/profile-changes")).data.items.filter((x) => x.employee_id === s.emp.id);
  assert.deepEqual(list.map((x) => x.source).sort(), ["bank", "contact", "qualifications"]);
  const contact = list.find((x) => x.source === "contact");
  assert.deepEqual(contact.changes.mobile, ["91111111", "92222222"]);
  assert.equal((await s.c.get("/api/profile-changes")).status, 403);
  assert.ok((await hr.c.get("/api/me")).data.pendingProfileChanges >= 3);
  assert.ok((await hr.c.get("/api/notifications")).data.items.some((n) => /verify/.test(n.title_en)));
  // the person sees their own pending changes
  assert.equal((await s.c.get(`/api/employees/${s.emp.id}`)).data.pendingChanges.length, 3);
});

test("HR confirms one, undoes another (the old values come back); changes by HR to others need no review", async () => {
  const list = (await hr.c.get("/api/profile-changes")).data.items.filter((x) => x.employee_id === s.emp.id);
  const bank = list.find((x) => x.source === "bank"), contact = list.find((x) => x.source === "contact");
  assert.equal((await hr.c.post(`/api/profile-changes/${bank.id}/confirm`, {})).status, 200);
  assert.equal((await hr.c.post(`/api/profile-changes/${bank.id}/confirm`, {})).status, 409);
  assert.equal((await hr.c.post(`/api/profile-changes/${contact.id}/revert`, {})).status, 400, "reason needed");
  assert.equal((await hr.c.post(`/api/profile-changes/${contact.id}/revert`, { note: "رقم غير صحيح" })).status, 200);
  const e = (await hr.c.get(`/api/employees/${s.emp.id}`)).data.employee;
  assert.equal(e.mobile, "91111111"); assert.equal(e.personal_email, null); assert.equal(e.bank_iban, IBAN);
  const before = (await hr.c.get("/api/profile-changes?status=all")).data.items.length;
  await hr.c.put(`/api/employees/${s.emp.id}/contact`, { mobile: "94444444" });
  assert.equal((await hr.c.get("/api/profile-changes?status=all")).data.items.length, before);
  // nobody verifies their own profile change
  await hr.c.put(`/api/employees/${hr.emp.id}/contact`, { mobile: "95555555" });
  const own = (await hr.c.get("/api/profile-changes")).data.items.find((x) => x.employee_id === hr.emp.id);
  assert.equal((await hr.c.post(`/api/profile-changes/${own.id}/confirm`, {})).status, 403);
  assert.equal((await admin.post(`/api/profile-changes/${own.id}/confirm`, {})).status, 200);
});

test("bank details: the person, HR, Admin and Accounts — not the manager or a colleague", async () => {
  for (const [c, sees] of [[s.c, true], [hr.c, true], [admin, true], [acc.c, true], [mgr.c, false]]) {
    const p = (await c.get(`/api/employees/${s.emp.id}`)).data;
    assert.equal(p.employee.bank_iban === IBAN, sees); assert.equal(p.seesBank, sees);
  }
  assert.equal((await other.c.get(`/api/employees/${s.emp.id}`)).status, 403);
});

test("a new photo is recorded for review; undo puts the old photo back", async () => {
  const up = (b) => s.c.upload(`/api/employees/${s.emp.id}/files?kind=photo&name=p.jpg`, Buffer.from(b), "image/jpeg");
  const first = (await up("one")).data.file.id;
  const second = (await up("two")).data.file.id;
  const list = (await hr.c.get("/api/profile-changes")).data.items.filter((x) => x.employee_id === s.emp.id && x.source === "photo");
  const last = list.find((x) => x.changes.photo_file_id[1] === second);
  assert.deepEqual(last.changes.photo_file_id, [first, second]);
  await hr.c.post(`/api/profile-changes/${last.id}/revert`, { note: "صورة غير واضحة" });
  assert.equal((await hr.c.get(`/api/employees/${s.emp.id}`)).data.employee.photo_file_id, first);
});

test("addresses: permanent wilayat and current area in Muscat are part of contact (and reviewed)", async () => {
  const r = await s.c.put(`/api/employees/${s.emp.id}/contact`, { perm_wilayat: "Nizwa", current_area: "Al Khuwair", address: "Way 1234, Building 56" });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.employee.perm_wilayat, r.data.employee.current_area], ["Nizwa", "Al Khuwair"]);
  const c = (await hr.c.get("/api/profile-changes")).data.items.find((x) => x.employee_id === s.emp.id && x.changes.perm_wilayat);
  assert.deepEqual(c.changes.perm_wilayat, [null, "Nizwa"]);
});

test("ID details typed by hand (when a document couldn't be read) are saved and go to HR to verify", async () => {
  const r = await s.c.put(`/api/employees/${s.emp.id}/identity`, { civil_id: "12345678", civil_id_expiry: "2029-02-01", passport_no: "A1234567", passport_expiry: "2030-03-01" });
  assert.equal(r.status, 200); assert.equal(r.data.employee.civil_id, "12345678"); assert.equal(r.data.employee.passport_expiry, "2030-03-01");
  assert.equal((await s.c.put(`/api/employees/${s.emp.id}/identity`, { visa_expiry: "01/02/2029" })).status, 400);
  assert.equal((await other.c.put(`/api/employees/${s.emp.id}/identity`, { civil_id: "1" })).status, 403);
  const c = (await hr.c.get("/api/profile-changes")).data.items.find((x) => x.employee_id === s.emp.id && x.source === "identity");
  assert.deepEqual(c.changes.civil_id, [null, "12345678"]);
});

test("HR deletes an entry from the list: it's gone, the profile keeps its current values, the person can't delete their own", async () => {
  const items = (await hr.c.get("/api/profile-changes?status=all")).data.items;
  const c = items[0];
  const before = (await hr.c.get(`/api/employees/${c.employee_id}`)).data.employee;
  assert.equal((await s.c.del(`/api/profile-changes/${c.id}`)).status, 403);
  assert.equal((await hr.c.del(`/api/profile-changes/${c.id}`)).status, 200);
  assert.ok(!(await hr.c.get("/api/profile-changes?status=all")).data.items.some((x) => x.id === c.id));
  assert.deepEqual((await hr.c.get(`/api/employees/${c.employee_id}`)).data.employee, before);
  assert.equal((await hr.c.del(`/api/profile-changes/${c.id}`)).status, 404);
});
