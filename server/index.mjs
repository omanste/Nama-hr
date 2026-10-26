/* Nama HR Portal — self-hosted server (no third-party services).
 * Designed by Eng. Hassan Al Riyami · تصميم م. حسن الريامي
 *
 * One Node.js process: JSON API under /api, static app from /public, SQLite in DATA_DIR/hr.db,
 * uploads in DATA_DIR/uploads, nightly backups in DATA_DIR/backups. Optional SMTP for e-mail.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.mjs";
import { router, makeStatic, send, fail, HttpError } from "./http.mjs";
import { registerModules } from "./modules.mjs";
import { todayMuscat } from "./leave.mjs";
import { stopOcr } from "./idread.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function startServer({ dataDir, port = 3000, env = process.env } = {}) {
  const DATA = path.resolve(dataDir || env.DATA_DIR || path.join(ROOT, "data"));
  for (const d of ["", "uploads", "backups"]) fs.mkdirSync(path.join(DATA, d), { recursive: true });
  const db = openDb(DATA);
  const ctx = { db, env, dataDir: DATA, appEnv: env.APP_ENV || "production", timers: [] };
  // tests may pin "today" (APP_ENV=test only); everyone else uses the Muscat calendar date
  ctx.fakeToday = ctx.appEnv === "test" ? env.FAKE_TODAY || null : null;
  ctx.today = () => ctx.fakeToday || todayMuscat();
  const api = router();
  api.get("/api/health", (req, res) => send(req, res, 200, { ok: true, env: ctx.appEnv }));
  await registerModules(api, ctx);
  const serveStatic = makeStatic(path.join(ROOT, "public"));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    try {
      if (url.pathname.startsWith("/api/")) {
        if (req.method !== "GET" && req.method !== "HEAD" && req.headers.origin) {
          let host = ""; try { host = new URL(req.headers.origin).host; } catch {}
          if (host !== req.headers.host) return fail(req, res, 403, "bad_origin", "Cross-site request refused");
        }
        if (ctx.guard && (await ctx.guard(req, res, url.pathname)) === false) return;
        const m = api.match(req.method, url.pathname);
        if (!m) return fail(req, res, 404, "not_found", "Unknown API route");
        req.params = m.params; req.query = url.searchParams;
        return await m.handler(req, res, ctx);
      }
      if (req.method !== "GET" && req.method !== "HEAD") return fail(req, res, 405, "method_not_allowed");
      return await serveStatic(req, res);
    } catch (e) {
      if (e instanceof HttpError) return send(req, res, e.status, { error: e.code, message: e.message, ...(e.field ? { field: e.field } : {}) });
      console.error(e);
      if (!res.headersSent) fail(req, res, 500, "server_error", "Unexpected server error");
    }
  });
  await new Promise((r) => server.listen(port, r));
  return {
    server, db, ctx,
    async close() { ctx.timers.forEach(clearInterval); ctx.timers.forEach(clearTimeout); await new Promise((r) => server.close(r)); server.closeAllConnections?.(); await stopOcr(); db.close(); },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  startServer({ port }).then((app) => {
    console.log(`Nama HR (${process.env.APP_ENV || "production"}) listening on :${port}`);
    // Docker stops the container with SIGTERM; close the database cleanly instead of being killed
    const stop = async () => { app.server.closeAllConnections?.(); await app.close(); process.exit(0); };
    process.once("SIGTERM", stop); process.once("SIGINT", stop);
  });
}
