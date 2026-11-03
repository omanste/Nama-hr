// Attendance (policy 007/2026): machine upload, linking numbers to staff, each day against the person's shift,
// fingerprint corrections (manager, then HR), external tasks, the monthly sheet, the weekly report without names.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { computeDay, uncovered, lastWeek } from "../server/attendance.mjs";
import { readPunches } from "../public/js/punches.js";

const S2 = { start: 540, end: 1080 }; // 09:00–18:00
const day = (o) => computeDay({ shift: S2, covered: true, rest: false, holiday: false, leave: null, pending: false, punches: [], excused: [], missions: [], correction: null, ...o });

test("a day: late from the first minute, early leaving, missing punch, absence, excused hours", () => {
  assert.deepEqual([day({ punches: [540, 1080] }).status, day({ punches: [540, 1080] }).late], ["present", 0]);
  const d = day({ punches: [541, 1075] });
  assert.equal(d.late, 1, "no grace period"); assert.equal(d.early, 5); assert.equal(d.onSite, 534);
  assert.equal(day({ punches: [600, 602, 1090] }).late, 60, "a double press counts once");
  const one = day({ punches: [560] });
  assert.equal(one.status, "missing"); assert.equal(one.missing, "out"); assert.equal(one.late, 20);
  assert.equal(day({ punches: [1070] }).missing, "in");
  assert.equal(day({}).status, "absent");
  assert.equal(day({ pending: true }).status, "pending");
  assert.equal(day({ rest: true }).status, "rest"); assert.equal(day({ rest: true, punches: [600, 700] }).status, "rest_worked");
  assert.equal(day({ leave: "annual" }).status, "leave");
  assert.equal(day({ missions: [[540, 1080]] }).status, "mission");
  // an approved late arrival until 10:00 excuses the first hour; arriving 10:10 is 10 minutes late
  assert.equal(day({ punches: [610, 1080], excused: [[540, 600]] }).late, 10);
  assert.equal(day({ punches: [540, 900], missions: [[900, 1080]] }).early, 0);
  assert.equal(day({ punches: [1070], correction: { in: 540, out: null } }).status, "present");
  assert.equal(day({ covered: false, punches: [600] }).status, "no_data");
  assert.equal(uncovered(0, 100, [[10, 20], [15, 30], [90, 200]]), 70);
  assert.deepEqual(lastWeek("2026-10-28"), ["2026-10-18", "2026-10-24"]);
});

test("the machine's file: columns found by name, day/month dates, AM/PM", () => {
  const r = readPunches([["Department", "Name", "No.", "Date/Time", "Location ID"], ["X", "Ali", "7", "02/09/2025 06:00:27 PM", "104"], ["X", "Ali", "7", "bad", "104"], []]);
  assert.deepEqual(r.punches, [{ no: "7", name: "Ali", at: "2025-09-02 18:00" }]);
  assert.equal(r.skipped, 1);
  assert.equal(readPunches([["a", "b"], [1, 2]]).error, "columns");
  assert.equal(readPunches([["AC-No.", "Date", "Time"], ["3", "2026-10-25", "08:31"]]).punches[0].at, "2026-10-25 08:31");
});

let t, admin, hr, mgr, s, other, ceo, outsider;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-10-29" });
  admin = await adminClient(t.base);
  const d = (await admin.post("/api/departments", { name_ar: "المبيعات", name_en: "Sales" })).data.department;
  const d2 = (await admin.post("/api/departments", { name_ar: "المالية", name_en: "Finance" })).data.department;
  mgr = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "مدير", name_en: "Boss Man", join_date: "2020-01-01", department_id: d.id }, "staff");
  await admin.put(`/api/departments/${d.id}`, { approver_employee_id: mgr.emp.id });
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  ceo = await makePerson(t.base, admin, { emp_no: "C1", name_ar: "تنفيذي", join_date: "2020-01-01" }, "ceo");
  s = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "ليلى", name_en: "Layla Hamed", join_date: "2022-01-10", department_id: d.id, opening_days: 10 }, "staff");
  other = await makePerson(t.base, admin, { emp_no: "S2", name_ar: "زميل", name_en: "Salma Nasser", join_date: "2022-01-10", department_id: d.id, shift: 1 }, "staff");
  outsider = await makePerson(t.base, admin, { emp_no: "F1", name_ar: "مالية", name_en: "Finance Person", join_date: "2022-01-10", department_id: d2.id }, "staff");
  await admin.put("/api/settings", { attendance_start: "2026-10-01" });
});
after(async () => { await t.close(); });

