// Check-in verification (Admin): photo, Face ID / fingerprint and location — each on or off for everyone, Default / On /
// Off per person. A check that is on but fails never stops the check-in: it is saved, flagged ⚠️, the manager and HR are
// told, and the manager accepts it or not. Every change is in the activity log.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";

const OFFICE = { lat: 23.588, lng: 58.3829 }, FAR = { lat: 23.6, lng: 58.4 };
const jpg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
let t, admin, hr, mgr, s, field;
const post = (p, kind, q = "", body = jpg) => p.c.upload(`/api/attendance/checkin?kind=${kind}&device=d1${q}`, body, "image/jpeg");
const at = (day, clock) => { t.app.ctx.fakeToday = day; t.app.ctx.fakeClock = clock; };
const loc = (p = OFFICE) => `&lat=${p.lat}&lng=${p.lng}&acc=10`;
const audits = (action) => t.db.prepare("SELECT * FROM audit_log WHERE action=? ORDER BY id").all(action);

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
});
after(async () => { await t.close(); });

test("all on (the default): the screen asks for all three; Admin only may change them; the change is logged", async () => {
  assert.deepEqual((await admin.get("/api/settings")).data.verify, { photo: true, faceid: true, location: true });
  assert.deepEqual((await s.c.get("/api/attendance/checkin/today")).data.verify, { photo: true, faceid: true, location: true });
  assert.equal((await hr.c.put("/api/settings", { verify: { photo: false } })).status, 403);
  assert.equal((await admin.put("/api/settings", { verify: { photo: "no" } })).status, 400);
  assert.equal((await admin.put("/api/settings", { verify: { selfie: true } })).status, 400);
  const n = audits("settings.update").length;
  assert.equal((await admin.put("/api/settings", { verify: { faceid: false } })).status, 200);
  const a = audits("settings.update").slice(n)[0];
  assert.ok(a && a.actor_user_id && a.at, "who and when");
  assert.equal(JSON.parse(a.before).verify.faceid, true); assert.equal(JSON.parse(a.after).verify.faceid, false);
  assert.equal((await admin.get("/api/settings")).data.faceid_mode, "off", "the older Face ID setting follows");
});

test("a check-in with every check passing: not flagged; the record keeps which checks were used (📷 📍)", async () => {
  at("2026-11-01", "08:50");
  const r = await post(s, "in", loc());
  assert.equal(r.status, 201); assert.deepEqual(r.data.checkin.flags, []);
  assert.deepEqual(r.data.checkin.checks, { photo: true, faceid: false, location: true });
});

test("failed GPS (no location) and outside every site: allowed, flagged, the manager and HR told with the distance", async () => {
  at("2026-11-01", "17:30");
  const r = await post(s, "out", ""); // the phone gave no location
  assert.equal(r.status, 201); assert.deepEqual(r.data.checkin.flags.map((f) => f.code), ["no_location"]); assert.equal(r.data.checkin.checks.location, false);
  at("2026-11-02", "08:52");
  const o = await post(s, "in", loc(FAR) + "&reason=" + encodeURIComponent("زيارة عميل"));
  assert.equal(o.status, 201); assert.equal(o.data.checkin.flags[0].code, "outside");
  const title = (p) => t.db.prepare("SELECT title_en FROM notifications WHERE user_id=? AND title_en LIKE '%Salim checked in 08:52%'").get(p.user.id);
  assert.match(title(mgr).title_en, /^⚠️ Salim checked in 08:52 — outside work site \(\d+(\.\d)? km away\)$/);
  assert.ok(title(hr), "HR too"); assert.ok(!title(field), "not a colleague");
});

test("no photo, or a photo the page measured as almost black: allowed and flagged", async () => {
  at("2026-11-02", "17:20");
  const r = await s.c.upload(`/api/attendance/checkin?kind=out${loc()}`, Buffer.alloc(0), "image/jpeg");
  assert.equal(r.status, 201); assert.deepEqual(r.data.checkin.flags.map((f) => f.code), ["no_photo"]); assert.equal(r.data.checkin.checks.photo, false);
  at("2026-11-03", "08:40");
  const d = await post(s, "in", loc() + "&photo_dark=1");
  assert.deepEqual(d.data.checkin.flags.map((f) => f.code), ["photo_unclear"]);
});

test("all off: nothing is asked, nothing is flagged, no photo or location is kept", async () => {
  await admin.put("/api/settings", { verify: { photo: false, faceid: false, location: false } });
  assert.deepEqual((await s.c.get("/api/attendance/checkin/today")).data.verify, { photo: false, faceid: false, location: false });
  at("2026-11-03", "17:00");
  const r = await s.c.upload("/api/attendance/checkin?kind=out", Buffer.alloc(0), "image/jpeg");
  assert.equal(r.status, 201); assert.deepEqual(r.data.checkin.flags, []);
  const row = t.db.prepare("SELECT lat, photo_file_id, flag_status FROM att_checkins WHERE id=?").get(r.data.checkin.id);
  assert.deepEqual([row.lat, row.photo_file_id, row.flag_status], [null, null, null]);
  await admin.put("/api/settings", { verify: { photo: true, faceid: false, location: true } });
});

