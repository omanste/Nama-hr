// Fixes from the second independent review (6cc85a7..c09a800)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";

let t, admin, hr, hr2, mgr, dep, man, woman;
const days = (n) => n * 480;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-10-26" });
  admin = await adminClient(t.base);
  const d = (await admin.post("/api/departments", { name_ar: "المبيعات" })).data.department;
  mgr = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "مدير", join_date: "2020-01-01", department_id: d.id, opening_days: 30 }, "staff");
  dep = await makePerson(t.base, admin, { emp_no: "D1", name_ar: "نائب", join_date: "2020-01-01", department_id: d.id }, "staff");
  await admin.put(`/api/departments/${d.id}`, { approver_employee_id: mgr.emp.id });
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01", opening_days: 30 }, "hr");
  hr2 = await makePerson(t.base, admin, { emp_no: "H2", name_ar: "موارد ٢", join_date: "2020-01-01" }, "hr");
  man = await makePerson(t.base, admin, { emp_no: "A1", name_ar: "رجل", gender: "male", nationality: "Omani", join_date: "2021-01-01", department_id: d.id, opening_days: 40 }, "staff");
  woman = await makePerson(t.base, admin, { emp_no: "B1", name_ar: "امرأة", gender: "female", nationality: "Omani", join_date: "2021-01-01", department_id: d.id, opening_days: 40 }, "staff");
  await admin.put("/api/settings", { official_holidays: [{ date: "2026-11-18", name: "x" }, { date: "2026-11-19", name: "x" }] });
});
after(async () => { await t.close(); });
const remaining = async (id) => (await hr2.c.get(`/api/employees/${id}`)).data.leave.remaining;

test("bereavement relation must be one of the listed ones (no inherited object keys)", async () => {
  for (const rel of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
    const r = await man.c.post("/api/requests", { type: "bereavement", relation: rel, event_date: "2026-11-01", start: "2026-11-01", end: "2027-03-01" });
    assert.equal(r.status, 400, rel);
  }
});

test("postponing moves the deputy cover and recounts days against holidays", async () => {
  const r = await mgr.c.post("/api/requests", { type: "annual", start: "2026-11-16", end: "2026-11-20", deputy_user_id: dep.user.id });
  assert.equal(r.data.request.minutes, days(3));
  const before = await remaining(mgr.emp.id);
  const p = await admin.post(`/api/requests/${r.data.request.id}/postpone`, { start: "2026-12-01" });
  assert.equal(p.status, 200);
  assert.equal(p.data.request.minutes, days(5), "no holidays in the new dates");
  assert.equal(await remaining(mgr.emp.id), before - days(5));
  const cover = (await admin.get("/api/cover")).data.items.find((c) => c.request_id === r.data.request.id);
  assert.equal(cover.start_date, "2026-12-01"); assert.equal(cover.end_date, "2026-12-05");
});

test("nobody decides their own balance review or cashes out their own leave", async () => {
  const doc = await hr.c.upload(`/api/employees/${hr.emp.id}/files?kind=doc&doc_type=consent&name=c.pdf`, Buffer.from("%PDF-1.4 c"), "application/pdf");
  assert.equal((await hr.c.post(`/api/employees/${hr.emp.id}/encash`, { days: 1, consent_file_id: doc.data.file.id })).status, 403);
  assert.equal((await hr.c.post(`/api/employees/${hr.emp.id}/adjust`, { minutes: 480, note: "x" })).status, 403);
  assert.equal((await hr2.c.post(`/api/employees/${hr.emp.id}/encash`, { days: 1, consent_file_id: doc.data.file.id })).status, 200);
  t.db.prepare("INSERT INTO cap_reviews(employee_id,year_start,excess,created_at) VALUES(?,?,?,?)").run(hr.emp.id, "2026-01-01", 480, new Date().toISOString());
  const rv = (await hr.c.get("/api/cap-reviews?status=pending")).data.items.find((x) => x.employee_id === hr.emp.id);
  assert.equal((await hr.c.post(`/api/cap-reviews/${rv.id}`, { decision: "keep", reason: "x" })).status, 403);
  assert.equal((await hr2.c.post(`/api/cap-reviews/${rv.id}`, { decision: "keep", reason: "x" })).status, 200);
});

test("a consent document pays out once", async () => {
  const doc = await hr.c.upload(`/api/employees/${man.emp.id}/files?kind=doc&doc_type=consent&name=c.pdf`, Buffer.from("%PDF-1.4 c"), "application/pdf");
  assert.equal((await hr.c.post(`/api/employees/${man.emp.id}/encash`, { days: 2, consent_file_id: doc.data.file.id })).status, 200);
  const again = await hr.c.post(`/api/employees/${man.emp.id}/encash`, { days: 2, consent_file_id: doc.data.file.id });
  assert.equal(again.status, 409); assert.equal(again.data.error, "consent_used");
  const p = (await hr2.c.get(`/api/employees/${man.emp.id}`)).data.leave;
  assert.equal(p.encashed, days(2), "cash payments show in the breakdown");
});