const punches = [
  // Layla (machine 9), shift 2 (09:00–18:00): Sun 25 Oct on time, Mon 26 late 30 min & left 17:30, Tue 27 one punch, Wed 28 absent
  ["9", "LAYLA HAMED", "2026-10-25 08:55"], ["9", "LAYLA HAMED", "2026-10-25 18:02"],
  ["9", "LAYLA HAMED", "2026-10-26 09:30"], ["9", "LAYLA HAMED", "2026-10-26 17:30"],
  ["9", "LAYLA HAMED", "2026-10-27 09:00"],
  ["9", "LAYLA HAMED", "2026-10-24 10:00"], ["9", "LAYLA HAMED", "2026-10-24 12:00"], // Saturday: worked on a rest day
  // Salma (machine 22), shift 1 (08:30–17:30)
  ["22", "SALMA NASSER SAID", "2026-10-25 08:45"], ["22", "SALMA NASSER SAID", "2026-10-25 17:30"],
  ["22", "SALMA NASSER SAID", "2026-10-28 08:30"], ["22", "SALMA NASSER SAID", "2026-10-28 17:31"],
  ["3", "3", "2026-10-25 08:00"], // nobody yet
].map(([no, name, at]) => ({ no, name, at }));

test("HR uploads the machine's punches; re-uploading adds nothing twice; only HR/Admin", async () => {
  assert.equal((await s.c.post("/api/attendance/upload", { punches })).status, 403);
  assert.equal((await hr.c.post("/api/attendance/upload", { punches: [{ no: "9", at: "yesterday" }] })).status, 400);
  const r = await hr.c.post("/api/attendance/upload", { name: "att.xls", punches });
  assert.equal(r.status, 201);
  assert.equal(r.data.added, punches.length); assert.equal(r.data.unlinked, 3);
  assert.equal((await hr.c.post("/api/attendance/upload", { name: "att.xls", punches })).data.added, 0);
});

test("HR links each machine number to a person (with a suggestion by name), or sets it aside", async () => {
  const dev = (await hr.c.get("/api/attendance/devices")).data.items;
  const iram = dev.find((d) => d.machine_no === "9"), j = dev.find((d) => d.machine_no === "22");
  assert.equal(iram.suggestion.id, s.emp.id); assert.equal(j.suggestion.id, other.emp.id);
  assert.equal(dev.find((d) => d.machine_no === "3").suggestion, null);
  assert.equal((await s.c.get("/api/attendance/devices")).status, 403);
  assert.equal((await hr.c.put("/api/attendance/devices/9", { employee_id: s.emp.id })).status, 200);
  assert.equal((await hr.c.put("/api/attendance/devices/22", { employee_id: other.emp.id })).status, 200);
  assert.equal((await hr.c.put("/api/attendance/devices/3", { ignored: true })).status, 200);
  assert.equal((await hr.c.put("/api/attendance/devices/99", { ignored: true })).status, 404);
});

