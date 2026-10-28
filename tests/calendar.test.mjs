// Company calendar: blocked days, occasions, holidays, birthdays (5-day heads-up, never to the person), visibility.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { runBirthdayAlerts } from "../server/calendar.mjs";

let t, admin, hr, mgr, s, b, other;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-10-26" });
  admin = await adminClient(t.base);
  const d = (await admin.post("/api/departments", { name_ar: "المبيعات" })).data.department;
  mgr = await makePerson(t.base, admin, { emp_no: "M1", name_ar: "مدير", join_date: "2020-01-01", department_id: d.id }, "manager");
  await admin.put(`/api/departments/${d.id}`, { approver_employee_id: mgr.emp.id });
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  s = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف", join_date: "2022-01-01", department_id: d.id, opening_days: 10 }, "staff");
  b = await makePerson(t.base, admin, { emp_no: "B1", name_ar: "صاحب الميلاد", join_date: "2022-01-01", department_id: d.id, dob: "1990-10-31" }, "staff");
  other = await makePerson(t.base, admin, { emp_no: "O1", name_ar: "زميل", join_date: "2022-01-01", dob: "1988-02-29" }, "staff");
});
after(async () => { await t.close(); });

test("HR/Admin add blocked days and occasions; staff can't; everyone is told", async () => {
  assert.equal((await s.c.post("/api/calendar/entries", { kind: "blocked", start: "2026-12-01", end: "2026-12-10", name: "إقفال السنة" })).status, 403);
  const bl = await hr.c.post("/api/calendar/entries", { kind: "blocked", start: "2026-12-01", end: "2026-12-10", name: "إقفال السنة" });
  assert.equal(bl.status, 201);
  assert.equal((await admin.post("/api/calendar/entries", { kind: "event", start: "2026-12-20", name: "حفل نهاية العام" })).status, 201);
  assert.equal((await admin.post("/api/calendar/entries", { kind: "holiday", start: "2026-11-18", end: "2026-11-19", name: "اليوم الوطني" })).status, 201);
  assert.equal((await admin.post("/api/calendar/entries", { kind: "event", start: "2026-12-20", end: "2026-12-01", name: "x" })).status, 400);
  assert.ok((await s.c.get("/api/notifications")).data.items.some((n) => /Days when leave/.test(n.title_en)));
  const cal = (await s.c.get("/api/calendar?month=2026-12")).data;
  assert.deepEqual(cal.events.map((e) => e.kind).sort(), ["blocked", "event"]);
  assert.equal(cal.canEdit, false);
  assert.deepEqual((await s.c.get("/api/calendar?month=2026-11")).data.holidays.map((h) => h.date), ["2026-11-18", "2026-11-19"]);
});

test("blocked days stop annual leave, unpaid leave and permissions — never sick or other statutory leave", async () => {
  const no = await s.c.post("/api/requests", { type: "annual", start: "2026-11-30", end: "2026-12-02" });
  assert.equal(no.status, 409); assert.equal(no.data.error, "blocked_days");
  assert.equal((await s.c.post("/api/requests", { type: "late", date: "2026-12-03", time: "10:00", reason: "x" })).data.error, "blocked_days");
  assert.equal((await s.c.post("/api/requests", { type: "unpaid", start: "2026-12-05", end: "2026-12-05" })).data.error, "blocked_days");
  assert.equal((await s.c.post("/api/requests", { type: "sick", start: "2026-12-04", end: "2026-12-04" })).status, 201);
  assert.equal((await s.c.post("/api/requests", { type: "annual", start: "2026-12-14", end: "2026-12-15" })).status, 201);
  // removing the block allows it again
  const ev = (await hr.c.get("/api/calendar?month=2026-12")).data.events.find((e) => e.kind === "blocked");
  assert.equal((await hr.c.del(`/api/calendar/entries/${ev.id}`)).status, 200);
  assert.equal((await s.c.post("/api/requests", { type: "annual", start: "2026-12-07", end: "2026-12-08" })).status, 201);
});

test("who's off: staff see only their own, a manager their department, HR everyone", async () => {
  const mine = (await s.c.get("/api/calendar?month=2026-12")).data.items;
  assert.ok(mine.length && mine.every((x) => x.employee_id === s.emp.id));
  assert.ok((await mgr.c.get("/api/calendar?month=2026-12")).data.items.some((x) => x.employee_id === s.emp.id));
  assert.equal((await b.c.get("/api/calendar?month=2026-12")).data.items.length, 0);
});

test("birthdays: on the calendar (no year), a heads-up 5 days before to everyone except the person", async () => {
  const cal = (await s.c.get("/api/calendar?month=2026-10")).data;
  const bd = cal.birthdays.find((x) => x.employee_id === b.emp.id);
  assert.equal(bd.date, "2026-10-31"); assert.equal(bd.dob, undefined);
  assert.equal((await s.c.get("/api/birthdays/upcoming")).data.items[0].employee_id, b.emp.id);
  assert.equal((await b.c.get("/api/birthdays/upcoming")).data.items.length, 0); // not told about their own
  assert.equal(runBirthdayAlerts(t.app.ctx, "2026-10-26"), 1);
  assert.equal(runBirthdayAlerts(t.app.ctx, "2026-10-26"), 0); // once
  const got = async (c) => (await c.get("/api/notifications")).data.items.some((n) => /birthday/.test(n.title_en));
  assert.equal(await got(s.c), true); assert.equal(await got(hr.c), true); assert.equal(await got(b.c), false);
  // 29 February birthdays show on 28 February in other years
  assert.ok((await s.c.get("/api/calendar?month=2027-02")).data.birthdays.some((x) => x.employee_id === other.emp.id && x.date === "2027-02-28"));
});

