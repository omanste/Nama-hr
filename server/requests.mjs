/* Leave request lifecycle: submit → approve | reject | cancel, with ledger postings and history.
 * The approver is fixed when the request is submitted; Admin can always act. */
import { nowIso, tx, getSetting } from "./db.mjs";
import { send, readJson, HttpError } from "./http.mjs";
import { can, canViewEmployee, approvedDepartments } from "./perm.mjs";
import { audit } from "./audit.mjs";
import { TYPES, PERMISSION_TYPES, ATTENDANCE_TYPES, PERM_CLASSES, CORRECTION_CLASSES, clockMin, permissionSpan, requestMinutes, eligibleFrom, isIsoDate, fmtDays, DAY, checkLeaveRules, RuleError, sickPayBands, addMonths, daysBetweenInclusive, addDays, daysExcludingHolidays } from "./leave.mjs";
import { approverFor } from "./routing.mjs";
import { postLedger, balanceOf, pendingMinutes, yearStartFor } from "./ledger.mjs";
import { notify } from "./notify.mjs";
import { getEmployee } from "./employees.mjs";
import { storeUpload } from "./files.mjs";
import { blockedOverlap } from "./calendar.mjs";
import { shiftFor, isRestDay } from "./shifts.mjs";

export const TYPE_NAMES = {
  annual: ["إجازة سنوية", "Annual leave"], early: ["مغادرة مبكرة", "Early leave"], late: ["تأخير في الحضور", "Late arrival"], break: ["استئذان خلال الدوام", "Personal break"], emergency: ["إجازة اضطرارية", "Emergency leave"],
  bereavement: ["إجازة وفاة", "Bereavement leave"], sick: ["إجازة مرضية", "Sick leave"], comp_day: ["عمل في يوم عطلة", "Worked on a holiday"],
  marriage: ["إجازة زواج", "Marriage leave"], paternity: ["إجازة أبوة", "Paternity leave"], maternity: ["إجازة أمومة", "Maternity leave"],
  hajj: ["إجازة الحج", "Hajj leave"], exam: ["إجازة امتحانات", "Exam leave"], patient_care: ["إجازة مرافقة مريض", "Accompanying a patient"],
  childcare: ["إجازة رعاية طفل (بدون أجر)", "Child-care leave (unpaid)"], unpaid: ["إجازة خاصة بدون أجر", "Special unpaid leave"],
  correction: ["تصحيح بصمة", "Fingerprint correction"], mission: ["مهمة عمل خارجية", "External work task"],
};
export const CLASS_NAMES = { statutory: ["حق نظامي مدفوع", "Statutory paid"], special: ["إذن خاص مدفوع", "Special paid permission"],
  unpaid: ["بدون أجر", "Unpaid"], leave: ["من الإجازة السنوية", "From annual leave"], confirmed: ["معتمد", "Confirmed"], refused: ["غير معتمد", "Not confirmed"] };
const RULE_STATUS = { invalid: 400, too_long: 400, outside_window: 400 };

const PERM_SQL = `(${PERMISSION_TYPES.map((t) => `'${t}'`).join(",")})`;
const isPermission = (type) => !!(TYPES[type] && TYPES[type].permission);
const ATT_SQL = `(${ATTENDANCE_TYPES.map((t) => `'${t}'`).join(",")})`;

const holidaySet = (db) => new Set(getSetting(db, "official_holidays", []).map((h) => h.date));


/** Days already requested (pending or approved) of a type, for the legal limits. */
function usedDays(db, empId, type, start, end, eventDate, relation, excludeId = 0) {
  const sum = (where, ...args) => db.prepare(`SELECT coalesce(sum(julianday(end_date)-julianday(start_date)+1),0) n FROM leave_requests
    WHERE employee_id=? AND type=? AND status IN ${ACTIVE} AND id<>? ${where}`).get(empId, type, excludeId, ...args).n;
  // yearly limits count the days that fall inside each calendar year the request touches; report the tightest year
  const overlap = (a, b, y) => { const s = a > `${y}-01-01` ? a : `${y}-01-01`, e = b < `${y}-12-31` ? b : `${y}-12-31`; return s > e ? 0 : daysBetweenInclusive(s, e); };
  let yearInfo = { used: 0, add: 0 };
  for (let y = +start.slice(0, 4); y <= +end.slice(0, 4); y++) {
    const rows = db.prepare(`SELECT start_date, end_date FROM leave_requests WHERE employee_id=? AND type=? AND status IN ${ACTIVE} AND id<>?
      AND start_date<=? AND end_date>=?`).all(empId, type, excludeId, `${y}-12-31`, `${y}-01-01`);
    const info = { used: rows.reduce((n, r) => n + overlap(r.start_date, r.end_date, y), 0), add: overlap(start, end, y) };
    if (info.used + info.add > yearInfo.used + yearInfo.add) yearInfo = info;
  }
  const forEvent = !eventDate ? 0 : type === "bereavement" ? sum("AND event_date=? AND relation=?", eventDate, relation || "") : sum("AND event_date=?", eventDate);
  const otherEventNear = !!eventDate && sum("AND event_date IS NOT NULL AND event_date<>? AND abs(julianday(event_date)-julianday(?))<270", eventDate, eventDate) > 0;
  return { yearInfo, ever: sum(""), forEvent, otherEventNear };
}
const ACTIVE = "('pending','approved')";
const dmy = (iso) => iso.split("-").reverse().join("/");
const err = (status, code, message, field) => Object.assign(new HttpError(status, code, message), field ? { field } : {});

