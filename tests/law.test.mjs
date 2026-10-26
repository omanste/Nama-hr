// Oman Labour Law (Royal Decree 53/2023) rules — see docs/compliance/oman-labour-law-2023-check.md
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { runAnniversaries } from "../server/jobs.mjs";
import { sickPayBands, earlyMinutes, BEREAVEMENT_DAYS } from "../server/leave.mjs";

let t, admin, hr, mgr, man, woman, junior, expat;
const days = (n) => n * 480;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-10-26" });
  admin = await adminClient(t.base);
  const dept = (await admin.post("/api/departments", { name_ar: "المبيعات", name_en: "Sales" })).data.department;
  mgr = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "مدير", join_date: "2020-01-01", department_id: dept.id }, "staff");
  await admin.put(`/api/departments/${dept.id}`, { approver_employee_id: mgr.emp.id });
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  man = await makePerson(t.base, admin, { emp_no: "A1", name_ar: "رجل", gender: "male", nationality: "Omani", join_date: "2022-01-10", department_id: dept.id, opening_days: 20 }, "staff");
  woman = await makePerson(t.base, admin, { emp_no: "B1", name_ar: "امرأة", gender: "female", nationality: "عمانية", join_date: "2022-01-10", department_id: dept.id, opening_days: 20 }, "staff");
  junior = await makePerson(t.base, admin, { emp_no: "C1", name_ar: "جديد", gender: "male", nationality: "Omani", join_date: "2026-06-01", department_id: dept.id }, "staff");
  expat = await makePerson(t.base, admin, { emp_no: "D1", name_ar: "وافد", gender: "male", nationality: "Indian", join_date: "2021-01-01", department_id: dept.id }, "staff");
});
after(async () => { await t.close(); });
const remaining = async (id) => (await hr.c.get(`/api/employees/${id}`)).data.leave.remaining;
const ask = (p, body) => p.c.post("/api/requests", body);
const proof = (p, id) => p.c.upload(`/api/requests/${id}/files?name=proof.pdf`, Buffer.from("%PDF-1.4 proof"), "application/pdf");

test("pure rules: sick pay bands, early-leave hours to a given day end, bereavement days", () => {
  assert.deepEqual(sickPayBands(0, 25), { 100: 21, 75: 4, 50: 0, 35: 0 });
  assert.deepEqual(sickPayBands(30, 50), { 100: 0, 75: 5, 50: 35, 35: 10 });
  assert.equal(earlyMinutes("13:30", 15 * 60), 90);
  assert.throws(() => earlyMinutes("15:00", 15 * 60), RangeError);
  assert.equal(BEREAVEMENT_DAYS.wife, 10); assert.equal(BEREAVEMENT_DAYS.father, 3); assert.equal(BEREAVEMENT_DAYS.uncle, 2);
  assert.equal(BEREAVEMENT_DAYS.husband_muslim, 130); assert.equal(BEREAVEMENT_DAYS.husband_other, 14);
});

test("early leave is recorded in hours and never touches the annual balance", async () => {
  const before = await remaining(man.emp.id);
  const r = await ask(man, { type: "early", date: "2026-11-02", time: "15:30" });
  assert.equal(r.status, 201); assert.equal(r.data.request.minutes, 90);
  assert.equal((await mgr.c.post(`/api/requests/${r.data.request.id}/approve`, {})).status, 200);
  assert.equal(await remaining(man.emp.id), before);
  const j = await ask(junior, { type: "early", date: "2026-11-02", time: "16:00" });
  assert.equal(j.status, 201, "early leave is not annual leave, so the 6-month rule does not apply");
});

test("Ramadan hours: early leave is measured to the Ramadan end of day", async () => {
  assert.equal((await admin.put("/api/settings", { ramadan_start: "2027-02-08", ramadan_end: "2027-03-09", ramadan_day_end: "15:00" })).status, 200);
  const r = await ask(man, { type: "early", date: "2027-02-15", time: "13:30" });
  assert.equal(r.status, 201); assert.equal(r.data.request.minutes, 90);
  assert.equal((await ask(man, { type: "early", date: "2027-02-16", time: "16:00" })).status, 400);
});

