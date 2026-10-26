// End-to-end smoke test in a real browser (Playwright): staff applies in Arabic on a phone,
// the department manager approves in English, the balance drops. Run: npm run test:e2e
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { boot, adminClient, makePerson } from "./helpers.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const t = await boot({ FAKE_TODAY: "2026-10-26" });
const browser = await chromium.launch();
const pageErrors = [];
try {
  const admin = await adminClient(t.base);
  const dept = (await admin.post("/api/departments", { name_ar: "التأجير", name_en: "Rental" })).data.department;
  const tawfiq = await makePerson(t.base, admin, { emp_no: "T1", name_ar: "توفيق", name_en: "Tawfiq", department_id: dept.id, join_date: "2022-03-01" }, "staff");
  await admin.put(`/api/departments/${dept.id}`, { approver_employee_id: tawfiq.emp.id });
  const staffEmp = (await admin.post("/api/employees", { emp_no: "S1", name_ar: "جهينة", name_en: "Juhaina", department_id: dept.id, join_date: "2022-10-15", opening_days: 10 })).data.employee;
  const login = (await admin.post("/api/users", { username: "s1", role: "staff", employee_id: staffEmp.id })).data;

  async function open(lang) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript((l) => localStorage.setItem("hr_lang", l), lang);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => pageErrors.push(e.message));
    return p;
  }
  async function signIn(p, user, pass, next) {
    await p.goto(`${t.base}/#/login`);
    await p.fill("#u", user); await p.fill("#p", pass); await p.click("button[type=submit]");
    if (next) { await p.waitForSelector("#pc"); await p.fill("#pc", pass); await p.fill("#pn", next); await p.fill("#pf", next); await p.click("button[type=submit]"); }
    await p.waitForSelector("header.top");
  }

  // staff, Arabic
  const s = await open("ar");
  await signIn(s, "s1", login.tempPassword, "Juhaina#2026");
  assert.equal(await s.getAttribute("html", "dir"), "rtl");
  await s.waitForSelector(".hero .big");
  assert.match(await s.textContent(".hero .big"), /^10/);
  await s.goto(`${t.base}/#/leave/new`);
  await s.waitForSelector("input[name=start]");
  await s.fill("input[name=start]", "2026-12-01"); await s.dispatchEvent("input[name=start]", "change");
  await s.fill("input[name=end]", "2026-12-20"); await s.dispatchEvent("input[name=end]", "change");
  assert.equal(await s.isDisabled("button[type=submit]"), true, "over-balance request must be blocked");
  await s.fill("input[name=end]", "2026-12-03"); await s.dispatchEvent("input[name=end]", "change");
  await s.click("button[type=submit]");
  await s.waitForSelector(".timeline li");
  assert.match(await s.textContent(".page-head .badge"), /بانتظار/);

  // manager, English
  const m = await open("en");
  await signIn(m, tawfiq.user.username, "Passw0rd!" + tawfiq.emp.id);
  await m.click("header button:has-text('English')"); // saved per user from now on
  await m.waitForFunction(() => document.documentElement.dir === "ltr");
  await m.goto(`${t.base}/#/approvals`);
  await m.waitForSelector("article.card button.ok");
  await m.click("article.card button.ok");
  await m.waitForSelector("dialog.dialog");
  await m.fill("dialog textarea", "Enjoy");
  await m.click("dialog button[type=submit]");
  await m.waitForSelector(".empty");

  // balance dropped by 3 days
  await s.goto(`${t.base}/#/`);
  await s.waitForSelector(".hero .big");
  assert.match(await s.textContent(".hero .big"), /^7/);
  assert.deepEqual(pageErrors, []);
  console.log("e2e smoke: ok");
} finally {
  await browser.close();
  await t.close();
}
