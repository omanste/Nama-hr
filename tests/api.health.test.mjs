import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { boot, client } from "./helpers.mjs";

let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

test("health endpoint reports ok and environment", async () => {
  const r = await client(t.base).get("/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.env, "test");
});

test("root serves the Arabic app shell", async () => {
  const r = await client(t.base).get("/");
  assert.equal(r.status, 200);
  assert.match(r.data, /lang="ar"/);
});

test("unknown api route is a JSON 404", async () => {
  const r = await client(t.base).get("/api/nope");
  assert.equal(r.status, 404);
  assert.equal(r.data.error, "not_found");
});

test("path traversal outside public is refused", async () => {
  const r = await fetch(t.base + "/..%2f..%2fetc/passwd");
  assert.ok([403, 404].includes(r.status));
});
