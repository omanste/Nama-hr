// ID photo reading and document expiry alerts. tests/fixtures/fake-id.jpg is a made-up card (no real person) — make-id-card.mjs builds it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { parseMrz, parseFront, parseArabicName, fullPrintedName, arabicNameFrom } from "../server/idread.mjs";
import { toArabicName, completeFamily } from "../server/names-ar.mjs";
import { runExpiryCheck } from "../server/jobs.mjs";

test("reader: check-digit verified ID lines and printed front labels", () => {
  // Omani cards write the name in its usual order: given names, then the family name
  const m = parseMrz("IDOMNA12345678498765432<<<<<<<\n9004034M2805128OMN<<<<<<<<<<<4\nSAMPLE<PERSON<<ALTEST<<<<<<<<<");
  assert.deepEqual({ ...m }, { kind: "id", card_no: "A12345678", civil_id: "98765432", dob: "1990-04-03", gender: "male", expiry: "2028-05-12", nationality: "OM", name_en: "Sample Person Altest" });
  // other countries' cards put the surname first (ICAO): turned round to given names first
  assert.equal(parseMrz("IDARE123456789<<<<<<<<<<<<<<<<\n9004034M2805128ARE<<<<<<<<<<<4\nALTEST<<SAMPLE<PERSON<<<<<<<<<").name_en, "Sample Person Altest");
  // a wrong check digit drops that value instead of guessing
  assert.equal(parseMrz("IDOMNA12345678498765432<<<<<<<\n9004035M2805128OMN<<<<<<<<<<<4\nX<<Y<<<<").dob, undefined);
  const f = parseFront("SULTANATE OF OMAN\nCivil Number: 98765432\nDate of Birth: 03/04/1990\nExpiry Date: 12/05/2028\nSex: F");
  assert.equal(f.civil_id, "98765432"); assert.equal(f.dob, "1990-04-03"); assert.equal(f.expiry, "2028-05-12"); assert.equal(f.gender, "female");
});

test("reader: an Omani ID whose civil number is the document number (optional field empty)", () => {
  const m = parseMrz("IDOMN12345678<8<<<<<<<<<<<<<<<\n9004034M2805128OMN<<<<<<<<<<<4\nSAMPLE<PERSON<<ALTEST<<<<<<<<<");
  assert.equal(m.civil_id, "12345678"); assert.equal(m.expiry, "2028-05-12");
  assert.equal(parseMrz("IDOMN12345678<5<<<<<<<<<<<<<<<\n9004034M2805128OMN<<<<<<<<<<<4\nX<<Y").civil_id, undefined, "wrong check digit");
});

test("reader: the Arabic name after \"الاسم\" — a clean 2–7-word name, or nothing", () => {
  assert.equal(parseArabicName("سلطنة عمان\nالبطاقة الشخصية\nالاسم: عينة شخص الاختبار\nName: SAMPLE"), "عينة شخص الاختبار");
  assert.equal(parseArabicName("الاسم\nعينة شخص الاختبار"), "عينة شخص الاختبار", "on the next line");
  assert.equal(parseArabicName("الاسم: عَينة شخص الاختبار"), "عينة شخص الاختبار", "vowel marks dropped");
  assert.equal(parseArabicName("الاسم: عينة"), undefined, "one word isn't a full name");
  assert.equal(parseArabicName("الاسم: تاريخ الميلاد"), undefined, "a label, not a name");
  assert.equal(parseArabicName("عينة شخص الاختبار"), undefined, "no label: not guessed");
});

test("reader: a name longer than the 30-letter line — the full printed name, or the known family name it starts", () => {
  const cut = "IDOMNA12345678498765432<<<<<<<\n9004034F2805128OMN<<<<<<<<<<<4\nSHAIKHA<SALIM<KHALFAN<<AL<HINA";
  assert.equal(parseMrz(cut).name_en, "Shaikha Salim Khalfan Al Hina"); assert.equal(parseMrz(cut).name_cut, true);
  assert.equal(fullPrintedName(`Name: SHAIKHA SALIM KHALFAN AL HINAI\n${cut}`, "Shaikha Salim Khalfan Al Hina"), "Shaikha Salim Khalfan Al Hinai");
  assert.equal(fullPrintedName("SULTANATE OF OMAN", "Shaikha Salim Khalfan Al Hina"), null);
  assert.equal(completeFamily("Hina"), "hinai"); assert.equal(completeFamily("Jabr"), "jabri"); assert.equal(completeFamily("Al"), null);
});

test("Arabic name: the matching line on the card, else the English spelled in Arabic (known names only)", () => {
  assert.equal(toArabicName("Shaikha Salim Khalfan Al Hinai"), "شيخة سالم خلفان الهنائي");
  assert.equal(toArabicName("Mohammed Bin Rashid Al Harthi"), "محمد بن راشد الحارثي");
  assert.equal(toArabicName("Abdul Aziz Hamed Al Busaidi"), "عبدالعزيز حامد البوسعيدي");
  assert.equal(toArabicName("Sample Person Altest"), null, "an unknown word: nothing guessed");
  assert.equal(arabicNameFrom("سلطنة عمان\nشيخة سالم خلفان الهنائي\nالرقم المدني", "Shaikha Salim Khalfan Al Hinai"), "شيخة سالم خلفان الهنائي", "no label: the line that matches");
  assert.equal(arabicNameFrom("سلطنة عمان\nالبطاقة الشخصية", "Shaikha Salim Khalfan Al Hinai"), undefined);
});

