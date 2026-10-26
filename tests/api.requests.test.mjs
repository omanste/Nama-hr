import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { setTransport } from "../server/notify.mjs";

const mails = [];
let t, admin, ceo, tawfiq, hr, staff, junior, sales, fin, finMgr;
const days = (n) => n * 480;

before(async () => {
  setTransport(async (m) => { mails.push(m); });
  t = await boot({ FAKE_TODAY: "2026-10-26" });
  admin = await adminClient(t.base);
  sales = (await admin.post("/api/departments", { name_ar: "المبيعات", name_en: "Sales" })).data.department;
  fin = (await admin.post("/api/departments", { name_ar: "المالية", name_en: "Finance" })).data.department;
  ceo = await makePerson(t.base, admin, { emp_no: "C1", name_ar: "الرئيس التنفيذي", email: "ceo@nama.om", join_date: "2018-01-01" }, "ceo");
  tawfiq = await makePerson(t.base, admin, { emp_no: "T1", name_ar: "توفيق", name_en: "Tawfiq", email: "tawfiq@nama.om", department_id: sales.id, join_date: "2022-03-01" }, "staff");
  finMgr = await makePerson(t.base, admin, { emp_no: "F1", name_ar: "مدير المالية", department_id: fin.id, join_date: "2021-01-01" }, "staff");
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "الموارد", join_date: "2020-01-01" }, "hr");
  staff = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف المبيعات", email: "s1@nama.om", department_id: sales.id, join_date: "2024-01-01", opening_days: 10 }, "staff");
  junior = await makePerson(t.base, admin, { emp_no: "J1", name_ar: "جديد", department_id: sales.id, join_date: "2026-08-20" }, "staff");
  await admin.put(`/api/departments/${sales.id}`, { approver_employee_id: tawfiq.emp.id });
  await admin.put(`/api/departments/${fin.id}`, { approver_employee_id: finMgr.emp.id });
  await admin.put("/api/settings", { managers_approver_employee_id: ceo.emp.id, managers_approver_title: "ceo" });
});
after(async () => { setTransport(null); await t.close(); });

const remaining = async (c, id) => (await c.get(`/api/employees/${id}`)).data.leave.remaining;
let annualId;

test("staff request goes to the department approver and notifies them", async () => {
  mails.length = 0;
  const r = await staff.c.post("/api/requests", { type: "annual", start: "2026-11-01", end: "2026-11-05", reason: "سفر" });
  assert.equal(r.status, 201);
  annualId = r.data.request.id;
  assert.equal(r.data.request.status, "pending");
  assert.equal(r.data.request.minutes, days(5));
  assert.equal(r.data.request.approver_user_id, tawfiq.user.id);
  const n = await tawfiq.c.get("/api/notifications");
  assert.ok(n.data.unread >= 1);
  assert.ok(n.data.items.some((x) => x.link === `#/leave/${annualId}`));
  assert.ok(mails.some((m) => m.to === "tawfiq@nama.om" && /\[dev\]|\[test\]|إجازة|leave/i.test(m.subject)));
  const ap = await tawfiq.c.get("/api/requests?scope=approvals");
  assert.deepEqual(ap.data.items.map((x) => x.id), [annualId]);
});

test("a second request that would exceed available balance is refused", async () => {
  const r = await staff.c.post("/api/requests", { type: "annual", start: "2026-12-01", end: "2026-12-06" });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, "insufficient_balance");
  assert.match(r.data.message, /5/);
});

test("overlapping requests are refused", async () => {
  const r = await staff.c.post("/api/requests", { type: "sick", start: "2026-11-04", end: "2026-11-06" });
  assert.equal(r.status, 409); assert.equal(r.data.error, "overlap");
  const e = await staff.c.post("/api/requests", { type: "early", date: "2026-11-03", time: "15:00" });
  assert.equal(e.status, 409); assert.equal(e.data.error, "overlap");
});

test("invalid input is refused", async () => {
  assert.equal((await staff.c.post("/api/requests", { type: "annual", start: "2026-11-10", end: "2026-11-09" })).status, 400);
  assert.equal((await staff.c.post("/api/requests", { type: "early", date: "2026-11-10", time: "15:15" })).status, 400);
  assert.equal((await staff.c.post("/api/requests", { type: "vacation", start: "2026-11-10", end: "2026-11-10" })).status, 400);
  assert.equal((await staff.c.post("/api/requests", { type: "annual", start: "2026-01-01", end: "2026-03-05" })).status, 400);
});

