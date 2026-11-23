// The phone-sized PDFs of a two-language guide page (guide-mobile.html or guide-mgr.html): node guide-print.mjs <html> <out.pdf>
// Arabic pages first, then English (pdfunite). Each page is 430 × 932 px, like a phone screen.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(path.join(HERE, "../../package.json"))(process.env.PW_MODULE || "playwright");
const [src, out] = process.argv.slice(2).map((x) => path.resolve(x));
const b = await chromium.launch(); const parts = [];
for (const lang of ["ar", "en"]) {
  const p = await b.newPage({ viewport: { width: 430, height: 932 } });
  await p.goto("file://" + src, { waitUntil: "networkidle" });
  await p.evaluate((l) => { document.querySelectorAll(".panel").forEach((x) => { x.hidden = x.lang !== l; }); document.documentElement.lang = l; document.documentElement.dir = l === "ar" ? "rtl" : "ltr"; document.querySelectorAll(".lang").forEach((x) => x.remove()); }, lang);
  await p.evaluate(() => document.fonts.ready);
  const f = out.replace(/\.pdf$/, `-${lang}.pdf`);
  await p.pdf({ path: f, width: "430px", height: "932px", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
  parts.push(f);
}
await b.close();
execFileSync("pdfunite", [...parts, out]);