test("marriage: 3 days, once in the whole service, proof before approval", async () => {
  assert.equal((await ask(man, { type: "marriage", start: "2026-12-01", end: "2026-12-04" })).data.error, "too_long");
  const r = await ask(man, { type: "marriage", start: "2026-12-01", end: "2026-12-03" });
  assert.equal(r.status, 201);
  const a = await mgr.c.post(`/api/requests/${r.data.request.id}/approve`, {});
  assert.equal(a.status, 409); assert.equal(a.data.error, "proof_required");
  assert.equal((await proof(man, r.data.request.id)).status, 201);
  assert.equal((await mgr.c.post(`/api/requests/${r.data.request.id}/approve`, {})).status, 200);
  assert.equal((await ask(man, { type: "marriage", start: "2027-05-01", end: "2027-05-01" })).data.error, "already_taken");
});

test("paternity: men only, up to 7 days, before the child is 98 days old", async () => {
  assert.equal((await ask(woman, { type: "paternity", start: "2026-11-10", end: "2026-11-11", event_date: "2026-11-09" })).data.error, "not_entitled");
  assert.equal((await ask(man, { type: "paternity", start: "2026-11-10", end: "2026-11-17", event_date: "2026-11-09" })).data.error, "too_long");
  assert.equal((await ask(man, { type: "paternity", start: "2027-02-20", end: "2027-02-21", event_date: "2026-11-09" })).data.error, "outside_window");
  assert.equal((await ask(man, { type: "paternity", start: "2026-11-10", end: "2026-11-16", event_date: "2026-11-09" })).status, 201);
});

test("maternity: women only, 98 days, at most 14 before the birth", async () => {
  assert.equal((await ask(woman, { type: "maternity", start: "2027-01-01", end: "2027-01-20", event_date: "2027-01-20" })).data.error, "outside_window");
  assert.equal((await ask(woman, { type: "maternity", start: "2027-01-10", end: "2027-04-20", event_date: "2027-01-20" })).data.error, "too_long");
  assert.equal((await ask(woman, { type: "maternity", start: "2027-01-10", end: "2027-04-17", event_date: "2027-01-20" })).status, 201);
});

test("bereavement: days depend on the relation; the widow's leave is for women", async () => {
  assert.equal((await ask(man, { type: "bereavement", start: "2027-06-01", end: "2027-06-04", relation: "father" })).data.error, "too_long");
  assert.equal((await ask(man, { type: "bereavement", start: "2027-06-01", end: "2027-06-03", relation: "father" })).status, 201);
  assert.equal((await ask(man, { type: "bereavement", start: "2027-06-10", end: "2027-06-10" })).data.error, "invalid");
  assert.equal((await ask(man, { type: "bereavement", start: "2027-06-10", end: "2027-06-20", relation: "husband_muslim" })).data.error, "not_entitled");
  assert.equal((await ask(woman, { type: "bereavement", start: "2027-06-01", end: "2027-10-08", relation: "husband_muslim" })).status, 201);
});

test("Hajj: 15 days once, after a continuous year of service", async () => {
  assert.equal((await ask(junior, { type: "hajj", start: "2027-05-20", end: "2027-06-03" })).data.error, "not_eligible_yet");
  assert.equal((await ask(expat, { type: "hajj", start: "2027-05-20", end: "2027-06-04" })).data.error, "too_long");
  assert.equal((await ask(expat, { type: "hajj", start: "2027-05-20", end: "2027-06-03" })).status, 201);
  assert.equal((await ask(expat, { type: "hajj", start: "2028-05-20", end: "2028-05-21" })).data.error, "already_taken");
});

