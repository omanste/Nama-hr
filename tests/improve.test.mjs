// Approver cover, security fixes from the review, team calendar
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson, client } from "./helpers.mjs";

let t, admin, hr, tawfiq, deputy, staff, other, ceo, dept;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-10-26" });
  admin = await adminClient(t.base);
  dept = (await admin.post("/api/departments", { name_ar: "المبيعات" })).data.department;
  const dept2 = (await admin.post("/api/departments", { name_ar: "المالية" })).data.department;
  tawfiq = await makePerson(t.base, admin, { emp_no: "T1", name_ar: "توفيق", join_date: "2020-01-01", department_id: dept.id }, "staff");
  deputy = await makePerson(t.base, admin, { emp_no: "D1", name_ar: "نائب", join_date: "2020-01-01", department_id: dept.id }, "staff");
  staff = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف", join_date: "2022-01-01", department_id: dept.id, opening_days: 30 }, "staff");
  other = await makePerson(t.base, admin, { emp_no: "O1", name_ar: "آخر", join_date: "2022-01-01", department_id: dept2.id, opening_days: 30 }, "staff");
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  ceo = await makePerson(t.base, admin, { emp_no: "C1", name_ar: "إسحاق", join_date: "2018-01-01" }, "ceo");
  await admin.put(`/api/departments/${dept.id}`, { approver_employee_id: tawfiq.emp.id });
  await admin.put("/api/settings", { managers_approver_employee_id: ceo.emp.id });
});
after(async () => { await t.close(); });

test("an approver names a deputy for dates; new requests go to the deputy, who can also decide waiting ones", async () => {
  const waiting = await staff.c.post("/api/requests", { type: "annual", start: "2026-12-01", end: "2026-12-01" });
  assert.equal(waiting.data.request.approver_user_id, tawfiq.user.id);
  assert.equal((await tawfiq.c.post("/api/cover", { deputy_user_id: tawfiq.user.id, start: "2026-10-20", end: "2026-11-05" })).status, 400);
  assert.equal((await staff.c.post("/api/cover", { deputy_user_id: deputy.user.id, start: "2026-10-20", end: "2026-11-05" })).status, 403, "only approvers set cover");
  const c = await tawfiq.c.post("/api/cover", { deputy_user_id: deputy.user.id, start: "2026-10-20", end: "2026-11-05" });
  assert.equal(c.status, 201);
  const fresh = await staff.c.post("/api/requests", { type: "annual", start: "2026-12-10", end: "2026-12-10" });
  assert.equal(fresh.data.request.approver_user_id, tawfiq.user.id, "stays with the real approver");
  assert.equal(fresh.data.request.route_reason, "cover");
  const list = (await deputy.c.get("/api/requests?scope=approvals")).data.items.map((x) => x.id).sort();
  assert.deepEqual(list, [waiting.data.request.id, fresh.data.request.id].sort());
  assert.equal((await deputy.c.get("/api/me")).data.pendingApprovals, 2);
  assert.equal((await deputy.c.post(`/api/requests/${waiting.data.request.id}/approve`, {})).status, 200);
  assert.equal((await tawfiq.c.get("/api/cover")).data.items.length, 1);
  const cand = (await tawfiq.c.get("/api/cover")).data.candidates;
  assert.ok(cand.some((x) => x.id === deputy.user.id) && !cand.some((x) => x.id === tawfiq.user.id));
  assert.equal((await staff.c.get("/api/cover")).data.candidates, undefined);
  assert.equal((await tawfiq.c.del(`/api/cover/${c.data.cover.id}`)).status, 200);
  assert.equal((await deputy.c.post(`/api/requests/${fresh.data.request.id}/approve`, {})).status, 403, "after the cover ends the deputy can't decide");
  assert.equal((await tawfiq.c.post(`/api/requests/${fresh.data.request.id}/approve`, {})).status, 200, "the real approver can");
});

test("cover outside its dates does nothing", async () => {
  await tawfiq.c.post("/api/cover", { deputy_user_id: deputy.user.id, start: "2027-01-01", end: "2027-01-10" });
  const r = await staff.c.post("/api/requests", { type: "annual", start: "2026-12-20", end: "2026-12-20" });
  assert.equal(r.data.request.approver_user_id, tawfiq.user.id);
});

