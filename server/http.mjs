/* Small HTTP toolkit: JSON responses, body reading, static files and a pattern router. */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".pdf": "application/pdf", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
export const SEC = {
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(self)", // camera and location for online check-in, on our own pages only
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'",
};

export class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

export function sendRaw(req, res, code, buf, type, extra = {}) {
  const h = { "Content-Type": type, "Cache-Control": "no-store", ...SEC, ...extra };
  if (buf.length > 1024 && /json|text|javascript|css|svg/.test(type) && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    buf = zlib.gzipSync(buf); h["Content-Encoding"] = "gzip"; h["Vary"] = "Accept-Encoding";
  }
  h["Content-Length"] = buf.length;
  res.writeHead(code, h);
  res.end(req.method === "HEAD" ? undefined : buf);
}
export const send = (req, res, code, obj) => sendRaw(req, res, code, Buffer.from(JSON.stringify(obj)), "application/json; charset=utf-8");
export const fail = (req, res, code, error, message) => send(req, res, code, { error, message: message || error });

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", (c) => { n += c.length; if (n > limit) { reject(new HttpError(413, "too_large", "File or request too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
export async function readJson(req, limit = 5 * 1024 * 1024) {
  const b = await readBody(req, limit);
  // a JSON type can't be sent cross-site without a CORS preflight, which this server never grants
  if (b.length && !/^application\/json\b/i.test(req.headers["content-type"] || "")) throw new HttpError(415, "unsupported_type", "Send JSON (application/json)");
  try { const v = JSON.parse(b.toString("utf8") || "{}"); return v && typeof v === "object" ? v : {}; }
  catch { throw new HttpError(400, "bad_json", "Invalid JSON body"); }
}

export function makeStatic(publicDir) {
  const root = path.resolve(publicDir);
  return async function serveStatic(req, res) {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { return fail(req, res, 400, "bad_path"); }
    if (rel === "/" || rel === "") rel = "/index.html";
    const file = path.resolve(root, "." + path.posix.normalize(rel));
    if (file !== root && !file.startsWith(root + path.sep)) return fail(req, res, 403, "forbidden");
    let st; try { st = await fsp.stat(file); } catch { return fail(req, res, 404, "not_found"); }
    if (!st.isFile()) return fail(req, res, 404, "not_found");
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    const cache = /\.(woff2|png|jpg|webp|ico)$/.test(file) || file.includes(`${path.sep}vendor${path.sep}`) ? "public, max-age=604800" : "no-cache";
    sendRaw(req, res, 200, fs.readFileSync(file), type, { "Cache-Control": cache });
  };
}

/** Pattern router: "/api/employees/:id" → req.params.id */
export function router() {
  const routes = [];
  const add = (method) => (pattern, handler) => {
    const keys = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
    routes.push({ method, re, keys, handler });
  };
  return {
    get: add("GET"), post: add("POST"), put: add("PUT"), delete: add("DELETE"),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method && !(method === "HEAD" && r.method === "GET")) continue;
        const m = r.re.exec(pathname);
        if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      }
      return null;
    },
  };
}