test("reader: an Omani passport's personal-number field gives the civil ID (check digit verified)", () => {
  const p = parseMrz("P<OMNTEST<<SAMPLE<PERSON<<<<<<<<<<<<<<<<<<<<\nT1234567<9OMN9004034F310130098765432<<<<<<20");
  assert.equal(p.kind, "passport"); assert.equal(p.passport_no, "T1234567"); assert.equal(p.civil_id, "98765432"); assert.equal(p.expiry, "2031-01-30");
  assert.equal(parseMrz("P<OMNTEST<<SAMPLE<PERSON<<<<<<<<<<<<<<<<<<<<\nT1234567<9OMN9004034F310130098765433<<<<<<20").civil_id, undefined, "wrong check digit");
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

test("uploading an ID fills the personal details at once — replacing what was typed, the English name too; HR sees it to verify", async () => {
  // details typed by hand before the card was uploaded
  await admin.put(`/api/employees/${staff.emp.id}`, { name_en: "Typed Name", name_ar: "اسم مكتوب", dob: "1985-01-01", gender: "female" });
  const jpg = fs.readFileSync(new URL("./fixtures/fake-id.jpg", import.meta.url));
  const up = await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=civil_id&name=id-back.jpg`, jpg, "image/jpeg");
  assert.equal(up.status, 201);
  assert.equal(up.data.read.civil_id, "98765432");
  assert.ok(up.data.read.verified.includes("dob"));
  assert.equal(up.data.file.expiry, "2028-05-12"); // the copy keeps its expiry for alerts
  assert.deepEqual([...up.data.applied].sort(), ["civil_id", "civil_id_expiry", "dob", "gender", "name_ar", "name_en", "nationality"]);
  const e = (await staff.c.get(`/api/employees/${staff.emp.id}`)).data.employee;
  assert.equal(e.civil_id, "98765432"); assert.equal(e.civil_id_expiry, "2028-05-12"); assert.equal(e.dob, "1990-04-03");
  assert.equal(e.gender, "male"); assert.equal(e.nationality, "OM"); assert.equal(e.name_en, "Sample Person Altest");
  assert.equal(e.name_ar, "عينة شخص الاختبار", "the Arabic name from the front of the card");
  // the name at the top and on the sign-in list follow the profile
  assert.equal((await staff.c.get("/api/me")).data.employee.name_en, "Sample Person Altest");
  // HR is shown what changed (old → new) and can undo it
  const pc = (await hr.c.get("/api/profile-changes")).data.items.find((c) => c.employee_id === staff.emp.id && c.source === "id");
  assert.deepEqual(pc.changes.name_en, ["Typed Name", "Sample Person Altest"]);
  assert.ok((await admin.get("/api/audit?entity=employee")).data.items.find((a) => a.action === "employee.update_from_id"));
  // uploading the same card again changes nothing
  const again = await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=civil_id&name=id-back.jpg`, jpg, "image/jpeg");
  assert.deepEqual(again.data.applied, []);
  // someone else can't apply a read value to this profile
  assert.equal((await other.c.post(`/api/files/${up.data.file.id}/apply`, { fields: ["civil_id"] })).status, 403);
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

test("a passport PDF (phone scan with a text layer) is read: number and expiry go to the profile after confirming", async () => {
  const pdf = fs.readFileSync(new URL("./fixtures/fake-passport.pdf", import.meta.url)); // made up, no real person
  await admin.put(`/api/employees/${staff.emp.id}`, { passport_no: "OLD0001", passport_expiry: "2025-01-01" }); // an old passport typed earlier
  const up = await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=passport&name=passport.pdf`, pdf, "application/pdf");
  assert.equal(up.status, 201);
  if (!up.data.read) return; // this machine has no pdftotext (the server image installs it)
  assert.equal(up.data.read.passport_no, "T1234567"); assert.equal(up.data.read.expiry, "2031-01-30");
  assert.equal(up.data.read.civil_id, "98765432", "the civil number from the passport");
  assert.equal(up.data.file.expiry, "2031-01-30");
  assert.ok(up.data.applied.includes("passport_no") && up.data.applied.includes("passport_expiry"), "applied on upload");
  const e = (await staff.c.get(`/api/employees/${staff.emp.id}`)).data.employee;
  assert.equal(e.passport_no, "T1234567"); assert.equal(e.passport_expiry, "2031-01-30");
});

test("a PDF can be viewed page by page as pictures — only by people who may see it", async () => {
  const up = await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=certificate&name=cert.pdf`, fs.readFileSync(new URL("./fixtures/fake-passport.pdf", import.meta.url)), "application/pdf");
  const id = up.data.file.id;
  assert.equal((await other.c.get(`/api/files/${id}/pages`)).status, 403);
  const p = (await staff.c.get(`/api/files/${id}/pages`)).data.pages;
  if (!p) return; // no poppler on this machine (the server image has it)
  assert.equal(p, 1);
  const png = await fetch(`${t.base}/api/files/${id}/page/1`, { headers: { cookie: hr.c.cookie } });
  assert.equal(png.status, 200); assert.equal(png.headers.get("content-type"), "image/png");
  assert.deepEqual([...Buffer.from(await png.arrayBuffer()).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal((await staff.c.get(`/api/files/${id}/page/2`)).status, 404);
  assert.equal((await fetch(`${t.base}/api/files/${id}/page/1`, { headers: { cookie: other.c.cookie } })).status, 403);
});

test("HR updates every profile from its uploaded ID in one go, and sees old → new, unreadable files and who has no ID", async () => {
  const jpg = fs.readFileSync(new URL("./fixtures/fake-id.jpg", import.meta.url));
  const a = await makePerson(t.base, admin, { emp_no: "RR1", name_ar: "قديم", join_date: "2022-01-01" });
  const bad = await makePerson(t.base, admin, { emp_no: "RR2", name_ar: "صورة غير واضحة", join_date: "2022-01-01" });
  const none = await makePerson(t.base, admin, { emp_no: "RR3", name_ar: "بلا بطاقة", join_date: "2022-01-01" });
  await hr.c.upload(`/api/employees/${a.emp.id}/files?kind=doc&doc_type=civil_id&name=id.jpg`, jpg, "image/jpeg");
  // details changed by hand after the card was uploaded (e.g. the name saved family-first by the old reader)
  await admin.put(`/api/employees/${a.emp.id}`, { name_en: "Altest Sample Person", name_ar: "قديم", dob: "1980-01-01" });
  await hr.c.upload(`/api/employees/${bad.emp.id}/files?kind=doc&doc_type=civil_id&name=blur.jpg`, Buffer.from("ffd8ffe000104a464946", "hex"), "image/jpeg");
  assert.equal((await staff.c.post("/api/profiles/reread-ids", {})).status, 403);
  assert.equal((await hr.c.post("/api/profiles/reread-ids", {})).status, 202);
  let b; for (let i = 0; i < 240; i++) { b = (await hr.c.get("/api/profiles/reread-ids")).data.batch; if (!b.running) break; await new Promise((r) => setTimeout(r, 500)); }
  assert.equal(b.running, false);
  const row = b.results.find((r) => r.id === a.emp.id);
  const d = row.docs.find((x) => x.doc_type === "civil_id");
  assert.equal(d.status, "updated");
  assert.deepEqual(d.changes.name_en, ["Altest Sample Person", "Sample Person Altest"]);
  assert.deepEqual(d.changes.name_ar, ["قديم", "عينة شخص الاختبار"]);
  assert.deepEqual(d.changes.dob, ["1980-01-01", "1990-04-03"]);
  assert.equal(b.results.find((r) => r.id === bad.emp.id).docs[0].status, "not_read");
  assert.ok(b.noId.some((p) => p.id === none.emp.id));
  const e = (await hr.c.get(`/api/employees/${a.emp.id}`)).data.employee;
  assert.equal(e.name_en, "Sample Person Altest"); assert.equal(e.name_ar, "عينة شخص الاختبار");
  // kept for later
  assert.equal((await admin.get("/api/profiles/reread-ids")).data.batch.results.length, b.results.length);
});

test("a card with a long name and no Arabic: the full English name, and the Arabic one completed from it", async () => {
  const jpg = fs.readFileSync(new URL("./fixtures/fake-id-long.jpg", import.meta.url));
  const a = await makePerson(t.base, admin, { emp_no: "LN1", name_ar: "شيخة سالم الهنائي", join_date: "2022-01-01" }); // a shorter Arabic name
  const up = await hr.c.upload(`/api/employees/${a.emp.id}/files?kind=doc&doc_type=civil_id&name=id.jpg`, jpg, "image/jpeg");
  assert.equal(up.status, 201);
  let e = (await hr.c.get(`/api/employees/${a.emp.id}`)).data.employee;
  assert.equal(e.name_en, "Shaikha Salim Khalfan Al Hinai");
  assert.equal(e.name_ar, "شيخة سالم خلفان الهنائي");
  // an Arabic name spelled differently by a person is kept (the English spelled in Arabic is only a fallback)
  const b = await makePerson(t.base, admin, { emp_no: "LN2", name_ar: "شيخه سليم الهنائي", join_date: "2022-01-01" });
  await hr.c.upload(`/api/employees/${b.emp.id}/files?kind=doc&doc_type=civil_id&name=id.jpg`, jpg, "image/jpeg");
  e = (await hr.c.get(`/api/employees/${b.emp.id}`)).data.employee;
  assert.equal(e.name_ar, "شيخه سليم الهنائي"); assert.equal(e.name_en, "Shaikha Salim Khalfan Al Hinai");
});
