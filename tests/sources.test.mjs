// Punch sources: a day with only fingerprint, only online, and both — each report counts only its chosen source (Online
// only / Fingerprint only / Combined, with where each time came from); untagged older check-ins are listed, not guessed;
// the online check-in log's flag filter. Made-up people and times.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";

let t, admin, hr, s, mgr;
const insCheckin = (emp, kind, at, extra = {}) => t.db.prepare(`INSERT INTO att_checkins(employee_id,kind,at,lat,lng,outside,created_at,ip,user_agent,flags,flag_status${"source" in extra ? ",source" : ""})
  VALUES(?,?,?,?,?,?,?,?,?,?,?${"source" in extra ? ",?" : ""})`).run(emp, kind, at, 23.6, 58.5, 0, "2026-11-01T00:00:00Z", "1.2.3.4", "test", extra.flags || null, extra.flags ? "open" : null, ...("source" in extra ? [extra.source] : []));

before(async () => {
  t = await boot({ FAKE_TODAY: "2026-11-12" });
  admin = await adminClient(t.base);
  const d = (await admin.post("/api/departments", { name_ar: "المبيعات", name_en: "Sales" })).data.department;
  mgr = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "مدير", join_date: "2020-01-01", department_id: d.id }, "staff");
  await admin.put(`/api/departments/${d.id}`, { approver_employee_id: mgr.emp.id });
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  s = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "ليلى", name_en: "Layla Test", join_date: "2022-01-10", department_id: d.id }, "staff");
  await admin.put("/api/settings", { attendance_start: "2026-10-01" });
  // fingerprint (device 9): Sun 1 Nov 09:00–18:00; Tue 3 Nov 09:20 only
  await hr.c.post("/api/attendance/upload", { name: "att.xls", punches: [["2026-11-01 09:00"], ["2026-11-01 18:00"], ["2026-11-03 09:20"]].map(([at]) => ({ no: "9", name: "LAYLA TEST", at })) });
  await hr.c.put("/api/attendance/devices/9", { employee_id: s.emp.id });
  // online: Mon 2 Nov 09:30 → 18:00; Tue 3 Nov leaves 17:00
  insCheckin(s.emp.id, "in", "2026-11-02 09:30"); insCheckin(s.emp.id, "out", "2026-11-02 18:00"); insCheckin(s.emp.id, "out", "2026-11-03 17:00");
});
after(async () => { await t.close(); });

const days = async (source) => Object.fromEntries((await s.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-11&source=${source}`)).data.days.map((d) => [d.date, d]));

test("Online only: only the portal's check-ins; the fingerprint is left out completely", async () => {
  const d = await days("online");
  assert.equal(d["2026-11-02"].status, "present"); assert.equal(d["2026-11-02"].late, 30);
  assert.equal(d["2026-11-03"].status, "missing", "the 09:20 fingerprint doesn't count"); assert.equal(d["2026-11-03"].missing, "in");
  assert.notEqual(d["2026-11-01"].status, "present", "a fingerprint-only day has nothing online");
});

test("Fingerprint only: only the device's punches; online check-ins are left out", async () => {
  const d = await days("fingerprint");
  assert.equal(d["2026-11-01"].status, "present");
  assert.equal(d["2026-11-02"].status, "absent", "the online day is empty here");
  assert.deepEqual([d["2026-11-03"].status, d["2026-11-03"].missing, d["2026-11-03"].late], ["missing", "out", 20], "the 17:00 online check-out doesn't count");
});

test("Combined: both, and each time says where it came from", async () => {
  const d = await days("combined");
  assert.equal(d["2026-11-01"].inSrc, "fingerprint");
  assert.deepEqual([d["2026-11-02"].inSrc, d["2026-11-02"].outSrc], ["online", "online"]);
  const x = d["2026-11-03"];
  assert.deepEqual([x.status, x.inSrc, x.outSrc, x.late, x.early], ["present", "fingerprint", "online", 20, 60]);
});

test("the report and the monthly data follow the chosen source", async () => {
  const late = async (src) => (await hr.c.get(`/api/attendance/report?from=2026-11-01&to=2026-11-03&source=${src}`)).data.people.find((p) => p.employee.id === s.emp.id);
  assert.deepEqual([(await late("online")).late, (await late("fingerprint")).late, (await late("combined")).late], [1, 1, 2]);
  assert.equal((await late("fingerprint")).absent, 1);
  const m = (await hr.c.get(`/api/attendance/monthly?month=2026-11&source=fingerprint&employee_id=${s.emp.id}`)).data;
  assert.equal(m.source, "machine");
  assert.equal(m.people[0].days.find((x) => x.date === "2026-11-02").status, "absent");
  const mc = (await hr.c.get(`/api/attendance/monthly?month=2026-11&source=combined&employee_id=${s.emp.id}`)).data;
  assert.equal(mc.people[0].days.find((x) => x.date === "2026-11-03").outSrc, "online");
  // staff: their own month, the same choice
  assert.equal((await s.c.get(`/api/attendance/employee/${s.emp.id}?month=2026-11&source=online`)).status, 200);
});

test("an untagged older check-in is listed for HR and counts in no report", async () => {
  insCheckin(s.emp.id, "in", "2026-11-04 09:00", { source: null });
  const r = (await hr.c.get("/api/attendance/punch-sources")).data;
  assert.equal(r.unclear.length, 1); assert.equal(r.unclear[0].emp_no, "S1");
  assert.ok(r.fingerprint >= 3 && r.online >= 3);
  assert.notEqual((await days("combined"))["2026-11-04"].in, 540, "not guessed into the day");
  assert.equal((await s.c.get("/api/attendance/punch-sources")).status, 403);
});

test("the online check-in log: only online check-ins; the flagged / unverified filter", async () => {
  insCheckin(s.emp.id, "in", "2026-11-05 09:05", { flags: JSON.stringify([{ code: "unverified" }]) });
  insCheckin(s.emp.id, "in", "2026-11-06 09:05", { flags: JSON.stringify([{ code: "outside", km: 1.2 }]) });
  const q = (x) => hr.c.get(`/api/attendance/checkins?from=2026-11-01&to=2026-11-10${x}`).then((r) => r.data.rows.map((y) => y.date).sort());
  assert.deepEqual(await q(""), ["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06"], "the untagged one and the fingerprint aren't in the log");
  assert.deepEqual(await q("&flag=flagged"), ["2026-11-05", "2026-11-06"]);
  assert.deepEqual(await q("&flag=unverified"), ["2026-11-05"]);
  const r = (await mgr.c.get("/api/attendance/checkins?from=2026-11-01&to=2026-11-10")).data;
  assert.ok(r.rows.length >= 1 && r.generated_at, "the manager sees their team");
});
