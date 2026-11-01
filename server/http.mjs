/* Small HTTP toolkit: JSON responses, body reading, static files and a pattern router. */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";

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

/* Static files, served from memory. At start every file in public/ is read once, with its gzip copy and an ETag. A
 * build version (a hash of all of them) is stamped on the app's own files: index.html loads /js/app.js?v=…, every
 * import inside the JavaScript gets the same ?v=…, and those versioned files may be kept by the browser for a year
 * (a new deploy has a new version, so nobody keeps old code). index.html itself is always checked again (a tiny 304
 * when unchanged). In tests the files are re-read when they change on disk. */
const COMPRESSIBLE = /\.(html|js|mjs|css|json|webmanifest|svg)$/;
const LONG = /\.(woff2|png|jpg|jpeg|webp|ico)$/;
function stampVersion(rel, text, v) {
  if (rel.startsWith("/vendor/")) return text;
  if (/\.m?js$/.test(rel)) // relative imports: from "./x.js", import("./x.js"), import(`./pages/${p}.js`)
    return text.replace(/((?:\bfrom|\bimport)\s*\(?\s*)(["'`])(\.{1,2}\/[^"'`]*?\.js)\2/g, (_, a, q, spec) => `${a}${q}${spec}?v=${v}${q}`);
  if (rel === "/index.html") {
    const core = ["api", "i18n", "ui", "app"].map((m) => `<link rel="modulepreload" href="/js/${m}.js?v=${v}">`).join("\n");
    return text.replace(/(src|href)="\/(js\/app\.js|js\/theme\.js|app\.css|fonts\.css)"/g, `$1="/$2?v=${v}"`).replace("</head>", `${core}\n</head>`);
  }
  return text;
}
export function makeStatic(publicDir, { watch = false } = {}) {
  const root = path.resolve(publicDir);
  let files = new Map(), version = "", loadedAt = 0;
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  function load() {
    const raw = new Map();
    for (const f of walk(root)) raw.set("/" + path.relative(root, f).split(path.sep).join("/"), fs.readFileSync(f));
    const h = crypto.createHash("sha256");
    for (const [k, b] of [...raw].sort(([a], [b]) => (a < b ? -1 : 1))) h.update(k).update(b);
    version = h.digest("hex").slice(0, 10);
    files = new Map();
    for (const [rel, b0] of raw) {
      const type = MIME[path.extname(rel).toLowerCase()] || "application/octet-stream";
      const body = COMPRESSIBLE.test(rel) ? Buffer.from(stampVersion(rel, b0.toString("utf8"), version), "utf8") : b0;
      const gz = COMPRESSIBLE.test(rel) && body.length > 1024 ? zlib.gzipSync(body, { level: 9 }) : null;
      files.set(rel, { body, gz, type, etag: `"${crypto.createHash("sha1").update(body).digest("base64url").slice(0, 16)}"` });
    }
    loadedAt = Date.now();
  }
  const newest = () => walk(root).reduce((m, f) => Math.max(m, fs.statSync(f).mtimeMs), 0);
  load();
  return async function serveStatic(req, res) {
    let rel, url;
    try { url = new URL(req.url, "http://x"); rel = path.posix.normalize(decodeURIComponent(url.pathname)); } catch { return fail(req, res, 400, "bad_path"); }
    if (rel === "/" || rel === "") rel = "/index.html";
    if (rel.includes("\0") || rel.split("/").includes("..")) return fail(req, res, 403, "forbidden");
    if (watch && newest() > loadedAt) load(); // tests / development: files changed on disk
    const f = files.get(rel);
    if (!f) return fail(req, res, 404, "not_found");
    const versioned = url.searchParams.get("v") === version;
    const cache = versioned ? "public, max-age=31536000, immutable" : LONG.test(rel) || rel.startsWith("/vendor/") ? "public, max-age=604800" : "no-cache";
    const h = { "Content-Type": f.type, "Cache-Control": cache, ETag: f.etag, Vary: "Accept-Encoding", ...SEC };
    if ((req.headers["if-none-match"] || "").split(/\s*,\s*/).includes(f.etag)) { res.writeHead(304, h); return res.end(); }
    let buf = f.body;
    if (f.gz && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) { buf = f.gz; h["Content-Encoding"] = "gzip"; }
    h["Content-Length"] = buf.length;
    res.writeHead(200, h);
    res.end(req.method === "HEAD" ? undefined : buf);
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
