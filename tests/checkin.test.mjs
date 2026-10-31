// Online check-in / check-out: notice, location, a live photo, work sites, the 15-minute grace, who sees what, retention.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { computeDay } from "../server/attendance.mjs";
import { metres, siteOf, runCheckinRetention } from "../server/checkin.mjs";

// made-up places: an office and a point about 2 km away
const OFFICE = { lat: 23.588, lng: 58.3829 }, FAR = { lat: 23.6, lng: 58.4 };
const jpg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
let t, admin, hr, mgr, s, other, con, ceo, dept;
const ci = (p, kind, at = OFFICE, extra = "") => p.c.upload(`/api/attendance/checkin?kind=${kind}&lat=${at.lat}&lng=${at.lng}&acc=12&device=dev-1${extra}`, jpg, "image/jpeg");

before(async () => {
  t = await boot({ FAKE_TODAY: "2026-11-02" }); // a Monday
  admin = await adminClient(t.base);
  dept = (await admin.post("/api/departments", { name_ar: "المبيعات", name_en: "Sales" })).data.department;
  mgr = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "مدير", join_date: "2020-01-01", department_id: dept.id }, "manager");
  await admin.put(`/api/departments/${dept.id}`, { approver_employee_id: mgr.emp.id });
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  s = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف", join_date: "2022-01-01", department_id: dept.id, shift: 2 }, "staff");
  other = await makePerson(t.base, admin, { emp_no: "S2", name_ar: "زميل", join_date: "2022-01-01", department_id: dept.id }, "staff");
  con = await makePerson(t.base, admin, { emp_no: "CN1", name_ar: "مستشار", join_date: "2026-10-01", contract_end: "2099-01-01" }, "staff");
  await admin.put(`/api/users/${con.user.id}`, { role: "consultant" });
  ceo = await makePerson(t.base, admin, { emp_no: "C1", name_ar: "الرئيس التنفيذي", join_date: "2015-01-01" }, "ceo");
  await admin.put("/api/settings", { managers_approver_employee_id: ceo.emp.id });
});
after(async () => { await t.close(); });

test("the grace: arriving within 15 minutes is on time; after it, lateness counts from the shift start; leaving early stays early", () => {
  const day = (inn, out) => computeDay({ shift: { start: 540, end: 1080 }, covered: true, rest: false, holiday: false, leave: null, pending: false, punches: [inn, out], excused: [], missions: [], correction: null, grace: 15 });
  assert.equal(day(555, 1080).late, 0, "09:15");
  assert.equal(day(556, 1080).late, 16, "09:16");
  assert.equal(day(560, 1080).late, 20, "09:20");
  assert.equal(day(540, 1050).early, 30, "left 17:30");
});

test("distance and work sites", () => {
  assert.ok(Math.abs(metres(OFFICE, FAR) - 2500) < 400);
  const sites = [{ id: "s-office", name_en: "Office", ...OFFICE, radius_m: 150 }];
  assert.equal(siteOf(sites, { lat: OFFICE.lat + 0.0005, lng: OFFICE.lng }).inside.id, "s-office");
  const far = siteOf(sites, FAR);
  assert.equal(far.inside, null); assert.equal(far.nearest.id, "s-office"); assert.ok(far.distance > 2000);
});

test("Settings: work sites and the grace are validated (Admin only)", async () => {
  assert.equal((await hr.c.put("/api/settings", { late_grace_min: 10 })).status, 403);
  assert.equal((await admin.put("/api/settings", { late_grace_min: 90 })).status, 400);
  assert.equal((await admin.put("/api/settings", { att_sites: [{ name_en: "X", lat: 200, lng: 0, radius_m: 100 }] })).status, 400);
  assert.equal((await admin.put("/api/settings", { att_sites: [{ name_en: "X", lat: 1, lng: 1, radius_m: 5 }] })).status, 400);
  const r = await admin.put("/api/settings", { att_sites: [{ name_ar: "المكتب الرئيسي", name_en: "Head office", ...OFFICE, radius_m: 150 }], late_grace_min: 15 });
  assert.equal(r.status, 200); assert.equal(r.data.att_sites.length, 1); assert.ok(r.data.att_sites[0].id);
});

