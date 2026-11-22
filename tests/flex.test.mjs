// Flexible hours (for all staff and shifts): on time 08:30–09:15, late from 09:15, an arrival before 08:30 counts as 08:30,
// the check-out time is the arrival + 8 hours; the monthly report (pack / one person) and who may see it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { runReminders } from "../server/checkin.mjs";

const OFFICE = { lat: 23.588, lng: 58.3829 };
const jpg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
let t, admin, hr, mgr, s, other, dept;
const ci = (p, kind, extra = "") => p.c.upload(`/api/attendance/checkin?kind=${kind}&lat=${OFFICE.lat}&lng=${OFFICE.lng}&acc=10&device=d1${extra}`, jpg, "image/jpeg");
const at = (day, clock) => { t.app.ctx.fakeToday = day; t.app.ctx.fakeClock = clock; };
const notes = (p) => t.db.prepare("SELECT title_en FROM notifications WHERE user_id=? ORDER BY id").all(p.user.id).map((n) => n.title_en);

before(async () => {
  t = await boot({ FAKE_TODAY: "2026-11-01", FLEX_DEFAULT: "on" });
  admin = await adminClient(t.base);
  await admin.put("/api/settings", { att_sites: [{ name_ar: "المكتب", name_en: "Office", lat: OFFICE.lat, lng: OFFICE.lng, radius_m: 200 }] });
  dept = (await admin.post("/api/departments", { name_ar: "المبيعات", name_en: "Sales" })).data.department;
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  mgr = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "مدير", join_date: "2020-01-01", department_id: dept.id }, "manager");
  // shift 3 (10:00–17:00) on purpose: flexible hours apply to every shift
  s = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف مرن", name_en: "Flex Staff", join_date: "2022-01-01", department_id: dept.id, shift: 3, manager_employee_id: mgr.emp.id }, "staff");
  other = await makePerson(t.base, admin, { emp_no: "S2", name_ar: "زميل", join_date: "2022-01-01", department_id: dept.id }, "staff");
  for (const p of [s, other]) await p.c.post("/api/attendance/checkin/consent", {});
});
after(async () => { await t.close(); });

test("Admin sets the window and the hours; HR can't; nonsense is refused", async () => {
  const st = (await admin.get("/api/settings")).data;
  assert.equal(st.flex_on, true); assert.equal(st.flex_start, "08:30"); assert.equal(st.flex_end, "09:15"); assert.equal(st.flex_hours, 8);
  assert.equal((await hr.c.put("/api/settings", { flex_end: "09:30" })).status, 403);
  assert.equal((await admin.put("/api/settings", { flex_end: "08:00" })).status, 400, "before the start");
  assert.equal((await admin.put("/api/settings", { flex_hours: 30 })).status, 400);
  assert.equal((await admin.put("/api/settings", { flex_start: "8:30" })).status, 400);
  assert.equal((await admin.put("/api/settings", { remind_before_out_min: 10, flex_hours: 8 })).status, 200);
});

test("in 08:45 → told the check-out time 16:45; out at 16:45 is on time", async () => {
  at("2026-11-01", "08:45"); // a Sunday
  const r = await ci(s, "in");
  assert.equal(r.status, 201); assert.equal(r.data.expected_out, "16:45");
  const today = (await s.c.get("/api/attendance/checkin/today")).data;
  assert.equal(today.expected_out, "16:45"); assert.deepEqual(today.flex, { from: "08:30", to: "09:15", hours: 8 });
  at("2026-11-01", "16:45");
  assert.equal((await s.c.get(`/api/attendance/checkin/check?kind=out&lat=${OFFICE.lat}&lng=${OFFICE.lng}`)).data.early, 0);
  assert.equal((await ci(s, "out")).status, 201);
});

test("in 09:30 → late 15 minutes (from 09:15), out due 17:30", async () => {
  at("2026-11-02", "09:30");
  assert.equal((await ci(s, "in")).data.expected_out, "17:30");
  at("2026-11-02", "17:30"); await ci(s, "out");
});

test("leaving before one's time: warned first (minutes early), and it counts as an early exit", async () => {
  at("2026-11-03", "08:50"); await ci(s, "in");
  at("2026-11-03", "16:00");
  const c = (await s.c.get(`/api/attendance/checkin/check?kind=out&lat=${OFFICE.lat}&lng=${OFFICE.lng}`)).data;
  assert.equal(c.early, 50); assert.equal(c.shift_end, "16:50");
  const r = await ci(s, "out");
  assert.equal(r.status, 201); assert.equal(r.data.early, 50);
});