test("per person: Default / On / Off — location Off for field staff; HR or Admin set it (logged); the person can't", async () => {
  assert.equal((await field.c.put(`/api/employees/${field.emp.id}`, { verify_location: "off" })).status, 403);
  assert.equal((await hr.c.put(`/api/employees/${field.emp.id}`, { verify_location: "sometimes" })).status, 400);
  assert.equal((await hr.c.put(`/api/employees/${field.emp.id}`, { verify_location: "off", verify_photo: "default" })).status, 200);
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE entity='employee' AND entity_id=? AND after LIKE '%verify_location%'").get(String(field.emp.id)) ||
    t.db.prepare("SELECT 1 FROM audit_log WHERE entity_id=? AND after LIKE '%verify_location%'").get(field.emp.id), "logged");
  assert.deepEqual((await field.c.get("/api/attendance/checkin/today")).data.verify, { photo: true, faceid: false, location: false });
  at("2026-11-04", "09:00");
  const r = await post(field, "in", ""); // a field visit: no location asked, so not flagged
  assert.equal(r.status, 201); assert.deepEqual(r.data.checkin.flags, []);
  // On for one person while the company has it off: Face ID for Salim
  await hr.c.put(`/api/employees/${s.emp.id}`, { verify_faceid: "on" });
  assert.equal((await s.c.get("/api/webauthn/status")).data.needed, true);
  at("2026-11-04", "08:45");
  assert.deepEqual((await post(s, "in", loc())).data.checkin.flags.map((f) => f.code), ["faceid_failed"]);
  await hr.c.put(`/api/employees/${s.emp.id}`, { verify_faceid: null });
  assert.equal((await s.c.get("/api/webauthn/status")).data.needed, false, "back to the company's switch");
});

test("the manager marks a flag Accepted or Not accepted (comment optional, logged); Not accepted no longer counts", async () => {
  const items = (await mgr.c.get("/api/attendance/checkins/pending")).data.items;
  assert.ok(items.length >= 4 && items.every((c) => c.flags.length));
  const out1 = items.find((c) => c.flags.some((f) => f.code === "no_location"));
  const unclear = items.find((c) => c.flags.some((f) => f.code === "photo_unclear"));
  assert.equal((await s.c.post(`/api/attendance/checkins/${out1.id}/approve`, {})).status, 403, "not one's own");
  assert.equal((await mgr.c.post(`/api/attendance/checkins/${out1.id}/approve`, {})).status, 200, "no comment needed");
  assert.equal((await mgr.c.post(`/api/attendance/checkins/${unclear.id}/reject`, { note: "الصورة سوداء" })).status, 200);
  assert.equal(audits("checkin.flag_accept").length, 1); assert.equal(audits("checkin.flag_reject").length, 1);
  at("2026-11-08", "10:00");
  const d = (await mgr.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-11`)).data;
  const day3 = d.days.find((x) => x.date === "2026-11-03");
  assert.equal(day3.in, null, "the not-accepted arrival doesn't count"); assert.equal(day3.checkins[0].flag_status, "rejected"); assert.equal(day3.checkins[0].flag_note, "الصورة سوداء");
  assert.equal(d.days.find((x) => x.date === "2026-11-01").checkins[1].flag_status, "accepted");
});

test("flagged count on the employee page, the staff summary and the monthly report; checks off are noted", async () => {
  const d = (await mgr.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-11`)).data;
  assert.equal(d.summary.flagged, 5); // no location, outside, no photo, dark photo, Face ID
  const rep = (await hr.c.get("/api/attendance/report?from=2026-11-01&to=2026-11-30")).data;
  assert.equal(rep.people.find((p) => p.employee.id === s.emp.id).flagged, 5);
  assert.equal(rep.people.find((p) => p.employee.id === field.emp.id).flagged, 0);
  const csv = String((await hr.c.get("/api/attendance/report?from=2026-11-01&to=2026-11-30&format=csv")).data);
  assert.match(csv, /Flagged check-ins/);
  const M = (await hr.c.get("/api/attendance/monthly?month=2026-11")).data;
  const f = M.people.find((p) => p.employee.id === field.emp.id), me = M.people.find((p) => p.employee.id === s.emp.id);
  assert.deepEqual(f.checksOff, ["faceid", "location"]); assert.deepEqual(f.verify, { photo: true, faceid: false, location: false });
  assert.ok(me.days.find((x) => x.date === "2026-11-02").flags[0].flags[0].code === "outside");
  assert.equal(M.total.flagged, 5);
});

test("a direct manager (not a department approver) opens the attendance report: only their own people", async () => {
  const r = await mgr.c.get("/api/attendance/report?from=2026-11-01&to=2026-11-30");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.people.map((p) => p.employee.id).sort(), [s.emp.id, field.emp.id].sort());
  assert.equal(r.data.total.flagged, 5);
  assert.equal((await s.c.get("/api/attendance/report?from=2026-11-01&to=2026-11-30")).status, 403, "staff");
});