test("the monthly sheet: each day against the person's own shift", async () => {
  const r = (await s.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-10`)).data;
  const d = Object.fromEntries(r.days.map((x) => [x.date, x]));
  assert.equal(d["2026-10-25"].status, "present"); assert.equal(d["2026-10-25"].late, 0);
  assert.deepEqual([d["2026-10-26"].late, d["2026-10-26"].early], [30, 30]);
  assert.equal(d["2026-10-27"].status, "missing");
  assert.equal(d["2026-10-28"].status, "absent");
  assert.equal(d["2026-10-29"].status, "no_data", "after the last upload");
  assert.equal(d["2026-10-24"].status, "rest_worked");
  assert.equal(d["2026-10-23"].status, "no_data", "before this person's first punch");
  assert.equal(r.summary.late, 1); assert.equal(r.summary.lateMin, 30); assert.equal(r.summary.missing, 1); assert.equal(r.summary.absent, 1);
  assert.equal(r.summary.workDays, 4); assert.equal(r.summary.onTime, 1); assert.equal(r.summary.compliance, 25);
  // shift 1 starts at 08:30: 08:45 is inside the 15-minute grace, so on time
  const j = (await mgr.c.get(`/api/attendance/employee/${other.emp.id}?month=2026-10`)).data;
  assert.equal(j.days.find((x) => x.date === "2026-10-25").late, 0);
  assert.equal(j.days.find((x) => x.date === "2026-10-28").late, 0);
  // who may see it: the person, their manager, HR — not a colleague, not the CEO
  assert.equal((await other.c.get(`/api/attendance/employee/${s.emp.id}`)).status, 403);
  assert.equal((await ceo.c.get(`/api/attendance/employee/${s.emp.id}`)).status, 403);
  assert.equal((await outsider.c.get(`/api/attendance/employee/${s.emp.id}`)).status, 403);
  assert.equal((await hr.c.get(`/api/attendance/employee/${s.emp.id}`)).status, 200);
});

test("a forgotten fingerprint: the employee asks, the manager verifies, HR confirms — then the day counts", async () => {
  assert.equal((await s.c.post("/api/requests", { type: "correction", date: "2026-10-27", end_time: "18:05" })).status, 400, "reason required");
  assert.equal((await s.c.post("/api/requests", { type: "correction", date: "2026-10-30", end_time: "18:05", reason: "x" })).status, 400, "future");
  const r = await s.c.post("/api/requests", { type: "correction", date: "2026-10-27", end_time: "18:05", reason: "نسيت البصمة" });
  assert.equal(r.status, 201);
  assert.equal((await s.c.post("/api/requests", { type: "correction", date: "2026-10-27", time: "09:00", reason: "x" })).status, 409, "one per day");
  const id = r.data.request.id;
  let day27 = async () => (await s.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-10`)).data.days.find((x) => x.date === "2026-10-27");
  assert.equal((await day27()).correctionPending, id);
  assert.equal((await mgr.c.post(`/api/requests/${id}/approve`, {})).status, 200);
  assert.equal((await day27()).status, "missing", "not until HR confirms");
  assert.ok((await hr.c.get("/api/attendance/hr-queue")).data.items.some((x) => x.id === id));
  assert.equal((await hr.c.post(`/api/requests/${id}/hr`, { class: "leave" })).status, 400, "a correction is confirmed or refused");
  assert.equal((await hr.c.post(`/api/requests/${id}/hr`, { class: "confirmed" })).status, 200);
  const d = await day27();
  assert.equal(d.status, "present"); assert.equal(d.out, 18 * 60 + 5); assert.equal(d.correctionPending, undefined);
  // the leave list doesn't show attendance requests; their own list does
  assert.ok(!(await s.c.get("/api/requests?scope=mine&kind=leave")).data.items.some((x) => x.id === id));
  assert.ok((await s.c.get("/api/requests?scope=mine&kind=attendance")).data.items.some((x) => x.id === id));
});

test("an external task counts as work; an absence with a pending request is not called unexcused", async () => {
  assert.equal((await s.c.post("/api/requests", { type: "mission", date: "2026-10-28", time: "09:00", end_time: "18:00", reason: "معاينة" })).status, 400, "place needed");
  const m = await s.c.post("/api/requests", { type: "mission", date: "2026-10-28", time: "09:00", end_time: "18:00", reason: "معاينة عقار", place: "مسقط - العميل X" });
  assert.equal(m.status, 201); assert.equal(m.data.request.minutes, 540);
  let d28 = async () => (await s.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-10`)).data.days.find((x) => x.date === "2026-10-28");
  assert.equal((await d28()).status, "pending");
  await mgr.c.post(`/api/requests/${m.data.request.id}/approve`, {});
  assert.equal((await d28()).status, "mission");
  // listed on my permissions page too (and still on the attendance list), never with leave
  const ids = async (kind) => (await s.c.get(`/api/requests?scope=mine&kind=${kind}`)).data.items.map((r) => r.id);
  assert.ok((await ids("permission")).includes(m.data.request.id));
  assert.ok((await ids("attendance")).includes(m.data.request.id));
  assert.ok(!(await ids("leave")).includes(m.data.request.id));
  assert.equal((await s.c.post("/api/requests", { type: "mission", date: "2026-10-28", time: "10:00", end_time: "11:00", reason: "x", place: "y" })).status, 409);
  // tasks and corrections don't appear on the leave calendar
  assert.ok(!(await hr.c.get("/api/calendar?month=2026-10")).data.items.some((x) => x.type === "mission"));
});

test("the person reviews their month; a note goes to HR", async () => {
  assert.equal((await mgr.c.post(`/api/attendance/employee/${s.emp.id}/review`, { month: "2026-10" })).status, 403);
  assert.equal((await s.c.post(`/api/attendance/employee/${s.emp.id}/review`, { month: "2026-10", note: "يوم 26 كان لدي موعد" })).status, 200);
  assert.equal((await s.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-10`)).data.review.note, "يوم 26 كان لدي موعد");
  assert.ok((await hr.c.get("/api/notifications")).data.items.some((n) => /attendance|الحضور/.test(n.title_en + n.title_ar)));
});

