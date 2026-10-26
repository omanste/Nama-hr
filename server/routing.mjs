/* Who approves a leave request — pure function, no I/O.
 *   1. The managers' leave approver (CEO, later maybe the Chairman) → Admin.
 *   2. A department approver, HR manager or CEO → the managers' leave approver.
 *   3. Everyone else → their department's approver.
 *   4. Nobody configured, no login, or the requester themself → Admin. */
export function approverFor({ employee, role }, ctx) {
  const admin = { userId: ctx.adminUserId, reason: "admin" };
  const pick = (employeeId, reason) => {
    if (!employeeId || employeeId === employee.id) return admin;
    const userId = ctx.userIdByEmployee(employeeId);
    return userId ? { userId, reason } : admin;
  };
  if (ctx.managersApproverEmployeeId && employee.id === ctx.managersApproverEmployeeId) return admin;
  const isApprover = ctx.departments.some((d) => d.approver_employee_id === employee.id);
  if (isApprover || role === "hr" || role === "ceo") return pick(ctx.managersApproverEmployeeId, "managers");
  const dept = ctx.departments.find((d) => d.id === employee.department_id);
  return pick(dept && dept.approver_employee_id, "dept");
}
