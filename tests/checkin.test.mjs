// Online check-in / check-out: notice, location, a live photo, work sites, the 15-minute grace, who sees what, retention.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { computeDay } from "../server/attendance.mjs";
import { metres, siteOf, runCheckinRetention, runReminders } from "../server/checkin.mjs";
import { overtimePay } from "../server/overtime.mjs";

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

test("overtime pay splits daytime and night hours; rest days and holidays are all at the night rate; after-hours time per day", () => {
  const R = { day: 1.25, night: 1.5, night_start: "21:00" };
  const p = overtimePay({ start_date: "2026-11-03", early_time: "18:00", end_time: "22:00" }, R, new Set());
  assert.deepEqual([p.day_min, p.night_min, p.paid_min, p.off_day], [180, 60, 315, false]);
  const fri = overtimePay({ start_date: "2026-11-06", early_time: "10:00", end_time: "12:00" }, R, new Set());
  assert.deepEqual([fri.night_min, fri.paid_min, fri.off_day], [120, 180, true]);
  assert.equal(overtimePay({ start_date: "2026-11-03", early_time: "18:00", end_time: "19:00" }, R, new Set(["2026-11-03"])).off_day, true);
  const day = (punches, extra = {}) => computeDay({ shift: { start: 540, end: 1080 }, covered: true, rest: false, holiday: false, leave: null, pending: false, punches, excused: [], missions: [], correction: null, grace: 15, ...extra });
  assert.equal(day([540, 1170]).after, 90, "left 19:30");
  assert.equal(day([540, 1080]).after, undefined, "left on time");
  assert.equal(day([600, 840], { rest: true }).after, 240, "a rest day: all of it");
});

test("online check-ins keep their own label: a check-out minutes after the check-in is still both, never one guessed punch", () => {
  const day = (o) => computeDay({ shift: { start: 540, end: 1080 }, covered: true, rest: false, holiday: false, leave: null, pending: false, punches: [], excused: [], missions: [], correction: null, grace: 15, ...o });
  // 14:00 in, 14:05 out (a test): both kept, 5 minutes on site, late and left early — not "check-in missing"
  const a = day({ onlineIn: 840, onlineOut: 845 });
  assert.equal(a.status, "present"); assert.equal(a.in, 840); assert.equal(a.out, 845); assert.equal(a.onSite, 5);
  assert.equal(a.late, 300); assert.equal(a.early, 235);
  // only an online arrival: the leaving is missing
  const b = day({ onlineIn: 545 });
  assert.equal(b.status, "missing"); assert.equal(b.missing, "out"); assert.equal(b.late, 0);
  // only an online leaving in the morning still counts as the leaving
  assert.equal(day({ onlineOut: 600 }).missing, "in");
  // with the machine: the earliest arrival and the latest leaving of both
  const c = day({ punches: [550, 1000], onlineIn: 545, onlineOut: 1085 });
  assert.equal(c.in, 545); assert.equal(c.out, 1085); assert.equal(c.early, 0);
  // a lone afternoon machine punch before the online arrival isn't taken as the leaving
  const d = day({ punches: [820], onlineIn: 830, onlineOut: 1080 });
  assert.equal(d.in, 820); assert.equal(d.out, 1080);
});

