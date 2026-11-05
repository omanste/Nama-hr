// ID photo reading and document expiry alerts. tests/fixtures/fake-id.jpg is a made-up card (no real person) — make-id-card.mjs builds it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { parseMrz, parseFront, parseArabicName, fullPrintedName, arabicNameFrom, arabicFromVariants } from "../server/idread.mjs";
import { toArabicName, completeFamily, completeArabicName, fixConfusedLetters } from "../server/names-ar.mjs";
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

test("uploading an ID shows what was read; only the ticked values are saved (replacing typed ones); HR sees it to verify", async () => {
  // details typed by hand before the card was uploaded
  await admin.put(`/api/employees/${staff.emp.id}`, { name_en: "Typed Name", name_ar: "اسم مكتوب", dob: "1985-01-01", gender: "female" });
  const jpg = fs.readFileSync(new URL("./fixtures/fake-id.jpg", import.meta.url));
  const up = await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=civil_id&name=id-back.jpg`, jpg, "image/jpeg");
  assert.equal(up.status, 201);
  assert.equal(up.data.read.civil_id, "98765432");
  assert.ok(up.data.read.verified.includes("dob"));
  assert.equal(up.data.file.expiry, "2028-05-12"); // the copy keeps its expiry for alerts
  // nothing is saved yet: the person checks before → after first
  assert.deepEqual(up.data.applied, []);
  assert.equal((await staff.c.get(`/api/employees/${staff.emp.id}`)).data.employee.name_en, "Typed Name");
  assert.equal(up.data.current.name_en, "Typed Name"); assert.equal(up.data.current.name_ar, "اسم مكتوب");
  // they untick the gender (say the scanner got it wrong) and save the rest
  assert.equal((await staff.c.post(`/api/files/${up.data.file.id}/apply`, { fields: ["civil_id", "expiry", "dob", "nationality", "name_en", "name_ar"] })).status, 200);
  const e = (await staff.c.get(`/api/employees/${staff.emp.id}`)).data.employee;
  assert.equal(e.gender, "female", "unticked: kept");
  assert.equal(e.civil_id, "98765432"); assert.equal(e.civil_id_expiry, "2028-05-12"); assert.equal(e.dob, "1990-04-03");
  assert.equal(e.nationality, "OM"); assert.equal(e.name_en, "Sample Person Altest");
  assert.equal(e.name_ar, "عينة شخص الاختبار", "the Arabic name from the front of the card");
  // the name at the top and on the sign-in list follow the profile
  assert.equal((await staff.c.get("/api/me")).data.employee.name_en, "Sample Person Altest");
  // HR is shown what changed (old → new) and can undo it
  const pc = (await hr.c.get("/api/profile-changes")).data.items.find((c) => c.employee_id === staff.emp.id && c.source === "id");
  assert.deepEqual(pc.changes.name_en, ["Typed Name", "Sample Person Altest"]);
  // with the card it was read from, to compare when verifying; and when it was changed
  assert.equal(pc.file_id, up.data.file.id); assert.deepEqual(pc.docs.map((d) => d.id), [up.data.file.id]);
  assert.equal(pc.docs[0].doc_type, "civil_id"); assert.ok(pc.created_at);
  assert.ok((await admin.get("/api/audit?entity=employee")).data.items.find((a) => a.action === "employee.update_from_id"));
  // uploading the same card again changes nothing
  const again = await staff.c.upload(`/api/employees/${staff.emp.id}/files?kind=doc&doc_type=civil_id&name=id-back.jpg`, jpg, "image/jpeg");
  assert.equal(again.data.current.name_en, "Sample Person Altest"); assert.deepEqual(again.data.applied, []);
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
  // a passport gives only its number and expiry: personal details come from the civil ID card
  for (const k of ["civil_id", "name_en", "name_ar", "dob", "gender", "nationality"]) assert.equal(up.data.read[k], undefined, k);
  assert.equal(up.data.file.expiry, "2031-01-30");
  assert.equal((await staff.c.post(`/api/files/${up.data.file.id}/apply`, { fields: ["name_en"] })).status, 400, "no names from a passport");
  assert.equal((await staff.c.post(`/api/files/${up.data.file.id}/apply`, { fields: ["passport_no", "expiry"] })).status, 200);
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
  assert.equal(png.status, 200); assert.equal(png.headers.get("content-type"), "image/jpeg", "a scan page as JPEG (far smaller than PNG)");
  assert.deepEqual([...Buffer.from(await png.arrayBuffer()).subarray(0, 3)], [0xff, 0xd8, 0xff]);
  // asked again with its tag: nothing is sent
  assert.equal((await fetch(`${t.base}/api/files/${id}/page/1`, { headers: { cookie: hr.c.cookie, "If-None-Match": png.headers.get("etag") } })).status, 304);
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
  assert.ok(b.noPassport.some((p) => p.id === a.emp.id));
  // kept for later, and as an Excel file for HR / Admin only
  assert.equal((await admin.get("/api/profiles/reread-ids")).data.batch.results.length, b.results.length);
  const csv = await fetch(`${t.base}/api/profiles/reread-ids?format=csv`, { headers: { cookie: hr.c.cookie } });
  assert.equal(csv.status, 200); const text = await csv.text();
  assert.match(text, /"Updated","RR1"/); assert.match(text, /"No civil ID uploaded","RR3"/); assert.match(text, /"Could not read","RR2"/);
  assert.equal((await fetch(`${t.base}/api/profiles/reread-ids?format=csv`, { headers: { cookie: staff.c.cookie } })).status, 403);
});

test("the check: a passport never changes names or nationality; what the card can't confirm is listed to check, unchanged", async () => {
  const pdf = fs.readFileSync(new URL("./fixtures/fake-passport.pdf", import.meta.url));
  const front = fs.readFileSync(new URL("./fixtures/fake-id-front.jpg", import.meta.url));
  const p = await makePerson(t.base, admin, { emp_no: "CK1", name_ar: "اسم صحيح", name_en: "Right Name", nationality: "OM", join_date: "2022-01-01" });
  await hr.c.upload(`/api/employees/${p.emp.id}/files?kind=doc&doc_type=passport&name=passport.pdf`, pdf, "application/pdf");
  const q = await makePerson(t.base, admin, { emp_no: "CK2", name_ar: "اسم", civil_id: "11111111", join_date: "2022-01-01" });
  const upq = await hr.c.upload(`/api/employees/${q.emp.id}/files?kind=doc&doc_type=civil_id&name=front.jpg`, front, "image/jpeg");
  assert.equal((await hr.c.post("/api/profiles/reread-ids", {})).status, 202);
  let b; for (let i = 0; i < 240; i++) { b = (await hr.c.get("/api/profiles/reread-ids")).data.batch; if (!b.running) break; await new Promise((r) => setTimeout(r, 500)); }
  const e = (await hr.c.get(`/api/employees/${p.emp.id}`)).data.employee;
  assert.equal(e.name_en, "Right Name"); assert.equal(e.name_ar, "اسم صحيح"); assert.equal(e.nationality, "OM");
  assert.ok(b.noId.some((x) => x.id === p.emp.id));
  // the printed front only (no "<<<" lines): a different civil number is not taken, it waits to be checked
  if (upq.data.read && upq.data.read.civil_id && !(upq.data.read.verified || []).includes("civil_id")) {
    assert.equal((await hr.c.get(`/api/employees/${q.emp.id}`)).data.employee.civil_id, "11111111");
    const c = b.check.find((x) => x.id === q.emp.id && x.field === "civil_id");
    assert.ok(c); assert.equal(c.profile, "11111111"); assert.equal(c.document, upq.data.read.civil_id); assert.equal(c.reason, "front_only");
  }
});

test("a card with a long name and no Arabic: the full English name, and the Arabic one completed from it", async () => {
  const jpg = fs.readFileSync(new URL("./fixtures/fake-id-long.jpg", import.meta.url));
  const a = await makePerson(t.base, admin, { emp_no: "LN1", name_ar: "شيخة سالم الهنائي", join_date: "2022-01-01" }); // a shorter Arabic name
  const up = await hr.c.upload(`/api/employees/${a.emp.id}/files?kind=doc&doc_type=civil_id&name=id.jpg`, jpg, "image/jpeg");
  assert.equal(up.status, 201);
  await hr.c.post(`/api/files/${up.data.file.id}/apply`, { fields: ["civil_id", "expiry", "dob", "gender", "nationality", "name_en", "name_ar", "passport_no"] });
  let e = (await hr.c.get(`/api/employees/${a.emp.id}`)).data.employee;
  assert.equal(e.name_en, "Shaikha Salim Khalfan Al Hinai");
  assert.equal(e.name_ar, "شيخة سالم خلفان الهنائي");
  // an Arabic name spelled differently by a person is kept (the English spelled in Arabic is only a fallback)
  const b = await makePerson(t.base, admin, { emp_no: "LN2", name_ar: "شيخه سليم الهنائي", join_date: "2022-01-01" });
  const ub = await hr.c.upload(`/api/employees/${b.emp.id}/files?kind=doc&doc_type=civil_id&name=id.jpg`, jpg, "image/jpeg");
  assert.equal(ub.data.read.name_ar, undefined, "no Arabic name offered");
  await hr.c.post(`/api/files/${ub.data.file.id}/apply`, { fields: ["name_en", "name_ar"] });
  e = (await hr.c.get(`/api/employees/${b.emp.id}`)).data.employee;
  assert.equal(e.name_ar, "شيخه سليم الهنائي"); assert.equal(e.name_en, "Shaikha Salim Khalfan Al Hinai");
});

test("Arabic name completed from the English one even with words the list doesn't know (the saved ones are kept)", () => {
  assert.equal(completeArabicName("Shaikha Xyzq Abdallah Al-Qwerty", "شيخة إسحاق الحوقاني"), "شيخة إسحاق عبدالله الحوقاني");
  assert.equal(completeArabicName("Shaikha Salim Khalfan Al Hinai", "شيخة سالم الهنائي"), "شيخة سالم خلفان الهنائي");
  assert.equal(completeArabicName("Shaikha Salim Khalfan Al Hinai", "منى سالم"), null, "doesn't line up: left alone");
  assert.equal(completeArabicName("Shaikha Salim Al Hinai", "شيخة سالم الهنائي"), null, "already complete");
  assert.equal(toArabicName("Shaikha Ishaq Abdallah Al-Hoqani"), "شيخة إسحاق عبدالله الحوقاني");
  assert.equal(arabicNameFrom("سلطنة عمان\nشيخة إسحاق عبدالله الحوقاني", "Shaikha Xyzq Abdallah Al-Qwerty"), "شيخة إسحاق عبدالله الحوقاني", "first name enough to find the line");
  assert.equal(fullPrintedName("SHAIKHA ISHAQ 'ABDALLAH AL-HOQANI", "Shaikha Ishaq Abdal"), "Shaikha Ishaq 'Abdallah Al-Hoqani");
});

test("the Arabic name on the front of a card laid out in columns (read broken over lines around \"الاسم\")", async () => {
  assert.equal(parseArabicName("شيخة إسحاق عبدالله\nالاسم الحوقاني\nالرقم المدني"), "شيخة إسحاق عبدالله الحوقاني");
  assert.equal(parseArabicName("الاسم\nشيخة إسحاق عبدالله\n06\nالحوقاني\nالرقم", "Shaikha Ishaq Abdallah Al-Hoqani"), "شيخة إسحاق عبدالله الحوقاني");
  assert.equal(parseArabicName("شيخة سالم الهنائي :الاسم"), "شيخة سالم الهنائي", "the label read last");
  assert.equal(parseArabicName("الإسم\nشيخة سالم الهنائي"), "شيخة سالم الهنائي", "another spelling of the label");
  const jpg = fs.readFileSync(new URL("./fixtures/fake-id-front.jpg", import.meta.url));
  const a = await makePerson(t.base, admin, { emp_no: "FR1", name_ar: "شيخة الحوقاني", join_date: "2022-01-01" });
  const up = await hr.c.upload(`/api/employees/${a.emp.id}/files?kind=doc&doc_type=civil_id&name=front.jpg`, jpg, "image/jpeg");
  assert.equal(up.data.read.name_ar, "شيخة إسحاق عبدالله الحوقاني");
  await hr.c.post(`/api/files/${up.data.file.id}/apply`, { fields: ["name_ar"] });
  assert.equal((await hr.c.get(`/api/employees/${a.emp.id}`)).data.employee.name_ar, "شيخة إسحاق عبدالله الحوقاني");
});

test("renewing an expired ID: the new one replaces it and updates Personal; the old one is archived, seen only by HR/Admin", async () => {
  const p = await makePerson(t.base, admin, { emp_no: "RN1", name_ar: "قديم", name_en: "Old Name", join_date: "2022-01-01" }, "staff");
  const old = (await p.c.upload(`/api/employees/${p.emp.id}/files?kind=doc&doc_type=civil_id&name=old-id.pdf&expiry=2026-01-31`, Buffer.from("%PDF-1.4"), "application/pdf")).data.file;
  // only an ID, passport or visa of this person, and as the same type
  const cert = (await p.c.upload(`/api/employees/${p.emp.id}/files?kind=doc&doc_type=certificate&name=c.pdf`, Buffer.from("%PDF-1.4"), "application/pdf")).data.file;
  const jpg = fs.readFileSync(new URL("./fixtures/fake-id.jpg", import.meta.url));
  assert.equal((await p.c.upload(`/api/employees/${p.emp.id}/files?kind=doc&doc_type=civil_id&replaces=${cert.id}`, jpg, "image/jpeg")).status, 400);
  assert.equal((await p.c.upload(`/api/employees/${p.emp.id}/files?kind=doc&doc_type=passport&replaces=${old.id}`, jpg, "image/jpeg")).status, 400);
  assert.equal((await other.c.upload(`/api/employees/${other.emp.id}/files?kind=doc&doc_type=civil_id&replaces=${old.id}`, jpg, "image/jpeg")).status, 400);
  const up = await p.c.upload(`/api/employees/${p.emp.id}/files?kind=doc&doc_type=civil_id&name=new-id.jpg&replaces=${old.id}`, jpg, "image/jpeg");
  assert.equal(up.status, 201);
  await p.c.post(`/api/files/${up.data.file.id}/apply`, { fields: ["civil_id", "expiry", "dob", "gender", "nationality", "name_en", "name_ar", "passport_no"] });
  const e = (await p.c.get(`/api/employees/${p.emp.id}`)).data;
  assert.equal(e.employee.name_en, "Sample Person Altest"); assert.equal(e.employee.civil_id_expiry, "2028-05-12"); // Personal updated from the new card
  // the person sees only the new one, and can't open the old one
  assert.deepEqual(e.files.filter((f) => f.doc_type === "civil_id").map((f) => f.id), [up.data.file.id]);
  assert.equal((await p.c.get(`/api/files/${old.id}`)).status, 404);
  // HR sees both, the old one marked archived and pointing at its replacement
  const hf = (await hr.c.get(`/api/employees/${p.emp.id}`)).data.files.find((f) => f.id === old.id);
  assert.ok(hf.archived_at); assert.equal(hf.replaced_by, up.data.file.id);
  assert.equal((await hr.c.get(`/api/files/${old.id}`)).status, 200);
  // the archived copy no longer sends expiry reminders
  assert.ok(!(await hr.c.get("/api/expiring")).data.items.some((x) => x.file && x.file.id === old.id));
  // an archived copy can't be renewed again; deleting the new one brings the old one back
  assert.equal((await p.c.upload(`/api/employees/${p.emp.id}/files?kind=doc&doc_type=civil_id&replaces=${old.id}`, jpg, "image/jpeg")).status, 400);
  assert.equal((await hr.c.del(`/api/files/${up.data.file.id}`)).status, 200);
  assert.ok((await p.c.get(`/api/employees/${p.emp.id}`)).data.files.some((f) => f.id === old.id));
});

test("phone scans: noise after the filler, a dropped space, a misread letter — the name still comes out right", () => {
  // "«" and a stray letter after the "<<<" filler (a phone scanner's text layer) are not a name
  assert.equal(parseMrz("IDOMNA12345678498765432<<<<<<<\n9004034M2805128OMN<<<<<<<<<<<4\nSAMPLE<PERSON<<<<«<<<«<<«<<<X").name_en, "Sample Person");
  // the card's NAME line: same first name, more names; a dropped space split back with the coded names
  assert.equal(fullPrintedName("NAME SAMPLE PERSON ALIEXAMPLE", "Sample Person Ali"), "Sample Person Ali Example");
  // one confused letter (L for I) turned back into the known name — a real L elsewhere stays
  assert.equal(fixConfusedLetters("ALL"), "ALI"); assert.equal(fixConfusedLetters("SALLM"), "SALIM"); assert.equal(fixConfusedLetters("SALIM"), "SALIM");
  assert.equal(fullPrintedName("Name: SAMPLE PERSON ALL EXAMPLE", "Sample Person"), "Sample Person Ali Example");
});

test("Arabic name from cleaned copies of the card: two readings that agree win; no ImageMagick → skipped", async () => {
  const en = "Shaikha Salim Khalfan Al Hinai", good = "الاسم شيخة سالم خلفان الهنائي", typo = "الاسم شيخة سالم خلفان الهتائي";
  const magick = async (args) => { fs.writeFileSync(args.at(-1), "x"); return true; }; // stands in for ImageMagick
  const reader = (texts) => { let i = 0; return async () => texts[i++] ?? ""; };
  // noise, a misread, then the right one twice: the agreed reading
  assert.equal(await arabicFromVariants(Buffer.from("img"), en, { magick, read: reader(["ضجيج", typo, good, good]) }), "شيخة سالم خلفان الهنائي");
  // the first two already agree: no more copies are read
  let calls = 0;
  assert.equal(await arabicFromVariants(Buffer.from("img"), en, { magick: async (a) => { calls++; return magick(a); }, read: reader([good, good, typo]) }), "شيخة سالم خلفان الهنائي");
  assert.equal(calls, 2);
  // none agree: one with as many parts as the English name and the same first name
  assert.equal(await arabicFromVariants(Buffer.from("img"), en, { magick, read: reader(["", typo, "", "", ""]) }), "شيخة سالم خلفان الهتائي");
  // nothing name-like at all
  assert.equal(await arabicFromVariants(Buffer.from("img"), en, { magick, read: reader([]) }), undefined);
  // no ImageMagick on the server
  assert.equal(await arabicFromVariants(Buffer.from("img"), en, { magick: async () => false, read: reader([good]) }), undefined);
  // a photo is turned upright first
  let args0;
  await arabicFromVariants(Buffer.from("img"), en, { photo: true, magick: async (a) => { args0 ||= a; return magick(a); }, read: reader([good, good]) });
  assert.ok(args0.includes("-auto-orient"));
});

test("nationality: every country's 3-letter code on the <<< lines, and the printed NATIONALITY line", () => {
  const td1 = (nat) => parseMrz(`IDOMN12345678<4<<<<<<<<<<<<<<<\n9001011M3001011${nat}<<<<<<<<<<<0\nSAMPLE<<PERSON<<<<<<<<<<<<<<<<`).nationality;
  assert.equal(td1("PSE"), "PS"); assert.equal(td1("LBY"), "LY"); assert.equal(td1("EGY"), "EG");
  assert.equal(parseFront("NAME SAMPLE PERSON\nNATIONALITY PALESTINIAN\n").nationality, "PS");
  assert.equal(parseFront("Nationality: Egyptian").nationality, "EG");
  assert.equal(parseFront("NATIONALITY XQZWV").nationality, undefined, "an unknown word isn't taken");
});

test("photos are sent small where they are shown small; the original for a download; a repeat asks with a tag (304)", async () => {
  const jpg = fs.readFileSync(new URL("./fixtures/fake-id.jpg", import.meta.url));
  const up = await hr.c.upload(`/api/employees/${staff.emp.id}/files?kind=photo&name=face.jpg`, jpg, "image/jpeg");
  const id = up.data.file.id;
  const get = (q, h = {}) => fetch(`${t.base}/api/files/${id}${q}`, { headers: { cookie: hr.c.cookie, ...h } });
  const orig = await get("");
  assert.equal(orig.status, 200); const origLen = Buffer.from(await orig.arrayBuffer()).length;
  assert.match(orig.headers.get("cache-control"), /max-age=86400/);
  const small = await get("?w=96");
  assert.equal(small.status, 200);
  const sb = Buffer.from(await small.arrayBuffer());
  assert.ok(sb.length <= origLen, "the small copy is no bigger than the original");
  assert.equal((await get("?w=96", { "If-None-Match": small.headers.get("etag") })).status, 304);
  assert.notEqual(small.headers.get("etag"), orig.headers.get("etag"));
  // a download is always the original
  assert.equal(Buffer.from(await (await get("?w=96&download=1")).arrayBuffer()).length, origLen);
  // someone who may not see it still can't, small or not
  assert.equal((await fetch(`${t.base}/api/files/${id}?w=96`)).status, 401);
});

test("the name in the <<< lines stops at the filler, even when a scanner read part of it as K / L", () => {
  const td1 = (name) => parseMrz(`IDOMN12345678<4<<<<<<<<<<<<<<<\n9001011F3001011OMN<<<<<<<<<<<0\n${name.padEnd(30, "<").slice(0, 30)}`).name_en;
  assert.equal(td1("SAMPLE<PERSON<TESTA<K<LK<K<<L"), "Sample Person Testa");
  assert.equal(td1("SAMPLE<PERSON<TESTA<K<<<<<K<L"), "Sample Person Testa");
  assert.equal(td1("SAMPLE<PERSON<AL<TEST<<<<<<<<<"), "Sample Person Al Test");
  assert.equal(td1("ALI<IL<TEST"), "Ali Il Test", "a real short name stays");
  // a 600-dpi phone scan of an Omani card: "<KL" right after the family name, and one "K" after "<<" (made-up name)
  assert.equal(td1("SAMPLE<KHALID<ALI<<AL<TESTI<KL"), "Sample Khalid Ali Al Testi");
  assert.equal(td1("SAMPLE<KHALID<ALI<<AL<TESTI<<K"), "Sample Khalid Ali Al Testi");
  const p = parseMrz("P<OMNTESTA<<SAMPLE<PERSON<L<K<LK<K<<<<<<<<<<<<<\nA123456780OMN9001011F3001011<<<<<<<<<<<<<<00");
  assert.equal(p.name_en, "Sample Person Testa");
});

test("an email typed on a phone (spaces, invisible direction marks, capitals) is saved clean; a bad one is refused", async () => {
  const e = await makePerson(t.base, admin, { emp_no: "EM1", name_ar: "بريد", join_date: "2022-01-01" });
  const r = await admin.put(`/api/employees/${e.emp.id}/contact`, { personal_email: " Sample.Person@Gmail.com‏" });
  assert.equal(r.status, 200); assert.equal(r.data.employee.personal_email, "sample.person@gmail.com");
  assert.equal((await admin.put(`/api/employees/${e.emp.id}/contact`, { personal_email: "‎sample＠gmail.com" })).data.employee.personal_email, "sample@gmail.com");
  assert.equal((await admin.put(`/api/employees/${e.emp.id}/contact`, { personal_email: "sample@gmail" })).status, 400);
});

test("today as an expiry date must be confirmed (a phone's date picker fills in today); other dates as before", async () => {
  const e = await makePerson(t.base, admin, { emp_no: "EX1", name_ar: "انتهاء", join_date: "2022-01-01" });
  const today = t.app.ctx.today();
  const a = await admin.put(`/api/employees/${e.emp.id}/identity`, { civil_id_expiry: today });
  assert.equal(a.status, 409); assert.equal(a.data.error, "expiry_today");
  assert.equal((await admin.put(`/api/employees/${e.emp.id}/identity`, { civil_id_expiry: today, confirm_past: true })).status, 200);
  assert.equal((await admin.put(`/api/employees/${e.emp.id}/identity`, { passport_expiry: "2020-01-01" })).status, 200, "an old date: fine");
  const up = await admin.upload(`/api/employees/${e.emp.id}/files?kind=doc&doc_type=visa&name=v.pdf&expiry=${today}`, Buffer.from("%PDF-1.4 v"), "application/pdf");
  assert.equal(up.data.file.expiry, null, "today on upload is left for the person to confirm");
  const f = up.data.file.id;
  assert.equal((await admin.put(`/api/files/${f}`, { expiry: today })).data.error, "expiry_today");
  assert.equal((await admin.put(`/api/files/${f}`, { expiry: today, confirm_past: true })).data.file.expiry, today);
  assert.equal((await admin.put(`/api/files/${f}`, { expiry: "2028-05-01" })).data.file.expiry, "2028-05-01");
});

test("the Arabic name from a PDF's text layer: joined letter shapes, direction marks, «بن», a family name containing «عمان»", () => {
  // made-up name; «خالد» in presentation forms as an iPhone scan stores it, wrapped in direction marks
  const line = "\u202bسالم بن ﺧﺎﻟﺪ بن علي بن حمود النعماني\u202c";
  assert.equal(arabicNameFrom(`سلطنة عمان\n${line}\nLight Vehicle`, "Salim Khalid Ali Al Namani"), "سالم بن خالد بن علي بن حمود النعماني");
  // an unknown first name: two known names in order are enough
  assert.equal(arabicNameFrom("ثمامة بن خالد بن علي النعماني", "Thumama Khalid Ali Al Namani"), "ثمامة بن خالد بن علي النعماني");
  // the card's own labels are still not a name
  assert.equal(arabicNameFrom("سلطنة عمان\nالبطاقة الشخصية", "Salim Khalid"), undefined);
});

test("«Read and update details» on an ID already on file: the person, HR and Admin; nothing is saved until confirmed", async () => {
  const jpg = fs.readFileSync(new URL("./fixtures/fake-id.jpg", import.meta.url));
  const p = await makePerson(t.base, admin, { emp_no: "RD1", name_ar: "اسم", join_date: "2022-01-01" }, "staff");
  const up = await p.c.upload(`/api/employees/${p.emp.id}/files?kind=doc&doc_type=civil_id&name=id.jpg`, jpg, "image/jpeg");
  await admin.put(`/api/employees/${p.emp.id}`, { name_en: "Wrong Name K", dob: "1980-01-01" }); // a mistake on the profile
  const r = await p.c.post(`/api/files/${up.data.file.id}/reread`, {});
  assert.equal(r.status, 200);
  assert.equal(r.data.read.name_en, "Sample Person Altest"); assert.equal(r.data.current.name_en, "Wrong Name K");
  assert.equal((await hr.c.get(`/api/employees/${p.emp.id}`)).data.employee.name_en, "Wrong Name K", "not saved yet");
  assert.equal((await hr.c.post(`/api/files/${up.data.file.id}/reread`, {})).status, 200);
  assert.equal((await admin.post(`/api/files/${up.data.file.id}/reread`, {})).status, 200);
  assert.equal((await other.c.post(`/api/files/${up.data.file.id}/reread`, {})).status, 403);
  // confirming the ticked values saves them
  assert.equal((await p.c.post(`/api/files/${up.data.file.id}/apply`, { fields: ["name_en", "dob"] })).status, 200);
  const e = (await hr.c.get(`/api/employees/${p.emp.id}`)).data.employee;
  assert.equal(e.name_en, "Sample Person Altest"); assert.equal(e.dob, "1990-04-03");
  // a passport offers only its number and expiry; a certificate can't be read
  const pass = await p.c.upload(`/api/employees/${p.emp.id}/files?kind=doc&doc_type=passport&name=p.pdf`, fs.readFileSync(new URL("./fixtures/fake-passport.pdf", import.meta.url)), "application/pdf");
  const rp = await p.c.post(`/api/files/${pass.data.file.id}/reread`, {});
  if (rp.status === 200) assert.deepEqual(Object.keys(rp.data.read).filter((k) => !["verified", "kind"].includes(k)).sort(), ["expiry", "passport_no"]);
  const cert = await p.c.upload(`/api/employees/${p.emp.id}/files?kind=doc&doc_type=certificate&name=c.pdf`, Buffer.from("%PDF-1.4"), "application/pdf");
  assert.equal((await p.c.post(`/api/files/${cert.data.file.id}/reread`, {})).status, 404);
});

test("feedback on a reading: the person or HR reports what was read wrong (with the right value, a comment); one list for HR / Admin", async () => {
  const jpg = fs.readFileSync(new URL("./fixtures/fake-id.jpg", import.meta.url));
  const p = await makePerson(t.base, admin, { emp_no: "FB1", name_ar: "اسم", join_date: "2022-01-01" }, "staff");
  const up = await p.c.upload(`/api/employees/${p.emp.id}/files?kind=doc&doc_type=civil_id&name=id.jpg`, jpg, "image/jpeg");
  const id = up.data.file.id;
  assert.equal((await p.c.post(`/api/files/${id}/feedback`, {})).status, 400, "something to say");
  assert.equal((await other.c.post(`/api/files/${id}/feedback`, { comment: "x" })).status, 403);
  assert.equal((await p.c.post(`/api/files/${id}/feedback`, { items: [{ field: "name_en", correct: "Sample Person Al Test" }, { field: "nope" }], comment: "the family name is cut" })).status, 201);
  assert.equal((await hr.c.post(`/api/files/${id}/feedback`, { comment: "photo is dark" })).status, 201);
  assert.equal((await p.c.get("/api/read-feedback")).status, 403);
  const list = (await hr.c.get("/api/read-feedback")).data.items.filter((x) => x.employee_id === p.emp.id);
  assert.equal(list.length, 2);
  const mine = list.find((x) => x.comment === "the family name is cut");
  assert.deepEqual(mine.items, [{ field: "name_en", read: "Sample Person Altest", correct: "Sample Person Al Test" }], "what it read is kept beside the right value");
  const csv = await (await fetch(`${t.base}/api/read-feedback?format=csv`, { headers: { cookie: admin.cookie } })).text();
  assert.match(csv, /"FB1"/); assert.match(csv, /Sample Person Al Test/);
  assert.equal((await hr.c.post(`/api/read-feedback/${mine.id}/resolve`, {})).status, 200);
  assert.ok(!(await hr.c.get("/api/read-feedback")).data.items.some((x) => x.id === mine.id), "done ones leave the open list");
  assert.ok((await hr.c.get("/api/read-feedback?status=resolved")).data.items.some((x) => x.id === mine.id));
  // the profile itself is not changed by feedback
  assert.notEqual((await hr.c.get(`/api/employees/${p.emp.id}`)).data.employee.name_en, "Sample Person Al Test");
});
