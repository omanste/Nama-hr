import { test } from "node:test";
import assert from "node:assert/strict";
import { approverFor } from "../server/routing.mjs";

// employees: 1 CEO, 2 Tawfiq, 3 Finance manager, 4 Sales staff, 5 Finance staff, 6 HR manager, 7 Chairman, 8 IT staff
const users = { 1: 101, 2: 102, 3: 103, 4: 104, 5: 105, 6: 106, 7: 107, 8: 108 };
const base = {
  departments: [
    { id: 10, approver_employee_id: 2 }, // Sales
    { id: 11, approver_employee_id: 2 }, // Rental
    { id: 12, approver_employee_id: 3 }, // Finance
    { id: 13, approver_employee_id: null }, // IT, no approver yet
    { id: 14, approver_employee_id: 9 }, // approver without a login
  ],
  managersApproverEmployeeId: 1,
  userIdByEmployee: (id) => users[id] ?? null,
  adminUserId: 100,
};
const emp = (id, department_id) => ({ id, department_id });

test("department staff go to their department's approver", () => {
  assert.deepEqual(approverFor({ employee: emp(4, 10), role: "staff" }, base), { userId: 102, reason: "dept" });
  assert.deepEqual(approverFor({ employee: emp(5, 12), role: "staff" }, base), { userId: 103, reason: "dept" });
});

test("department approvers go to the managers' leave approver", () => {
  assert.deepEqual(approverFor({ employee: emp(2, 10), role: "staff" }, base), { userId: 101, reason: "managers" });
  assert.deepEqual(approverFor({ employee: emp(3, 12), role: "staff" }, base), { userId: 101, reason: "managers" });
});

test("HR manager goes to the managers' leave approver even without a department", () => {
  assert.deepEqual(approverFor({ employee: emp(6, null), role: "hr" }, base), { userId: 101, reason: "managers" });
});

test("the managers' leave approver goes to admin", () => {
  assert.deepEqual(approverFor({ employee: emp(1, null), role: "ceo" }, base), { userId: 100, reason: "admin" });
});

test("missing approver or approver without a login falls back to admin", () => {
  assert.deepEqual(approverFor({ employee: emp(8, 13), role: "staff" }, base), { userId: 100, reason: "admin" });
  assert.deepEqual(approverFor({ employee: emp(8, 14), role: "staff" }, base), { userId: 100, reason: "admin" });
  assert.deepEqual(approverFor({ employee: emp(8, null), role: "staff" }, base), { userId: 100, reason: "admin" });
  assert.deepEqual(approverFor({ employee: emp(2, 10), role: "staff" }, { ...base, managersApproverEmployeeId: null }), { userId: 100, reason: "admin" });
});

test("switching the managers' approver to the Chairman reroutes managers and the CEO", () => {
  const ctx = { ...base, managersApproverEmployeeId: 7 };
  assert.deepEqual(approverFor({ employee: emp(2, 10), role: "staff" }, ctx), { userId: 107, reason: "managers" });
  assert.deepEqual(approverFor({ employee: emp(1, null), role: "ceo" }, ctx), { userId: 107, reason: "managers" });
  assert.deepEqual(approverFor({ employee: emp(7, null), role: "staff" }, ctx), { userId: 100, reason: "admin" });
});