export function adminUserId(db, notUserId = 0) {
  const r = db.prepare("SELECT id FROM users WHERE role='admin' AND active=1 AND id<>? ORDER BY id LIMIT 1").get(notUserId);
  return r ? r.id : null;
}

/** The deputy covering for an approver on a date, if any. */
export function deputyOf(db, approverUserId, date) {
  const r = db.prepare(`SELECT c.deputy_user_id id FROM approver_cover c JOIN users u ON u.id=c.deputy_user_id
    WHERE c.approver_user_id=? AND c.start_date<=? AND c.end_date>=? AND u.active=1 ORDER BY c.id DESC LIMIT 1`).get(approverUserId, date, date);
  return r ? r.id : null;
}

/** May this session approve/reject this request? Never one's own; the stored approver, their deputy while covering, or Admin. */
export function mayDecide(db, sess, r, today) {
  if (sess.employee && sess.employee.id === r.employee_id) return false;
  if (sess.user.role === "admin" || r.approver_user_id === sess.user.id) return true;
  return deputyOf(db, r.approver_user_id, today) === sess.user.id;
}

const hrUsers = (db) => db.prepare("SELECT id FROM users WHERE role='hr' AND active=1").all().map((u) => u.id);

/** Undo whatever a request took from (or added to) the balance — the net per leave year, so it can run more than once. */
function reverseRequest(db, emp, requestId, date, by, note) {
  for (const l of db.prepare("SELECT leave_year_start, sum(minutes) n FROM leave_ledger WHERE request_id=? GROUP BY leave_year_start HAVING sum(minutes)<>0").all(requestId))
    postLedger(db, emp, { kind: "reversal", minutes: -l.n, date, yearStart: l.leave_year_start, requestId, note, by });
}

export function routeFor(db, emp, today) {
  const user = db.prepare("SELECT id, role FROM users WHERE employee_id=?").get(emp.id) || {};
  const route = approverFor({ employee: emp, role: user.role || "staff" }, {
    departments: db.prepare("SELECT id, approver_employee_id FROM departments WHERE active=1").all(),
    managersApproverEmployeeId: getSetting(db, "managers_approver_employee_id", null),
    userIdByEmployee: (id) => {
      const u = db.prepare("SELECT u.id FROM users u JOIN employees e ON e.id=u.employee_id WHERE u.employee_id=? AND u.active=1 AND e.status IN ('active','on_leave')").get(id);
      return u ? u.id : null;
    },
    adminUserId: adminUserId(db, user.id || 0),
  });
  if (route.userId && route.userId === user.id) route.userId = adminUserId(db, user.id); // never one's own approver
  // while a deputy covers, the request stays with the real approver; the deputy may decide it during the cover dates
  const deputy = today && route.userId && deputyOf(db, route.userId, today);
  return deputy && deputy !== user.id ? { ...route, reason: "cover", deputyId: deputy } : route;
}

/** Requests that went to Admin only because the right approver had no login (or none was set) move to that approver
 * once there is one — after a manager first signs in, gets a login, or is named as a department's approver. */
export function rerouteFallbacks(ctx) {
  const { db } = ctx;
  let moved = 0;
  for (const r of db.prepare("SELECT * FROM leave_requests WHERE status='pending' AND route_reason='admin'").all()) {
    const emp = getEmployee(db, r.employee_id);
    if (!emp) continue;
    const route = routeFor(db, emp, ctx.today());
    if (route.reason === "admin" || !route.userId || route.userId === r.approver_user_id) continue;
    db.prepare("UPDATE leave_requests SET approver_user_id=?, route_reason=? WHERE id=?").run(route.userId, route.reason, r.id);
    event(db, r.id, "rerouted", null, null);
    const d = describe(r, emp);
    notify(ctx, [route.userId], { title_ar: "طلب بانتظار موافقتك", title_en: "A request is waiting for your approval", body_ar: d.ar, body_en: d.en, link: `#/leave/${r.id}` });
    moved++;
  }
  return moved;
}

