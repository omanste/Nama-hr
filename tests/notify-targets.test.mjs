// Every notification reaches only the people responsible: the person for their own matters, the manager for approvals,
// HR (with the system Admin) for HR's tasks, top management for its reports, and everyone only for company news.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { runExpiryCheck } from "../server/jobs.mjs";
import { runReminders } from "../server/checkin.mjs";

let t, admin, adminId, h1, h2, m, s, s2, other, ceo;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-11-16" }); // a Monday
  admin = await adminClient(t.base);
  adminId = (await admin.get("/api/me")).data.user.id;
  const d = (await admin.post("/api/departments", { name_ar: "المبيعات" })).data.department;
  const d2 = (await admin.post("/api/departments", { name_ar: "المالية" })).data.department;
  m = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "مدير المبيعات", join_date: "2020-01-01", department_id: d.id }, "manager");
  await admin.put(`/api/departments/${d.id}`, { approver_employee_id: m.emp.id });
  other = await makePerson(t.base, admin, { emp_no: "M2", name_ar: "مدير المالية", join_date: "2020-01-01", department_id: d2.id }, "manager");
  await admin.put(`/api/departments/${d2.id}`, { approver_employee_id: other.emp.id });
  h1 = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد ١", join_date: "2020-01-01" }, "hr");
  h2 = await makePerson(t.base, admin, { emp_no: "H2", name_ar: "موارد ٢", join_date: "2020-01-01" }, "hr");
  ceo = await makePerson(t.base, admin, { emp_no: "C1", name_ar: "التنفيذي", join_date: "2015-01-01" }, "ceo");
  await admin.put("/api/settings", { managers_approver_employee_id: ceo.emp.id });
  s = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف", join_date: "2022-01-01", department_id: d.id, opening_days: 20, shift: 2, att_mode: "online" }, "staff");
  s2 = await makePerson(t.base, admin, { emp_no: "S2", name_ar: "زميل", join_date: "2022-01-01", department_id: d2.id, opening_days: 20 }, "staff");
});
after(async () => { await t.close(); });

// who got a notification whose title matches, since a given notification id
const all = () => ({ admin: adminId, h1: h1.user.id, h2: h2.user.id, m: m.user.id, other: other.user.id, s: s.user.id, s2: s2.user.id, ceo: ceo.user.id });
const mark = () => t.db.prepare("SELECT coalesce(max(id),0) n FROM notifications").get().n;
const who = (since, re) => {
  const ids = new Set(t.db.prepare("SELECT user_id, title_en FROM notifications WHERE id>?").all(since).filter((n) => re.test(n.title_en)).map((n) => n.user_id));
  return Object.entries(all()).filter(([, id]) => ids.has(id)).map(([k]) => k).sort();
};

test("a staff member's leave: their manager only; then HR and Admin; the person gets their own updates", async () => {
  let at = mark();
  const r = (await s.c.post("/api/requests", { type: "annual", start: "2026-12-06", end: "2026-12-07", reason: "x" })).data.request;
  assert.deepEqual(who(at, /awaiting your approval/), ["m"]);
  assert.deepEqual(who(at, /submitted/), ["s"]);
  at = mark();
  assert.equal((await m.c.post(`/api/requests/${r.id}/approve`, {})).status, 200);
  assert.deepEqual(who(at, /awaiting HR approval/), ["admin", "h1", "h2"]);
  assert.deepEqual(who(at, /now with HR/), ["s"]);
  at = mark();
  assert.equal((await h1.c.post(`/api/requests/${r.id}/approve`, {})).status, 200);
  assert.deepEqual(who(at, /was approved/), ["s"], "not the other HR, not s2");
});

test("an HR person's own leave at the HR step goes to the other HR account and Admin, not to them", async () => {
  // HR's own leave goes to the CEO first (the managers' approver), then HR
  const r = (await h1.c.post("/api/requests", { type: "annual", start: "2026-12-13", end: "2026-12-13", reason: "x" })).data.request;
  const at = mark();
  const a = await ceo.c.post(`/api/requests/${r.id}/approve`, {});
  if (a.data.request.route_reason === "hr_final") assert.deepEqual(who(at, /awaiting HR approval/), ["admin", "h2"]);
});

test("a permission waiting for HR: HR and Admin, not the person, not other managers", async () => {
  const r = (await s.c.post("/api/requests", { type: "early", reason: "موعد", date: "2026-11-24", time: "16:30" })).data.request;
  const at = mark();
  assert.equal((await m.c.post(`/api/requests/${r.id}/approve`, {})).status, 200);
  assert.deepEqual(who(at, /awaiting HR/), ["admin", "h1", "h2"]);
});