test("HR cannot approve; the department approver can, and the balance drops", async () => {
  const no = await hr.c.post(`/api/requests/${annualId}/approve`, {});
  assert.equal(no.status, 403);
  mails.length = 0;
  const ok = await tawfiq.c.post(`/api/requests/${annualId}/approve`, { comment: "موافق" });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.request.status, "approved");
  assert.equal(await remaining(hr.c, staff.emp.id), days(5));
  assert.ok(mails.some((m) => m.to === "s1@nama.om"));
  assert.equal((await tawfiq.c.post(`/api/requests/${annualId}/approve`, {})).status, 409);
});

test("early leave deducts hours once approved", async () => {
  const r = await staff.c.post("/api/requests", { type: "early", date: "2026-11-10", time: "15:30" });
  assert.equal(r.status, 201);
  assert.equal(r.data.request.minutes, 90);
  assert.equal((await tawfiq.c.post(`/api/requests/${r.data.request.id}/approve`, {})).status, 200);
  assert.equal(await remaining(hr.c, staff.emp.id), days(5) - 90);
});

test("cancelling an approved request reverses its deduction", async () => {
  assert.equal((await staff.c.post(`/api/requests/${annualId}/cancel`, {})).status, 403); // owner cannot cancel approved
  const r = await tawfiq.c.post(`/api/requests/${annualId}/cancel`, { comment: "تغيير" });
  assert.equal(r.status, 200);
  assert.equal(r.data.request.status, "cancelled");
  assert.equal(await remaining(hr.c, staff.emp.id), days(10) - 90);
  const p = await hr.c.get(`/api/employees/${staff.emp.id}`);
  assert.ok(p.data.ledger.some((l) => l.kind === "reversal" && l.minutes === days(5)));
});

test("owner may cancel a pending request", async () => {
  const r = await staff.c.post("/api/requests", { type: "annual", start: "2027-01-03", end: "2027-01-03" });
  assert.equal((await staff.c.post(`/api/requests/${r.data.request.id}/cancel`, {})).status, 200);
  assert.equal(await remaining(hr.c, staff.emp.id), days(10) - 90);
});

test("managers' leave goes to the CEO; the CEO's goes to admin", async () => {
  const a = await tawfiq.c.post("/api/requests", { type: "annual", start: "2026-12-20", end: "2026-12-21" });
  assert.equal(a.data.request.approver_user_id, ceo.user.id);
  assert.equal(a.data.request.route_reason, "managers");
  const h = await hr.c.post("/api/requests", { type: "annual", start: "2026-12-20", end: "2026-12-20" });
  assert.equal(h.data.request.approver_user_id, ceo.user.id);
  const c = await ceo.c.post("/api/requests", { type: "annual", start: "2026-12-20", end: "2026-12-20" });
  assert.equal(c.data.request.route_reason, "admin");
  assert.equal((await ceo.c.post(`/api/requests/${a.data.request.id}/approve`, {})).status, 200);
});

test("changing the approver keeps pending requests with the stored approver; admin can still act", async () => {
  const r = await staff.c.post("/api/requests", { type: "annual", start: "2027-02-01", end: "2027-02-02" });
  await admin.put(`/api/departments/${sales.id}`, { approver_employee_id: finMgr.emp.id });
  const got = await staff.c.get(`/api/requests/${r.data.request.id}`);
  assert.equal(got.data.request.approver_user_id, tawfiq.user.id);
  assert.equal((await finMgr.c.post(`/api/requests/${r.data.request.id}/approve`, {})).status, 403);
  assert.equal((await admin.post(`/api/requests/${r.data.request.id}/approve`, {})).status, 200);
  await admin.put(`/api/departments/${sales.id}`, { approver_employee_id: tawfiq.emp.id });
});

test("rejection needs a reason", async () => {
  const r = await staff.c.post("/api/requests", { type: "annual", start: "2027-03-01", end: "2027-03-01" });
  assert.equal((await tawfiq.c.post(`/api/requests/${r.data.request.id}/reject`, {})).status, 400);
  const ok = await tawfiq.c.post(`/api/requests/${r.data.request.id}/reject`, { comment: "ضغط عمل" });
  assert.equal(ok.data.request.status, "rejected");
  assert.equal(ok.data.request.decision_comment, "ضغط عمل");
});