/** Validate a submission; returns {type, start_date, end_date, early_time, minutes}. */
export function validateRequest(db, emp, body, today) {
  const type = body.type;
  if (!TYPES[type]) throw err(400, "invalid", "Unknown leave type", "type");
  let start, end, time = null;
  if (TYPES[type].range) { start = body.start; end = body.end; }
  else { start = end = body.date; }
  if (!isIsoDate(start)) throw err(400, "invalid", "A valid date is required", TYPES[type].range ? "start" : "date");
  if (!isIsoDate(end)) throw err(400, "invalid", "A valid end date is required", "end");
  let endTime = null;
  if (isPermission(type)) {
    time = body.time;
    if (type === "break") endTime = body.end_time;
    if (!String(body.reason || "").trim()) throw err(400, "invalid", "Please give a reason", "reason");
    if (holidaySet(db).has(start)) throw err(400, "invalid", "This day is an official holiday", "date");
  }
  if (TYPES[type].attendance) return validateAttendance(db, emp, type, start, body, today);
  let minutes;
  const sh = shiftFor(db, emp, start), dayStart = sh.start, dayEnd = sh.end;
  if (isPermission(type) && isRestDay(start)) throw err(400, "invalid", "This day is a weekly rest day", "date");
  try { minutes = requestMinutes(type, { start, end, time, endTime, dayStart, dayEnd }); }
  catch (e) { throw err(400, "invalid", e.message, isPermission(type) ? (type === "break" && /end|after/.test(e.message) ? "end_time" : "time") : "end"); }
  // official holidays inside leave taken from the annual balance are not deducted
  if (TYPES[type].effect === "deduct") {
    const days = daysExcludingHolidays(start, end, holidaySet(db));
    if (!days) throw err(400, "invalid", "All the chosen days are official holidays", "start");
    minutes = days * DAY;
  }
  let compChoice = null;
  if (type === "comp_day") {
    compChoice = body.comp_choice || "leave";
    if (!["leave", "pay"].includes(compChoice)) throw err(400, "invalid", "Choose a day off or payment", "comp_choice");
  }
  const relation = String(body.relation || "").trim().slice(0, 100) || null;
  const eventDate = body.event_date || null;
  if (TYPES[type].range) {
    try { checkLeaveRules(type, { emp, start, end, relation, eventDate, used: usedDays(db, emp.id, type, start, end, eventDate, relation) }); }
    catch (e) { if (e instanceof RuleError) throw err(RULE_STATUS[e.code] || 409, e.code, e.message, e.field); throw e; }
  }
  if (type === "comp_day" && start > today) throw err(400, "invalid", "The worked day cannot be in the future", "date");

  if (type === "comp_day") {
    if (db.prepare(`SELECT 1 FROM leave_requests WHERE employee_id=? AND type='comp_day' AND start_date=? AND status IN ${ACTIVE}`).get(emp.id, start))
      throw err(409, "overlap", "This day has already been claimed");
  } else if (isPermission(type)) {
    // a permission can't fall on a day already taken as leave, nor overlap another permission's hours that day
    if (db.prepare(`SELECT 1 FROM leave_requests WHERE employee_id=? AND type<>'comp_day' AND type NOT IN ${PERM_SQL} AND type NOT IN ${ATT_SQL} AND status IN ${ACTIVE} AND start_date<=? AND end_date>=?`).get(emp.id, start, start))
      throw err(409, "overlap", "You already have leave on this day");
    const [a, b] = permissionSpan(type, { time, endTime, dayStart, dayEnd });
    for (const o of db.prepare(`SELECT * FROM leave_requests WHERE employee_id=? AND type IN ${PERM_SQL} AND status IN ${ACTIVE} AND start_date=?`).all(emp.id, start)) {
      const [c, d] = permissionSpan(o.type, { time: o.early_time, endTime: o.end_time, dayStart, dayEnd });
      if (a < d && c < b) throw err(409, "overlap", "These hours overlap another permission on the same day");
    }
  } else {
    const clash = db.prepare(`SELECT id FROM leave_requests WHERE employee_id=? AND type<>'comp_day' AND type NOT IN ${ATT_SQL} AND status IN ${ACTIVE} AND start_date<=? AND end_date>=?`).get(emp.id, end, start);
    if (clash) throw err(409, "overlap", "These dates overlap another request");
  }

  const blocked = blockedOverlap(db, type, start, end);
  if (blocked) throw err(409, "blocked_days", `Leave can't be booked on these days: ${blocked.name} (${dmy(blocked.start_date)} – ${dmy(blocked.end_date)})`, isPermission(type) ? "date" : "start");
  if (TYPES[type].effect === "deduct") {
    const from = eligibleFrom(emp.join_date);
    if (from && start < from) throw err(409, "not_eligible_yet", `Leave is available from ${dmy(from)} (${from})`);
    const available = balanceOf(db, emp.id) - pendingMinutes(db, emp.id);
    if (minutes > available) throw err(409, "insufficient_balance", `This exceeds your available balance (${fmtDays(available)} days)`);
  }
  return { type, start_date: start, end_date: end, early_time: time, end_time: endTime, minutes, relation, event_date: TYPES[type].event ? eventDate : null, comp_choice: compChoice };
}

