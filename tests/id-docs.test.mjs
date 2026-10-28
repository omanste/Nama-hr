// ID photo reading and document expiry alerts. tests/fixtures/fake-id-back.jpg is a made-up card (no real person).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { parseMrz, parseFront } from "../server/idread.mjs";
import { runExpiryCheck } from "../server/jobs.mjs";

test("reader: check-digit verified ID lines and printed front labels", () => {
  const m = parseMrz("IDOMNA12345678498765432<<<<<<<\n9004034M2805128OMN<<<<<<<<<<<4\nALTEST<<SAMPLE<PERSON<<<<<<<<<");
  assert.deepEqual({ ...m }, { kind: "id", card_no: "A12345678", civil_id: "98765432", dob: "1990-04-03", gender: "male", expiry: "2028-05-12", nationality: "OM", name_en: "Sample Person Altest" });
  // a wrong check digit drops that value instead of guessing
  assert.equal(parseMrz("IDOMNA12345678498765432<<<<<<<\n9004035M2805128OMN<<<<<<<<<<<4\nX<<Y<<<<").dob, undefined);
  const f = parseFront("SULTANATE OF OMAN\nCivil Number: 98765432\nDate of Birth: 03/04/1990\nExpiry Date: 12/05/2028\nSex: F");
  assert.equal(f.civil_id, "98765432"); assert.equal(f.dob, "1990-04-03"); assert.equal(f.expiry, "2028-05-12"); assert.equal(f.gender, "female");
});

test("reader: a visa's machine-readable lines (expiry, check digits) and printed \"valid until\"", () => {
  const v = parseMrz("VOOMNTEST<<SAMPLE<PERSON<<<<<<<<<<<<<<<<<<<<\nV123456781IND9004034M2709156<<<<<<<<<<<<<<<<");
  assert.equal(v.kind, "visa"); assert.equal(v.expiry, "2027-09-15"); assert.equal(v.visa_no, "V12345678"); assert.equal(v.passport_no, undefined);
  assert.equal(parseFront("RESIDENCE VISA\nValid until: 15/09/2027").expiry, "2027-09-15");
});

let t, admin, hr, staff, other;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-10-26", OCR: "on" });
  admin = await adminClient(t.base);
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "الموارد", join_date: "2020-01-01" }, "hr");
  staff = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف", join_date: "2024-03-01" }, "staff");
  other = await makePerson(t.base, admin, { emp_no: "S2", name_ar: "آخر", join_date: "2024-01-01" }, "staff");
});
after(async () => { await t.close(); });

test("a real photo of a (made-up) ID card is read on our server and the values applied only after confirming", async () => {
  const jpg = fs.readFileSync(new URL("./fixtures/fake-id-back.jpg", import.meta.url));
  const up = await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=civil_id&name=id-back.jpg`, jpg, "image/jpeg");
  assert.equal(up.status, 201);
  assert.equal(up.data.read.civil_id, "98765432");
  assert.equal(up.data.read.expiry, "2028-05-12");
  assert.ok(up.data.read.verified.includes("dob"));
  assert.equal(up.data.file.expiry, "2028-05-12"); // the copy keeps its expiry for alerts
  // nothing changed yet
  assert.equal((await staff.c.get(`/api/employees/${staff.emp.id}`)).data.employee.civil_id, null);
  // someone else can't apply it; the owner can
  assert.equal((await other.c.post(`/api/files/${up.data.file.id}/apply`, { fields: ["civil_id"] })).status, 403);
  const ap = await staff.c.post(`/api/files/${up.data.file.id}/apply`, { fields: ["civil_id", "expiry", "dob", "gender", "nationality", "name_en", "made_up"] });
  assert.equal(ap.status, 200);
  const e = ap.data.employee;
  assert.equal(e.civil_id, "98765432"); assert.equal(e.civil_id_expiry, "2028-05-12"); assert.equal(e.dob, "1990-04-03");
  assert.equal(e.gender, "male"); assert.equal(e.nationality, "OM"); assert.equal(e.name_en, "Sample Person Altest");
  const log = (await admin.get("/api/audit?entity=employee")).data.items.find((a) => a.action === "employee.update_from_id");
  assert.ok(log);
});

test("values that were not read can't be pushed through apply", async () => {
  const up = await hr.c.upload(`/api/employees/${other.emp.id}/files?kind=doc&doc_type=passport&name=p.pdf`, Buffer.from("%PDF-1.4"), "application/pdf");
  assert.equal(up.data.read, null); // PDFs are kept, not read
  assert.equal((await hr.c.post(`/api/files/${up.data.file.id}/apply`, { fields: ["civil_id"] })).status, 404);
});

test("documents near expiry alert HR and the person at 30 days, 7 days and on expiry — once each", async () => {
  const pdf = Buffer.from("%PDF-1.4");
  await hr.c.upload(`/api/employees/${other.emp.id}/files?kind=doc&doc_type=visa&name=visa.pdf&expiry=2026-11-20`, pdf, "application/pdf");
  const list = (await hr.c.get("/api/expiring")).data.items;
  const visa = list.find((x) => x.what === "visa");
  assert.ok(visa); assert.equal(visa.days, 25); assert.equal(visa.employee.id, other.emp.id);
  assert.equal((await staff.c.get("/api/expiring")).status, 403);
  const count = async (c) => (await c.get("/api/notifications")).data.items.filter((n) => /Visa/.test(n.title_en)).length;
  assert.equal(await count(hr.c), 1); assert.equal(await count(other.c), 1);
  runExpiryCheck(t.app.ctx, "2026-10-27");
  assert.equal(await count(other.c), 1); // same stage: no repeat
  runExpiryCheck(t.app.ctx, "2026-11-14");
  assert.equal(await count(other.c), 2); // 7 days left
  runExpiryCheck(t.app.ctx, "2026-11-20");
  assert.equal(await count(other.c), 3); // expired
  // a renewed copy stops the alerts for the old one
  await hr.c.upload(`/api/employees/${other.emp.id}/files?kind=doc&doc_type=visa&name=visa2.pdf&expiry=2028-11-20`, pdf, "application/pdf");
  assert.ok(!(await hr.c.get("/api/expiring")).data.items.some((x) => x.what === "visa"));
});

test("a document's expiry date can be set or corrected (own papers or HR), and then reminds", async () => {
  const up = await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=visa&name=visa.pdf`, Buffer.from("%PDF-1.4"), "application/pdf");
  assert.equal(up.status, 201); assert.equal(up.data.file.expiry, null, "a PDF isn't read");
  const id = up.data.file.id;
  assert.equal((await other.c.put(`/api/files/${id}`, { expiry: "2026-11-10" })).status, 403);
  assert.equal((await staff.c.put(`/api/files/${id}`, { expiry: "10/11/2026" })).status, 400);
  assert.equal((await staff.c.put(`/api/files/${id}`, { expiry: "2026-11-10" })).data.file.expiry, "2026-11-10");
  const exp = (await hr.c.get("/api/expiring")).data.items;
  assert.ok(exp.some((x) => x.what === "visa" && x.employee.id === staff.emp.id && x.expiry === "2026-11-10"));
  assert.ok((await staff.c.get("/api/notifications")).data.items.some((n) => /Visa|التأشيرة/.test(n.body_en + n.body_ar + n.title_en + n.title_ar)));
  assert.equal((await hr.c.put(`/api/files/${id}`, { expiry: "2028-01-01" })).status, 200);
});