test("per-event limits: bereavement per death, paternity/maternity per birth, child care per child", async () => {
  assert.equal((await man.c.post("/api/requests", { type: "bereavement", relation: "father", start: "2027-01-01", end: "2027-01-02" })).data.error, "invalid", "date of death required");
  assert.equal((await man.c.post("/api/requests", { type: "bereavement", relation: "father", event_date: "2027-01-01", start: "2027-01-01", end: "2027-01-02" })).status, 201);
  assert.equal((await man.c.post("/api/requests", { type: "bereavement", relation: "father", event_date: "2027-01-01", start: "2027-01-03", end: "2027-01-04" })).data.error, "too_long");
  assert.equal((await man.c.post("/api/requests", { type: "bereavement", relation: "mother", event_date: "2026-12-30", start: "2027-01-05", end: "2027-01-05" })).data.error, "outside_window", "starts at the death, not days later");
  assert.equal((await man.c.post("/api/requests", { type: "paternity", event_date: "2027-02-01", start: "2027-02-01", end: "2027-02-07" })).status, 201);
  assert.equal((await man.c.post("/api/requests", { type: "paternity", event_date: "2027-02-02", start: "2027-02-08", end: "2027-02-14" })).data.error, "already_taken", "another birth a day later");
  assert.equal((await woman.c.post("/api/requests", { type: "maternity", event_date: "2027-03-01", start: "2027-06-01", end: "2027-06-10" })).data.error, "outside_window", "can't start months after the birth");
  assert.equal((await woman.c.post("/api/requests", { type: "childcare", event_date: "2026-01-01", start: "2028-01-01", end: "2028-12-30" })).status, 201);
  assert.equal((await woman.c.post("/api/requests", { type: "childcare", event_date: "2026-01-01", start: "2029-01-01", end: "2029-01-05" })).data.error, "too_long", "a year per child in total");
});

test("yearly limits count the days inside each calendar year", async () => {
  assert.equal((await man.c.post("/api/requests", { type: "sick", start: "2027-12-01", end: "2028-05-30" })).status, 201);
  const r = await man.c.post("/api/requests", { type: "sick", start: "2028-06-01", end: "2028-11-29" });
  assert.equal(r.data.error, "year_limit", "152 days of 2028 already requested");
});

test("a deputy can open the proof they are asked to approve; requests stay with the real approver after cover ends", async () => {
  const s = await man.c.post("/api/requests", { type: "sick", start: "2026-10-20", end: "2026-10-21" });
  const f = await man.c.upload(`/api/requests/${s.data.request.id}/files?name=m.pdf`, Buffer.from("%PDF-1.4 m"), "application/pdf");
  const cover = await mgr.c.post("/api/cover", { deputy_user_id: dep.user.id, start: "2026-10-20", end: "2026-10-30" });
  const got = await fetch(`${t.base}/api/files/${f.data.file.id}`, { headers: { cookie: dep.c.cookie } });
  assert.equal(got.status, 200);
  const fresh = await woman.c.post("/api/requests", { type: "annual", start: "2027-04-01", end: "2027-04-01" });
  assert.equal(fresh.data.request.approver_user_id, mgr.user.id, "stored approver stays the manager");
  assert.equal(fresh.data.request.route_reason, "cover");
  assert.ok((await dep.c.get("/api/requests?scope=approvals")).data.items.some((x) => x.id === fresh.data.request.id));
  await mgr.c.del(`/api/cover/${cover.data.cover.id}`);
  assert.ok((await mgr.c.get("/api/requests?scope=approvals")).data.items.some((x) => x.id === fresh.data.request.id));
  assert.equal((await dep.c.post(`/api/requests/${fresh.data.request.id}/approve`, {})).status, 403);
  assert.equal((await mgr.c.post(`/api/requests/${fresh.data.request.id}/approve`, {})).status, 200);
});

test("the cover created with an approver's own leave can't be deleted while that leave stands (Admin can)", async () => {
  const r = await mgr.c.post("/api/requests", { type: "annual", start: "2027-05-01", end: "2027-05-02", deputy_user_id: dep.user.id });
  const c = (await mgr.c.get("/api/cover")).data.items.find((x) => x.request_id === r.data.request.id);
  assert.equal((await mgr.c.del(`/api/cover/${c.id}`)).status, 409);
  assert.equal((await admin.del(`/api/cover/${c.id}`)).status, 200);
});

test("settings refuse Ramadan dates in the wrong order", async () => {
  assert.equal((await admin.put("/api/settings", { ramadan_start: "2027-03-09", ramadan_end: "2027-02-08" })).status, 400);
});