/** A fingerprint correction (§5) or an external task (§10): one date, times of any minute. */
function validateAttendance(db, emp, type, date, body, today) {
  if (date > today && type === "correction") throw err(400, "invalid", "You can't correct a day that hasn't happened yet", "date");
  if (!String(body.reason || "").trim()) throw err(400, "invalid", type === "mission" ? "Describe the purpose of the task" : "Please give a reason", "reason");
  const time = body.time || null, endTime = body.end_time || null;
  if (time !== null && clockMin(time) === null) throw err(400, "invalid", "Enter a valid time (HH:MM)", "time");
  if (endTime !== null && clockMin(endTime) === null) throw err(400, "invalid", "Enter a valid time (HH:MM)", "end_time");
  let minutes = 0, details = null;
  if (type === "correction") {
    if (!time && !endTime) throw err(400, "invalid", "Enter the arrival time, the leaving time, or both", "time");
    if (time && endTime && clockMin(endTime) <= clockMin(time)) throw err(400, "invalid", "Leaving must be after arriving", "end_time");
    if (db.prepare(`SELECT 1 FROM leave_requests WHERE employee_id=? AND type='correction' AND start_date=? AND status IN ${ACTIVE}`).get(emp.id, date))
      throw err(409, "overlap", "There is already a correction for this day");
  } else {
    if (date < addDays(today, -30)) throw err(400, "invalid", "A task more than 30 days ago can't be added", "date");
    if (!time || !endTime) throw err(400, "invalid", "Enter when the task starts and ends", !time ? "time" : "end_time");
    try { minutes = requestMinutes(type, { time, endTime }); } catch (e) { throw err(400, "invalid", e.message, "end_time"); }
    const place = String(body.place || "").trim().slice(0, 200);
    if (!place) throw err(400, "invalid", "Where is the task (client or place)?", "place");
    details = JSON.stringify({ place });
    for (const o of db.prepare(`SELECT * FROM leave_requests WHERE employee_id=? AND type='mission' AND status IN ${ACTIVE} AND start_date=?`).all(emp.id, date))
      if (clockMin(time) < clockMin(o.end_time) && clockMin(o.early_time) < clockMin(endTime)) throw err(409, "overlap", "These hours overlap another task on the same day");
  }
  return { type, start_date: date, end_date: date, early_time: time, end_time: endTime, minutes, relation: null, event_date: null, comp_choice: null, details };
}

function event(db, requestId, action, actorId, comment) {
  db.prepare("INSERT INTO request_events(request_id,action,actor_user_id,at,comment) VALUES(?,?,?,?,?)").run(requestId, action, actorId, nowIso(), comment || null);
}
const getReq = (db, id) => db.prepare("SELECT * FROM leave_requests WHERE id=?").get(Number(id));
const ownerUser = (db, empId) => (db.prepare("SELECT id FROM users WHERE employee_id=? AND active=1").get(empId) || {}).id;

function describe(r, emp) {
  const [ar, en] = TYPE_NAMES[r.type];
  const when = isPermission(r.type) || TYPES[r.type].attendance ? `${dmy(r.start_date)} ${r.early_time || "…"}${r.end_time ? "–" + r.end_time : ""}` : r.start_date === r.end_date ? dmy(r.start_date) : `${dmy(r.start_date)} – ${dmy(r.end_date)}`;
  const amount = isPermission(r.type) || r.type === "mission" ? `${r.minutes / 60} h` : r.type === "correction" ? "—" : `${fmtDays(r.minutes)} d`;
  return { ar: `${emp.name_ar || emp.name_en}: ${ar} · ${when} · ${amount}`, en: `${emp.name_en || emp.name_ar}: ${en} · ${when} · ${amount}` };
}

