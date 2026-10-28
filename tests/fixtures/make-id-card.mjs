// Builds tests/fixtures/fake-id.jpg: a made-up Omani civil ID (no real person) — the front with the Arabic name after "الاسم",
// the back with the "<<<" lines, the name in its usual order (given names, then the family name) as Omani cards write it.
// Run: node tests/fixtures/make-id-card.mjs (needs Playwright's Chromium)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)("playwright");
const card = "width:860px;height:540px;border-radius:28px;background:linear-gradient(135deg,#e9ece6,#c9d3cf);box-shadow:0 8px 30px rgba(0,0,0,.35);padding:40px;box-sizing:border-box;position:relative";
const html = `<html><body style="margin:0;background:#5a5047;display:grid;gap:60px;justify-content:center;padding:60px;font-family:'DejaVu Sans'">
<div style="${card};transform:rotate(-1.5deg)" dir="rtl">
  <div style="font-size:34px;font-weight:bold">سلطنة عمان</div><div style="font-size:28px;margin-top:6px">البطاقة الشخصية</div>
  <div style="font-size:40px;margin-top:60px">الاسم: عينة شخص الاختبار</div>
  <div dir="ltr" style="font-size:26px;margin-top:30px;text-align:left">Name: SAMPLE PERSON ALTEST<br>Civil No: 98765432</div>
</div>
<div style="${card};transform:rotate(1deg);display:flex;align-items:flex-end">
  <pre style="font:34px/1.35 'DejaVu Sans Mono';letter-spacing:2px;margin:0">IDOMNA12345678498765432&lt;&lt;&lt;&lt;&lt;&lt;&lt;
9004034M2805128OMN&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;4
SAMPLE&lt;PERSON&lt;&lt;ALTEST&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</pre>
</div></body></html>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1000, height: 1380 } });
await p.setContent(html); await p.screenshot({ path: path.join(here, "fake-id.jpg"), type: "jpeg", quality: 88 });
await b.close();