test("today isn't judged before the shift ends: not yet, then on duty; absent or missing only once it's over", () => {
  const day = (o) => computeDay({ shift: { start: 540, end: 1080 }, covered: true, rest: false, holiday: false, leave: null, pending: false, punches: [], excused: [], missions: [], correction: null, grace: 15, ...o });
  assert.equal(day({ now: 480 }).status, "today", "07:00, nobody in yet");
  assert.equal(day({ now: 700 }).status, "today", "11:40, still not called absent");
  assert.equal(day({ now: 1090 }).status, "absent", "after the shift");
  const on = day({ now: 700, onlineIn: 570 });
  assert.equal(on.status, "on_duty"); assert.equal(on.late, 30); assert.equal(on.missing, null);
  assert.equal(day({ now: 1090, onlineIn: 570 }).status, "missing", "the day is over and no leaving");
  assert.equal(day({ now: 900, onlineIn: 545, onlineOut: 880 }).status, "present", "left early today: shown at once");
  assert.equal(day({ now: 600 }).status, "today"); assert.equal(day({}).status, "absent", "past days as before");
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
  // waiting: the check-out doesn't count yet (the arrival does) — read after the shift has ended
  t.app.ctx.fakeClock = "23:30";
  let day = (await s.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-11`)).data.days.find((x) => x.date === "2026-11-02");
  assert.equal(day.status, "pending", "waiting for the manager, not a missing punch"); assert.equal(day.missing, "out"); assert.equal(day.checkins[1].approval, "pending");
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
  t.app.ctx.fakeClock = "23:30"; // the day is over when it is read
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

test("the online check-in log: one line per person per day, first in / last out, with place and approval; CSV too", async () => {
  const r = await hr.c.get("/api/attendance/checkins?from=2026-11-01&to=2026-11-02");
  assert.equal(r.status, 200);
  const row = r.data.rows.find((x) => x.employee.id === s.emp.id && x.date === "2026-11-02");
  assert.equal(row.in.time, "09:12"); assert.equal(row.in.site.name_en, "Head office"); assert.equal(row.in.outside, false);
  assert.equal(row.out.time, "16:40"); assert.equal(row.out.outside, true); assert.equal(row.out.reason, "زيارة موقع عميل"); assert.equal(row.out.approval, "approved");
  assert.equal(row.minutes, 448); assert.ok(row.in.photo_file_id && row.in.lat);
  // filters: by person, by department
  assert.ok((await hr.c.get(`/api/attendance/checkins?from=2026-11-01&to=2026-11-02&emp=${other.emp.id}`)).data.rows.every((x) => x.employee.id === other.emp.id));
  // the manager sees their department; a staff member can't open it
  assert.ok((await mgr.c.get("/api/attendance/checkins?from=2026-11-01&to=2026-11-02")).data.rows.some((x) => x.employee.id === s.emp.id));
  assert.equal((await s.c.get("/api/attendance/checkins")).status, 403);
  assert.equal((await hr.c.get("/api/attendance/checkins?from=2026-11-05&to=2026-11-01")).status, 400);
  // the CSV
  const csv = await hr.c.get("/api/attendance/checkins?from=2026-11-01&to=2026-11-02&format=csv");
  assert.equal(csv.status, 200);
  const lines = String(csv.data).replace(/^\ufeff/, "").split("\r\n");
  assert.match(lines[0], /^Date,Employee ID/);
  assert.ok(lines.some((l) => l.includes('"S1"') && l.includes('"09:12"') && l.includes("Outside the work sites")));
});

test("separate reports: fingerprint only, online check-ins only, or both", async () => {
  const sheet = async (src) => (await mgr.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-11${src ? `&source=${src}` : ""}`)).data;
  const day = (d) => d.days.find((x) => x.date === "2026-11-02");
  // online only: the day is counted from the check-ins (in 09:12 within the grace, out 16:40 early)
  const on = await sheet("online");
  assert.equal(on.source, "online"); assert.equal(day(on).status, "present"); assert.equal(day(on).early, 80); assert.ok(day(on).checkins);
  // fingerprint only: no machine data for this person, so nothing is counted and the check-ins aren't shown
  const fp = await sheet("machine");
  assert.equal(day(fp).status, "no_data"); assert.equal(day(fp).checkins, undefined);
  assert.equal(fp.summary.workDays, 0);
  // both (the default) matches the online view here
  assert.equal(day(await sheet()).status, "present");
  // the report: the person appears from the online source, not from the fingerprint one
  const rep = async (src) => (await hr.c.get(`/api/attendance/report?from=2026-11-01&to=2026-11-02&source=${src}`)).data;
  const ro = await rep("online"), rm = await rep("machine");
  assert.equal(ro.source, "online"); assert.ok(ro.people.some((p) => p.employee.id === s.emp.id && p.early === 1));
  assert.ok(!rm.people.some((p) => p.employee.id === s.emp.id));
  // an unknown source falls back to both
  assert.equal((await rep("other")).source, "all");
  const csv = await hr.c.get("/api/attendance/report?from=2026-11-01&to=2026-11-02&source=online&format=csv");
  assert.equal(csv.status, 200);
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

test("leaving after hours: a reason; the extra time goes to the manager (who may adjust the end), then HR confirms; \"still working\"", async () => {
  const w = await makePerson(t.base, admin, { emp_no: "OT1", name_ar: "إضافي", join_date: "2022-01-01", department_id: dept.id, shift: 2 }, "staff");
  await w.c.post("/api/attendance/checkin/consent", {});
  const day = "2026-11-03"; // a Tuesday
  t.app.ctx.fakeToday = day;
  t.app.ctx.fakeClock = "08:55"; assert.equal((await ci(w, "in")).status, 201);
  // 18:20 (shift 2 ends 18:00): within 30 minutes — no question
  // 18:45: the card offers "I'm still working"
  t.app.ctx.fakeClock = "18:45";
  let st = (await w.c.get("/api/attendance/checkin/today")).data;
  assert.equal(st.after_hours, true); assert.equal(st.shift_end, "18:00"); assert.equal(st.staying, null);
  assert.equal((await w.c.post("/api/attendance/checkin/stay", {})).status, 400, "a reason is needed");
  assert.equal((await w.c.post("/api/attendance/checkin/stay", { reason: "إغلاق تقرير المشروع" })).status, 200);
  assert.equal((await w.c.get("/api/attendance/checkin/today")).data.staying.reason, "إغلاق تقرير المشروع");
  // checking out at 21:10: the open request gets its end (no second question)
  t.app.ctx.fakeClock = "21:10";
  const out = await ci(w, "out");
  assert.equal(out.status, 201); assert.ok(out.data.extra);
  let r = t.db.prepare("SELECT * FROM leave_requests WHERE employee_id=? AND type='overtime'").get(w.emp.id);
  assert.equal(r.early_time, "18:00"); assert.equal(r.end_time, "21:10"); assert.equal(r.minutes, 190); assert.equal(r.status, "pending");
  // the manager approves it, ending it at 19:30
  assert.equal((await w.c.post("/api/requests", { type: "overtime", date: day })).status, 400, "not filed by hand");
  const a = await mgr.c.post(`/api/requests/${r.id}/approve`, { end_time: "19:30" });
  assert.equal(a.status, 200); assert.equal(a.data.request.status, "approved"); assert.equal(a.data.request.minutes, 90);
  // HR confirms (adjusting to 19:45)
  assert.equal((await hr.c.post(`/api/requests/${r.id}/hr`, { class: "confirmed", end_time: "19:45" })).status, 200);
  r = t.db.prepare("SELECT * FROM leave_requests WHERE id=?").get(r.id);
  assert.equal(r.hr_class, "confirmed"); assert.equal(r.minutes, 105);
  // the sheet and the report show the approved extra time
  t.app.ctx.fakeClock = "23:59";
  const sheet = (await hr.c.get(`/api/attendance/employee/${w.emp.id}?month=2026-11&source=online`)).data;
  assert.equal(sheet.days.find((x) => x.date === day).extra, 105); assert.equal(sheet.summary.extraMin, 105);
  // time after the official end is shown each day and totalled (21:10 − 18:00), whatever was approved
  assert.equal(sheet.days.find((x) => x.date === day).after, 190); assert.equal(sheet.summary.afterMin, 190); assert.equal(sheet.summary.afterDays, 1);
  const rep = (await hr.c.get(`/api/attendance/report?from=${day}&to=${day}&source=online`)).data;
  assert.equal(rep.total.afterMin, 190);
  // overtime pay: HR's multipliers are kept at confirmation; Accounts see the paid hours
  assert.deepEqual(JSON.parse(r.details).ot_rates, { day: 1.25, night: 1.5, night_start: "21:00" });
  assert.equal((await w.c.get("/api/reports/overtime?month=2026-11")).status, 403);
  assert.equal((await mgr.c.put("/api/settings/overtime", { overtime_rate_day: 2 })).status, 403);
  assert.equal((await hr.c.put("/api/settings/overtime", { overtime_rate_day: 0.5 })).status, 400);
  assert.equal((await hr.c.put("/api/settings/overtime", { overtime_rate_day: 1.5, overtime_night_start: "20:00" })).status, 200);
  const ot = (await hr.c.get("/api/reports/overtime?month=2026-11")).data;
  const row = ot.rows.find((x) => x.id === r.id);
  assert.equal(row.minutes, 105); assert.equal(row.day_min, 105); assert.equal(row.night_min, 0); assert.equal(row.paid_min, 131, "105 × 1.25, the rate it was confirmed at");
  assert.equal(ot.rates.overtime_rate_day, 1.5);
  const csvText = await (await fetch(`${t.base}/api/reports/overtime?month=2026-11&format=csv`, { headers: { cookie: hr.c.cookie } })).text();
  assert.match(csvText, /OT1/); assert.match(csvText, /2\.18/);
  await hr.c.put("/api/settings/overtime", { overtime_rate_day: 1.25, overtime_night_start: "21:00" });
  // another day: leaving at 19:00 without having said anything — asked why, then filed
  const day2 = "2026-11-04"; t.app.ctx.fakeToday = day2;
  t.app.ctx.fakeClock = "08:58"; await ci(w, "in");
  t.app.ctx.fakeClock = "19:00";
  const q = await ci(w, "out");
  assert.equal(q.status, 400); assert.equal(q.data.after_hours, true); assert.equal(q.data.field, "extra_reason");
  const ok = await ci(w, "out", OFFICE, "&extra_reason=" + encodeURIComponent("اجتماع مع العميل"));
  assert.equal(ok.status, 201);
  const r2 = t.db.prepare("SELECT * FROM leave_requests WHERE employee_id=? AND type='overtime' AND start_date=?").get(w.emp.id, day2);
  assert.equal(r2.minutes, 60); assert.equal(r2.reason, "اجتماع مع العميل");
  assert.ok((await mgr.c.get("/api/requests?scope=approvals")).data.items.some((x) => x.id === r2.id));
  // a check-out within 30 minutes of the end asks nothing
  const day3 = "2026-11-05"; t.app.ctx.fakeToday = day3;
  t.app.ctx.fakeClock = "09:00"; await ci(w, "in"); t.app.ctx.fakeClock = "18:25";
  assert.equal((await ci(w, "out")).status, 201);
  // the next morning: no missed check-out; a day without one shows on the card
  const day4 = "2026-11-08"; t.app.ctx.fakeToday = day4; t.app.ctx.fakeClock = "09:00"; await ci(w, "in"); // Sunday, never checked out
  t.app.ctx.fakeToday = "2026-11-09"; t.app.ctx.fakeClock = "08:00";
  assert.deepEqual((await w.c.get("/api/attendance/checkin/today")).data.missed, { date: day4 });
  t.app.ctx.fakeToday = "2026-11-02"; t.app.ctx.fakeClock = "23:30";
});

test("reminders: not checked in by start + 30, not out by end + 30 (with the two buttons), once each; the manager's morning list", async () => {
  const r = await makePerson(t.base, admin, { emp_no: "RM1", name_ar: "تذكير", join_date: "2022-01-01", department_id: dept.id, shift: 2, att_mode: "online" }, "staff");
  const fp = await makePerson(t.base, admin, { emp_no: "RM2", name_ar: "بصمة فقط", join_date: "2022-01-01", department_id: dept.id, att_mode: "machine" }, "staff");
  const notes = async (p) => (await p.c.get("/api/notifications")).data.items;
  const day = "2026-11-10"; // Tuesday
  runReminders(t.app.ctx, day, 9 * 60 + 20); // 09:20: shift 2 starts 09:00 — not yet
  assert.ok(!(await notes(r)).some((n) => /haven't checked in/.test(n.title_en)));
  runReminders(t.app.ctx, day, 9 * 60 + 35); runReminders(t.app.ctx, day, 9 * 60 + 40);
  assert.equal((await notes(r)).filter((n) => /haven't checked in/.test(n.title_en)).length, 1, "once");
  assert.ok(!(await notes(fp)).some((n) => /checked in/.test(n.title_en)), "not for fingerprint-only staff");
  // checked in; 18:35 → the check-out question
  await r.c.post("/api/attendance/checkin/consent", {});
  t.app.ctx.fakeToday = day; t.app.ctx.fakeClock = "09:50"; await ci(r, "in");
  runReminders(t.app.ctx, day, 18 * 60 + 20);
  assert.ok(!(await notes(r)).some((n) => /haven't checked out/.test(n.title_en)));
  runReminders(t.app.ctx, day, 18 * 60 + 35);
  const out = (await notes(r)).find((n) => /haven't checked out/.test(n.title_en));
  assert.ok(out); assert.equal(out.link, "#/?ci=out");
  // not on a rest day
  runReminders(t.app.ctx, "2026-11-13", 10 * 60); // Friday
  assert.equal((await notes(r)).filter((n) => /haven't checked in/.test(n.title_en)).length, 1);
  // the next working morning: the manager gets the list (once)
  runReminders(t.app.ctx, "2026-11-11", 9 * 60 + 5); runReminders(t.app.ctx, "2026-11-11", 9 * 60 + 10);
  const m = (await notes(mgr)).filter((n) => /Didn't check out/.test(n.title_en));
  assert.equal(m.length, 1); assert.match(m[0].body_ar, /تذكير/);
  t.app.ctx.fakeToday = "2026-11-02"; t.app.ctx.fakeClock = "23:30";
});

test("outside the sites from a phone: the quick check asks for the reason first; the server reads the whole photo before answering", async () => {
  const p = await makePerson(t.base, admin, { emp_no: "LF1", name_ar: "هاتف", join_date: "2022-01-01", department_id: dept.id }, "staff");
  await p.c.post("/api/attendance/checkin/consent", {});
  t.app.ctx.fakeToday = "2026-11-10"; t.app.ctx.fakeClock = "09:05";
  // the quick check (no photo)
  const out = (await p.c.get(`/api/attendance/checkin/check?kind=in&lat=${FAR.lat}&lng=${FAR.lng}`)).data;
  assert.equal(out.inside, false); assert.equal(out.nearest.name_en, "Head office"); assert.ok(out.distance > 1000); assert.equal(out.after_hours, false);
  const inn = (await p.c.get(`/api/attendance/checkin/check?kind=in&lat=${OFFICE.lat}&lng=${OFFICE.lng}`)).data;
  assert.equal(inn.inside, true); assert.equal(inn.site.name_en, "Head office");
  assert.equal((await p.c.get("/api/attendance/checkin/check?kind=in")).status, 400, "a location is needed");
  // a phone-sized photo sent slowly: no answer before the last byte arrived
  const net = await import("node:net");
  const url = new URL(t.base), photo = Buffer.alloc(600 * 1024, 7); photo[0] = 0xff; photo[1] = 0xd8;
  const answer = await new Promise((resolve, reject) => {
    const sock = net.connect(Number(url.port), url.hostname);
    let got = "", sentAll = false, early = false;
    sock.on("data", (d) => { if (!sentAll) early = true; got += d; });
    sock.on("end", () => resolve({ got, early })); sock.on("error", reject);
    sock.write(`POST /api/attendance/checkin?kind=in&lat=${FAR.lat}&lng=${FAR.lng}&acc=10&device=d HTTP/1.1\r\nHost: ${url.host}\r\nCookie: ${p.c.cookie}\r\nContent-Type: image/jpeg\r\nContent-Length: ${photo.length}\r\nConnection: close\r\n\r\n`);
    let i = 0; const step = 64 * 1024;
    const next = () => { const last = i + step >= photo.length; if (last) sentAll = true; sock.write(photo.subarray(i, i + step)); i += step; if (!last) setTimeout(next, 15); };
    next();
  });
  assert.equal(answer.early, false, "the server waited for the whole photo: " + answer.got.slice(0, 300));
  assert.match(answer.got, /^HTTP\/1\.1 400/); assert.match(answer.got, /"outside":true/);
  // with the reason: saved, waiting for the manager
  const ok = await ci(p, "in", FAR, "&reason=" + encodeURIComponent("زيارة موقع"));
  assert.equal(ok.status, 201); assert.equal(ok.data.checkin.approval, "pending");
  t.app.ctx.fakeToday = "2026-11-02"; t.app.ctx.fakeClock = "23:30";
});