test("exam and patient-care leave: Omani staff only, 15 days a year each", async () => {
  assert.equal((await ask(expat, { type: "exam", start: "2027-01-05", end: "2027-01-06" })).data.error, "not_entitled");
  assert.equal((await ask(man, { type: "exam", start: "2027-01-05", end: "2027-01-14" })).status, 201);
  assert.equal((await ask(man, { type: "exam", start: "2027-03-01", end: "2027-03-06" })).data.error, "year_limit");
  assert.equal((await ask(man, { type: "patient_care", start: "2027-08-01", end: "2027-08-02" })).data.error, "invalid"); // relation required
  assert.equal((await ask(man, { type: "patient_care", start: "2027-08-01", end: "2027-08-02", relation: "الوالدة" })).status, 201);
});

test("sick leave: medical certificate before approval, 182 days a year, pay bands shown", async () => {
  const r = await ask(expat, { type: "sick", start: "2026-10-01", end: "2026-10-25" });
  assert.equal(r.status, 201);
  assert.equal((await mgr.c.post(`/api/requests/${r.data.request.id}/approve`, {})).data.error, "proof_required");
  await proof(expat, r.data.request.id);
  assert.equal((await mgr.c.post(`/api/requests/${r.data.request.id}/approve`, {})).status, 200);
  const d = await hr.c.get(`/api/requests/${r.data.request.id}`);
  assert.deepEqual(d.data.sickPay, { 100: 21, 75: 4, 50: 0, 35: 0 });
  assert.equal((await ask(expat, { type: "sick", start: "2026-02-01", end: "2026-07-31" })).data.error, "year_limit");
});

test("unpaid child-care leave is for women; special unpaid leave for anyone", async () => {
  assert.equal((await ask(man, { type: "childcare", start: "2028-01-01", end: "2028-02-01" })).data.error, "not_entitled");
  assert.equal((await ask(woman, { type: "childcare", start: "2028-01-01", end: "2028-02-01" })).status, 201);
  assert.equal((await ask(expat, { type: "unpaid", start: "2028-03-01", end: "2028-03-10" })).status, 201);
});

test("over the cap at an anniversary: HR reviews instead of an automatic forfeit", async () => {
  t.app.ctx.fakeToday = "2026-10-26";
  const e = (await hr.c.post("/api/employees", { emp_no: "K1", name_ar: "رصيد كبير", join_date: "2019-11-01", opening_days: 50 })).data.employee;
  const comp = (await hr.c.post("/api/employees", { emp_no: "K2", name_ar: "أيام عطلة", join_date: "2019-11-01", opening_days: 28 })).data.employee;
  t.db.prepare("INSERT INTO leave_ledger(employee_id,kind,minutes,leave_year_start,effective_date,note,created_at) VALUES(?, 'comp_credit', ?, '2025-11-01', '2026-10-01', 'test', ?)").run(comp.id, days(5), new Date().toISOString());
  runAnniversaries(t.app.ctx, "2026-11-01");
  assert.equal(await remaining(e.id), days(80), "nothing forfeited automatically");
  assert.equal(await remaining(comp.id), days(63), "holiday-work days are outside the cap");
  const list = await hr.c.get("/api/cap-reviews?status=pending");
  const rv = list.data.items.find((x) => x.employee_id === e.id);
  assert.equal(rv.excess, days(20));
  assert.ok(!list.data.items.some((x) => x.employee_id === comp.id));
  assert.ok((await hr.c.get("/api/me")).data.pendingCapReviews >= 1);
  assert.equal((await man.c.get("/api/me")).data.pendingCapReviews, 0);
  assert.equal((await man.c.post(`/api/cap-reviews/${rv.id}`, { decision: "forfeit", reason: "x" })).status, 403);
  assert.equal((await hr.c.post(`/api/cap-reviews/${rv.id}`, { decision: "forfeit" })).status, 400);
  assert.equal((await hr.c.post(`/api/cap-reviews/${rv.id}`, { decision: "forfeit", reason: "لم تؤجل لمصلحة العمل" })).status, 200);
  assert.equal(await remaining(e.id), days(60));
  assert.equal((await hr.c.post(`/api/cap-reviews/${rv.id}`, { decision: "keep", reason: "again" })).status, 409);
  runAnniversaries(t.app.ctx, "2026-11-01");
  assert.equal((await hr.c.get("/api/cap-reviews?status=pending")).data.items.filter((x) => x.employee_id === e.id).length, 0);
});

