/* Role and permission checks — the single place the spec §4 matrix lives. The UI only mirrors these. */
const ALL_VIEW = ["hr", "accounts", "ceo", "chairman", "admin"];
/** Top management: may approve or reject any pending request in the company (never their own). */
export const TOP = ["ceo", "chairman"];
// a consultant (read-only, for a fixed period) sees staff, requests and reports — not the audit log
const CONSULT_VIEW = [...ALL_VIEW, "consultant"];
const MATRIX = {
  "employee.viewAll": CONSULT_VIEW,
  "employee.edit": ["hr", "admin"],
  "ledger.adjust": ["hr", "admin"],
  "import.run": ["hr", "admin"],
  "settings.edit": ["admin"],
  "users.manage": ["admin"],
  "audit.view": ALL_VIEW,
  "requests.viewAll": CONSULT_VIEW,
};

export function can(sess, action, target) {
  if (!sess) return false;
  const role = sess.user.role;
  if (action === "request.decide") return role === "admin" || (!!target && target.approver_user_id === sess.user.id);
  const roles = MATRIX[action];
  if (!roles) throw new Error(`unknown permission ${action}`);
  return roles.includes(role);
}

/** Department ids this employee approves. */
export function approvedDepartments(db, employeeId) {
  if (!employeeId) return [];
  return db.prepare("SELECT id FROM departments WHERE approver_employee_id=? AND active=1").all(employeeId).map((r) => r.id);
}
export const isApprover = (db, employeeId) => approvedDepartments(db, employeeId).length > 0;

/** May this session see this employee's profile and leave? */
export function canViewEmployee(db, sess, emp) {
  if (!emp) return false;
  if (can(sess, "employee.viewAll")) return true;
  if (sess.employee && sess.employee.id === emp.id) return true;
  return approvedDepartments(db, sess.employee && sess.employee.id).includes(emp.department_id);
}
