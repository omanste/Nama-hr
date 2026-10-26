// Staff Voice: staff write to their manager, HR or the CEO; never anonymous; only the sender, the recipient(s) and Admin can read it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";

let t, admin, hr, hr2, ceo, mgr, s, other, acc;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-10-26" });
  admin = await adminClient(t.base);
  const d = (await admin.post("/api/departments", { name_ar: "المبيعات" })).data.department;
  mgr = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "توفيق", join_date: "2020-01-01", department_id: d.id }, "staff");
  await admin.put(`/api/departments/${d.id}`, { approver_employee_id: mgr.emp.id });
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  hr2 = await makePerson(t.base, admin, { emp_no: "H2", name_ar: "موارد٢", join_date: "2020-01-01" }, "hr");
  ceo = await makePerson(t.base, admin, { emp_no: "C1", name_ar: "إسحاق", join_date: "2015-01-01" }, "ceo");
  acc = await makePerson(t.base, admin, { emp_no: "A1", name_ar: "محاسب", join_date: "2020-01-01" }, "accounts");
  s = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف", join_date: "2022-01-01", department_id: d.id }, "staff");
  other = await makePerson(t.base, admin, { emp_no: "S2", name_ar: "زميل", join_date: "2022-01-01", department_id: d.id }, "staff");
});
after(async () => { await t.close(); });
const send = (c, b) => c.post("/api/voice", { category: "suggestion", subject: "فكرة", body: "نص", ...b });

test("staff choose manager, HR or the CEO; each message reaches only them", async () => {
  const opts = (await s.c.get("/api/voice/recipients")).data.items.map((x) => x.kind);
  assert.deepEqual(opts, ["manager", "hr", "ceo"]);
  const toMgr = (await send(s.c, { to: "manager", category: "question" })).data.message;
  const toHr = (await send(s.c, { to: "hr", category: "complaint", subject: "شكوى من المدير" })).data.message;
  const toCeo = (await send(s.c, { to: "ceo", category: "note" })).data.message;
  assert.equal(toMgr.to_user_id, mgr.user.id);
  const can = async (c, id) => (await c.get(`/api/voice/${id}`)).status;
  // manager: only theirs; HR (both): only HR messages; CEO: only theirs; colleagues and accounts: none; Admin: all
  assert.deepEqual([await can(mgr.c, toMgr.id), await can(mgr.c, toHr.id), await can(mgr.c, toCeo.id)], [200, 403, 403]);
  assert.deepEqual([await can(hr.c, toMgr.id), await can(hr2.c, toHr.id), await can(hr.c, toCeo.id)], [403, 200, 403]);
  assert.deepEqual([await can(ceo.c, toMgr.id), await can(ceo.c, toHr.id), await can(ceo.c, toCeo.id)], [403, 403, 200]);
  for (const c of [other.c, acc.c]) for (const m of [toMgr, toHr, toCeo]) assert.equal(await can(c, m.id), 403);
  for (const m of [toMgr, toHr, toCeo]) assert.equal(await can(admin, m.id), 200);
  // inboxes and notifications follow the same rule
  assert.deepEqual((await mgr.c.get("/api/voice?box=inbox")).data.items.map((x) => x.id), [toMgr.id]);
  assert.deepEqual((await hr2.c.get("/api/voice?box=inbox")).data.items.map((x) => x.id), [toHr.id]);
  assert.equal((await other.c.get("/api/voice?box=inbox")).data.items.length, 0);
  assert.equal((await s.c.get("/api/voice?box=sent")).data.items.length, 3);
  assert.equal((await ceo.c.get("/api/notifications")).data.items.filter((n) => n.link === `#/voice/${toCeo.id}`).length, 1);
  // unread count: a new HR message waits for HR until any HR member opens it
  assert.equal((await hr.c.get("/api/me")).data.voiceInbox, 0);
  const fresh = (await send(other.c, { to: "hr" })).data.message;
  assert.equal((await hr.c.get("/api/me")).data.voiceInbox, 1);
  await hr2.c.get(`/api/voice/${fresh.id}`);
  assert.equal((await hr.c.get("/api/me")).data.voiceInbox, 0);
  // the sender's name is always there
  assert.equal(toHr.name_ar, "موظف");
});

test("conversation: recipient opens → in review, replies → answered; sender can reply and close; others can't", async () => {
  const m = (await send(s.c, { to: "manager", category: "question", subject: "سؤال" })).data.message;
  assert.equal((await mgr.c.get(`/api/voice/${m.id}`)).data.message.status, "in_review");
  assert.equal((await mgr.c.post(`/api/voice/${m.id}/reply`, { body: "" })).status, 400);
  assert.equal((await mgr.c.post(`/api/voice/${m.id}/reply`, { body: "الجواب" })).status, 200);
  assert.equal((await s.c.get(`/api/voice/${m.id}`)).data.message.status, "answered");
  assert.equal((await other.c.post(`/api/voice/${m.id}/reply`, { body: "x" })).status, 403);
  assert.equal((await admin.post(`/api/voice/${m.id}/reply`, { body: "x" })).status, 403); // Admin reads only
  assert.equal((await s.c.post(`/api/voice/${m.id}/reply`, { body: "شكراً" })).status, 200);
  const th = (await s.c.get(`/api/voice/${m.id}`)).data;
  assert.equal(th.replies.length, 2); assert.equal(th.message.status, "in_review");
  assert.equal((await s.c.post(`/api/voice/${m.id}/status`, { status: "answered" })).status, 403); // only the recipient answers
  assert.equal((await s.c.post(`/api/voice/${m.id}/status`, { status: "closed" })).status, 200);
  assert.equal((await mgr.c.post(`/api/voice/${m.id}/reply`, { body: "متأخر" })).status, 409);
});

