// The staff guide as one long page per language (Arabic, then English): node guide-pdf.mjs <out-dir>
// → <out-dir>/Nama-HR-Staff-Guide.pdf. The page is as tall as its content. Needs Playwright's Chromium and pdfunite.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url)), OUT = path.resolve(process.argv[2] || ".");
const { chromium } = createRequire(path.join(HERE, "../../package.json"))(process.env.PW_MODULE || "playwright");
const logo = "data:image/png;base64," + readFileSync(path.join(HERE, "../../public/logo-wordmark.png")).toString("base64");
const b = await chromium.launch(); const parts = [];
for (const [f, lang] of [["Main.dc.html", "ar"], ["English.dc.html", "en"]]) {
  const s = readFileSync(path.join(HERE, f), "utf8");
  const head = s.match(/<helmet>([\s\S]*?)<\/helmet>/)[1], body = s.match(/<x-dc>[\s\S]*?<\/helmet>([\s\S]*?)<\/x-dc>/)[1].replaceAll("/_blob/4e2503d43c0f04bebc30c30846296ce7", logo);
  const html = (hgt) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Nama HR — Staff guide</title>${head}<style>@page{size:1080px ${hgt}px;margin:0} html,body{margin:0}</style></head><body>${body}</body></html>`;
  const file = path.join(OUT, `guide-${lang}.html`);
  const p = await b.newPage({ viewport: { width: 1080, height: 1200 } });
  writeFileSync(file, html(1200));
  await p.goto("file://" + file, { waitUntil: "networkidle" }); await p.evaluate(() => document.fonts.ready);
  let hgt = await p.$eval("body > div", (d) => Math.ceil(d.scrollHeight)); // the whole guide on one page
  const pdf = path.join(OUT, `guide-${lang}.pdf`);
  for (let k = 0; k < 8; k++) { // print can lay out a little taller than the screen: grow the page until it is one page
    writeFileSync(file, html(hgt)); await p.goto("file://" + file, { waitUntil: "networkidle" }); await p.evaluate(() => document.fonts.ready);
    await p.pdf({ path: pdf, printBackground: true, preferCSSPageSize: true });
    if (/Pages:\s+1\b/.test(execFileSync("pdfinfo", [pdf]).toString())) break;
    hgt = Math.ceil(hgt * 1.03);
  }
  console.log(lang, "height", hgt); parts.push(pdf);
}
await b.close();
execFileSync("pdfunite", [...parts, path.join(OUT, "Nama-HR-Staff-Guide.pdf")]);
