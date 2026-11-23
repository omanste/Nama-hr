// The Staff tab: HR and Admin only; the seven columns' data, leave days left, status with the last working day, "On leave"
// set and cleared by itself, Resigned / Terminated can't sign in, status changes logged. Made-up people.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson, client } from "./helpers.mjs";
import { syncLeaveStatus } from "../server/employees.mjs";

let t, admin, hr, mgr, a, b;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-11-23" });
  admin = await adminClient(t.base);
  hr = await makePerson(t.base, admin, { emp_no: "NAMA-090", name_ar: "موارد بشرية", name_en: "Human Resources Officer", join_date: "2020-01-01" }, "hr");
  mgr = await makePerson(t.base, admin, { emp_no: "NAMA-091", name_ar: "مدير", join_date: "2020-01-01" }, "manager");
  a = await makePerson(t.base, admin, { emp_no: "NAMA-005", name_ar: "سالم بن خالد بن محمد بن عبدالله البلوشي", name_en: "Salim Khalid Mohammed Abdullah Al Balushi Al Makhzoumi", join_date: "2024-03-01", job_title: "Accountant | محاسب" }, "staff");
  b = await makePerson(t.base, admin, { emp_no: "NAMA-002", name_ar: "منى", name_en: "", join_date: "2025-06-15" }, "staff");
});
after(async () => { await t.close(); });

test("HR and Admin get the list; managers and staff are refused", async () => {
  for (const c of [admin, hr.c]) assert.equal((await c.get("/api/staff-list")).status, 200);
  for (const c of [mgr.c, a.c]) assert.equal((await c.get("/api/staff-list")).status, 403);
});

test("each row: number, both names, department, job title, join date, leave left, status; what is missing is counted", async () => {
  const r = (await hr.c.get("/api/staff-list")).data;
  assert.deepEqual(r.items.map((e) => e.emp_no).slice(0, 2), ["NAMA-002", "NAMA-005"], "by employee number");
  const x = r.items.find((e) => e.emp_no === "NAMA-005");
  assert.equal(x.name_en, "Salim Khalid Mohammed Abdullah Al Balushi Al Makhzoumi", "the full name, never cut");
  assert.equal(x.job_title, "Accountant | محاسب"); assert.equal(x.join_date, "2024-03-01"); assert.equal(x.status, "active");
  assert.equal(typeof x.remaining, "number"); assert.equal(r.day, 480);
  assert.ok(r.missing.name_en >= 2 && r.missing.department >= 4 && r.missing.job_title >= 3, JSON.stringify(r.missing));
});

test("On leave is set while approved leave covers today and goes back to Active after; a status set by hand is left alone", async () => {
  const ins = t.db.prepare("INSERT INTO leave_requests(employee_id,type,start_date,end_date,minutes,status,created_at) VALUES(?,?,?,?,?,?,?)");
  ins.run(a.emp.id, "annual", "2026-11-22", "2026-11-25", 1920, "approved", "2026-11-01T08:00:00Z");
  ins.run(b.emp.id, "early", "2026-11-23", "2026-11-23", 60, "approved", "2026-11-01T08:00:00Z"); // a short permission is not leave
  const row = async (id) => (await hr.c.get("/api/staff-list")).data.items.find((e) => e.id === id);
  assert.equal((await row(a.emp.id)).status, "on_leave");
  assert.equal((await row(b.emp.id)).status, "active");
  assert.deepEqual(syncLeaveStatus(t.db, "2026-11-26").map((c) => [c.id, c.to]), [[a.emp.id, "active"]], "the leave ended");
  assert.equal(t.db.prepare("SELECT status FROM employees WHERE id=?").get(a.emp.id).status, "active");
  const log = t.db.prepare("SELECT after FROM audit_log WHERE action='employee.status' AND entity_id=? ORDER BY id").all(String(a.emp.id)).map((r) => JSON.parse(r.after));
  assert.deepEqual(log.map((l) => [l.status, l.auto]), [["on_leave", true], ["active", true]], "logged, both ways");
  // HR puts someone on "On leave" by hand: it stays
  await hr.c.put(`/api/employees/${b.emp.id}`, { status: "on_leave" });
  syncLeaveStatus(t.db, "2026-11-26");
  assert.equal(t.db.prepare("SELECT status FROM employees WHERE id=?").get(b.emp.id).status, "on_leave");
  await hr.c.put(`/api/employees/${b.emp.id}`, { status: "active" });
});

