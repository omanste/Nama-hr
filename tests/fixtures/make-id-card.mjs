// Builds tests/fixtures/fake-id.jpg: a made-up Omani civil ID (no real person) — the front with the Arabic name after "الاسم",
// the back with the "<<<" lines, the name in its usual order (given names, then the family name) as Omani cards write it.
// Also fake-id-long.jpg: only the back of a card whose name is longer than the 30-letter "<<<" line (it ends "AL<HINA"),
// with no Arabic on it — for the name completed from the known family names and the Arabic spelled from the English.
// And fake-id-front.jpg: a front laid out like a real card (labels in a column, the photo beside), where the reader breaks
// the name over lines around "الاسم".
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
await p.setViewportSize({ width: 1000, height: 680 });
await p.setContent(`<html><body style="margin:0;background:#5a5047;display:grid;justify-content:center;padding:60px">
<div style="${card};transform:rotate(1deg);display:flex;align-items:flex-end">
  <pre style="font:34px/1.35 'DejaVu Sans Mono';letter-spacing:2px;margin:0">IDOMNA12345678498765432&lt;&lt;&lt;&lt;&lt;&lt;&lt;
9004034F2805128OMN&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;4
SHAIKHA&lt;SALIM&lt;KHALFAN&lt;&lt;AL&lt;HINA</pre>
</div></body></html>`);
await p.screenshot({ path: path.join(here, "fake-id-long.jpg"), type: "jpeg", quality: 88 });
const row = (ar, v, en) => `<div style="display:grid;grid-template-columns:150px 1fr 140px;align-items:center;gap:10px;margin:10px 0"><b style="font-size:24px">${ar}</b><span style="font-size:30px">${v}</span><span dir="ltr" style="font-size:18px;color:#555;text-align:left">${en}</span></div>`;
await p.setViewportSize({ width: 1000, height: 660 });
await p.setContent(`<html><body style="margin:0;background:#4a463f;padding:50px;font-family:'DejaVu Sans'">
<div dir="rtl" style="width:900px;height:560px;border-radius:26px;background:linear-gradient(135deg,#f0ede4,#d8e2dc);padding:30px 36px;box-sizing:border-box;display:grid;grid-template-columns:1fr 200px;gap:20px;transform:rotate(-1deg)">
<div><div style="font-size:30px;font-weight:bold">سلطنة عمان</div><div style="font-size:22px;margin-bottom:24px">البطاقة الشخصية &nbsp; <span dir="ltr">IDENTITY CARD</span></div>
${row("الاسم", "شيخة إسحاق عبدالله الحوقاني", "Name")}${row("الرقم المدني", "98765432", "Civil No.")}${row("تاريخ الميلاد", "03/04/1990", "Date of Birth")}${row("تاريخ الانتهاء", "12/05/2028", "Expiry Date")}</div>
<div style="background:#b9c2bd;border-radius:12px;height:240px;margin-top:40px"></div></div></body></html>`);
await p.screenshot({ path: path.join(here, "fake-id-front.jpg"), type: "jpeg", quality: 85 });
await b.close();
