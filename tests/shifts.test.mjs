// The three shifts: Flexible (default; arrive 08:30–09:15, out = arrival + 8 h work + 1 h break), 10–5 and 10–6 (fixed);
// a change by HR / Admin applies from the next day; hours attended = time on site minus the break; the monthly report.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { runReminders } from "../server/checkin.mjs";

const OFFICE = { lat: 23.588, lng: 58.3829 };
const jpg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
let t, admin, hr, mgr, s, f5, f6, other, dept;
const ci = (p, kind) => p.c.upload(`/api/attendance/checkin?kind=${kind}&lat=${OFFICE.lat}&lng=${OFFICE.lng}&acc=10&device=d1`, jpg, "image/jpeg");
const at = (day, clock) => { t.app.ctx.fakeToday = day; t.app.ctx.fakeClock = clock; };
const notes = (p) => t.db.prepare("SELECT title_en FROM notifications WHERE user_id=? ORDER BY id").all(p.user.id).map((n) => n.title_en);
const sheet = async (p, who = p) => (await who.c.get(`/api/attendance/employee/${p.emp.id}?month=2026-11`)).data;
const day = (d, iso) => d.days.find((x) => x.date === iso);

before(async () => {
  t = await boot({ FAKE_TODAY: "2026-11-01", FLEX_DEFAULT: "on" });
  admin = await adminClient(t.base);
  await admin.put("/api/settings", { att_sites: [{ name_ar: "المكتب", name_en: "Office", lat: OFFICE.lat, lng: OFFICE.lng, radius_m: 200 }] });
  dept = (await admin.post("/api/departments", { name_ar: "المبيعات", name_en: "Sales" })).data.department;
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  mgr = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "مدير", join_date: "2020-01-01", department_id: dept.id }, "manager");
  s = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف مرن", name_en: "Flex Staff", join_date: "2022-01-01", department_id: dept.id, manager_employee_id: mgr.emp.id }, "staff");
  f5 = await makePerson(t.base, admin, { emp_no: "S2", name_ar: "عشرة لخمسة", join_date: "2022-01-01", department_id: dept.id, manager_employee_id: mgr.emp.id }, "staff");
  f6 = await makePerson(t.base, admin, { emp_no: "S3", name_ar: "عشرة لستة", join_date: "2022-01-01", department_id: dept.id, manager_employee_id: mgr.emp.id }, "staff");
  other = await makePerson(t.base, admin, { emp_no: "S4", name_ar: "زميل", join_date: "2022-01-01", department_id: dept.id }, "staff");
  for (const p of [s, f5, f6, other]) await p.c.post("/api/attendance/checkin/consent", {});
});
after(async () => { await t.close(); });

test("three shifts in Settings (Admin only): Flexible 08:30–09:15 + 8 h + 1 h break, 10–5, 10–6; new staff start on Flexible", async () => {
  const sh = (await admin.get("/api/settings")).data.shifts;
  assert.deepEqual(Object.keys(sh), ["5", "6", "7"]);
  assert.deepEqual([sh[5].flex_from, sh[5].flex_to, sh[5].work_hours, sh[5].break_min], ["08:30", "09:15", 8, 60]);
  assert.deepEqual([sh[6].start, sh[6].end, sh[7].start, sh[7].end], ["10:00", "17:00", "10:00", "18:00"]);
  assert.equal((await hr.c.put("/api/settings", { shifts: { 5: { flex_to: "09:30" } } })).status, 403);
  assert.equal((await admin.put("/api/settings", { shifts: { 5: { flex_to: "08:00" } } })).status, 400, "before the window opens");
  assert.equal((await admin.put("/api/settings", { shifts: { 9: { start: "08:00" } } })).status, 400);
  assert.equal((await admin.put("/api/settings", { shifts: { 6: { break_min: 500 } } })).status, 400);
  assert.equal(s.emp.shift, 5, "Flexible by default");
  // HR moves two people to the fixed shifts (from the next day — they start on 2 Nov)
  assert.equal((await hr.c.put(`/api/employees/${f5.emp.id}`, { shift: 6 })).status, 200);
  assert.equal((await hr.c.put(`/api/employees/${f6.emp.id}`, { shift: 7 })).status, 200);
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE action='employee.shift' AND after LIKE '%\"from\":\"2026-11-02\"%'").get(), "logged with the day it applies from");
  assert.equal((await hr.c.put("/api/settings", { verify: { location: false } })).status, 403, "HR can't change check-in verification");
});

test("Flexible: in 08:45 → told 17:45 (9 hours); out 17:45 is on time; hours attended = 9 h on site − 1 h break", async () => {
  at("2026-11-01", "08:45");
  assert.equal((await ci(s, "in")).data.expected_out, "17:45");
  assert.equal((await s.c.get("/api/attendance/checkin/today")).data.expected_out, "17:45");
  at("2026-11-01", "17:45"); await ci(s, "out");
});

