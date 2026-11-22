// Check-in verification: location first (required), then Face ID / fingerprint, a photo only when Face ID fails (or is
// off), else the punch is saved Unverified. Admin sets the switches (company and per person); the server decides the
// method and the flags; the manager accepts (counts) or rejects (a missing punch). Every change is in the activity log.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { phone } from "./fake-phone.mjs";

const OFFICE = { lat: 23.588, lng: 58.3829 }, FAR = { lat: 23.6, lng: 58.4 };
const jpg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
let t, admin, hr, mgr, s, field, ph;
const post = (p, kind, q = "", body = jpg) => p.c.upload(`/api/attendance/checkin?kind=${kind}&device=d1${q}`, body, "image/jpeg");
const at = (day, clock) => { t.app.ctx.fakeToday = day; t.app.ctx.fakeClock = clock; };
const loc = (p = OFFICE) => `&lat=${p.lat}&lng=${p.lng}&acc=10`;
const codes = (r) => r.data.checkin.flags.map((f) => f.code);
const audits = (action) => t.db.prepare("SELECT * FROM audit_log WHERE action=? ORDER BY id").all(action);
const titles = (p, re) => t.db.prepare("SELECT title_en FROM notifications WHERE user_id=?").all(p.user.id).map((n) => n.title_en).filter((x) => re.test(x));
const faceOk = async (p, device) => { const o = (await p.c.post("/api/webauthn/verify/options", {})).data; assert.equal((await p.c.post("/api/webauthn/verify", device.get(o, t.base))).status, 200); };

before(async () => {
  t = await boot({ FAKE_TODAY: "2026-11-01", FACEID_MODE_DEFAULT: "required" });
  admin = await adminClient(t.base);
  await admin.put("/api/settings", { att_sites: [{ name_ar: "المكتب", name_en: "Office", lat: OFFICE.lat, lng: OFFICE.lng, radius_m: 200 }] });
  const d = (await admin.post("/api/departments", { name_ar: "المبيعات", name_en: "Sales" })).data.department;
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  mgr = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "مدير", join_date: "2020-01-01", department_id: d.id }, "manager");
  s = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "سالم", name_en: "Salim", join_date: "2022-01-01", department_id: d.id, manager_employee_id: mgr.emp.id }, "staff");
  field = await makePerson(t.base, admin, { emp_no: "F1", name_ar: "ميداني", name_en: "Field", join_date: "2022-01-01", department_id: d.id, manager_employee_id: mgr.emp.id }, "staff");
  for (const p of [s, field]) await p.c.post("/api/attendance/checkin/consent", {});
  // Salim's phone is registered for Face ID
  ph = phone();
  const o = (await s.c.post("/api/webauthn/register/options", {})).data;
  await s.c.post("/api/webauthn/register/verify", ph.create(o, t.base));
});
after(async () => { await t.close(); });

test("Admin's switches: all three on by default; Admin only; each change logged (who, what, when)", async () => {
  assert.deepEqual((await admin.get("/api/settings")).data.verify, { photo: true, faceid: true, location: true });
  assert.deepEqual((await s.c.get("/api/attendance/checkin/today")).data.verify, { photo: true, faceid: true, location: true });
  assert.equal((await hr.c.put("/api/settings", { verify: { photo: false } })).status, 403);
  assert.equal((await admin.put("/api/settings", { verify: { photo: "no" } })).status, 400);
  const n = audits("settings.update").length;
  assert.equal((await admin.put("/api/settings", { verify: { photo: false } })).status, 200);
  const a = audits("settings.update").slice(n)[0];
  assert.ok(a.actor_user_id && a.at); assert.equal(JSON.parse(a.before).verify.photo, true); assert.equal(JSON.parse(a.after).verify.photo, false);
  await admin.put("/api/settings", { verify: { photo: true } });
});

test("location first: no check-in (nor the pre-check) without it", async () => {
  at("2026-11-01", "08:40");
  const r = await post(s, "in", "");
  assert.equal(r.status, 400); assert.equal(r.data.error, "location_required");
  assert.equal((await s.c.get("/api/attendance/checkin/check?kind=in")).data.error, "location_required");
  assert.equal(t.db.prepare("SELECT count(*) n FROM att_checkins").get().n, 0);
});