test("keeping the excess for work needs records the decision and keeps the days", async () => {
  const e = (await hr.c.post("/api/employees", { emp_no: "K3", name_ar: "مصلحة العمل", join_date: "2019-11-01", opening_days: 45 })).data.employee;
  runAnniversaries(t.app.ctx, "2026-11-01");
  const rv = (await hr.c.get("/api/cap-reviews?status=pending")).data.items.find((x) => x.employee_id === e.id);
  assert.equal((await hr.c.post(`/api/cap-reviews/${rv.id}`, { decision: "keep", reason: "أجلت الإجازة لمصلحة العمل" })).status, 200);
  assert.equal(await remaining(e.id), days(75));
  assert.equal((await hr.c.get("/api/cap-reviews?status=kept")).data.items.find((x) => x.id === rv.id).reason, "أجلت الإجازة لمصلحة العمل");
});

test("the employer may postpone annual leave by up to 6 months; postponing approves the new dates", async () => {
  const r = await ask(man, { type: "annual", start: "2026-12-10", end: "2026-12-12" });
  assert.equal((await mgr.c.post(`/api/requests/${r.data.request.id}/postpone`, { start: "2027-07-01", comment: "x" })).data.error, "too_late");
  assert.equal((await man.c.post(`/api/requests/${r.data.request.id}/postpone`, { start: "2027-01-20" })).status, 403);
  const p = await mgr.c.post(`/api/requests/${r.data.request.id}/postpone`, { start: "2027-01-20", comment: "ضغط العمل" });
  assert.equal(p.status, 200);
  assert.equal(p.data.request.status, "approved");
  assert.equal(p.data.request.start_date, "2027-01-20"); assert.equal(p.data.request.end_date, "2027-01-22");
  const ev = (await man.c.get(`/api/requests/${r.data.request.id}`)).data.events.map((x) => x.action);
  assert.deepEqual(ev, ["submitted", "postponed"]);
});

test("cash for unused leave needs the employee's written consent on file", async () => {
  const before = await remaining(woman.emp.id);
  assert.equal((await hr.c.post(`/api/employees/${woman.emp.id}/encash`, { days: 5 })).data.error, "consent_required");
  const doc = await hr.c.upload(`/api/employees/${woman.emp.id}/files?kind=doc&doc_type=consent&name=consent.pdf`, Buffer.from("%PDF-1.4 consent"), "application/pdf");
  assert.equal(doc.status, 201);
  assert.equal((await hr.c.post(`/api/employees/${woman.emp.id}/encash`, { days: 500, consent_file_id: doc.data.file.id })).data.error, "insufficient_balance");
  const r = await hr.c.post(`/api/employees/${woman.emp.id}/encash`, { days: 5, consent_file_id: doc.data.file.id });
  assert.equal(r.status, 200);
  assert.equal(await remaining(woman.emp.id), before - days(5));
  assert.equal((await man.c.post(`/api/employees/${woman.emp.id}/encash`, { days: 1, consent_file_id: doc.data.file.id })).status, 403);
});

test("staff list flags anyone who has not taken 30 days of annual leave in 2 years", async () => {
  const items = (await hr.c.get("/api/employees")).data.items;
  const m = items.find((x) => x.emp_no === "M1");
  assert.equal(m.under_30_in_2y, true);
  const j = items.find((x) => x.emp_no === "C1");
  assert.equal(j.under_30_in_2y, false, "less than 2 years of service");
});

test("gender is validated", async () => {
  assert.equal((await hr.c.put(`/api/employees/${man.emp.id}`, { gender: "x" })).data.field, "gender");
  assert.equal((await hr.c.put(`/api/employees/${man.emp.id}`, { gender: "male" })).status, 200);
});