test("Flexible: in 09:30 → 15 minutes late (from 09:15), out due 18:30; before 08:30 counts as 08:30 (out 17:30)", async () => {
  at("2026-11-02", "09:30"); assert.equal((await ci(s, "in")).data.expected_out, "18:30");
  at("2026-11-02", "18:30"); await ci(s, "out");
  at("2026-11-03", "08:00"); assert.equal((await ci(s, "in")).data.expected_out, "17:30");
  at("2026-11-03", "18:00"); await ci(s, "out"); // 30 minutes after official hours
});

test("Flexible: leaving before one's time is warned and counts as early exit; reminded 10 minutes before the time", async () => {
  at("2026-11-04", "09:15"); assert.equal((await ci(s, "in")).data.expected_out, "18:15");
  runReminders(t.app.ctx, "2026-11-04", 18 * 60 + 4);
  assert.ok(!notes(s).includes("Your check-out time today: 18:15"));
  runReminders(t.app.ctx, "2026-11-04", 18 * 60 + 6);
  assert.equal(notes(s).filter((n) => n === "Your check-out time today: 18:15").length, 1);
  at("2026-11-04", "17:00");
  const c = (await s.c.get(`/api/attendance/checkin/check?kind=out&lat=${OFFICE.lat}&lng=${OFFICE.lng}`)).data;
  assert.equal(c.early, 75); assert.equal(c.shift_end, "18:15");
  assert.equal((await ci(s, "out")).data.early, 75);
});

test("10–5 and 10–6 (from the day after HR's change): late after 10:00, early before 17:00 / 18:00, no grace", async () => {
  at("2026-11-02", "10:05"); assert.equal((await ci(f5, "in")).data.expected_out, "17:00");
  at("2026-11-02", "16:50"); await ci(f5, "out");
  at("2026-11-02", "10:00"); assert.equal((await ci(f6, "in")).data.expected_out, "18:00");
  at("2026-11-02", "17:30"); await ci(f6, "out");
  // 1 Nov (the day of the change) they were still on Flexible
  at("2026-11-01", "10:00"); await ci(f5, "in"); at("2026-11-01", "19:00"); await ci(f5, "out");
});

test("the month by these rules: late, early, after hours, expected check-out, hours attended, compliance", async () => {
  at("2026-11-08", "10:00");
  const d = await sheet(s);
  assert.deepEqual([day(d, "2026-11-01").late, day(d, "2026-11-01").early, day(d, "2026-11-01").expectedOut, day(d, "2026-11-01").worked], [0, 0, 17 * 60 + 45, 8 * 60]);
  assert.deepEqual([day(d, "2026-11-02").late, day(d, "2026-11-02").expectedOut], [15, 18 * 60 + 30]);
  assert.deepEqual([day(d, "2026-11-03").expectedOut, day(d, "2026-11-03").after, day(d, "2026-11-03").worked], [17 * 60 + 30, 30, 9 * 60]);
  assert.deepEqual([day(d, "2026-11-04").late, day(d, "2026-11-04").early], [0, 75]);
  assert.equal(day(d, "2026-11-01").shift.no, 5); assert.equal(day(d, "2026-11-01").shift.brk, 60);
  assert.deepEqual([d.summary.workDays, d.summary.onTime, d.summary.compliance, d.summary.absent], [5, 2, 40, 1], "5 Nov: no check-in");
  assert.equal(d.summary.worked, 8 * 60 + (9 * 60 - 60) + 9 * 60 + (7 * 60 + 45 - 60));
  const a = await sheet(f5, hr), b = await sheet(f6, hr);
  assert.deepEqual([day(a, "2026-11-02").shift.no, day(a, "2026-11-02").late, day(a, "2026-11-02").early, day(a, "2026-11-02").expectedOut], [6, 5, 10, 17 * 60]);
  assert.deepEqual([day(a, "2026-11-01").shift.no, day(a, "2026-11-01").late], [5, 45], "the day of the change: still Flexible (10:00 is 45 minutes late)");
  assert.deepEqual([day(b, "2026-11-02").shift.no, day(b, "2026-11-02").late, day(b, "2026-11-02").early], [7, 0, 30]);
});

test("Admin moves the Flexible window: the same arrivals are judged by the new end", async () => {
  await admin.put("/api/settings", { shifts: { 5: { flex_to: "09:00" } } });
  assert.equal(day(await sheet(s), "2026-11-02").late, 30);
  await admin.put("/api/settings", { shifts: { 5: { flex_to: "09:15" } } });
});

test("the monthly report: HR the company, the direct manager their team, a person only their own — never a colleague's", async () => {
  const H = (await hr.c.get("/api/attendance/monthly?month=2026-11")).data;
  assert.equal(H.scope, "company"); assert.ok(H.people.find((p) => p.employee.id === s.emp.id));
  assert.equal((await mgr.c.get("/api/attendance/monthly?month=2026-11")).data.scope, "team");
  assert.equal((await s.c.get(`/api/attendance/monthly?month=2026-11&employee_id=${s.emp.id}`)).data.own, true);
  assert.equal((await other.c.get(`/api/attendance/monthly?month=2026-11&employee_id=${s.emp.id}`)).status, 403);
  assert.equal((await other.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-11`)).status, 403);
});
