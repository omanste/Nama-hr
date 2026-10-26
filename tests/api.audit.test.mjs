import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";

let t, admin, hr, staff;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-10-26" });
  admin = await adminClient(t.base);
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "الموارد" }, "hr");
  staff = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف" }, "staff");
  await hr.c.put(`/api/employees/${staff.emp.id}`, { job_title: "Agent" });
});
after(async () => { await t.close(); });

test("audit log lists newest first with actor names, filterable by entity", async () => {
  const r = await hr.c.get("/api/audit");
  assert.equal(r.status, 200);
  assert.equal(r.data.items[0].action, "employee.update");
  assert.equal(r.data.items[0].actor_name, "الموارد");
  assert.ok(r.data.items.every((x, i, a) => i === 0 || a[i - 1].id > x.id));
  const f = await hr.c.get("/api/audit?entity=user");
  assert.ok(f.data.items.length > 0 && f.data.items.every((x) => x.entity === "user"));
  const q = await hr.c.get(`/api/audit?entity=employee&entity_id=${staff.emp.id}`);
  assert.ok(q.data.items.every((x) => x.entity_id === String(staff.emp.id)));
});

test("audit log pages by 50 and never exposes password hashes", async () => {
  for (let i = 0; i < 55; i++) await hr.c.put(`/api/employees/${staff.emp.id}`, { job_title: "Agent " + i });
  const p1 = await hr.c.get("/api/audit");
  assert.equal(p1.data.items.length, 50);
  assert.equal(p1.data.more, true);
  const p2 = await hr.c.get(`/api/audit?before=${p1.data.items[49].id}`);
  assert.ok(p2.data.items.length > 0 && p2.data.items[0].id < p1.data.items[49].id);
  assert.ok(!JSON.stringify(p1.data).includes("pw_hash"));
});

test("staff cannot read the audit log", async () => {
  assert.equal((await staff.c.get("/api/audit")).status, 403);
});
