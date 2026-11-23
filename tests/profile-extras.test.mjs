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

test("staff upload their own photo and papers (ID, passport, resume, course certificates, a contract copy…), not consents or other people's", async () => {
  const jpg = Buffer.from("ffd8ffe000104a464946", "hex");
  const id = await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=civil_id&name=id-front.jpg`, jpg, "image/jpeg");
  assert.equal(id.status, 201);
  assert.equal(id.data.file.doc_type, "civil_id");
  assert.equal((await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=passport&name=p.pdf`, Buffer.from("%PDF-1.4"), "application/pdf")).status, 201);
  for (const dt of ["resume", "course", "contract"]) assert.equal((await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=${dt}&name=${dt}.pdf`, Buffer.from("%PDF-1.4"), "application/pdf")).status, 201, dt);
  assert.equal((await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=consent`, jpg, "image/jpeg")).status, 403);
  assert.equal((await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=diploma`, jpg, "image/jpeg")).status, 403, "unknown type");
  assert.equal((await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=photo`, jpg, "image/jpeg")).status, 201); // own photo: yes
  assert.equal((await staff.c.upload(`/api/employees/${staff2.emp.id}/files?kind=photo`, jpg, "image/jpeg")).status, 403); // someone else's: no
  assert.equal((await staff.c.upload(`/api/employees/${staff2.emp.id}/files?kind=doc&doc_type=civil_id`, jpg, "image/jpeg")).status, 403);
  assert.equal((await staff.c.del(`/api/files/${id.data.file.id}`)).status, 403);
  const files = (await staff.c.get(`/api/employees/${staff.emp.id}`)).data.files;
  assert.deepEqual(files.filter((f) => f.kind === "doc").map((f) => f.doc_type).sort(), ["civil_id", "contract", "course", "passport", "resume"]);
});

test("holidays save as a sorted list of dates", async () => {
  const r = await admin.put("/api/settings", { official_holidays: [{ date: "2026-11-19", name: "National Day" }, { date: "2026-11-18", name: "National Day" }] });
  assert.equal(r.status, 200);
  assert.deepEqual((await admin.get("/api/settings")).data.official_holidays.map((x) => x.date), ["2026-11-18", "2026-11-19"]);
});

test("staff edit their own contact details, but not the work e-mail or anyone else's", async () => {
  const r = await staff.c.put(`/api/employees/${staff.emp.id}/contact`, { mobile: "+968 9000 1111", emergency_name: "أخ", emergency_relation: "Brother", emergency_phone: "99999999", email: "hack@x.om", civil_id: "1" });
  assert.equal(r.status, 200);
  assert.equal(r.data.employee.mobile, "+96890001111"); assert.equal(r.data.employee.emergency_phone, "+96899999999");
  assert.equal(r.data.employee.emergency_name, "أخ");
  assert.equal(r.data.employee.email, null);     // e-mail is HR/Admin only
  assert.notEqual(r.data.employee.civil_id, "1"); // so is everything outside contact details
  assert.equal((await staff.c.put(`/api/employees/${staff2.emp.id}/contact`, { mobile: "1" })).status, 403);
  assert.equal((await staff.c.put(`/api/employees/${staff.emp.id}`, { email: "a@b.om" })).status, 403);
});

test("HR sets the work e-mail from the Contact window, next to the personal one; a wrong one is refused", async () => {
  const r = await hr.c.put(`/api/employees/${staff.emp.id}/contact`, { email: "staff.one@nama.om", personal_email: "me@example.com" });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.employee.email, r.data.employee.personal_email], ["staff.one@nama.om", "me@example.com"]);
  const bad = await hr.c.put(`/api/employees/${staff.emp.id}/contact`, { email: "not an email" });
  assert.equal(bad.status, 400); assert.equal(bad.data.field, "email");
  // the person can't change it from their own Contact window
  await staff.c.put(`/api/employees/${staff.emp.id}/contact`, { email: "other@x.om" });
  assert.equal((await hr.c.get(`/api/employees/${staff.emp.id}`)).data.employee.email, "staff.one@nama.om");
});

test("degrees and courses with their year: saved newest first, a wrong year refused, staff keep their own current", async () => {
  const put = (c, b) => c.put(`/api/employees/${staff.emp.id}/qualifications`, b);
  const r = await put(staff.c, { degrees: [{ level: "bachelor", field: "Marketing", date: "2008-06-15" }, { level: "phd", field: "Economics", date: "2019-01-20" }, { level: "master", field: "Management", year: 2013 }],
    courses: [{ name: "Project management", year: 2021 }] });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.data.employee.degrees).map((d) => [d.level, d.year]), [["phd", 2019], ["master", 2013], ["bachelor", 2008]]);
  assert.equal(JSON.parse(r.data.employee.degrees)[0].date, "2019-01-20", "the graduation date is kept");
  const future = await put(staff.c, { degrees: [{ level: "general", field: "Science", date: "2999-01-01" }] });
  assert.equal(future.status, 400, "not after today");
  assert.equal((await put(staff.c, { degrees: [{ level: "professional", field: "CPA", date: "2015-03-01" }], languages: "Arabic, English | العربية، الإنجليزية" })).data.employee.languages, "Arabic, English | العربية، الإنجليزية");
  assert.equal(JSON.parse(r.data.employee.courses)[0].name, "Project management");
  // a diploma still being finished: this year is fine; next year isn't
  const thisYear = Number(new Date().toISOString().slice(0, 4));
  assert.equal((await put(staff.c, { degrees: [{ level: "diploma", field: "Sharia sciences", year: thisYear }] })).status, 200);
  const bad = await put(staff.c, { degrees: [{ level: "diploma", field: "Sharia sciences", year: 2999 }] });
  assert.equal(bad.status, 400); assert.equal(bad.data.field, "degrees");
  assert.equal((await put(staff.c, { degrees: [{ level: "master", field: "", year: 2010 }] })).status, 400, "the specialization is needed");
  assert.equal((await put(hr.c, { courses: [] })).data.employee.courses, null, "an empty list clears it");
});

test("experience before Nama: kept in months (0–50 years), with the previous employers in both languages", async () => {
  const put = (c, b) => c.put(`/api/employees/${staff.emp.id}/qualifications`, b);
  const r = await put(staff.c, { prior_exp_months: 66, experience: "Oman Bank, sales officer | بنك عُمان، موظف مبيعات" });
  assert.equal(r.status, 200); assert.equal(r.data.employee.prior_exp_months, 66);
  for (const bad of [601, -1, 2.5, "x"]) assert.equal((await put(staff.c, { prior_exp_months: bad })).status, 400, String(bad));
  assert.equal((await put(hr.c, { prior_exp_months: 24 })).data.employee.prior_exp_months, 24, "HR can change it");
  assert.equal((await put(hr.c, { prior_exp_months: null })).data.employee.prior_exp_months, null, "and clear it");
});