test("nobody approves their own request — not even Admin", async () => {
  const me = await makePerson(t.base, admin, { emp_no: "A9", name_ar: "مدير النظام", join_date: "2019-01-01", opening_days: 10 }, "admin");
  const r = await me.c.post("/api/requests", { type: "annual", start: "2026-12-01", end: "2026-12-01" });
  assert.notEqual(r.data.request.approver_user_id, me.user.id);
  const a = await me.c.post(`/api/requests/${r.data.request.id}/approve`, {});
  assert.equal(a.status, 403);
  assert.equal((await admin.post(`/api/requests/${r.data.request.id}/approve`, {})).status, 200, "another admin can");
});

test("only Admin can mark an Admin or CEO as resigned", async () => {
  assert.equal((await hr.c.put(`/api/employees/${ceo.emp.id}`, { status: "resigned" })).status, 403);
  assert.equal((await hr.c.put(`/api/employees/${ceo.emp.id}`, { job_title: "CEO" })).status, 200, "other edits are fine");
  assert.equal((await hr.c.put(`/api/employees/${other.emp.id}`, { status: "on_leave" })).status, 200);
  await hr.c.put(`/api/employees/${other.emp.id}`, { status: "active" });
});

test("Admin cannot switch off their own account by any value", async () => {
  const me = (await admin.get("/api/me")).data.user;
  for (const v of [false, 0, "", null]) assert.equal((await admin.put(`/api/users/${me.id}`, { active: v })).status, 400, String(v));
});

test("lock-out: a forged X-Forwarded-For does not reset the counter; unknown users take as long as real ones", async () => {
  const tries = async (n, fwd) => { let last; for (let i = 0; i < n; i++) last = await fetch(t.base + "/api/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": fwd(i) }, body: JSON.stringify({ username: "victim", password: "x" + i }) }); return last.status; };
  assert.equal(await tries(7, (i) => `10.0.0.${i}`), 429);
  const time = async (u) => { const s = performance.now(); await client(t.base).post("/api/login", { username: u, password: "wrong-pass" }); return performance.now() - s; };
  const known = await time("t1"), unknown = await time("nobody-here");
  assert.ok(unknown > known / 3, `unknown user answered in ${unknown.toFixed(1)}ms vs ${known.toFixed(1)}ms`);
});

test("team calendar: who is off in a month, by visibility", async () => {
  await admin.put("/api/settings", { official_holidays: [{ date: "2026-12-18", name: "عطلة" }] });
  const r = await tawfiq.c.get("/api/calendar?month=2026-12");
  assert.equal(r.status, 200);
  assert.ok(r.data.items.length >= 2);
  assert.ok(r.data.items.every((x) => x.department_id === dept.id), "a manager sees their department");
  assert.ok(r.data.items.every((x) => ["pending", "approved"].includes(x.status)));
  assert.deepEqual(r.data.holidays.map((x) => x.date), ["2026-12-18"]);
  assert.ok((await hr.c.get("/api/calendar?month=2026-12")).data.items.length >= r.data.items.length);
  assert.equal((await staff.c.get("/api/calendar?month=2026-12")).status, 403);
  assert.equal((await hr.c.get("/api/calendar?month=2026-13")).status, 400);
});

test("an approver must name a deputy for their own annual or emergency leave; cancelling removes the cover", async () => {
  const no = await tawfiq.c.post("/api/requests", { type: "annual", start: "2027-03-01", end: "2027-03-05" });
  assert.equal(no.status, 400); assert.equal(no.data.error, "deputy_required");
  assert.equal((await tawfiq.c.post("/api/requests", { type: "annual", start: "2027-03-01", end: "2027-03-05", deputy_user_id: tawfiq.user.id })).data.error, "deputy_required");
  const ok = await tawfiq.c.post("/api/requests", { type: "annual", start: "2027-03-01", end: "2027-03-05", deputy_user_id: deputy.user.id });
  assert.equal(ok.status, 201);
  const cover = (await tawfiq.c.get("/api/cover")).data.items.find((c) => c.request_id === ok.data.request.id);
  assert.ok(cover && cover.start_date === "2027-03-01" && cover.end_date === "2027-03-05" && cover.deputy_user_id === deputy.user.id);
  assert.equal((await staff.c.post("/api/requests", { type: "annual", start: "2027-04-01", end: "2027-04-01" })).status, 201, "staff don't need a deputy");
  assert.equal((await tawfiq.c.post("/api/requests", { type: "sick", start: "2026-10-20", end: "2026-10-20" })).status, 201, "unplanned leave doesn't need one");
  await tawfiq.c.post(`/api/requests/${ok.data.request.id}/cancel`, {});
  assert.ok(!(await tawfiq.c.get("/api/cover")).data.items.some((c) => c.request_id === ok.data.request.id));
});