test("weekly report: by department without names for the CEO; HR and the manager also see their people", async () => {
  const q = "from=2026-10-25&to=2026-10-29";
  const c = (await ceo.c.get(`/api/attendance/report?${q}`)).data;
  assert.equal(c.people.length, 0);
  const sales = c.departments.find((x) => x.name_en === "Sales");
  assert.equal(sales.staff, 2); assert.equal(sales.late, 1); assert.equal(sales.lateMin, 30); // 08:45 on an 08:30 shift is within the grace
  assert.equal(sales.mission, 1);
  const h = (await hr.c.get(`/api/attendance/report?${q}`)).data;
  assert.ok(h.people.some((p) => p.employee.id === s.emp.id));
  // HR's confirmation is stamped with the real clock, so count corrections settled up to today
  const realToday = new Date().toISOString().slice(0, 10);
  assert.equal((await hr.c.get(`/api/attendance/report?from=2026-10-25&to=${realToday > "2026-10-29" ? realToday : "2026-10-29"}`)).data.corrections, 1);
  const m = (await mgr.c.get(`/api/attendance/report?${q}`)).data;
  assert.ok(m.people.every((p) => [s.emp.id, other.emp.id].includes(p.employee.id)));
  assert.equal((await s.c.get(`/api/attendance/report?${q}`)).status, 403);
  assert.equal((await hr.c.get("/api/attendance/report?from=2026-10-29&to=2026-10-01")).status, 400);
  const csv = await fetch(`${t.base}/api/attendance/report?${q}&format=csv`, { headers: { cookie: hr.c.cookie } });
  assert.equal(csv.status, 200); assert.match(await csv.text(), /Compliance %/);
});

test("permission times follow the person's shift", async () => {
  // shift 1 ends at 17:30: leaving at 16:30 is one hour; 17:30 is the end of the day, so it's refused
  const r = await other.c.post("/api/requests", { type: "early", date: "2026-11-02", time: "16:30", reason: "موعد" });
  assert.equal(r.status, 201); assert.equal(r.data.request.minutes, 60);
  assert.equal((await other.c.post("/api/requests", { type: "late", date: "2026-11-03", time: "09:00", reason: "موعد" })).data.request.minutes, 30);
  assert.equal((await hr.c.put(`/api/employees/${other.emp.id}`, { shift: 5 })).status, 400);
});

test("staff choose their own shift until HR locks it (one person) or Admin switches it off (everyone)", async () => {
  const p = (await s.c.get(`/api/employees/${s.emp.id}`)).data;
  assert.equal(p.shiftSelf, true);
  assert.equal((await s.c.put(`/api/employees/${s.emp.id}/shift`, { shift: 1 })).data.employee.shift, 1);
  assert.equal((await s.c.put(`/api/employees/${s.emp.id}/shift`, { shift: 3 })).status, 400);
  assert.equal((await s.c.put(`/api/employees/${other.emp.id}/shift`, { shift: 1 })).status, 403, "only their own");
  assert.equal((await hr.c.get(`/api/employees/${s.emp.id}`)).data.shiftSelf, false, "HR edits it in the full form");
  assert.equal((await hr.c.put(`/api/employees/${s.emp.id}`, { shift_locked: 1 })).status, 200);
  assert.equal((await s.c.put(`/api/employees/${s.emp.id}/shift`, { shift: 2 })).status, 403);
  assert.equal((await s.c.get(`/api/employees/${s.emp.id}`)).data.shiftSelf, false);
  await hr.c.put(`/api/employees/${s.emp.id}`, { shift_locked: 0 });
  assert.equal((await admin.put("/api/settings", { shift_self_select: false })).status, 200);
  assert.equal((await s.c.put(`/api/employees/${s.emp.id}/shift`, { shift: 2 })).status, 403);
  await admin.put("/api/settings", { shift_self_select: true });
  assert.equal((await s.c.put(`/api/employees/${s.emp.id}/shift`, { shift: 2 })).status, 200);
});