test("in before 08:30 counts as 08:30 (out 16:30); staying to 17:00 shows 30 minutes after official hours", async () => {
  at("2026-11-04", "08:00");
  assert.equal((await ci(s, "in")).data.expected_out, "16:30");
  at("2026-11-04", "17:00"); assert.equal((await ci(s, "out")).status, 201, "30 minutes after: no reason asked yet");
});

test("in 09:15 (the last on-time minute) → out 17:15; reminded 10 minutes before it, once", async () => {
  at("2026-11-05", "09:15");
  assert.equal((await ci(s, "in")).data.expected_out, "17:15");
  runReminders(t.app.ctx, "2026-11-05", 17 * 60 + 4);
  assert.ok(!notes(s).some((n) => /check-out time today/.test(n)), "not yet at 17:04");
  runReminders(t.app.ctx, "2026-11-05", 17 * 60 + 6);
  runReminders(t.app.ctx, "2026-11-05", 17 * 60 + 8);
  assert.equal(notes(s).filter((n) => n === "Your check-out time today: 17:15").length, 1);
  at("2026-11-05", "17:20"); await ci(s, "out");
});

test("the month: late / early / after hours by the flexible rules, and compliance from them", async () => {
  at("2026-11-08", "10:00");
  const d = (await s.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-11`)).data;
  const day = (iso) => d.days.find((x) => x.date === iso);
  assert.deepEqual([day("2026-11-01").late, day("2026-11-01").early, day("2026-11-01").expectedOut, day("2026-11-01").status], [0, 0, 16 * 60 + 45, "present"]);
  assert.deepEqual([day("2026-11-02").late, day("2026-11-02").early, day("2026-11-02").expectedOut], [15, 0, 17 * 60 + 30]);
  assert.deepEqual([day("2026-11-03").late, day("2026-11-03").early], [0, 50]);
  assert.deepEqual([day("2026-11-04").late, day("2026-11-04").expectedOut, day("2026-11-04").after], [0, 16 * 60 + 30, 30]);
  assert.deepEqual([day("2026-11-05").late, day("2026-11-05").early, day("2026-11-05").after], [0, 0, 5]);
  assert.ok(day("2026-11-01").shift.flex, "shift 3 follows the flexible hours too");
  const S = d.summary;
  assert.equal(S.workDays, 5); assert.equal(S.onTime, 3); assert.equal(S.compliance, 60);
  assert.deepEqual([S.late, S.lateMin, S.early, S.earlyMin, S.afterMin], [1, 15, 1, 50, 35]);
  assert.ok(d.flex && d.flex.hours === 8);
});

test("Admin moves the window: the same arrival is judged by the new end (09:30 is late 30 minutes from 09:00)", async () => {
  await admin.put("/api/settings", { flex_end: "09:00" });
  const d = (await s.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-11`)).data;
  assert.equal(d.days.find((x) => x.date === "2026-11-02").late, 30);
  assert.equal(d.days.find((x) => x.date === "2026-11-05").late, 15, "09:15 is late now");
  await admin.put("/api/settings", { flex_end: "09:15" });
});

test("the monthly report: HR the company, the direct manager their team, a person only their own — never a colleague's", async () => {
  const H = (await hr.c.get("/api/attendance/monthly?month=2026-11")).data;
  assert.equal(H.scope, "company");
  const row = H.people.find((p) => p.employee.id === s.emp.id);
  assert.ok(row); assert.equal(row.summary.compliance, 60); assert.equal(row.days.length, 30);
  assert.equal(H.total.workDays >= 5, true); assert.ok(H.working_days > 15); assert.ok(H.rules.flex);
  const M = (await mgr.c.get("/api/attendance/monthly?month=2026-11")).data;
  assert.equal(M.scope, "team"); assert.ok(M.people.some((p) => p.employee.id === s.emp.id));
  assert.ok(!M.people.some((p) => p.employee.id === hr.emp.id), "not outside the team");
  // a staff member: their own month (one person), nothing else
  const own = await s.c.get(`/api/attendance/monthly?month=2026-11&employee_id=${s.emp.id}`);
  assert.equal(own.status, 200); assert.equal(own.data.scope, "person"); assert.equal(own.data.own, true); assert.equal(own.data.people.length, 1);
  assert.equal((await other.c.get(`/api/attendance/monthly?month=2026-11&employee_id=${s.emp.id}`)).status, 403, "a colleague's report");
  assert.equal((await other.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-11`)).status, 403, "a colleague's sheet");
  assert.equal((await other.c.get("/api/attendance/monthly?month=2026-11")).status, 403, "the pack");
  assert.equal((await s.c.get("/api/attendance/monthly?month=2026-13")).status, 400);
});
