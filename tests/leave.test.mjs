import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAY, ANNUAL, CAP, annualMinutes, earlyMinutes, anniversaryOn, leaveYearStart, dueCredits, capForfeit,
  summarize, fmtDays, eligibleFrom, probationEnd, requestMinutes, TYPES, todayMuscat, addMonths,
} from "../server/leave.mjs";

test("constants are minutes", () => {
  assert.equal(DAY, 480); assert.equal(ANNUAL, 14400); assert.equal(CAP, 28800);
});

test("annual leave counts calendar days inclusive", () => {
  assert.equal(annualMinutes("2026-11-01", "2026-11-05"), 2400);
  assert.equal(annualMinutes("2026-11-01", "2026-11-01"), 480);
  assert.equal(annualMinutes("2026-12-30", "2027-01-02"), 4 * 480);
});

test("annual leave rejects reversed or over-60-day ranges and bad dates", () => {
  assert.throws(() => annualMinutes("2026-11-05", "2026-11-01"), RangeError);
  assert.throws(() => annualMinutes("2026-01-01", "2026-03-02"), RangeError); // 61 days
  assert.equal(annualMinutes("2026-01-01", "2026-03-01"), 60 * 480);
  assert.throws(() => annualMinutes("2026-02-30", "2026-03-01"), RangeError);
  assert.throws(() => annualMinutes("", "2026-03-01"), RangeError);
});

test("early leave deducts from leave time to 17:00 in 30-minute steps", () => {
  assert.equal(earlyMinutes("15:30"), 90);
  assert.equal(earlyMinutes("09:30"), 450);
  assert.equal(earlyMinutes("16:30"), 30);
  for (const bad of ["15:15", "17:00", "09:00", "08:30", "x", "", "16:60"]) assert.throws(() => earlyMinutes(bad), RangeError, bad);
});

test("anniversary of 29 February falls on 28 February in non-leap years", () => {
  assert.equal(anniversaryOn("2024-02-29", 2027), "2027-02-28");
  assert.equal(anniversaryOn("2024-02-29", 2028), "2028-02-29");
  assert.equal(anniversaryOn("2020-11-01", 2026), "2026-11-01");
});

test("leave year starts at the latest anniversary on or before today", () => {
  assert.equal(leaveYearStart("2020-03-10", "2026-03-09"), "2025-03-10");
  assert.equal(leaveYearStart("2020-03-10", "2026-03-10"), "2026-03-10");
  assert.equal(leaveYearStart("2026-10-01", "2026-10-26"), "2026-10-01");
  assert.equal(leaveYearStart("2026-12-01", "2026-10-26"), "2026-12-01"); // not joined yet
});

test("due credits lists missing leave-year starts up to today", () => {
  assert.deepEqual(dueCredits("2024-01-10", "2026-10-26", new Set(["2024-01-10"])), ["2025-01-10", "2026-01-10"]);
  assert.deepEqual(dueCredits("2024-01-10", "2026-10-26", new Set(["2024-01-10", "2025-01-10", "2026-01-10"])), []);
  assert.deepEqual(dueCredits("2024-02-29", "2026-03-01", new Set(["2024-02-29"])), ["2025-02-28", "2026-02-28"]);
  assert.deepEqual(dueCredits("2019-05-05", "2026-10-26", new Set(), "2026-10-02"), []);
  assert.deepEqual(dueCredits("2019-05-05", "2027-05-05", new Set(), "2026-10-02"), ["2027-05-05"]);
  assert.deepEqual(dueCredits(null, "2027-05-05", new Set()), []);
});

test("cap forfeit is the amount above 60 days", () => {
  assert.equal(capForfeit(30000), 1200);
  assert.equal(capForfeit(28800), 0);
  assert.equal(capForfeit(100), 0);
});

const Y = "2026-01-10", PREV = "2025-01-10";
test("summary splits carried, entitlement, used, remaining and available", () => {
  const rows = [
    { kind: "annual_credit", minutes: 14400, leave_year_start: PREV },
    { kind: "annual_leave", minutes: -9600, leave_year_start: PREV },   // carried 10 days
    { kind: "annual_credit", minutes: 14400, leave_year_start: Y },
    { kind: "annual_leave", minutes: -2400, leave_year_start: Y },
  ];
  const s = summarize(rows, 0, Y);
  assert.equal(s.carried, 4800); assert.equal(s.entitlement, 14400); assert.equal(s.used, 2400); assert.equal(s.remaining, 16800);
  assert.equal(s.available, 16800);
  assert.equal(summarize(rows, 960, Y).available, 15840);
  assert.equal(summarize(rows, 960, Y).pending, 960);
});

test("summary shows carried after the cap and counts extra days and reversals", () => {
  const rows = [
    { kind: "opening", minutes: 24000, leave_year_start: PREV },          // 50 days
    { kind: "annual_credit", minutes: 14400, leave_year_start: Y },
    { kind: "cap_forfeit", minutes: -9600, leave_year_start: Y },         // 20 days
    { kind: "comp_credit", minutes: 480, leave_year_start: Y },
    { kind: "early_leave", minutes: -90, leave_year_start: Y },
    { kind: "annual_leave", minutes: -960, leave_year_start: Y },
    { kind: "reversal", minutes: 960, leave_year_start: Y },
    { kind: "adjustment", minutes: 240, leave_year_start: Y },
  ];
  const s = summarize(rows, 0, Y);
  assert.equal(s.carried, 14400);
  assert.equal(s.entitlement, 14400);
  assert.equal(s.extra, 480);
  assert.equal(s.used, 90);
  assert.equal(s.adjustments, 240);
  assert.equal(s.remaining, 24000 + 14400 - 9600 + 480 - 90 + 240);
});

test("an opening balance posted inside the year counts as entitlement, not carried", () => {
  const s = summarize([{ kind: "opening", minutes: 50880, leave_year_start: Y }], 0, Y);
  assert.equal(s.carried, 0); assert.equal(s.entitlement, 50880); assert.equal(s.remaining, 50880);
});

test("days are shown with up to two decimals", () => {
  assert.equal(fmtDays(14400), "30");
  assert.equal(fmtDays(6120), "12.75");
  assert.equal(fmtDays(90), "0.19");
  assert.equal(fmtDays(-480), "-1");
});

test("eligibility is join + 6 months and probation is join + 3 months, clamped to month end", () => {
  assert.equal(eligibleFrom("2026-08-31"), "2027-02-28");
  assert.equal(eligibleFrom("2026-01-15"), "2026-07-15");
  assert.equal(probationEnd("2026-01-15"), "2026-04-15");
  assert.equal(probationEnd("2025-11-30"), "2026-02-28");
  assert.equal(eligibleFrom(null), null);
  assert.equal(addMonths("2024-08-31", 6), "2025-02-28");
});

test("request minutes per type", () => {
  assert.equal(requestMinutes("annual", { start: "2026-11-01", end: "2026-11-03" }), 1440);
  assert.equal(requestMinutes("sick", { start: "2026-11-01", end: "2026-11-02" }), 960);
  assert.equal(requestMinutes("early", { time: "16:00" }), 60);
  assert.equal(requestMinutes("comp_day", { date: "2026-10-01" }), 480);
  assert.throws(() => requestMinutes("holiday", {}), RangeError);
  assert.equal(TYPES.annual.effect, "deduct"); assert.equal(TYPES.sick.effect, "record"); assert.equal(TYPES.comp_day.effect, "credit");
});

test("today is an ISO date in Muscat time", () => {
  assert.match(todayMuscat(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(todayMuscat(new Date("2026-10-26T21:30:00Z")), "2026-10-27"); // UTC+4
});
