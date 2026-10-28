// Full backup and restore: everything (data, settings, attendance, documents) moves from one portal to another.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson, ADMIN } from "./helpers.mjs";

const servers = [];
after(async () => { for (const s of servers) await s.close(); });

test("a full backup from one portal restores into another: staff, settings, attendance, documents and logins", async () => {
  const a = await boot({ FAKE_TODAY: "2026-10-28" }); servers.push(a);
  const admin = await adminClient(a.base);
  const s = await makePerson(a.base, admin, { emp_no: "NAMA-025", name_ar: "نبراس", name_en: "Test Person", join_date: "2022-01-10", shift: 3 }, "hr");
  await admin.put("/api/settings", { attendance_start: "2026-11-01" });
  await admin.post("/api/attendance/upload", { name: "x.xls", punches: [{ no: "35", name: "X", at: "2026-10-26 10:02" }, { no: "35", name: "X", at: "2026-10-26 17:00" }] });
  await admin.put("/api/attendance/devices/35", { employee_id: s.emp.id });
  const photo = Buffer.from("fake photo bytes");
  const f = await s.c.upload(`/api/employees/${s.emp.id}/files?name=p.jpg&doc_type=other`, photo, "image/jpeg");
  assert.equal(f.status, 201, JSON.stringify(f.data));
  assert.equal((await s.c.get("/api/admin/backup")).status, 403, "Admin only");
  const res = await fetch(`${a.base}/api/admin/backup`, { headers: { cookie: admin.cookie } });
  assert.equal(res.status, 200);
  const backup = Buffer.from(await res.arrayBuffer());

  const b = await boot({ FAKE_TODAY: "2026-10-28", ADMIN_USERNAME: "prodadmin", ADMIN_PASSWORD: "Prod#Admin2026" }); servers.push(b);
  const badmin = await adminClient(b.base).catch(() => null);
  const pa = badmin || (await (await import("./helpers.mjs")).login(b.base, "prodadmin", "Prod#Admin2026"));
  // needs the typed confirmation, and a real backup
  const post = (body, confirm) => fetch(`${b.base}/api/admin/restore`, { method: "POST", headers: { cookie: pa.cookie, "content-type": "application/octet-stream", ...(confirm ? { "x-confirm": "RESTORE" } : {}) }, body });
  assert.equal((await post(backup, false)).status, 400);
  assert.equal((await post(Buffer.from("not a database at all, just text ......................................................................."), true)).status, 400);
  const r = await post(backup, true);
  assert.equal(r.status, 200, await r.clone().text());
  // everyone signs in again — with the logins from the backup
  assert.equal((await fetch(`${b.base}/api/me`, { headers: { cookie: pa.cookie } })).status, 401);
  const again = await (await import("./helpers.mjs")).login(b.base, ADMIN.username, "NewAdmin#2026");
  const p = (await again.get(`/api/employees/${s.emp.id}`)).data;
  assert.equal(p.employee.name_ar, "نبراس"); assert.equal(p.employee.shift, 3);
  assert.equal((await again.get("/api/settings")).data.attendance_start, "2026-11-01");
  const day = (await again.get(`/api/attendance/employee/${s.emp.id}?month=2026-10`)).data.days.find((x) => x.date === "2026-10-26");
  assert.deepEqual([day.status, day.late], ["present", 2]);
  const doc = await fetch(`${b.base}/api/files/${f.data.file.id}`, { headers: { cookie: again.cookie } });
  assert.equal(doc.status, 200); assert.deepEqual(Buffer.from(await doc.arrayBuffer()), photo);
  const users = (await again.get("/api/users")).data.items.map((u) => u.username);
  assert.ok(users.includes("nama-025") && !users.includes("prodadmin"));
});