test("Oman's national days show every year for everyone without importing; religious ones are imported once a year", async () => {
  for (const [c, m, day] of [[s.c, "2027-01", "2027-01-11"], [other.c, "2030-07", "2030-07-23"], [admin, "2026-10", "2026-10-26"]]) {
    const ev = (await c.get(`/api/calendar?month=${m}`)).data.events.filter((e) => e.kind === "national");
    assert.ok(ev.some((e) => e.start_date === day && e.fixed), `${day} shown`);
  }
  assert.deepEqual((await s.c.get("/api/calendar?month=2026-10")).data.events.filter((e) => e.kind === "national").map((e) => e.start_date), ["2026-10-17", "2026-10-26"]);
  const { omanOccasions } = await import("../server/oman-occasions.mjs");
  const y26 = omanOccasions(2026);
  assert.ok(y26.some((o) => o.kind === "national" && o.date === "2026-11-18"));
  assert.ok(y26.some((o) => o.kind === "religious" && /Eid al-Adha/.test(o.name)));
  const c = admin;
  const r = await c.post("/api/calendar/import-oman", { year: 2026 });
  assert.equal((await s.c.post("/api/calendar/import-oman", { year: 2026 })).status, 403, "staff can't import");
  assert.equal(r.status, 200); assert.equal(r.data.added, y26.filter((o) => o.kind === "religious").length);
  assert.equal((await c.post("/api/calendar/import-oman", { year: 2026 })).data.added, 0, "not twice");
  const nov = (await c.get("/api/calendar?month=2026-11")).data.events;
  assert.equal(nov.filter((e) => e.kind === "national" && e.start_date === "2026-11-18").length, 1, "built in, once");
  assert.equal((await c.post("/api/calendar/entries", { kind: "religious", start: "2026-12-01", name: "Test" })).status, 201);
});

test("staff add their own events: personal (only they see it) or shared with everyone; only the owner or HR/Admin delete", async () => {
  const p = await s.c.post("/api/calendar/entries", { kind: "event", visibility: "personal", start: "2027-01-05", name: "موعد طبيب" });
  assert.equal(p.status, 201);
  const sh = await s.c.post("/api/calendar/entries", { kind: "event", visibility: "company", start: "2027-01-07", name: "غداء الفريق" });
  assert.equal(sh.status, 201);
  assert.equal((await s.c.post("/api/calendar/entries", { kind: "event", start: "2027-01-08", name: "x" })).status, 400, "staff must choose");
  assert.equal((await s.c.post("/api/calendar/entries", { kind: "national", start: "2027-01-08", name: "x" })).status, 403);
  const mine = (await s.c.get("/api/calendar?month=2027-01")).data.events.filter((e) => e.kind === "event");
  assert.deepEqual(mine.map((e) => [e.name, e.visibility, !!e.mine]).sort(), [["غداء الفريق", "company", true], ["موعد طبيب", "personal", true]]);
  for (const c of [other.c, hr.c, admin]) assert.deepEqual((await c.get("/api/calendar?month=2027-01")).data.events.filter((e) => e.kind === "event").map((e) => e.name), ["غداء الفريق"]);
  assert.equal((await other.c.del(`/api/calendar/entries/${sh.data.entry.id}`)).status, 403);
  assert.equal((await hr.c.del(`/api/calendar/entries/${p.data.entry.id}`)).status, 404, "a personal event is invisible to others");
  assert.equal((await s.c.del(`/api/calendar/entries/${p.data.entry.id}`)).status, 200);
  assert.equal((await hr.c.del(`/api/calendar/entries/${sh.data.entry.id}`)).status, 200);
  assert.equal((await s.c.get("/api/calendar?month=2027-01")).data.events.filter((e) => e.kind === "event").length, 0);
});

test("the expected official holidays for a year are added only when asked, and dates already set are kept", async () => {
  const { omanHolidays } = await import("../server/oman-occasions.mjs");
  const y27 = omanHolidays(2027);
  assert.ok(y27.some((x) => x.date === "2027-01-11") && y27.some((x) => x.date === "2027-11-18"));
  assert.equal(y27.filter((x) => /Eid al-Adha/.test(x.name)).length, 5);
  assert.equal((await admin.post("/api/calendar/import-oman", { year: 2027 })).data.holidays, 0);
  assert.equal((await admin.get("/api/calendar?month=2027-03")).data.holidays.length, 0);
  await admin.post("/api/calendar/entries", { kind: "holiday", start: "2027-01-11", name: "Set by HR" });
  const r = await admin.post("/api/calendar/import-oman", { year: 2027, holidays: true });
  assert.equal(r.data.holidays, y27.length - 1);
  assert.equal((await s.c.get("/api/calendar?month=2027-01")).data.holidays.find((x) => x.date === "2027-01-11").name, "Set by HR");
  assert.ok((await s.c.get("/api/calendar?month=2027-03")).data.holidays.length >= 3);
  assert.equal((await admin.post("/api/calendar/import-oman", { year: 2027, holidays: true })).data.holidays, 0, "not twice");
});