test("check-in: notice first, then location and a photo; inside the site; the server keeps the time", async () => {
  let st = (await s.c.get("/api/attendance/checkin/today")).data;
  assert.equal(st.enabled, true); assert.equal(st.consent, false); assert.equal(st.next, "in");
  assert.equal((await ci(s, "in")).status, 409, "the notice comes first");
  assert.equal((await s.c.post("/api/attendance/checkin/consent", {})).status, 200);
  assert.equal((await s.c.upload("/api/attendance/checkin?kind=in&device=x", jpg, "image/jpeg")).status, 400, "no location");
  assert.equal((await s.c.upload(`/api/attendance/checkin?kind=in&lat=${OFFICE.lat}&lng=${OFFICE.lng}`, Buffer.from("%PDF-1.4"), "application/pdf")).status, 415, "a photo, not a file");
  t.app.ctx.fakeClock = "09:12";
  const r = await ci(s, "in");
  assert.equal(r.status, 201); assert.equal(r.data.checkin.at, "2026-11-02 09:12"); assert.equal(r.data.checkin.outside, false);
  st = (await s.c.get("/api/attendance/checkin/today")).data;
  assert.equal(st.next, "out"); assert.equal(st.items[0].site.name_en, "Head office");
});

test("check-out outside every site needs a reason and the manager's approval; it counts only once approved", async () => {
  t.app.ctx.fakeClock = "16:40";
  const r1 = await ci(s, "out", FAR);
  assert.equal(r1.status, 400); assert.equal(r1.data.field, "reason"); assert.equal(r1.data.outside, true); assert.equal(r1.data.nearest.name_en, "Head office");
  const r2 = await ci(s, "out", FAR, "&reason=" + encodeURIComponent("زيارة موقع عميل"));
  assert.equal(r2.status, 201); assert.equal(r2.data.checkin.outside, true); assert.equal(r2.data.checkin.approval, "pending");
  assert.ok((await mgr.c.get("/api/notifications")).data.items.some((n) => /outside the work sites awaiting your approval/.test(n.title_en)));
  // waiting: the check-out doesn't count yet (the arrival does)
  let day = (await s.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-11`)).data.days.find((x) => x.date === "2026-11-02");
  assert.equal(day.status, "missing"); assert.equal(day.checkins[1].approval, "pending");
  // who may decide: the manager (or HR/Admin), not a colleague, not the person
  const pend = (await mgr.c.get("/api/attendance/checkins/pending")).data.items;
  assert.equal(pend.length, 1); assert.equal(pend[0].nearest.name_en, "Head office");
  assert.equal((await other.c.get("/api/attendance/checkins/pending")).data.items.length, 0);
  assert.equal((await s.c.post(`/api/attendance/checkins/${pend[0].id}/approve`, {})).status, 403);
  assert.equal((await other.c.post(`/api/attendance/checkins/${pend[0].id}/approve`, {})).status, 403);
  assert.ok((await mgr.c.get("/api/me")).data.pendingCheckins >= 1);
  assert.equal((await mgr.c.post(`/api/attendance/checkins/${pend[0].id}/reject`, {})).status, 400, "a reason to reject");
  assert.equal((await mgr.c.post(`/api/attendance/checkins/${pend[0].id}/approve`, {})).status, 200);
  assert.equal((await mgr.c.post(`/api/attendance/checkins/${pend[0].id}/approve`, {})).status, 409);
  assert.ok((await s.c.get("/api/notifications")).data.items.some((n) => /was approved/.test(n.title_en)));
});

test("a rejected check-in outside the sites doesn't count", async () => {
  t.app.ctx.fakeClock = "09:05";
  const c = await other.c.post("/api/attendance/checkin/consent", {});
  assert.equal(c.status, 200);
  const r = await ci(other, "in", FAR, "&reason=x");
  assert.equal((await mgr.c.post(`/api/attendance/checkins/${r.data.checkin.id}/reject`, { note: "ليس في مهمة" })).status, 200);
  const day = (await hr.c.get(`/api/attendance/employee/${other.emp.id}?month=2026-11`)).data.days.find((x) => x.date === "2026-11-02");
  assert.equal(day.in, null); assert.equal(day.checkins[0].approval, "rejected"); assert.equal(day.checkins[0].decision_note, "ليس في مهمة");
});

test("Settings: a Google Maps link (or coordinates) gives the site's location — Admin only, Google hosts only", async () => {
  t.app.ctx.fetchImpl = async (u) => ({ headers: { get: (k) => (k === "location" ? "https://www.google.com/maps/place/HQ/@23.58,58.38,17z/data=!3d23.5881!4d58.3829" : null) }, text: async () => "" });
  assert.deepEqual((await admin.post("/api/settings/map-link", { link: "https://maps.app.goo.gl/madeup123" })).data, { lat: 23.5881, lng: 58.3829 });
  assert.deepEqual((await admin.post("/api/settings/map-link", { link: "23.5, 58.4" })).data, { lat: 23.5, lng: 58.4 });
  assert.equal((await admin.post("/api/settings/map-link", { link: "https://example.com/x" })).status, 400);
  assert.equal((await hr.c.post("/api/settings/map-link", { link: "23.5, 58.4" })).status, 403);
});

test("the monthly sheet: online check-ins are the day's punches (in within the grace, out early), with site, photo and map", async () => {
  const d = (await mgr.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-11`)).data;
  const day = d.days.find((x) => x.date === "2026-11-02");
  assert.equal(day.status, "present"); assert.equal(day.in, 552); assert.equal(day.out, 1000);
  assert.equal(day.late, 0, "09:12 is within the 15-minute grace"); assert.equal(day.early, 80, "left at 16:40");
  assert.equal(day.checkins.length, 2);
  assert.equal(day.checkins[0].site_en, "Head office"); assert.equal(day.checkins[1].outside, true); assert.equal(day.checkins[1].reason, "زيارة موقع عميل");
  assert.ok(day.checkins[0].photo_file_id && day.checkins[0].lat);
  // the report counts the day outside the sites
  const rep = (await hr.c.get("/api/attendance/report?from=2026-11-01&to=2026-11-02")).data;
  assert.equal(rep.people.find((p) => p.employee.id === s.emp.id).outside, 1);
  // the photo: the person, their manager and HR — not a colleague, not the consultant
  const id = day.checkins[0].photo_file_id;
  for (const [c, code] of [[s.c, 200], [mgr.c, 200], [hr.c, 200], [other.c, 403], [con.c, 403]]) assert.equal((await c.get(`/api/files/${id}`)).status, code);
  // and it never shows up among the person's documents
  assert.ok(!(await hr.c.get(`/api/employees/${s.emp.id}`)).data.files.some((f) => f.id === id));
});

