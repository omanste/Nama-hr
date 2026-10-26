import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson, client } from "./helpers.mjs";

test("dev: staff pick their name and sign in with the shared password; no forced password change", async () => {
  const t = await boot({ APP_ENV: "dev" });
  try {
    const admin = await adminClient(t.base);
    const a = (await admin.post("/api/employees", { name_ar: "جهينة", name_en: "Juhaina", join_date: "2022-01-01" })).data.employee;
    const hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "الموارد", join_date: "2020-01-01" }, "hr");
    const opts = (await client(t.base).get("/api/login-options")).data;
    assert.equal(opts.devStaffList, true);
    assert.ok(opts.people.some((p) => p.id === a.id));
    const c = client(t.base);
    assert.equal((await c.post("/api/login", { employee_id: a.id, password: "wrong" })).status, 401);
    const r = await c.post("/api/login", { employee_id: a.id, password: "2026" });
    assert.equal(r.status, 200);
    assert.equal(r.data.mustChange, false);
    assert.equal(r.data.user.role, "staff");
    assert.equal((await c.get("/api/me")).data.employee.id, a.id);
    // an existing login (created by HR with a temporary password) works too, with its role, and is not forced to change
    const c2 = client(t.base);
    const r2 = await c2.post("/api/login", { employee_id: hr.emp.id, password: "2026" });
    assert.equal(r2.status, 200); assert.equal(r2.data.user.role, "hr"); assert.equal(r2.data.mustChange, false);
    // the second sign-in reuses the same login
    assert.equal((await client(t.base).post("/api/login", { employee_id: a.id, password: "2026" })).data.user.id, r.data.user.id);
  } finally { await t.close(); }
});

test("dev: admin accounts never open with the shared password", async () => {
  const t = await boot({ APP_ENV: "dev" });
  try {
    const admin = await adminClient(t.base);
    const e = await makePerson(t.base, admin, { emp_no: "X1", name_ar: "مسؤول", join_date: "2020-01-01" }, "admin");
    assert.equal((await client(t.base).post("/api/login", { employee_id: e.emp.id, password: "2026" })).status, 401);
    assert.equal((await client(t.base).post("/api/login", { username: "admin", password: "2026" })).status, 401);
  } finally { await t.close(); }
});

test("production: no staff list and no shared password, even if the setting is present", async () => {
  const t = await boot({ APP_ENV: "production", DEV_SHARED_PASSWORD: "2026" });
  try {
    const admin = await adminClient(t.base);
    const a = (await admin.post("/api/employees", { name_ar: "جهينة", join_date: "2022-01-01" })).data.employee;
    const opts = (await client(t.base).get("/api/login-options")).data;
    assert.equal(opts.devStaffList, false);
    assert.equal(opts.people, undefined);
    assert.equal((await client(t.base).post("/api/login", { employee_id: a.id, password: "2026" })).status, 401);
  } finally { await t.close(); }
});

test("dev: the shared password can be switched off", async () => {
  const t = await boot({ APP_ENV: "dev", DEV_SHARED_PASSWORD: "" });
  try { assert.equal((await client(t.base).get("/api/login-options")).data.devStaffList, false); } finally { await t.close(); }
});