test("shift 3 (10:00–17:00) is a special case only HR/Admin assign; the day is measured from 10:00", async () => {
  assert.equal((await s.c.put(`/api/employees/${s.emp.id}/shift`, { shift: 3 })).status, 400, "staff can't pick it");
  assert.equal((await hr.c.put(`/api/employees/${s.emp.id}`, { shift: 3 })).data.employee.shift, 3);
  assert.equal((await s.c.get(`/api/employees/${s.emp.id}`)).data.shiftSelf, false, "and can't switch away from it");
  assert.equal((await s.c.put(`/api/employees/${s.emp.id}/shift`, { shift: 2 })).status, 403);
  // 26 Oct: in 09:30, out 17:30 → on time and no early leaving on 10:00–17:00
  const d = (await s.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-10`)).data.days.find((x) => x.date === "2026-10-26");
  assert.deepEqual([d.late, d.early, d.shift.start, d.shift.end], [0, 0, 600, 1020]);
  const r = await s.c.post("/api/requests", { type: "early", date: "2026-11-09", time: "16:00", reason: "موعد" });
  assert.equal(r.data.request.minutes, 60);
  assert.equal((await admin.put("/api/settings", { shift_3_start: "10:30" })).status, 200);
  assert.equal((await admin.get("/api/settings")).data.shift_3_start, "10:30");
  await hr.c.put(`/api/employees/${s.emp.id}`, { shift: 2 });
});

test("a task over several days (a distant site): every day is work; the allowance is worked out at approval; HR corrects it; Accounts' month report", async () => {
  // HR sets the rates: 5 OMR a day outside Muscat, 10 OMR a night
  assert.equal((await s.c.put("/api/settings/allowances", { mission_day_allowance: 5 })).status, 403, "staff can't");
  assert.equal((await hr.c.put("/api/settings/allowances", { mission_day_allowance: 5, mission_night_allowance: 10 })).status, 200);
  assert.equal((await hr.c.put("/api/settings/allowances", { mission_day_allowance: -1 })).status, 400);
  const body = { type: "mission", date: "2026-10-25", end_date: "2026-10-27", time: "08:00", end_time: "17:00", reason: "إشراف على موقع المشروع", place: "صلالة — موقع المشروع", outside_muscat: true, overnight: true };
  assert.equal((await s.c.post("/api/requests", { ...body, end_date: "2026-10-24" })).status, 400, "the last day before the first");
  assert.equal((await s.c.post("/api/requests", { ...body, end_date: "2026-11-20" })).status, 400, "at most 14 days");
  const m = await s.c.post("/api/requests", body);
  assert.equal(m.status, 201); assert.equal(m.data.request.end_date, "2026-10-27"); assert.equal(m.data.request.minutes, 3 * 540);
  assert.deepEqual(JSON.parse(m.data.request.details), { place: "صلالة — موقع المشروع", days: 3, outside_muscat: true, nights: 2 });
  // no second task over the same hours on any of those days
  assert.equal((await s.c.post("/api/requests", { ...body, date: "2026-10-26", end_date: "2026-10-26" })).status, 409);
  await mgr.c.post(`/api/requests/${m.data.request.id}/approve`, {});
  const got = (await s.c.get(`/api/requests/${m.data.request.id}`)).data.request;
  assert.equal(got.status, "approved");
  const x = JSON.parse(got.details);
  assert.equal(x.days_outside, 3); assert.equal(x.nights, 2); assert.deepEqual(x.rates, { day: 5, night: 10 }); assert.equal(x.allowance, 35);
  // every day of it is work on the sheet
  const days = (await s.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-10`)).data.days.filter((d) => d.date >= "2026-10-25" && d.date <= "2026-10-27");
  assert.equal(days.length, 3);
  assert.ok(days.every((d) => ["mission", "present"].includes(d.status)), "worked: a task day (or present, where the machine also recorded them)");
  assert.ok(days.every((d) => d.requests.some((r) => r.id === got.id)), "the task shows on each of its days");
  // a rate change later doesn't alter it; HR corrects it with a reason
  await hr.c.put("/api/settings/allowances", { mission_day_allowance: 8 });
  assert.equal((await hr.c.post(`/api/requests/${got.id}/allowance`, { nights: 1 })).status, 400, "a reason is needed");
  assert.equal((await s.c.post(`/api/requests/${got.id}/allowance`, { nights: 1, note: "x" })).status, 403);
  const c = await hr.c.post(`/api/requests/${got.id}/allowance`, { nights: 1, note: "عاد في اليوم الثالث مساءً" });
  assert.equal(JSON.parse(c.data.request.details).allowance, 25, "3 × 5 + 1 × 10 at the approved rates");
  // the month's report for Accounts (and its CSV); staff can't open it
  const acc = await makePerson(t.base, admin, { emp_no: "AC1", name_ar: "حسابات" }, "accounts");
  const rep = (await acc.c.get("/api/reports/mission-allowances?month=2026-10")).data;
  const row = rep.rows.find((r) => r.id === got.id);
  assert.equal(row.allowance, 25); assert.equal(row.days_outside, 3); assert.equal(row.nights, 1); assert.ok(rep.total >= 25);
  const csv = String((await acc.c.get("/api/reports/mission-allowances?month=2026-10&format=csv")).data);
  assert.match(csv, /Allowance \(OMR\)/); assert.match(csv, /"25\.000"/);
  assert.equal((await s.c.get("/api/reports/mission-allowances?month=2026-10")).status, 403);
  // a task inside Muscat has no allowance
  const inMuscat = await s.c.post("/api/requests", { ...body, date: "2026-10-22", end_date: "2026-10-22", outside_muscat: false, overnight: false, place: "مسقط" });
  await mgr.c.post(`/api/requests/${inMuscat.data.request.id}/approve`, {});
  assert.equal(JSON.parse((await s.c.get(`/api/requests/${inMuscat.data.request.id}`)).data.request.details).allowance, 0);
});

