/* Who approves a leave request — pure function, no I/O.
 *   1. The CEO (the managers' leave approver) → the Chairman (Admin when none is set). The Chairman has no leave here.
 *   2. A department approver, anyone with the Manager role, HR manager or CEO → the managers' leave approver.
 *   3. Everyone else → their department's approver.
 *   4. Nobody configured, no login, or the requester themself → Admin. */
export function approverFor({ employee, role }, ctx) {
  const admin = { userId: ctx.adminUserId, reason: "admin" };
  const pick = (employeeId, reason) => {
    if (!employeeId || employeeId === employee.id) return admin;
    const userId = ctx.userIdByEmployee(employeeId);
    return userId ? { userId, reason } : admin;
  };
  if (ctx.managersApproverEmployeeId && employee.id === ctx.managersApproverEmployeeId) return pick(ctx.chairmanEmployeeId, "chairman");
  const isApprover = ctx.departments.some((d) => d.approver_employee_id === employee.id);
  if (isApprover || role === "manager" || role === "hr" || role === "ceo") return pick(ctx.managersApproverEmployeeId, "managers");
  const dept = ctx.departments.find((d) => d.id === employee.department_id);
  return pick(dept && dept.approver_employee_id, "dept");
}
