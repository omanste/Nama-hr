import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { toCountryCode, countryName, isOmani } from "../public/js/countries.js";

let t, admin, hr, staff, staff2;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-10-26" });
  admin = await adminClient(t.base);
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "مدير الموارد", join_date: "2020-01-01" }, "hr");
  staff = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف", join_date: "2024-03-01" }, "staff");
  staff2 = await makePerson(t.base, admin, { emp_no: "S2", name_ar: "موظف٢", join_date: "2024-01-01" }, "staff");
});
after(async () => { await t.close(); });

test("nationality text becomes a country code; Omani checks still work", async () => {
  assert.equal(toCountryCode("Omani"), "OM");
  assert.equal(toCountryCode("عماني"), "OM");
  assert.equal(toCountryCode("India"), "IN");
  assert.equal(toCountryCode("in"), "IN");
  assert.equal(toCountryCode("Atlantis"), "Atlantis");
  assert.equal(countryName("OM", "en"), "Oman");
  assert.ok(isOmani("OM") && isOmani("Omani") && !isOmani("IN"));
  const r = await hr.c.put(`/api/employees/${staff.emp.id}`, { nationality: "Omani" });
  assert.equal(r.status, 200);
  assert.equal(r.data.employee.nationality, "OM");
  assert.equal((await hr.c.put(`/api/employees/${staff.emp.id}`, { nationality: "PK" })).data.employee.nationality, "PK");
});

test("staff upload their own photo and papers (ID, passport…), not contracts, consents or other people's", async () => {
  const jpg = Buffer.from("ffd8ffe000104a464946", "hex");
  const id = await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=civil_id&name=id-front.jpg`, jpg, "image/jpeg");
  assert.equal(id.status, 201);
  assert.equal(id.data.file.doc_type, "civil_id");
  assert.equal((await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=passport&name=p.pdf`, Buffer.from("%PDF-1.4"), "application/pdf")).status, 201);
  for (const dt of ["contract", "consent"]) assert.equal((await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=${dt}`, jpg, "image/jpeg")).status, 403);
  assert.equal((await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=photo`, jpg, "image/jpeg")).status, 201); // own photo: yes
  assert.equal((await staff.c.upload(`/api/employees/${staff2.emp.id}/files?kind=photo`, jpg, "image/jpeg")).status, 403); // someone else's: no
  assert.equal((await staff.c.upload(`/api/employees/${staff2.emp.id}/files?kind=doc&doc_type=civil_id`, jpg, "image/jpeg")).status, 403);
  assert.equal((await staff.c.del(`/api/files/${id.data.file.id}`)).status, 403);
  const files = (await staff.c.get(`/api/employees/${staff.emp.id}`)).data.files;
  assert.equal(files.filter((f) => f.kind === "doc").length, 2);
});

test("holidays save as a sorted list of dates", async () => {
  const r = await admin.put("/api/settings", { official_holidays: [{ date: "2026-11-19", name: "National Day" }, { date: "2026-11-18", name: "National Day" }] });
  assert.equal(r.status, 200);
  assert.deepEqual((await admin.get("/api/settings")).data.official_holidays.map((x) => x.date), ["2026-11-18", "2026-11-19"]);
});

test("staff edit their own contact details, but not the work e-mail or anyone else's", async () => {
  const r = await staff.c.put(`/api/employees/${staff.emp.id}/contact`, { mobile: "+968 9000 1111", emergency_name: "أخ", emergency_phone: "99999999", email: "hack@x.om", civil_id: "1" });
  assert.equal(r.status, 200);
  assert.equal(r.data.employee.mobile, "+968 9000 1111");
  assert.equal(r.data.employee.emergency_name, "أخ");
  assert.equal(r.data.employee.email, null);     // e-mail is HR/Admin only
  assert.notEqual(r.data.employee.civil_id, "1"); // so is everything outside contact details
  assert.equal((await staff.c.put(`/api/employees/${staff2.emp.id}/contact`, { mobile: "1" })).status, 403);
  assert.equal((await staff.c.put(`/api/employees/${staff.emp.id}`, { email: "a@b.om" })).status, 403);
});