export function registerRequests(api, ctx) {
  const { db } = ctx;
  const forbidden = () => new HttpError(403, "forbidden", "You do not have permission for this");
  const canSee = (sess, r) => r.approver_user_id === sess.user.id || deputyOf(db, r.approver_user_id, ctx.today()) === sess.user.id || can(sess, "requests.viewAll") || canViewEmployee(db, sess, getEmployee(db, r.employee_id));

  const withNames = `SELECT r.*, e.emp_no, e.name_ar, e.name_en, e.department_id,
      (SELECT coalesce(sum(minutes),0) FROM leave_ledger l WHERE l.employee_id=r.employee_id) balance,
      (SELECT count(*) FROM files f WHERE f.request_id=r.id) file_count
    FROM leave_requests r JOIN employees e ON e.id=r.employee_id`;

  api.post("/api/requests", async (req, res) => {
    const sess = req.sess;
    if (!sess.employee) throw err(400, "no_profile", "Your login is not linked to a staff profile");
    const body = await readJson(req);
    const emp = sess.employee;
    // Company policy: an approver taking planned leave names a deputy for those dates
    const needsDeputy = ["annual", "emergency"].includes(body.type) && (sess.isApprover || sess.user.role === "ceo"
      || getSetting(db, "managers_approver_employee_id", null) === emp.id);
    const deputyId = Number(body.deputy_user_id) || 0;
    if (needsDeputy && (!deputyId || deputyId === sess.user.id || !db.prepare("SELECT 1 FROM users WHERE id=? AND active=1").get(deputyId)))
      throw err(400, "deputy_required", "Name a deputy to handle your approvals while you are away", "deputy_user_id");
    const r = tx(db, () => {
      const v = validateRequest(db, emp, body, ctx.today());
      const route = routeFor(db, emp, ctx.today());
      const ins = db.prepare(`INSERT INTO leave_requests(employee_id,type,start_date,end_date,early_time,minutes,reason,status,approver_user_id,route_reason,created_by,created_at,relation,event_date,comp_choice,end_time,details)
        VALUES(?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?)`).run(emp.id, v.type, v.start_date, v.end_date, v.early_time, v.minutes, String(body.reason || "").slice(0, 1000) || null, route.userId, route.reason, sess.user.id, nowIso(), v.relation, v.event_date, v.comp_choice, v.end_time, v.details || null);
      const row = getReq(db, ins.lastInsertRowid);
      if (needsDeputy) db.prepare("INSERT INTO approver_cover(approver_user_id,deputy_user_id,start_date,end_date,created_by,created_at,request_id) VALUES(?,?,?,?,?,?,?)")
        .run(sess.user.id, deputyId, v.start_date, v.end_date, sess.user.id, nowIso(), row.id);
      event(db, row.id, "submitted", sess.user.id, row.reason);
      audit(db, sess.user.id, "request.submit", "request", row.id, null, row);
      return row;
    });
    const d = describe(r, emp);
    const dep = deputyOf(db, r.approver_user_id, ctx.today());
    notify(ctx, [r.approver_user_id, dep && dep !== sess.user.id ? dep : null], { title_ar: "طلب إجازة بانتظار موافقتك", title_en: "Leave request awaiting your approval", body_ar: d.ar, body_en: d.en, link: `#/leave/${r.id}` });
    notify(ctx, [sess.user.id], { title_ar: "تم إرسال طلبك", title_en: "Your request was submitted", body_ar: d.ar, body_en: d.en, link: `#/leave/${r.id}`, inAppOnly: true });
    send(req, res, 201, { request: r });
  });

  api.get("/api/requests", (req, res) => {
    const sess = req.sess;
    const scope = req.query.get("scope") || "mine";
    const where = [], args = [];
    if (scope === "mine") { where.push("r.employee_id=?"); args.push(sess.employee ? sess.employee.id : -1); }
    else if (scope === "approvals") {
      where.push("r.status='pending'", "r.employee_id<>?"); args.push(sess.employee ? sess.employee.id : -1);
      if (sess.user.role !== "admin") {
        where.push(`(r.approver_user_id=? OR r.approver_user_id IN (SELECT approver_user_id FROM approver_cover WHERE deputy_user_id=? AND start_date<=? AND end_date>=?))`);
        args.push(sess.user.id, sess.user.id, ctx.today(), ctx.today());
      }
    }
    else if (scope === "team") {
      const depts = approvedDepartments(db, sess.employee && sess.employee.id);
      if (!depts.length) throw forbidden();
      where.push(`e.department_id IN (${depts.map(() => "?").join(",")})`); args.push(...depts);
    } else if (scope === "all") { if (!can(sess, "requests.viewAll")) throw forbidden(); }
    else throw err(400, "invalid", "unknown scope");
    // period: requests starting between from and to (YYYY-MM-DD)
    const from = req.query.get("from"), to = req.query.get("to");
    if (from) { if (!isIsoDate(from)) throw err(400, "invalid", "from must be a date"); where.push("r.start_date>=?"); args.push(from); }
    if (to) { if (!isIsoDate(to)) throw err(400, "invalid", "to must be a date"); where.push("r.start_date<=?"); args.push(to); }
    const status = req.query.get("status");
    if (status) { where.push("r.status=?"); args.push(status); }
    const emp = req.query.get("employee");
    if (emp) { where.push("r.employee_id=?"); args.push(Number(emp)); }
    const kind = req.query.get("kind"); // permission = early/late/break; attendance = corrections and external tasks; leave = everything else
    if (kind === "permission") where.push(`r.type IN ${PERM_SQL}`);
    else if (kind === "attendance") where.push(`r.type IN ${ATT_SQL}`);
    else if (kind === "leave") where.push(`r.type NOT IN ${PERM_SQL} AND r.type NOT IN ${ATT_SQL}`);
    const items = db.prepare(`${withNames} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY r.created_at DESC, r.id DESC LIMIT 500`).all(...args);
    send(req, res, 200, { items });
  });

  api.get("/api/requests/:id", (req, res) => {
    const r = db.prepare(`${withNames} WHERE r.id=?`).get(Number(req.params.id));
    if (!r) throw new HttpError(404, "not_found", "Request not found");
    if (!canSee(req.sess, r)) throw forbidden();
    const events = db.prepare(`SELECT ev.*, u.username actor_username, coalesce(e.name_ar, u.username) actor_name, e.name_en actor_name_en
      FROM request_events ev LEFT JOIN users u ON u.id=ev.actor_user_id LEFT JOIN employees e ON e.id=u.employee_id WHERE ev.request_id=? ORDER BY ev.id`).all(r.id);
    const approver = db.prepare("SELECT u.id, u.username, e.name_ar, e.name_en FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=?").get(r.approver_user_id);
    const files = db.prepare("SELECT id,name,mime,size,uploaded_at FROM files WHERE request_id=?").all(r.id);
    let sickPay;
    if (r.type === "sick") {
      const prior = db.prepare(`SELECT coalesce(sum(julianday(end_date)-julianday(start_date)+1),0) n FROM leave_requests
        WHERE employee_id=? AND type='sick' AND status='approved' AND id<>? AND substr(start_date,1,4)=? AND start_date<?`).get(r.employee_id, r.id, r.start_date.slice(0, 4), r.start_date).n;
      sickPay = sickPayBands(prior, daysBetweenInclusive(r.start_date, r.end_date));
    }
    const deducted = -db.prepare("SELECT coalesce(sum(minutes),0) n FROM leave_ledger WHERE request_id=?").get(r.id).n;
    const classes = isPermission(r.type) ? PERM_CLASSES : r.type === "correction" ? CORRECTION_CLASSES : null;
    send(req, res, 200, { request: r, events, approver, files, sickPay, deducted, classes, canClassify: !!classes && r.status === "approved" && can(req.sess, "employee.edit") && !(req.sess.employee && req.sess.employee.id === r.employee_id), needsProof: !!TYPES[r.type].proof && !files.length,
      canDecide: r.status === "pending" && mayDecide(db, req.sess, r, ctx.today()), canPostpone: r.status === "pending" && r.type === "annual" && mayDecide(db, req.sess, r, ctx.today()) });
  });

  async function decide(req, res, action) {
    const sess = req.sess;
    const body = await readJson(req);
    const comment = String(body.comment || "").trim().slice(0, 1000);
    const out = tx(db, () => {
      const r = getReq(db, req.params.id);
      if (!r) throw new HttpError(404, "not_found", "Request not found");
      const emp = getEmployee(db, r.employee_id);
      const isOwner = sess.employee && sess.employee.id === r.employee_id;
      if (action === "approve" || action === "reject") {
        if (!mayDecide(db, sess, r, ctx.today())) throw forbidden();
        if (r.status !== "pending") throw err(409, "not_pending", "This request has already been decided");
        if (action === "reject" && !comment) throw err(400, "invalid", "Please give a reason for the rejection", "comment");
        if (action === "approve") {
          if (TYPES[r.type].proof && !db.prepare("SELECT 1 FROM files WHERE request_id=?").get(r.id))
            throw err(409, "proof_required", "Attach the supporting document (e.g. medical certificate) before approval");
          const effect = TYPES[r.type].effect;
          if (effect === "deduct") {
            const available = balanceOf(db, emp.id) - pendingMinutes(db, emp.id, r.id);
            if (r.minutes > available) throw err(409, "insufficient_balance", `The balance is no longer enough (${fmtDays(available)} days available)`);
            postLedger(db, emp, { kind: r.type === "emergency" ? "emergency_leave" : "annual_leave", minutes: -r.minutes, date: r.start_date, requestId: r.id, by: sess.user.id });
          } else if (effect === "credit" && r.comp_choice !== "pay") {
            postLedger(db, emp, { kind: "comp_credit", minutes: DAY, date: r.start_date, requestId: r.id, note: "Worked on a holiday", by: sess.user.id });
          }
        }
      } else { // cancel
        if (r.status === "pending") { if (!(isOwner || can(sess, "employee.edit") || sess.user.role === "admin")) throw forbidden(); }
        else if (r.status === "approved") {
          if (!(sess.user.role === "admin" || r.approver_user_id === sess.user.id)) throw forbidden();
          reverseRequest(db, emp, r.id, ctx.today(), sess.user.id, "Cancelled");
        } else throw err(409, "not_cancellable", "This request cannot be cancelled");
      }
      const status = { approve: "approved", reject: "rejected", cancel: "cancelled" }[action];
      if (status !== "approved") db.prepare("DELETE FROM approver_cover WHERE request_id=?").run(r.id);
      db.prepare("UPDATE leave_requests SET status=?, decided_by=?, decided_at=?, decision_comment=coalesce(?,decision_comment) WHERE id=?")
        .run(status, sess.user.id, nowIso(), comment || null, r.id);
      event(db, r.id, status, sess.user.id, comment);
      const after = getReq(db, r.id);
      audit(db, sess.user.id, `request.${action}`, "request", r.id, r, after);
      return { r: after, emp };
    });
    const { r, emp } = out;
    const d = describe(r, emp);
    const T = { approved: ["تمت الموافقة على طلبك", "Your request was approved"], rejected: ["تم رفض طلبك", "Your request was rejected"], cancelled: ["تم إلغاء الطلب", "The request was cancelled"] }[r.status];
    const extra = comment ? { ar: ` — ${comment}`, en: ` — ${comment}` } : { ar: "", en: "" };
    // tell the owner and the approver, except whoever just acted
    const to = [ownerUser(db, r.employee_id), r.approver_user_id].filter((id) => id && id !== sess.user.id);
    notify(ctx, to, { title_ar: T[0], title_en: T[1], body_ar: d.ar + extra.ar, body_en: d.en + extra.en, link: `#/leave/${r.id}` });
    // §5, §8: after the manager, HR classifies a permission or confirms a fingerprint correction
    if (r.status === "approved" && (isPermission(r.type) || r.type === "correction"))
      notify(ctx, hrUsers(db).filter((id) => id !== sess.user.id), { title_ar: r.type === "correction" ? "تصحيح بصمة بانتظار اعتماد الموارد البشرية" : "استئذان بانتظار تصنيف الموارد البشرية",
        title_en: r.type === "correction" ? "Fingerprint correction awaiting HR" : "Permission awaiting HR classification", body_ar: d.ar, body_en: d.en, link: `#/leave/${r.id}` });
    send(req, res, 200, { request: r });
  }

  // HR: classify an approved permission (§8) or confirm / refuse an approved fingerprint correction (§5).
  // "leave" takes the hours from annual leave; changing the classification undoes the earlier deduction.
  api.post("/api/requests/:id/hr", async (req, res) => {
    const sess = req.sess;
    if (!can(sess, "employee.edit")) throw forbidden();
    const b = await readJson(req);
    const out = tx(db, () => {
      const r = getReq(db, req.params.id);
      if (!r) throw new HttpError(404, "not_found", "Request not found");
      if (sess.employee && sess.employee.id === r.employee_id) throw forbidden();
      const classes = isPermission(r.type) ? PERM_CLASSES : r.type === "correction" ? CORRECTION_CLASSES : null;
      if (!classes) throw err(400, "invalid", "This request has no HR classification");
      if (r.status !== "approved") throw err(409, "not_approved", "The manager must approve it first");
      if (!classes.includes(b.class)) throw err(400, "invalid", "Choose a classification", "class");
      const emp = getEmployee(db, r.employee_id);
      reverseRequest(db, emp, r.id, ctx.today(), sess.user.id, "Classification changed");
      if (b.class === "leave") {
        const available = balanceOf(db, emp.id) - pendingMinutes(db, emp.id);
        if (r.minutes > available) throw err(409, "insufficient_balance", `The balance is not enough (${fmtDays(available)} days available)`);
        postLedger(db, emp, { kind: "early_leave", minutes: -r.minutes, date: r.start_date, requestId: r.id, note: "Permission taken from annual leave (HR)", by: sess.user.id });
      }
      db.prepare("UPDATE leave_requests SET hr_class=?, hr_by=?, hr_at=? WHERE id=?").run(b.class, sess.user.id, nowIso(), r.id);
      const comment = String(b.comment || "").trim().slice(0, 500);
      event(db, r.id, "hr_" + b.class, sess.user.id, comment || null);
      const after = getReq(db, r.id);
      audit(db, sess.user.id, "request.hr_class", "request", r.id, r, after);
      return { r: after, emp };
    });
    const d = describe(out.r, out.emp), [ar, en] = CLASS_NAMES[out.r.hr_class];
    notify(ctx, [ownerUser(db, out.r.employee_id)].filter(Boolean), { title_ar: `الموارد البشرية: ${ar}`, title_en: `HR: ${en}`, body_ar: d.ar, body_en: d.en, link: `#/leave/${out.r.id}` });
    send(req, res, 200, { request: out.r });
  });
  api.post("/api/requests/:id/approve", (req, res) => decide(req, res, "approve"));
  api.post("/api/requests/:id/reject", (req, res) => decide(req, res, "reject"));
  api.post("/api/requests/:id/cancel", (req, res) => decide(req, res, "cancel"));

  // Art. 81: the employer may postpone annual leave by up to 6 months. Postponing approves the leave on the new dates.
  api.post("/api/requests/:id/postpone", async (req, res) => {
    const sess = req.sess;
    const { start, comment } = await readJson(req);
    const out = tx(db, () => {
      const r = getReq(db, req.params.id);
      if (!r) throw new HttpError(404, "not_found", "Request not found");
      if (!mayDecide(db, sess, r, ctx.today())) throw forbidden();
      if (r.status !== "pending" || r.type !== "annual") throw err(409, "not_pending", "Only a pending annual leave can be postponed");
      if (!isIsoDate(start) || start <= r.start_date) throw err(400, "invalid", "Choose a later start date", "start");
      if (start > addMonths(r.start_date, 6)) throw err(400, "too_late", "Annual leave can be postponed by at most 6 months", "start");
      const end = addDays(start, daysBetweenInclusive(r.start_date, r.end_date) - 1);
      const workDays = daysExcludingHolidays(start, end, holidaySet(db));
      if (!workDays) throw err(400, "invalid", "All the new days are official holidays", "start");
      r.minutes = workDays * DAY; // official holidays in the new dates are not deducted
      if (db.prepare(`SELECT 1 FROM leave_requests WHERE employee_id=? AND id<>? AND type<>'comp_day' AND status IN ${ACTIVE} AND start_date<=? AND end_date>=?`).get(r.employee_id, r.id, end, start))
        throw err(409, "overlap", "The new dates overlap another request");
      const emp = getEmployee(db, r.employee_id);
      const available = balanceOf(db, emp.id) - pendingMinutes(db, emp.id, r.id);
      if (r.minutes > available) throw err(409, "insufficient_balance", `The balance is no longer enough (${fmtDays(available)} days available)`);
      postLedger(db, emp, { kind: "annual_leave", minutes: -r.minutes, date: start, requestId: r.id, by: sess.user.id });
      db.prepare("UPDATE leave_requests SET start_date=?, end_date=?, minutes=?, status='approved', decided_by=?, decided_at=?, decision_comment=? WHERE id=?")
        .run(start, end, r.minutes, sess.user.id, nowIso(), String(comment || "").slice(0, 1000) || null, r.id);
      db.prepare("UPDATE approver_cover SET start_date=?, end_date=? WHERE request_id=?").run(start, end, r.id);
      event(db, r.id, "postponed", sess.user.id, `${dmy(r.start_date)} → ${dmy(start)}${comment ? " — " + comment : ""}`);
      const after = getReq(db, r.id);
      audit(db, sess.user.id, "request.postpone", "request", r.id, r, after);
      return { r: after, emp };
    });
    const d = describe(out.r, out.emp);
    notify(ctx, [ownerUser(db, out.r.employee_id)].filter((id) => id && id !== sess.user.id),
      { title_ar: "تم تأجيل إجازتك والموافقة عليها", title_en: "Your leave was postponed and approved", body_ar: d.ar, body_en: d.en, link: `#/leave/${out.r.id}` });
    send(req, res, 200, { request: out.r });
  });

  // ---- approver cover: an approver (or Admin) names a deputy for a period
  const coverRow = `SELECT c.*, ua.username approver_username, ea.name_ar approver_name_ar, ea.name_en approver_name_en,
      ud.username deputy_username, ed.name_ar deputy_name_ar, ed.name_en deputy_name_en
    FROM approver_cover c JOIN users ua ON ua.id=c.approver_user_id LEFT JOIN employees ea ON ea.id=ua.employee_id
    JOIN users ud ON ud.id=c.deputy_user_id LEFT JOIN employees ed ON ed.id=ud.employee_id`;
  const isApproverUser = (sess) => sess.user.role === "admin" || sess.user.role === "ceo" || sess.isApprover
    || (sess.employee && getSetting(db, "managers_approver_employee_id", null) === sess.employee.id);
  api.get("/api/cover", (req, res) => {
    const all = req.sess.user.role === "admin";
    const items = db.prepare(`${coverRow} WHERE c.end_date>=? ${all ? "" : "AND (c.approver_user_id=? OR c.deputy_user_id=?)"} ORDER BY c.start_date`)
      .all(ctx.today(), ...(all ? [] : [req.sess.user.id, req.sess.user.id]));
    // people who can be named deputy: active logins other than me
    const candidates = isApproverUser(req.sess) ? db.prepare(`SELECT u.id, u.username, e.name_ar, e.name_en FROM users u LEFT JOIN employees e ON e.id=u.employee_id
      WHERE u.active=1 AND u.id<>? AND (e.id IS NULL OR e.status IN ('active','on_leave')) ORDER BY coalesce(e.name_ar,u.username)`).all(req.sess.user.id) : undefined;
    send(req, res, 200, { items, candidates });
  });
  api.post("/api/cover", async (req, res) => {
    const sess = req.sess;
    if (!isApproverUser(sess)) throw forbidden();
    const b = await readJson(req);
    const approverId = sess.user.role === "admin" && b.approver_user_id ? Number(b.approver_user_id) : sess.user.id;
    const deputyId = Number(b.deputy_user_id);
    if (!deputyId || deputyId === approverId) throw err(400, "invalid", "Choose someone else as deputy", "deputy_user_id");
    if (!db.prepare("SELECT 1 FROM users WHERE id=? AND active=1").get(deputyId)) throw err(400, "invalid", "Unknown deputy", "deputy_user_id");
    if (!isIsoDate(b.start) || !isIsoDate(b.end) || b.end < b.start) throw err(400, "invalid", "Choose valid dates", "end");
    if (daysBetweenInclusive(b.start, b.end) > 120) throw err(400, "invalid", "At most 120 days", "end");
    const id = tx(db, () => {
      const r = db.prepare("INSERT INTO approver_cover(approver_user_id,deputy_user_id,start_date,end_date,created_by,created_at) VALUES(?,?,?,?,?,?)")
        .run(approverId, deputyId, b.start, b.end, sess.user.id, nowIso());
      audit(db, sess.user.id, "cover.create", "user", approverId, null, { deputyId, start: b.start, end: b.end });
      return Number(r.lastInsertRowid);
    });
    const cover = db.prepare(`${coverRow} WHERE c.id=?`).get(id);
    notify(ctx, [deputyId], { title_ar: "تم تعيينك نائباً للموافقات", title_en: "You are covering approvals", body_ar: `${cover.approver_name_ar || cover.approver_username}: ${dmy(b.start)} – ${dmy(b.end)}`, body_en: `${cover.approver_name_en || cover.approver_name_ar || cover.approver_username}: ${dmy(b.start)} – ${dmy(b.end)}`, link: "#/approvals" });
    send(req, res, 201, { cover });
  });
  api.delete("/api/cover/:id", (req, res) => {
    const c = db.prepare("SELECT * FROM approver_cover WHERE id=?").get(Number(req.params.id));
    if (!c) throw new HttpError(404, "not_found", "Not found");
    if (req.sess.user.role !== "admin" && c.approver_user_id !== req.sess.user.id) throw forbidden();
    if (req.sess.user.role !== "admin" && c.request_id && db.prepare("SELECT 1 FROM leave_requests WHERE id=? AND status IN ('pending','approved')").get(c.request_id))
      throw err(409, "cover_required", "This deputy covers your own leave; cancel the leave first");
    db.prepare("DELETE FROM approver_cover WHERE id=?").run(c.id);
    audit(db, req.sess.user.id, "cover.delete", "user", c.approver_user_id, c, null);
    send(req, res, 200, { ok: true });
  });

  // ---- team calendar: who is off in a month (HR, Accounts, CEO, Admin: everyone; managers: their departments)
  // Attachments on a request (e.g. a medical note for sick leave): the requester, HR or Admin.
  api.post("/api/requests/:id/files", async (req, res) => {
    const r = getReq(db, req.params.id);
    if (!r) throw new HttpError(404, "not_found", "Request not found");
    const isOwner = req.sess.employee && req.sess.employee.id === r.employee_id;
    if (!isOwner && !can(req.sess, "employee.edit")) throw forbidden();
    req.query.set("doc_type", r.type === "sick" ? "medical" : "other");
    const file = await storeUpload(ctx, req, { employeeId: r.employee_id, requestId: r.id, kind: "doc" });
    audit(db, req.sess.user.id, "request.attach", "request", r.id, null, file);
    send(req, res, 201, { file });
  });
}
