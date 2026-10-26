/* Leave request lifecycle: submit → approve | reject | cancel, with ledger postings and history.
 * The approver is fixed when the request is submitted; Admin can always act. */
import { nowIso, tx, getSetting } from "./db.mjs";
import { send, readJson, HttpError } from "./http.mjs";
import { can, canViewEmployee, approvedDepartments } from "./perm.mjs";
import { audit } from "./audit.mjs";
import { TYPES, requestMinutes, eligibleFrom, isIsoDate, fmtDays, DAY, checkLeaveRules, RuleError, sickPayBands, addMonths, daysBetweenInclusive, addDays } from "./leave.mjs";
import { approverFor } from "./routing.mjs";
import { postLedger, balanceOf, pendingMinutes, yearStartFor } from "./ledger.mjs";
import { notify } from "./notify.mjs";
import { getEmployee } from "./employees.mjs";
import { storeUpload } from "./files.mjs";

export const TYPE_NAMES = {
  annual: ["إجازة سنوية", "Annual leave"], early: ["مغادرة مبكرة", "Early leave"], emergency: ["إجازة اضطرارية", "Emergency leave"],
  bereavement: ["إجازة وفاة", "Bereavement leave"], sick: ["إجازة مرضية", "Sick leave"], comp_day: ["عمل في يوم عطلة", "Worked on a holiday"],
  marriage: ["إجازة زواج", "Marriage leave"], paternity: ["إجازة أبوة", "Paternity leave"], maternity: ["إجازة أمومة", "Maternity leave"],
  hajj: ["إجازة الحج", "Hajj leave"], exam: ["إجازة امتحانات", "Exam leave"], patient_care: ["إجازة مرافقة مريض", "Accompanying a patient"],
  childcare: ["إجازة رعاية طفل (بدون أجر)", "Child-care leave (unpaid)"], unpaid: ["إجازة خاصة بدون أجر", "Special unpaid leave"],
};
const RULE_STATUS = { invalid: 400, too_long: 400, outside_window: 400 };
const hm = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; };

/** End of the working day on a date: 17:00 by default, or the Ramadan end time inside the Ramadan dates (Art. 70). */
export function dayEndOn(db, date) {
  const rs = getSetting(db, "ramadan_start", null), re = getSetting(db, "ramadan_end", null);
  if (rs && re && date >= rs && date <= re) return hm(getSetting(db, "ramadan_day_end", "15:00"));
  return hm(getSetting(db, "work_day_end", "17:00"));
}

/** Days already requested (pending or approved) of a type, for the legal limits. */
function usedDays(db, empId, type, start, eventDate, excludeId = 0) {
  const sum = (where, ...args) => db.prepare(`SELECT coalesce(sum(julianday(end_date)-julianday(start_date)+1),0) n FROM leave_requests
    WHERE employee_id=? AND type=? AND status IN ${ACTIVE} AND id<>? ${where}`).get(empId, type, excludeId, ...args).n;
  return { inYear: sum("AND substr(start_date,1,4)=?", start.slice(0, 4)), ever: sum(""), forEvent: eventDate ? sum("AND event_date=?", eventDate) : 0 };
}
const ACTIVE = "('pending','approved')";
const dmy = (iso) => iso.split("-").reverse().join("/");
const err = (status, code, message, field) => Object.assign(new HttpError(status, code, message), field ? { field } : {});

export function adminUserId(db) {
  const r = db.prepare("SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1").get();
  return r ? r.id : null;
}

export function routeFor(db, emp) {
  const role = (db.prepare("SELECT role FROM users WHERE employee_id=?").get(emp.id) || {}).role || "staff";
  return approverFor({ employee: emp, role }, {
    departments: db.prepare("SELECT id, approver_employee_id FROM departments WHERE active=1").all(),
    managersApproverEmployeeId: getSetting(db, "managers_approver_employee_id", null),
    userIdByEmployee: (id) => {
      const u = db.prepare("SELECT u.id FROM users u JOIN employees e ON e.id=u.employee_id WHERE u.employee_id=? AND u.active=1 AND e.status IN ('active','on_leave')").get(id);
      return u ? u.id : null;
    },
    adminUserId: adminUserId(db),
  });
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
  if (type === "early") time = body.time;
  let minutes;
  try { minutes = requestMinutes(type, { start, end, time, dayEnd: dayEndOn(db, start) }); }
  catch (e) { throw err(400, "invalid", e.message, type === "early" ? "time" : "end"); }
  const relation = String(body.relation || "").trim().slice(0, 100) || null;
  const eventDate = body.event_date || null;
  if (TYPES[type].range) {
    try { checkLeaveRules(type, { emp, start, end, relation, eventDate, used: usedDays(db, emp.id, type, start, eventDate) }); }
    catch (e) { if (e instanceof RuleError) throw err(RULE_STATUS[e.code] || 409, e.code, e.message, e.field); throw e; }
  }
  if (type === "comp_day" && start > today) throw err(400, "invalid", "The worked day cannot be in the future", "date");

  if (type === "comp_day") {
    if (db.prepare(`SELECT 1 FROM leave_requests WHERE employee_id=? AND type='comp_day' AND start_date=? AND status IN ${ACTIVE}`).get(emp.id, start))
      throw err(409, "overlap", "This day has already been claimed");
  } else {
    const clash = db.prepare(`SELECT id FROM leave_requests WHERE employee_id=? AND type<>'comp_day' AND status IN ${ACTIVE} AND start_date<=? AND end_date>=?`).get(emp.id, end, start);
    if (clash) throw err(409, "overlap", "These dates overlap another request");
  }

  if (TYPES[type].effect === "deduct") {
    const from = eligibleFrom(emp.join_date);
    if (from && start < from) throw err(409, "not_eligible_yet", `Leave is available from ${dmy(from)} (${from})`);
    const available = balanceOf(db, emp.id) - pendingMinutes(db, emp.id);
    if (minutes > available) throw err(409, "insufficient_balance", `This exceeds your available balance (${fmtDays(available)} days)`);
  }
  return { type, start_date: start, end_date: end, early_time: time, minutes, relation, event_date: TYPES[type].event ? eventDate : null };
}