test("attachments stay inside the conversation", async () => {
  const m = (await send(s.c, { to: "ceo", category: "complaint" })).data.message;
  const f = (await s.c.upload(`/api/voice/${m.id}/files?name=p.pdf`, Buffer.from("%PDF-1.4"), "application/pdf")).data.file;
  const get = (c) => fetch(`${t.base}/api/files/${f.id}`, { headers: { cookie: c.cookie } }).then((r) => r.status);
  assert.equal(await get(ceo.c), 200); assert.equal(await get(s.c), 200);
  assert.equal(await get(hr.c), 403); assert.equal(await get(mgr.c), 403);
  assert.ok(!(await hr.c.get(`/api/employees/${s.emp.id}`)).data.files.some((x) => x.id === f.id)); // not among profile documents
  assert.equal((await hr.c.del(`/api/files/${f.id}`)).status, 403);
});

test("bad input; report counts for management only", async () => {
  assert.equal((await send(s.c, { to: "manager", category: "rumour" })).status, 400);
  assert.equal((await send(s.c, { to: "manager", subject: "" })).status, 400);
  assert.equal((await send(s.c, { to: "board" })).status, 400);
  assert.equal((await send(mgr.c, { to: "manager" })).status, 400); // the manager has no manager of their own here
  const r = (await hr.c.get("/api/reports/voice")).data.rows;
  assert.ok(r.some((x) => x.category === "complaint"));
  assert.equal((await s.c.get("/api/reports/voice")).status, 403);
  assert.equal((await mgr.c.get("/api/reports/voice")).status, 403);
});

test("a manager without a login yet still receives it, and sees it at first sign-in; missing set-up is named", async () => {
  const d = (await admin.post("/api/departments", { name_ar: "التأجير" })).data.department;
  const boss = (await admin.post("/api/employees", { name_ar: "مدير بلا حساب", join_date: "2020-01-01", department_id: d.id })).data.employee;
  await admin.put(`/api/departments/${d.id}`, { approver_employee_id: boss.id });
  const w = await makePerson(t.base, admin, { emp_no: "R9", name_ar: "موظف تأجير", join_date: "2022-01-01", department_id: d.id }, "staff");
  const opts = (await w.c.get("/api/voice/recipients")).data;
  assert.ok(opts.items.some((x) => x.kind === "manager" && x.name_ar === "مدير بلا حساب"));
  const m = (await send(w.c, { to: "manager" })).data.message;
  assert.equal(m.to_employee_id, boss.id);
  const login = (await admin.post(`/api/employees/${boss.id}/login`, {})).data;
  const { login: signIn } = await import("./helpers.mjs");
  const bc = await signIn(t.base, login.user.username, login.tempPassword, "Boss#2026x9");
  assert.equal((await bc.get("/api/me")).data.voiceInbox, 1);
  assert.equal((await bc.get(`/api/voice/${m.id}`)).status, 200);
  // nothing set up at all → the reasons are listed
  const t2 = await (await import("./helpers.mjs")).boot({});
  try {
    const a2 = await (await import("./helpers.mjs")).adminClient(t2.base);
    const lone = await (await import("./helpers.mjs")).makePerson(t2.base, a2, { emp_no: "Z1", name_ar: "وحيد", join_date: "2022-01-01" }, "staff");
    const r = (await lone.c.get("/api/voice/recipients")).data;
    assert.deepEqual(r.items, []); assert.deepEqual(r.missing, ["manager", "hr", "ceo"]);
  } finally { await t2.close(); }
});

test("Admin hides a message (then only Admin sees it) or deletes it for good", async () => {
  const m = (await send(s.c, { to: "manager", subject: "مخفية" })).data.message;
  assert.equal((await mgr.c.post(`/api/voice/${m.id}/hide`, {})).status, 403);
  assert.equal((await admin.post(`/api/voice/${m.id}/hide`, {})).status, 200);
  for (const c of [s.c, mgr.c]) {
    assert.equal((await c.get(`/api/voice/${m.id}`)).status, 403);
    assert.ok(!(await c.get("/api/voice?box=sent")).data.items.concat((await c.get("/api/voice?box=inbox")).data.items).some((x) => x.id === m.id));
  }
  assert.equal((await admin.get(`/api/voice/${m.id}`)).data.message.hidden, 1);
  assert.equal((await admin.post(`/api/voice/${m.id}/hide`, { hidden: false })).status, 200);
  assert.equal((await mgr.c.get(`/api/voice/${m.id}`)).status, 200);
  const f = (await s.c.upload(`/api/voice/${m.id}/files?name=a.pdf`, Buffer.from("%PDF-1.4"), "application/pdf")).data.file;
  await mgr.c.post(`/api/voice/${m.id}/reply`, { body: "رد" });
  assert.equal((await mgr.c.del(`/api/voice/${m.id}`)).status, 403);
  assert.equal((await admin.del(`/api/voice/${m.id}`)).status, 200);
  assert.equal((await admin.get(`/api/voice/${m.id}`)).status, 404);
  assert.equal((await fetch(`${t.base}/api/files/${f.id}`, { headers: { cookie: admin.cookie } })).status, 404);
});
