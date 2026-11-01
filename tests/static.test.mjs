// Static files: served from memory, the app's own files versioned (cached a year), index.html checked each time (304).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot } from "./helpers.mjs";

let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

test("index.html loads versioned files; their imports carry the same version; they may be cached for a year", async () => {
  const idx = await fetch(t.base + "/");
  assert.equal(idx.headers.get("cache-control"), "no-cache");
  const html = await idx.text();
  const v = /\/js\/app\.js\?v=([0-9a-f]{10})/.exec(html)[1];
  assert.match(html, new RegExp(`/app\\.css\\?v=${v}`)); assert.match(html, /rel="modulepreload"/);
  const app = await fetch(`${t.base}/js/app.js?v=${v}`, { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(app.status, 200); assert.equal(app.headers.get("cache-control"), "public, max-age=31536000, immutable");
  const js = await app.text();
  assert.match(js, new RegExp(`from "\\./api\\.js\\?v=${v}"`));
  assert.match(js, new RegExp(`import\\(\`\\./pages/\\$\\{route\\.page\\}\\.js\\?v=${v}\``));
  assert.ok(!/from "\.\/[^"?]+\.js"/.test(js), "no import left without the version");
  // a stale version isn't cached for long
  assert.equal((await fetch(`${t.base}/js/app.js?v=0000000000`)).headers.get("cache-control"), "no-cache");
});

test("an unchanged file answers 304; unknown files 404; no way out of the folder", async () => {
  const r = await fetch(t.base + "/js/i18n.js");
  const tag = r.headers.get("etag"); assert.ok(tag);
  assert.equal((await fetch(t.base + "/js/i18n.js", { headers: { "If-None-Match": tag } })).status, 304);
  assert.equal((await fetch(t.base + "/js/nope.js")).status, 404);
  assert.notEqual((await fetch(t.base + "/../server/db.mjs")).status, 200);
  assert.notEqual((await fetch(t.base + "/%2e%2e/server/db.mjs")).status, 200);
});
