// Personal break: asked for with a reason, start and length; the direct manager approves or rejects (comment optional);
// started only once approved, "Back to work" records how long; the check-out time doesn't move; time away without an
// approved break is flagged for the manager.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";

const OFFICE = { lat: 23.588, lng: 58.3829 };
const jpg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
let t, admin, mgr, hr, s;
const ci = (p, kind) => p.c.upload(`/api/attendance/checkin?kind=${kind}&lat=${OFFICE.lat}&lng=${OFFICE.lng}&acc=10&device=d1`, jpg, "image/jpeg");
const at = (day, clock) => { t.app.ctx.fakeToday = day; t.app.ctx.fakeClock = clock; };
const titles = (p) => t.db.prepare("SELECT title_en FROM notifications WHERE user_id=? ORDER BY id").all(p.user.id).map((n) => n.title_en);

before(async () => {
  t = await boot({ FAKE_TODAY: "2026-11-01", FLEX_DEFAULT: "on" });
  admin = await adminClient(t.base);
  await admin.put("/api/settings", { att_sites: [{ name_ar: "المكتب", name_en: "Office", lat: OFFICE.lat, lng: OFFICE.lng, radius_m: 200 }] });
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  mgr = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "مدير", join_date: "2020-01-01" }, "manager");
  s = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "سالم", name_en: "Salim", join_date: "2022-01-01", manager_employee_id: mgr.emp.id }, "staff");
  await s.c.post("/api/attendance/checkin/consent", {});
});
after(async () => { await t.close(); });

test("approved: asked → the manager approves (no comment needed) → started → back to work; the check-out time stays", async () => {
  at("2026-11-01", "09:00"); assert.equal((await ci(s, "in")).data.expected_out, "18:00");
  const r = (await s.c.post("/api/requests", { type: "break", date: "2026-11-01", time: "12:00", end_time: "12:30", reason: "مراجعة البنك" })).data.request;
  assert.ok(titles(mgr).some((x) => /awaiting your approval/.test(x)), "the manager is told");
  at("2026-11-01", "12:00");
  assert.equal((await s.c.post("/api/attendance/break/start", {})).data.error, "not_approved", "not before approval");
  assert.equal((await s.c.get("/api/attendance/checkin/today")).data.personal_break.status, "pending");
  assert.equal((await mgr.c.post(`/api/requests/${r.id}/approve`, {})).status, 200);
  assert.ok(titles(s).some((x) => /approved/.test(x)), "the person is told");
  at("2026-11-01", "12:05"); assert.equal((await s.c.post("/api/attendance/break/start", {})).data.personal_break.started, "12:05");
  at("2026-11-01", "12:40");
  const e = (await s.c.post("/api/attendance/break/end", {})).data.personal_break;
  assert.deepEqual([e.ended, e.minutes], ["12:40", 35]);
  assert.equal((await s.c.post("/api/attendance/break/end", {})).status, 409);
  assert.equal((await s.c.get("/api/attendance/checkin/today")).data.expected_out, "18:00", "the check-out time doesn't move");
  at("2026-11-01", "18:00"); await ci(s, "out");
  const day = (await s.c.get("/api/attendance/employee/" + s.emp.id + "?month=2026-11")).data.days.find((x) => x.date === "2026-11-01");
  assert.deepEqual([day.status, day.early, day.away, day.breakTaken.minutes], ["present", 0, undefined, 35]);
  // the permissions report counts it as a personal break, with the time it really took
  const rep = (await hr.c.get("/api/reports/permissions?from=2026-11-01&to=2026-11-30")).data.items.find((x) => x.employee.id === s.emp.id);
  assert.deepEqual([rep.break.count, rep.break.minutes], [1, 35]);
});

test("rejected (comment optional): it can't be started; going out anyway is flagged for the manager", async () => {
  at("2026-11-02", "09:00"); await ci(s, "in");
  const r = (await s.c.post("/api/requests", { type: "break", date: "2026-11-02", time: "13:00", end_time: "13:30", reason: "شخصي" })).data.request;
  assert.equal((await mgr.c.post(`/api/requests/${r.id}/reject`, {})).status, 200, "no comment needed");
  at("2026-11-02", "13:00");
  assert.equal((await s.c.post("/api/attendance/break/start", {})).data.error, "not_approved");
  await ci(s, "out");
  at("2026-11-02", "13:40");
  const back = await ci(s, "in");
  assert.deepEqual(back.data.checkin.flags.map((f) => [f.code, f.min]), [["away", 40]]);
  assert.ok(titles(mgr).some((x) => /Salim checked in 13:40 — away 40 min without an approved permission/.test(x)));
  at("2026-11-02", "18:30"); await ci(s, "out");
  const day = (await mgr.c.get("/api/attendance/employee/" + s.emp.id + "?month=2026-11")).data.days.find((x) => x.date === "2026-11-02");
  assert.equal(day.away, 40); assert.equal(day.worked, 9 * 60 + 30 - 60 - 40, "time away isn't counted as hours attended");
});

test("taken without asking: out and back in is flagged; an approved break covering the time away isn't", async () => {
  at("2026-11-03", "09:00"); await ci(s, "in");
  at("2026-11-03", "11:00"); await ci(s, "out");
  at("2026-11-03", "11:30");
  assert.deepEqual((await ci(s, "in")).data.checkin.flags.map((f) => f.code), ["away"]);
  const r = (await s.c.post("/api/requests", { type: "break", date: "2026-11-03", time: "15:00", end_time: "15:30", reason: "موعد" })).data.request;
  await mgr.c.post(`/api/requests/${r.id}/approve`, {});
  at("2026-11-03", "15:00"); await ci(s, "out");
  at("2026-11-03", "15:25");
  assert.deepEqual((await ci(s, "in")).data.checkin.flags, [], "covered by the approved break");
  const S = (await mgr.c.get("/api/attendance/employee/" + s.emp.id + "?month=2026-11")).data.summary;
  assert.deepEqual([S.awayDays, S.awayMin], [2, 70]);
});