test("not for the CEO (outside the policy) or someone on the fingerprint machine only", async () => {
  assert.equal((await ceo.c.get("/api/attendance/checkin/today")).data.enabled, false);
  assert.equal((await ceo.c.post("/api/attendance/checkin/consent", {})).status, 403);
  await admin.put(`/api/employees/${other.emp.id}`, { att_mode: "machine" });
  assert.equal((await other.c.get("/api/attendance/checkin/today")).data.why, "machine_only");
  assert.equal((await admin.put(`/api/employees/${other.emp.id}`, { att_mode: "pigeon" })).status, 400);
});

test("retention: photos go after 90 days, locations after 12 months", async () => {
  const db = t.app.ctx.db;
  const c = db.prepare("SELECT * FROM att_checkins WHERE employee_id=? ORDER BY id LIMIT 1").get(s.emp.id);
  const file = path.join(t.app.ctx.dataDir, "uploads", String(c.photo_file_id));
  assert.ok(fs.existsSync(file));
  assert.deepEqual(runCheckinRetention(t.app.ctx, "2026-12-01"), { photos: 0, locations: 0 });
  const r = runCheckinRetention(t.app.ctx, "2027-02-15"); // 105 days later
  assert.equal(r.photos, 3); assert.equal(r.locations, 0);
  assert.equal(fs.existsSync(file), false);
  assert.equal(db.prepare("SELECT photo_file_id p, lat FROM att_checkins WHERE id=?").get(c.id).p, null);
  assert.equal(runCheckinRetention(t.app.ctx, "2027-11-10").locations, 3);
  assert.equal(db.prepare("SELECT lat FROM att_checkins WHERE id=?").get(c.id).lat, null);
  // the times stay: the day still counts
  const day = (await hr.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-11`)).data.days.find((x) => x.date === "2026-11-02");
  assert.equal(day.status, "present");
});

test("every sign-in is logged; the browser adds its location; HR sees a person's sign-ins", async () => {
  const { login } = await import("./helpers.mjs");
  const c = await login(t.base, "s1", "Passw0rd!" + s.emp.id);
  assert.equal((await c.post("/api/me/login-location", { lat: 999, lng: 0 })).status, 400);
  assert.equal((await c.post("/api/me/login-location", { lat: OFFICE.lat, lng: OFFICE.lng, acc: 30 })).data.ok, true);
  const items = (await hr.c.get(`/api/employees/${s.emp.id}/logins`)).data.items;
  assert.ok(items.length >= 2); assert.equal(items[0].lat, OFFICE.lat); assert.equal(items[0].accuracy_m, 30); assert.ok(items[0].ip);
  assert.equal((await mgr.c.get(`/api/employees/${s.emp.id}/logins`)).status, 403);
  assert.equal((await s.c.get(`/api/employees/${s.emp.id}/logins`)).status, 403);
});
