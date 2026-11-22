// HR system updates: the changelog shipped with each deploy becomes the list (HR areas only), each environment it reaches
// gets its date, a change that moves from dev to production is one entry with both dates; Admin adds / edits / hides;
// HR views; everyone else is refused. Made-up entries.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { syncChangelog, parseChangelog } from "../server/updates.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hr-cl-"));
const file = path.join(dir, "CHANGELOG-HR.md");
const write = (s) => fs.writeFileSync(file, s);
write(`# changelog
## 2026-10-26
- [Leave · New feature] Leave requests | طلبات الإجازة
  Staff ask for leave in the portal. | يطلب الموظف الإجازة من البوابة.
  key: first · commit: aaa1111 · dev: 2026-10-26 11:31Z
- [Sales · New feature] Sales pipeline | مسار المبيعات
  key: not-hr · dev: 2026-10-26 12:00
## 2026-11-20
- [Attendance · Fix] Check-in camera | كاميرا الحضور
  key: cam · dev: 2026-11-20 10:00
`);

let t, admin, hr, mgr, staff;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-11-23", CHANGELOG_FILE: file, SOURCE_COMMIT: "abc1234def" });
  admin = await adminClient(t.base);
  hr = await makePerson(t.base, admin, { emp_no: "U1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  mgr = await makePerson(t.base, admin, { emp_no: "U2", name_ar: "مدير", join_date: "2020-01-01" }, "manager");
  staff = await makePerson(t.base, admin, { emp_no: "U3", name_ar: "موظف", join_date: "2020-01-01" }, "staff");
});
after(async () => { await t.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test("the changelog: HR areas only; the history keeps its dates; this deploy is recorded with its version", async () => {
  const p = parseChangelog(fs.readFileSync(file, "utf8"));
  assert.equal(p.entries.length, 2); assert.equal(p.skipped.length, 1, "Sales is not an HR area");
  const r = (await hr.c.get("/api/hr-updates")).data;
  assert.deepEqual(r.items.map((x) => x.key).sort(), ["cam", "first"]);
  const first = r.items.find((x) => x.key === "first");
  assert.equal(first.title_ar, "طلبات الإجازة"); assert.equal(first.area, "leave"); assert.equal(first.type, "feature");
  assert.deepEqual(first.envs.map((e) => [e.env, e.day]), [["dev", "2026-10-26"], ["test", first.envs[1].day]], "dev from the history, test = this deploy");
  assert.equal(first.envs[1].version, "abc1234def");
  assert.equal(r.env, "test"); assert.equal(r.deploys[0].version, "abc1234def");
  assert.equal(r.first, "2026-10-26T11:31:00.000Z", "the first HR update");
});

test("a new HR deploy adds its entry; a deploy with nothing new for HR adds nothing; dev → production is one entry with both dates", async () => {
  write(fs.readFileSync(file, "utf8") + `## 2026-11-23
- [Shifts · Improvement] Three shifts | ثلاث مناوبات
  Flexible, 10–5 and 10–6. | مرنة و10–5 و10–6.
- [Rental · Fix] Rent reminders | تذكير الإيجار
`);
  const ctx = (appEnv, v) => ({ db: t.db, appEnv, env: { SOURCE_COMMIT: v } });
  const d1 = syncChangelog(ctx("dev", "bbb2222"), { file, root: dir, now: "2026-11-23T05:00:00.000Z" });
  assert.equal(d1.added, 1, "the Shifts entry"); assert.equal(d1.skipped, 2, "Sales and Rental left out");
  const again = syncChangelog(ctx("dev", "bbb2222"), { file, root: dir, now: "2026-11-23T06:00:00.000Z" });
  assert.equal(again.added + again.stamped, 0, "the same deploy again: nothing new");
  assert.equal(t.db.prepare("SELECT count(*) n FROM hr_deploys WHERE env='dev'").get().n, 1, "and no second deploy record");
  syncChangelog(ctx("production", "ccc3333"), { file, root: dir, now: "2026-11-25T06:00:00.000Z" });
  const r = (await admin.get("/api/hr-updates")).data;
  assert.equal(r.items.filter((x) => x.title_en === "Three shifts").length, 1, "shown once");
  const s = r.items.find((x) => x.title_en === "Three shifts");
  assert.deepEqual(s.envs.filter((e) => e.env !== "test").map((e) => [e.env, e.day, e.version]), [["dev", "2026-11-23", "bbb2222"], ["production", "2026-11-25", "ccc3333"]]);
  assert.ok(!r.items.some((x) => /Rent|Sales/.test(x.title_en)), "non-HR updates never shown");
  // filters: environment and dates
  const prod = (await hr.c.get("/api/hr-updates?env=production&from=2026-11-25&to=2026-11-25")).data.items;
  assert.ok(prod.some((x) => x.title_en === "Three shifts") && prod.every((x) => x.envs.some((e) => e.env === "production" && e.day === "2026-11-25")));
  const oct = (await hr.c.get("/api/hr-updates?env=dev&from=2026-10-01&to=2026-10-31")).data.items;
  assert.deepEqual(oct.map((x) => x.key), ["first"]);
  assert.equal((await hr.c.get("/api/hr-updates?area=attendance")).data.items.length, 1);
  assert.equal((await hr.c.get("/api/hr-updates?type=fix")).data.items[0].key, "cam");
  assert.equal((await hr.c.get("/api/hr-updates?q=" + encodeURIComponent("مناوبات"))).data.items.length, 1, "search in Arabic");
});

test("Admin adds, rewords and hides; a reworded entry keeps its words on the next deploy; HR can't change; others are refused", async () => {
  const add = await admin.post("/api/hr-updates", { title_en: "Leave rules explained to staff", title_ar: "شرح قواعد الإجازة للموظفين", area: "leave", type: "improvement", env: "production", date: "2026-11-21" });
  assert.equal(add.status, 201); assert.equal(add.data.item.source, "manual"); assert.deepEqual(add.data.item.envs.map((e) => [e.env, e.day]), [["production", "2026-11-21"]]);
  assert.equal((await admin.post("/api/hr-updates", { title_en: "x", area: "sales", type: "fix" })).status, 400, "HR areas only");
  const cam = (await admin.get("/api/hr-updates")).data.items.find((x) => x.key === "cam");
  const ed = await admin.put(`/api/hr-updates/${cam.id}`, { title_en: "Check-in camera: clearer pictures", envs: { production: "2026-11-24" } });
  assert.equal(ed.status, 200); assert.equal(ed.data.item.title_en, "Check-in camera: clearer pictures");
  assert.ok(ed.data.item.envs.some((e) => e.env === "production" && e.day === "2026-11-24"));
  syncChangelog({ db: t.db, appEnv: "test", env: { SOURCE_COMMIT: "ddd4444" } }, { file, root: dir });
  assert.equal(t.db.prepare("SELECT title_en FROM hr_updates WHERE id=?").get(cam.id).title_en, "Check-in camera: clearer pictures", "Admin's words stay");
  await admin.put(`/api/hr-updates/${cam.id}`, { hidden: true });
  assert.ok(!(await hr.c.get("/api/hr-updates")).data.items.some((x) => x.id === cam.id), "hidden from HR");
  assert.ok((await admin.get("/api/hr-updates?hidden=1")).data.items.find((x) => x.id === cam.id).hidden, "Admin still sees it, marked");
  assert.equal((await hr.c.put(`/api/hr-updates/${cam.id}`, { hidden: false })).status, 403, "HR views only");
  assert.equal((await hr.c.post("/api/hr-updates", { title_en: "x", area: "leave", type: "fix" })).status, 403);
  for (const who of [mgr, staff]) assert.equal((await who.c.get("/api/hr-updates")).status, 403);
});