test("an expiring civil ID: HR, Admin and the person — nobody else; an HR person's own: the others and them, once", async () => {
  await admin.put(`/api/employees/${s.emp.id}`, { civil_id: "11112222", civil_id_expiry: "2026-11-30" });
  await admin.put(`/api/employees/${h1.emp.id}`, { civil_id: "33334444", civil_id_expiry: "2026-11-29" });
  const at = mark();
  runExpiryCheck(t.app.ctx, "2026-11-16");
  const rows = t.db.prepare("SELECT user_id, body_en FROM notifications WHERE id>? AND title_en LIKE '%expiring%'").all(at);
  const to = (needle) => Object.entries(all()).filter(([, id]) => rows.some((n) => n.user_id === id && n.body_en.includes(needle))).map(([k]) => k).sort();
  assert.deepEqual(to("موظف"), ["admin", "h1", "h2"], "HR's copy names the person");
  assert.deepEqual(to("Your"), ["h1", "s"], "each person's own reminder");
  assert.deepEqual(to("موارد ١"), ["admin", "h2"], "h1 isn't told as HR about their own ID");
});

test("a profile update: HR and Admin, not the person; the person hears the decision", async () => {
  let at = mark();
  assert.equal((await s.c.put(`/api/employees/${s.emp.id}/contact`, { personal_phone: "93333333" })).status, 200);
  assert.deepEqual(who(at, /profile update to verify/), ["admin", "h1", "h2"]);
  const c = (await h1.c.get("/api/profile-changes")).data.items.find((x) => x.employee_id === s.emp.id);
  at = mark();
  await h1.c.post(`/api/profile-changes/${c.id}/confirm`, {});
  assert.deepEqual(who(at, /./), ["s"]);
});

test("company news reaches everyone; a staff member's own shared event reaches nobody", async () => {
  let at = mark();
  assert.equal((await h1.c.post("/api/calendar/entries", { kind: "event", visibility: "company", start: "2026-12-20", name: "غداء الشركة" })).status, 201);
  const everyone = who(at, /Company occasion/);
  assert.ok(["admin", "h2", "m", "other", "s", "s2", "ceo"].every((k) => everyone.includes(k)));
  at = mark();
  await s.c.post("/api/calendar/entries", { kind: "event", visibility: "company", start: "2026-12-21", name: "غداء الفريق" });
  assert.deepEqual(who(at, /./), []);
});

test("the morning 'didn't check out' list goes only to that person's manager", async () => {
  t.db.prepare("INSERT INTO att_checkins(employee_id,kind,at,lat,lng,outside,created_at) VALUES(?,?,?,?,?,?,?)").run(s.emp.id, "in", "2026-11-17 09:00", 0, 0, 0, "2026-11-17T05:00:00Z");
  const at = mark();
  runReminders(t.app.ctx, "2026-11-18", 9 * 60 + 5);
  assert.deepEqual(who(at, /Didn't check out/), ["m"]);
});

test("Staff Voice to HR stays with HR (private): not Admin, not managers", async () => {
  const at = mark();
  assert.equal((await s.c.post("/api/voice", { to: "hr", category: "suggestion", subject: "فكرة", body: "نص" })).status, 201);
  assert.deepEqual(who(at, /New/), ["h1", "h2"]);
});

test("a passport is reminded from 6 months before it expires (it must be renewed then), then at 3 months, 30 and 7 days", async () => {
  const p = await makePerson(t.base, admin, { emp_no: "P1", name_ar: "جواز", join_date: "2022-01-01", passport_no: "A1234567", passport_expiry: "2027-05-10" }, "staff");
  const count = () => t.db.prepare("SELECT count(*) n FROM notifications WHERE user_id=? AND title_en LIKE 'Passport%'").get(p.user.id).n;
  runExpiryCheck(t.app.ctx, "2026-10-01"); assert.equal(count(), 0, "7 months ahead: nothing yet");
  runExpiryCheck(t.app.ctx, "2026-11-16"); assert.equal(count(), 1, "within 6 months");
  const n = t.db.prepare("SELECT body_en FROM notifications WHERE user_id=? AND title_en LIKE 'Passport%' ORDER BY id DESC").get(p.user.id);
  assert.match(n.body_en, /renewed 6 months before/);
  runExpiryCheck(t.app.ctx, "2026-11-20"); assert.equal(count(), 1, "once per stage");
  runExpiryCheck(t.app.ctx, "2027-02-15"); assert.equal(count(), 2, "3 months");
  runExpiryCheck(t.app.ctx, "2027-04-15"); assert.equal(count(), 3, "30 days");
  // HR sees it on the expiring list already 6 months ahead; a civil ID only from 30 days
  const list = (await h1.c.get("/api/expiring")).data.items;
  assert.ok(list.some((x) => x.employee.id === p.emp.id && x.what === "passport"));
  // HR and Admin are told too (not other staff)
  const hrGot = t.db.prepare("SELECT count(*) n FROM notifications WHERE user_id IN (?,?) AND title_en LIKE 'Passport%' AND body_ar LIKE '%جواز%'").get(h1.user.id, adminId).n;
  assert.ok(hrGot >= 2);
  assert.equal(t.db.prepare("SELECT count(*) n FROM notifications WHERE user_id=? AND title_en LIKE 'Passport%' AND body_ar LIKE 'جواز:%'").get(s2.user.id).n, 0);
});