test("all passing: inside a site + Face ID → verified, no photo kept, nothing flagged", async () => {
  await faceOk(s, ph);
  const r = await post(s, "in", loc());
  assert.equal(r.status, 201); assert.deepEqual(codes(r), []);
  assert.deepEqual(r.data.checkin.checks, { photo: false, faceid: true, location: true });
  assert.equal(t.db.prepare("SELECT photo_file_id, verified FROM att_checkins WHERE id=?").get(r.data.checkin.id).photo_file_id, null);
});

test("a page can't mark a punch verified itself: only the server's Face ID check counts", async () => {
  at("2026-11-01", "17:00");
  const r = await post(s, "out", loc() + "&verified=1&faceid=1&checks=%7B%22faceid%22%3Atrue%7D");
  assert.deepEqual(codes(r), ["faceid_failed_photo"]); assert.equal(r.data.checkin.checks.faceid, false);
});

test("outside a work site: saved, flagged with the distance; the manager and HR told", async () => {
  at("2026-11-02", "08:52");
  await faceOk(s, ph);
  const r = await post(s, "in", loc(FAR) + "&reason=" + encodeURIComponent("زيارة عميل"));
  assert.equal(r.status, 201); assert.deepEqual(codes(r), ["outside"]); assert.ok(r.data.checkin.flags[0].km > 1);
  assert.equal(titles(mgr, /Salim checked in 08:52/)[0].replace(/\d+(\.\d)? km/, "N km"), "⚠️ Salim checked in 08:52 — outside work site (N km away)");
  assert.equal(titles(hr, /Salim checked in 08:52/).length, 1); assert.equal(titles(field, /Salim/).length, 0, "not a colleague");
});

test("Face ID failed → the photo: saved with it, flagged 'Face ID failed — photo taken'", async () => {
  at("2026-11-02", "17:10");
  const r = await post(s, "out", loc());
  assert.deepEqual(codes(r), ["faceid_failed_photo"]); assert.equal(r.data.checkin.checks.photo, true);
  assert.ok(t.db.prepare("SELECT photo_file_id FROM att_checkins WHERE id=?").get(r.data.checkin.id).photo_file_id);
  assert.equal(titles(mgr, /Salim checked out 17:10 — Face ID failed — photo taken/).length, 1);
});

test("the photo failed too (none, or a poor one after the retries) → Unverified, with time and location", async () => {
  at("2026-11-03", "08:40");
  const r = await post(s, "in", loc(), Buffer.alloc(0));
  assert.equal(r.status, 201); assert.deepEqual(codes(r), ["unverified"]);
  assert.equal(r.data.checkin.checks.unverified, true); assert.equal(r.data.checkin.checks.location, true);
  assert.equal(titles(mgr, /^⚠️ Salim — unverified check-in 08:40$/).length, 1);
  at("2026-11-03", "17:05");
  const bad = await post(s, "out", loc() + "&photo_bad=1");
  assert.deepEqual(codes(bad), ["unverified"]);
  assert.ok(t.db.prepare("SELECT photo_file_id FROM att_checkins WHERE id=?").get(bad.data.checkin.id).photo_file_id, "the poor photo is kept for the manager");
});

test("all off: nothing asked, nothing flagged, no location or photo kept", async () => {
  await admin.put("/api/settings", { verify: { photo: false, faceid: false, location: false } });
  at("2026-11-04", "08:45");
  const r = await post(s, "in", "", Buffer.alloc(0));
  assert.equal(r.status, 201); assert.deepEqual(codes(r), []);
  const row = t.db.prepare("SELECT lat, photo_file_id FROM att_checkins WHERE id=?").get(r.data.checkin.id);
  assert.deepEqual([row.lat, row.photo_file_id], [null, null]);
  await admin.put("/api/settings", { verify: { photo: true, faceid: true, location: true } });
});

