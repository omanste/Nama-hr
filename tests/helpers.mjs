// Test helpers: boot a server in-process on a random port with a throwaway data directory.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "../server/index.mjs";

export const ADMIN = { username: "admin", password: "Admin#2026" };

export async function boot(extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nama-hr-test-"));
  const app = await startServer({
    dataDir,
    port: 0,
    env: { APP_ENV: "test", ADMIN_USERNAME: ADMIN.username, ADMIN_PASSWORD: ADMIN.password, NO_JOBS: "1", ...extraEnv },
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return {
    base, db: app.db, app, dataDir,
    async close() { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}

export function client(base) {
  let cookie = "";
  async function call(method, p, body, headers = {}) {
    const h = { ...headers };
    if (cookie) h.cookie = cookie;
    let payload = body;
    if (body !== undefined && !Buffer.isBuffer(body) && typeof body !== "string") { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(base + p, { method, headers: h, body: payload });
    const sc = res.headers.get("set-cookie");
    if (sc) { const m = /hr_sid=([^;]*)/.exec(sc); if (m) cookie = m[1] ? `hr_sid=${m[1]}` : ""; }
    const type = res.headers.get("content-type") || "";
    const data = type.includes("json") ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (p) => call("GET", p),
    post: (p, b) => call("POST", p, b ?? {}),
    put: (p, b) => call("PUT", p, b ?? {}),
    del: (p) => call("DELETE", p),
    upload: (p, buf, type) => call("POST", p, buf, { "content-type": type }),
    get cookie() { return cookie; },
  };
}

// Sign in and, if the account still has a one-time password, change it to `next`.
export async function login(base, username, password, next = password + "x9") {
  const c = client(base);
  const r = await c.post("/api/login", { username, password });
  if (r.status !== 200) throw new Error(`login ${username} → ${r.status} ${JSON.stringify(r.data)}`);
  if (r.data.mustChange) {
    const ch = await c.post("/api/me/password", { current: password, next });
    if (ch.status !== 200) throw new Error(`password change → ${ch.status} ${JSON.stringify(ch.data)}`);
  }
  return c;
}