test("HR sets a balance to an exact number: the difference is recorded as an adjustment", async () => {
  const cur = (await hr.c.get(`/api/employees/${s.emp.id}`)).data.leave.remaining;
  const target = 18.5 * 480;
  assert.equal((await hr.c.post(`/api/employees/${s.emp.id}/adjust`, { minutes: target - cur, note: "تصحيح الرصيد حسب السجل الورقي" })).status, 200);
  assert.equal((await hr.c.get(`/api/employees/${s.emp.id}`)).data.leave.remaining, target);
});

test("shift 4 (10:00–18:00): HR/Admin assign it, staff can't pick it; lateness and leaving early follow its times", async () => {
  const p = await makePerson(t.base, admin, { emp_no: "SH4", name_ar: "وردية رابعة", join_date: "2022-01-01", shift: 4 }, "staff");
  assert.equal((await hr.c.get(`/api/employees/${p.emp.id}`)).data.employee.shift, 4);
  assert.equal((await hr.c.put(`/api/employees/${p.emp.id}`, { shift: 5 })).status, 400);
  assert.equal((await p.c.put(`/api/employees/${p.emp.id}/shift`, { shift: 1 })).status, 403, "someone on shift 4 can't move themselves off it");
  const st = (await admin.get("/api/settings")).data;
  assert.equal(st.shift_4_start, "10:00"); assert.equal(st.shift_4_end, "18:00");
  assert.equal((await admin.put("/api/settings", { shift_4_start: "10:30" })).data.shift_4_start, "10:30");
  await admin.put("/api/settings", { shift_4_start: "10:00" });
  const { shiftFor } = await import("../server/shifts.mjs");
  const sh = shiftFor(t.db, { shift: 4 }, "2026-11-10");
  assert.deepEqual([sh.start, sh.end], [600, 1080]);
  const d = (o) => computeDay({ shift: sh, covered: true, rest: false, holiday: false, leave: null, pending: false, punches: [], excused: [], missions: [], correction: null, grace: 15, ...o });
  assert.equal(d({ punches: [612, 1080] }).late, 0, "10:12 within the grace");
  assert.equal(d({ punches: [620, 1080] }).late, 20, "10:20 → 20 minutes late");
  assert.equal(d({ punches: [600, 1050] }).early, 30, "17:30 → 30 minutes early");
});