function event(db, requestId, action, actorId, comment) {
  db.prepare("INSERT INTO request_events(request_id,action,actor_user_id,at,comment) VALUES(?,?,?,?,?)").run(requestId, action, actorId, nowIso(), comment || null);
}
const getReq = (db, id) => db.prepare("SELECT * FROM leave_requests WHERE id=?").get(Number(id));
const ownerUser = (db, empId) => (db.prepare("SELECT id FROM users WHERE employee_id=? AND active=1").get(empId) || {}).id;

function describe(r, emp) {
  const [ar, en] = TYPE_NAMES[r.type];
  const when = r.type === "early" ? `${dmy(r.start_date)} ${r.early_time}` : r.start_date === r.end_date ? dmy(r.start_date) : `${dmy(r.start_date)} – ${dmy(r.end_date)}`;
  const amount = r.type === "early" ? `${r.minutes / 60} h` : `${fmtDays(r.minutes)} d`;
  return { ar: `${emp.name_ar || emp.name_en}: ${ar} · ${when} · ${amount}`, en: `${emp.name_en || emp.name_ar}: ${en} · ${when} · ${amount}` };
}

export function registerRequests(api, ctx) {
  const { db } = ctx;
  const forbidden = () => new HttpError(403, "forbidden", "You do not have permission for this");
  const canSee = (sess, r) => r.approver_user_id === sess.user.id || can(sess, "requests.viewAll") || canViewEmployee(db, sess, getEmployee(db, r.employee_id));

  const withNames = `SELECT r.*, e.emp_no, e.name_ar, e.name_en, e.department_id,
      (SELECT coalesce(sum(minutes),0) FROM leave_ledger l WHERE l.employee_id=r.employee_id) balance,
      (SELECT count(*) FROM files f WHERE f.request_id=r.id) file_count
    FROM leave_requests r JOIN employees e ON e.id=r.employee_id`;

  api.post("/api/requests", async (req, res) => {
    const sess = req.sess;
    if (!sess.employee) throw err(400, "no_profile", "Your login is not linked to a staff profile");
    const body = await readJson(req);
    const emp = sess.employee;
    const r = tx(db, () => {
      const v = validateRequest(db, emp, body, ctx.today());
      const route = routeFor(db, emp);
      const ins = db.prepare(`INSERT INTO leave_requests(employee_id,type,start_date,end_date,early_time,minutes,reason,status,approver_user_id,route_reason,created_by,created_at,relation,event_date)
        VALUES(?,?,?,?,?,?,?,'pending',?,?,?,?,?,?)`).run(emp.id, v.type, v.start_date, v.end_date, v.early_time, v.minutes, String(body.reason || "").slice(0, 1000) || null, route.userId, route.reason, sess.user.id, nowIso(), v.relation, v.event_date);
      const row = getReq(db, ins.lastInsertRowid);
      event(db, row.id, "submitted", sess.user.id, row.reason);
      audit(db, sess.user.id, "request.submit", "request", row.id, null, row);
      return row;
    });
    const d = describe(r, emp);
    notify(ctx, [r.approver_user_id], { title_ar: "طلب إجازة بانتظار موافقتك", title_en: "Leave request awaiting your approval", body_ar: d.ar, body_en: d.en, link: `#/leave/${r.id}` });
    notify(ctx, [sess.user.id], { title_ar: "تم إرسال طلبك", title_en: "Your request was submitted", body_ar: d.ar, body_en: d.en, link: `#/leave/${r.id}`, inAppOnly: true });
    send(req, res, 201, { request: r });
  });

  api.get("/api/requests", (req, res) => {
    const sess = req.sess;
    const scope = req.query.get("scope") || "mine";
    const where = [], args = [];
    if (scope === "mine") { where.push("r.employee_id=?"); args.push(sess.employee ? sess.employee.id : -1); }
    else if (scope === "approvals") { where.push("r.status='pending'"); if (sess.user.role !== "admin") { where.push("r.approver_user_id=?"); args.push(sess.user.id); } }
    else if (scope === "team") {
      const depts = approvedDepartments(db, sess.employee && sess.employee.id);
      if (!depts.length) throw forbidden();
      where.push(`e.department_id IN (${depts.map(() => "?").join(",")})`); args.push(...depts);
    } else if (scope === "all") { if (!can(sess, "requests.viewAll")) throw forbidden(); }
    else throw err(400, "invalid", "unknown scope");
    const status = req.query.get("status");
    if (status) { where.push("r.status=?"); args.push(status); }
    const emp = req.query.get("employee");
    if (emp) { where.push("r.employee_id=?"); args.push(Number(emp)); }
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
    send(req, res, 200, { request: r, events, approver, files, sickPay, needsProof: !!TYPES[r.type].proof && !files.length,
      canDecide: r.status === "pending" && can(req.sess, "request.decide", r), canPostpone: r.status === "pending" && r.type === "annual" && can(req.sess, "request.decide", r) });
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
        if (!can(sess, "request.decide", r)) throw forbidden();
        if (r.status !== "pending") throw err(409, "not_pending", "This request has already been decided");
        if (action === "reject" && !comment) throw err(400, "invalid", "Please give a reason for the rejection", "comment");
        if (action === "approve") {
          if (TYPES[r.type].proof && !db.prepare("SELECT 1 FROM files WHERE request_id=?").get(r.id))
            throw err(409, "proof_required", "Attach the supporting document (e.g. medical certificate) before approval");
          const effect = TYPES[r.type].effect;
          if (effect === "deduct") {
            const available = balanceOf(db, emp.id) - pendingMinutes(db, emp.id, r.id);
            if (r.minutes > available) throw err(409, "insufficient_balance", `The balance is no longer enough (${fmtDays(available)} days available)`);
            postLedger(db, emp, { kind: "annual_leave", minutes: -r.minutes, date: r.start_date, requestId: r.id, by: sess.user.id });
          } else if (effect === "credit") {
            postLedger(db, emp, { kind: "comp_credit", minutes: DAY, date: r.start_date, requestId: r.id, note: "Worked on a holiday", by: sess.user.id });
          }
        }
      } else { // cancel
        if (r.status === "pending") { if (!(isOwner || can(sess, "employee.edit") || sess.user.role === "admin")) throw forbidden(); }
        else if (r.status === "approved") {
          if (!(sess.user.role === "admin" || r.approver_user_id === sess.user.id)) throw forbidden();
          for (const l of db.prepare("SELECT * FROM leave_ledger WHERE request_id=? AND kind<>'reversal'").all(r.id))
            postLedger(db, emp, { kind: "reversal", minutes: -l.minutes, date: ctx.today(), yearStart: l.leave_year_start, requestId: r.id, note: "Cancelled", by: sess.user.id });
        } else throw err(409, "not_cancellable", "This request cannot be cancelled");
      }
      const status = { approve: "approved", reject: "rejected", cancel: "cancelled" }[action];
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
    send(req, res, 200, { request: r });
  }
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
      if (!can(sess, "request.decide", r)) throw forbidden();
      if (r.status !== "pending" || r.type !== "annual") throw err(409, "not_pending", "Only a pending annual leave can be postponed");
      if (!isIsoDate(start) || start <= r.start_date) throw err(400, "invalid", "Choose a later start date", "start");
      if (start > addMonths(r.start_date, 6)) throw err(400, "too_late", "Annual leave can be postponed by at most 6 months", "start");
      const end = addDays(start, daysBetweenInclusive(r.start_date, r.end_date) - 1);
      if (db.prepare(`SELECT 1 FROM leave_requests WHERE employee_id=? AND id<>? AND type<>'comp_day' AND status IN ${ACTIVE} AND start_date<=? AND end_date>=?`).get(r.employee_id, r.id, end, start))
        throw err(409, "overlap", "The new dates overlap another request");
      const emp = getEmployee(db, r.employee_id);
      const available = balanceOf(db, emp.id) - pendingMinutes(db, emp.id, r.id);
      if (r.minutes > available) throw err(409, "insufficient_balance", `The balance is no longer enough (${fmtDays(available)} days available)`);
      postLedger(db, emp, { kind: "annual_leave", minutes: -r.minutes, date: start, requestId: r.id, by: sess.user.id });
      db.prepare("UPDATE leave_requests SET start_date=?, end_date=?, status='approved', decided_by=?, decided_at=?, decision_comment=? WHERE id=?")
        .run(start, end, sess.user.id, nowIso(), String(comment || "").slice(0, 1000) || null, r.id);
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