test("Resigned / Terminated: the last working day is needed and kept, they can no longer sign in, the change is logged", async () => {
  const put = (b2) => hr.c.put(`/api/employees/${a.emp.id}`, b2);
  const noDay = await put({ status: "resigned" });
  assert.equal(noDay.status, 400); assert.equal(noDay.data.field, "last_working_day");
  const ok = await put({ status: "resigned", last_working_day: "2026-11-30" });
  assert.equal(ok.status, 200); assert.equal(ok.data.employee.last_working_day, "2026-11-30");
  const again = await client(t.base).post("/api/login", { username: a.user.username, password: "Passw0rd!" + a.emp.id });
  assert.notEqual(again.status, 200, "can't sign in");
  assert.equal((await a.c.get("/api/me")).status, 401, "the open session ended");
  const log = t.db.prepare("SELECT actor_user_id, before, after FROM audit_log WHERE action='employee.status' AND entity_id=? ORDER BY id DESC").get(String(a.emp.id));
  assert.deepEqual([JSON.parse(log.before).status, JSON.parse(log.after).status, JSON.parse(log.after).last_working_day], ["active", "resigned", "2026-11-30"]);
  assert.equal(log.actor_user_id, hr.user.id, "who changed it");
  const term = await hr.c.put(`/api/employees/${b.emp.id}`, { status: "terminated", last_working_day: "2026-11-20" });
  assert.equal(term.status, 200);
  assert.equal(t.db.prepare("SELECT active FROM users WHERE employee_id=?").get(b.emp.id).active, 0);
  // back to Active: the last working day is cleared
  const back = await hr.c.put(`/api/employees/${b.emp.id}`, { status: "active" });
  assert.equal(back.data.employee.last_working_day, null);
});

test("the Staff list says where each current person is right now, from today's attendance", async () => {
  const { presenceNow } = await import("../server/attendance.mjs");
  const { getEmployee } = await import("../server/employees.mjs");
  const ins = t.db.prepare("INSERT INTO att_checkins(employee_id,kind,at,lat,lng,outside,created_at,ip,user_agent,checks,verified) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
  const make = async (no) => (await admin.post("/api/employees", { emp_no: no, name_ar: no, join_date: "2021-01-01" })).data.employee;
  const [onDuty, out, away, task] = [await make("P1"), await make("P2"), await make("P3"), await make("P4")];
  for (const e of [onDuty, out, away, task]) ins.run(e.id, "in", "2026-11-01 09:00", 23.6, 58.5, 0, "x", "1", "u", "{}", 1); // online from before
  ins.run(onDuty.id, "in", "2026-11-23 08:41", 23.6, 58.5, 0, "x", "1", "u", "{}", 1);
  ins.run(out.id, "in", "2026-11-23 08:30", 23.6, 58.5, 0, "x", "1", "u", "{}", 1); ins.run(out.id, "out", "2026-11-23 11:00", 23.6, 58.5, 0, "x", "1", "u", "{}", 1);
  t.db.prepare("INSERT INTO leave_requests(employee_id,type,start_date,end_date,minutes,status,created_at,early_time,end_time) VALUES(?,?,?,?,?,?,?,?,?)").run(task.id, "mission", "2026-11-23", "2026-11-23", 420, "approved", "x", "09:00", "16:00");
  const at = (e) => presenceNow(t.db, getEmployee(t.db, e.id), "2026-11-23", 11 * 60 + 30).code;
  assert.deepEqual([at(onDuty), at(out), at(away), at(task)], ["on_duty", "checked_out", "not_in", "mission"]);
  const r = (await hr.c.get("/api/staff-list")).data;
  const byNo = Object.fromEntries(r.items.map((e) => [e.emp_no, e.now && e.now.code]));
  assert.deepEqual([byNo.P1, byNo.P2, byNo.P3, byNo.P4].length, 4);
  assert.ok(r.items.filter((e) => ["P1", "P2", "P3", "P4"].includes(e.emp_no)).every((e) => e.now && e.now.code));
});