test("approval re-checks the balance", async () => {
  const before = await remaining(hr.c, staff.emp.id);
  const r = await staff.c.post("/api/requests", { type: "annual", start: "2027-04-01", end: "2027-04-02" });
  assert.equal(r.status, 201);
  await hr.c.post(`/api/employees/${staff.emp.id}/adjust`, { minutes: -(before - 480), note: "تصحيح الرصيد" });
  const a = await tawfiq.c.post(`/api/requests/${r.data.request.id}/approve`, {});
  assert.equal(a.status, 409); assert.equal(a.data.error, "insufficient_balance");
  await hr.c.post(`/api/employees/${staff.emp.id}/adjust`, { minutes: before - 480, note: "إرجاع" });
});

test("new joiners cannot take annual or early leave before six months; record types are fine", async () => {
  const a = await junior.c.post("/api/requests", { type: "annual", start: "2026-11-01", end: "2026-11-01" });
  assert.equal(a.status, 409); assert.equal(a.data.error, "not_eligible_yet");
  assert.match(a.data.message, /2027-02-20|20\/02\/2027/);
  assert.equal((await junior.c.post("/api/requests", { type: "early", date: "2026-11-02", time: "16:00" })).data.error, "not_eligible_yet");
  const s = await junior.c.post("/api/requests", { type: "sick", start: "2026-10-20", end: "2026-10-21", reason: "زكام" });
  assert.equal(s.status, 201);
  const before = await remaining(hr.c, junior.emp.id);
  assert.equal((await tawfiq.c.post(`/api/requests/${s.data.request.id}/approve`, {})).status, 200);
  assert.equal(await remaining(hr.c, junior.emp.id), before);
  const pdf = Buffer.from("%PDF-1.4 note");
  const up = await junior.c.upload(`/api/requests/${s.data.request.id}/files?name=note.pdf`, pdf, "application/pdf");
  assert.equal(up.status, 201);
  assert.equal((await tawfiq.c.get(`/api/requests/${s.data.request.id}`)).data.files.length, 1);
});

test("worked-on-holiday adds one day once approved and only once per date", async () => {
  const before = await remaining(hr.c, staff.emp.id);
  const r = await staff.c.post("/api/requests", { type: "comp_day", date: "2026-10-24", reason: "معرض" });
  assert.equal(r.status, 201);
  assert.equal((await tawfiq.c.post(`/api/requests/${r.data.request.id}/approve`, {})).status, 200);
  assert.equal(await remaining(hr.c, staff.emp.id), before + 480);
  assert.equal((await staff.c.post("/api/requests", { type: "comp_day", date: "2026-10-24" })).data.error, "overlap");
  assert.equal((await staff.c.post("/api/requests", { type: "comp_day", date: "2026-10-30" })).status, 400);
});

test("history records who requested and who decided", async () => {
  const r = await staff.c.get(`/api/requests/${annualId}`);
  const acts = r.data.events.map((e) => e.action);
  assert.deepEqual(acts, ["submitted", "approved", "cancelled"]);
  assert.equal(r.data.events[1].actor_user_id, tawfiq.user.id);
  assert.ok(r.data.events[1].at);
  assert.equal(r.data.events[1].actor_name, "توفيق");
});

test("visibility: staff see only their own requests; accounts see all", async () => {
  const other = await finMgr.c.post("/api/requests", { type: "sick", start: "2026-10-01", end: "2026-10-01" });
  assert.equal((await staff.c.get(`/api/requests/${other.data.request.id}`)).status, 403);
  assert.equal((await staff.c.get("/api/requests?scope=all")).status, 403);
  const acc = await makePerson(t.base, admin, { emp_no: "A1", name_ar: "حسابات" }, "accounts");
  const all = await acc.c.get("/api/requests?scope=all");
  assert.equal(all.status, 200);
  assert.ok(all.data.items.length >= 5);
  assert.equal((await acc.c.post(`/api/requests/${other.data.request.id}/approve`, {})).status, 403);
  const team = await tawfiq.c.get("/api/requests?scope=team");
  assert.ok(team.data.items.every((x) => x.department_id === sales.id));
});

test("notifications can be marked read", async () => {
  const n = await staff.c.get("/api/notifications");
  assert.ok(n.data.unread > 0);
  assert.equal((await staff.c.post("/api/notifications/read", { all: true })).status, 200);
  assert.equal((await staff.c.get("/api/notifications")).data.unread, 0);
});

test("a failing mail server never blocks the request", async () => {
  setTransport(async () => { throw new Error("smtp down"); });
  const r = await staff.c.post("/api/requests", { type: "annual", start: "2027-05-01", end: "2027-05-01" });
  assert.equal(r.status, 201);
  setTransport(async (m) => { mails.push(m); });
});
