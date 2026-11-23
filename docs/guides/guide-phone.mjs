import { createRequire } from "node:module";
const { chromium } = createRequire("/home/user/nama-hr/package.json")("playwright");
const b = await chromium.launch();
for (const lang of ["ar", "en"]) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 });
  await p.goto("file://" + process.cwd() + `/guide-${lang}.html`, { waitUntil: "networkidle" });
  console.log(lang, "page width", await p.evaluate(() => document.documentElement.scrollWidth), "viewport", 390);
  await p.screenshot({ path: `gphone-${lang}.png` });
}
await b.close();
