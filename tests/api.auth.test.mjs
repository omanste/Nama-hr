import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, client, ADMIN } from "./helpers.mjs";
import { hashPassword, verifyPassword } from "../server/auth.mjs";
import { can } from "../server/perm.mjs";

let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

test("password hashes verify and differ per salt", () => {
  const a = hashPassword("Secret#123"), b = hashPassword("Secret#123");
  assert.notEqual(a.hash, b.hash);
  assert.equal(a.iter, 150000);
  assert.ok(verifyPassword("Secret#123", { pw_hash: a.hash, pw_salt: a.salt, pw_iter: a.iter }));
  assert.ok(!verifyPassword("wrong", { pw_hash: a.hash, pw_salt: a.salt, pw_iter: a.iter }));
});

test("api requires a session", async () => {
  const r = await client(t.base).get("/api/me");
  assert.equal(r.status, 401);
  assert.equal(r.data.error, "unauthorized");
});

test("first admin login must change the password before using the api", async () => {
  const c = client(t.base);
  const r = await c.post("/api/login", { username: ADMIN.username, password: ADMIN.password });
  assert.equal(r.status, 200);
  assert.equal(r.data.mustChange, true);
  assert.match(r.headers.get("set-cookie"), /HttpOnly/);
  assert.match(r.headers.get("set-cookie"), /SameSite=Lax/);
  const blocked = await c.get("/api/employees");
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error, "must_change_password");
  const short = await c.post("/api/me/password", { current: ADMIN.password, next: "short" });
  assert.equal(short.status, 400);
  const wrong = await c.post("/api/me/password", { current: "nope", next: "NewAdmin#2026" });
  assert.equal(wrong.status, 403);
  const ok = await c.post("/api/me/password", { current: ADMIN.password, next: "NewAdmin#2026" });
  assert.equal(ok.status, 200);
  const me = await c.get("/api/me");
  assert.equal(me.status, 200);
  assert.equal(me.data.user.role, "admin");
  assert.equal(me.data.user.mustChange, false);
  assert.equal((await client(t.base).post("/api/login", { username: "admin", password: ADMIN.password })).status, 401);
  assert.equal((await client(t.base).post("/api/login", { username: "ADMIN", password: "NewAdmin#2026" })).status, 200);
});

test("language preference is saved", async () => {
  const c = client(t.base);
  await c.post("/api/login", { username: "admin", password: "NewAdmin#2026" });
  assert.equal((await c.put("/api/me/lang", { lang: "en" })).status, 200);
  assert.equal((await c.get("/api/me")).data.user.lang, "en");
  assert.equal((await c.put("/api/me/lang", { lang: "fr" })).status, 400);
});

test("six wrong passwords lock the account for this address", async () => {
  const c = client(t.base);
  for (let i = 0; i < 6; i++) assert.equal((await c.post("/api/login", { username: "lockme", password: "x" })).status, 401);
  const r = await c.post("/api/login", { username: "lockme", password: "x" });
  assert.equal(r.status, 429);
  assert.equal(r.data.error, "locked");
});

test("logout ends the session", async () => {
  const c = client(t.base);
  await c.post("/api/login", { username: "admin", password: "NewAdmin#2026" });
  assert.equal((await c.post("/api/logout")).status, 200);
  assert.equal((await c.get("/api/me")).status, 401);
});

test("a session ends when the linked employee resigns", async () => {
  const now = new Date().toISOString();
  const e = t.db.prepare("INSERT INTO employees(emp_no,name_ar,created_at,updated_at) VALUES('R1','موظف',?,?)").run(now, now);
  const h = hashPassword("Staff#2026");
  t.db.prepare("INSERT INTO users(username,employee_id,role,pw_hash,pw_salt,pw_iter,must_change,created_at) VALUES('r1',?,'staff',?,?,?,0,?)").run(e.lastInsertRowid, h.hash, h.salt, h.iter, now);
  const c = client(t.base);
  assert.equal((await c.post("/api/login", { username: "r1", password: "Staff#2026" })).status, 200);
  assert.equal((await c.get("/api/me")).status, 200);
  t.db.prepare("UPDATE employees SET status='resigned' WHERE id=?").run(e.lastInsertRowid);
  assert.equal((await c.get("/api/me")).status, 401);
  assert.equal((await client(t.base).post("/api/login", { username: "r1", password: "Staff#2026" })).status, 401);
});

test("an audit row is written for password changes", () => {
  const n = t.db.prepare("SELECT count(*) n FROM audit_log WHERE action='password.change'").get().n;
  assert.ok(n >= 1);
});

test("permission matrix follows the spec", () => {
  const s = (role, extra = {}) => ({ user: { id: 1, role }, employee: { id: 1 }, isApprover: false, ...extra });
  assert.ok(can(s("hr"), "employee.edit")); assert.ok(can(s("admin"), "employee.edit"));
  assert.ok(!can(s("accounts"), "employee.edit")); assert.ok(!can(s("ceo"), "employee.edit")); assert.ok(!can(s("staff"), "employee.edit"));
  for (const r of ["hr", "accounts", "ceo", "admin"]) assert.ok(can(s(r), "employee.viewAll"), r);
  assert.ok(!can(s("staff"), "employee.viewAll")); assert.ok(!can(s("staff", { isApprover: true }), "employee.viewAll"));
  assert.ok(can(s("hr"), "ledger.adjust")); assert.ok(can(s("hr"), "import.run")); assert.ok(!can(s("accounts"), "import.run"));
  assert.ok(!can(s("hr"), "settings.edit")); assert.ok(can(s("admin"), "settings.edit")); assert.ok(can(s("admin"), "users.manage"));
  for (const r of ["hr", "accounts", "ceo", "admin"]) assert.ok(can(s(r), "audit.view"), r);
  assert.ok(!can(s("staff"), "audit.view"));
  const req = { approver_user_id: 7 };
  assert.ok(!can(s("hr"), "request.decide", req));
  assert.ok(can(s("staff", { user: { id: 7, role: "staff" } }), "request.decide", req));
  assert.ok(can(s("admin"), "request.decide", req));
  assert.ok(!can(s("ceo"), "request.decide", req));
});

test("state-changing requests need a JSON body type and a same-site origin", async () => {
  const c = client(t.base);
  await c.post("/api/login", { username: "admin", password: "NewAdmin#2026" });
  const plain = await fetch(t.base + "/api/departments", { method: "POST", headers: { cookie: c.cookie, "content-type": "text/plain" }, body: JSON.stringify({ name_ar: "x" }) });
  assert.equal(plain.status, 415);
  const evil = await fetch(t.base + "/api/departments", { method: "POST", headers: { cookie: c.cookie, "content-type": "application/json", origin: "https://nama.omanste.com" }, body: JSON.stringify({ name_ar: "x" }) });
  assert.equal(evil.status, 403);
  const same = await fetch(t.base + "/api/departments", { method: "POST", headers: { cookie: c.cookie, "content-type": "application/json", origin: t.base }, body: JSON.stringify({ name_ar: "قسم" }) });
  assert.equal(same.status, 201);
});