test("per person (Admin only, logged): location Off for field staff; Face ID Off → the photo is the check", async () => {
  assert.equal((await hr.c.put(`/api/employees/${field.emp.id}`, { verify_location: "off" })).status, 403, "HR can't");
  assert.equal((await admin.put(`/api/employees/${field.emp.id}`, { verify_location: "sometimes" })).status, 400);
  assert.equal((await admin.put(`/api/employees/${field.emp.id}`, { verify_location: "off", verify_faceid: "off" })).status, 200);
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE action='employee.update' AND after LIKE '%\"verify_location\":\"off\"%'").get(), "logged");
  assert.deepEqual((await field.c.get("/api/attendance/checkin/today")).data.verify, { photo: true, faceid: false, location: false });
  at("2026-11-04", "09:00");
  const r = await post(field, "in", "");
  assert.equal(r.status, 201); assert.deepEqual(codes(r), [], "photo taken, no location asked"); assert.equal(r.data.checkin.checks.photo, true);
  assert.deepEqual(codes(await post(field, "out", "", Buffer.alloc(0))), ["unverified"], "Face ID off, no photo");
  // On for one person while the company has it off
  await admin.put("/api/settings", { verify: { faceid: false } });
  assert.equal((await s.c.get("/api/webauthn/status")).data.needed, false);
  await admin.put(`/api/employees/${s.emp.id}`, { verify_faceid: "on" });
  assert.equal((await s.c.get("/api/webauthn/status")).data.needed, true);
  await admin.put(`/api/employees/${s.emp.id}`, { verify_faceid: null });
  await admin.put("/api/settings", { verify: { faceid: true } });
});

test("the manager: Accepted counts; Rejected counts as a missing punch; comment optional; logged", async () => {
  const items = (await mgr.c.get("/api/attendance/checkins/pending")).data.items;
  const outside = items.find((c) => c.flags.some((f) => f.code === "outside"));
  const unv = items.find((c) => c.at === "2026-11-03 08:40");
  const unvOut = items.find((c) => c.at === "2026-11-03 17:05");
  assert.equal((await s.c.post(`/api/attendance/checkins/${outside.id}/approve`, {})).status, 403, "not one's own");
  assert.equal((await mgr.c.post(`/api/attendance/checkins/${outside.id}/approve`, {})).status, 200, "no comment needed");
  assert.equal((await mgr.c.post(`/api/attendance/checkins/${unv.id}/reject`, { note: "لا صورة" })).status, 200);
  assert.equal((await mgr.c.post(`/api/attendance/checkins/${unvOut.id}/reject`, {})).status, 200);
  assert.ok(audits("checkin.flag_accept").length >= 1 && audits("checkin.flag_reject").length === 2);
  at("2026-11-08", "10:00");
  const d = (await mgr.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-11`)).data;
  const day = (x) => d.days.find((y) => y.date === x);
  assert.equal(day("2026-11-02").in, 8 * 60 + 52, "accepted: counts");
  assert.equal(day("2026-11-03").status, "missing", "both punches rejected: a missing punch, not an absence");
  assert.equal(day("2026-11-03").checkins[0].flag_status, "rejected"); assert.equal(day("2026-11-03").checkins[0].flag_note, "لا صورة");
  assert.ok((await s.c.get("/api/notifications")).data.items.some((n) => /flagged check-in was not accepted|was rejected/i.test(n.title_en)));
});

test("counts on the employee page, the staff summary, the monthly report and the CSV; checks off noted", async () => {
  const d = (await mgr.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-11`)).data;
  assert.equal(d.summary.flagged, 5); assert.equal(d.summary.unverified, 2);
  const rep = (await hr.c.get("/api/attendance/report?from=2026-11-01&to=2026-11-30")).data;
  const me = rep.people.find((p) => p.employee.id === s.emp.id), f = rep.people.find((p) => p.employee.id === field.emp.id);
  assert.deepEqual([me.flagged, me.unverified, f.flagged, f.unverified], [5, 2, 1, 1]);
  assert.match(String((await hr.c.get("/api/attendance/report?from=2026-11-01&to=2026-11-30&format=csv")).data), /Flagged check-ins,Unverified check-ins/);
  const M = (await hr.c.get("/api/attendance/monthly?month=2026-11")).data;
  assert.deepEqual(M.people.find((p) => p.employee.id === field.emp.id).checksOff, ["faceid", "location"]);
  assert.equal(M.total.unverified, 3);
  assert.ok(M.people.find((p) => p.employee.id === s.emp.id).days.find((x) => x.date === "2026-11-03").flags.every((x) => x.status === "rejected"));
  // a direct manager (not a department approver) opens the report: their own people only
  const R = (await mgr.c.get("/api/attendance/report?from=2026-11-01&to=2026-11-30")).data;
  assert.deepEqual(R.people.map((p) => p.employee.id).sort(), [s.emp.id, field.emp.id].sort());
});
