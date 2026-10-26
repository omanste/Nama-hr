// Every t("key") used by the screens has Arabic and English text (a missing key would show as "read_title").
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("all UI text keys exist in both languages", async () => {
  globalThis.document ||= { documentElement: { setAttribute() {} } };
  globalThis.localStorage ||= { getItem() {}, setItem() {} };
  const { has, t, setLang } = await import("../public/js/i18n.js");
  const dir = new URL("../public/js/", import.meta.url).pathname;
  const files = [...fs.readdirSync(dir).map((f) => path.join(dir, f)), ...fs.readdirSync(path.join(dir, "pages")).map((f) => path.join(dir, "pages", f))].filter((f) => f.endsWith(".js") && !f.endsWith("i18n.js"));
  const missing = new Set();
  for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/\bt\("([a-z0-9_]+)"\s*[,)]/g)) if (!has(m[1])) missing.add(`${m[1]} (${path.basename(f)})`);
  assert.deepEqual([...missing], []);
  for (const lang of ["ar", "en"]) { setLang(lang); assert.notEqual(t("read_title"), "read_title"); }
});
