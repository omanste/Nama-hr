/* Staff Voice: suggestions, questions, complaints and notes from staff to their manager, HR or the CEO, with replies.
 * Never anonymous. A message is readable only by its sender, the people it was sent to, and Admin. */
import { nowIso, tx, getSetting } from "./db.mjs";
import { send, readJson, HttpError } from "./http.mjs";
import { audit } from "./audit.mjs";
import { notify } from "./notify.mjs";
import { storeUpload } from "./files.mjs";

export const CATEGORIES = ["suggestion", "question", "complaint", "note", "other"];
const STATUSES = ["new", "in_review", "answered", "closed"];
const NAMES = { suggestion: ["اقتراح", "Suggestion"], question: ["استفسار", "Question"], complaint: ["شكوى", "Complaint"], note: ["ملاحظة", "Note"], other: ["رسالة", "Message"] };

/** Who reads messages sent to HR; "manager" and "ceo" go to one person (an employee — with or without a login yet). */
const hrUsers = (db) => db.prepare("SELECT id FROM users WHERE role='hr' AND active=1").all().map((r) => r.id);
const activeEmp = (db, id) => id && db.prepare("SELECT id FROM employees WHERE id=? AND status IN ('active','on_leave')").get(id) ? id : null;
/** The CEO: the person with the CEO login, else the managers' leave approver (Settings). */
function ceoEmployee(db) {
  const u = db.prepare("SELECT employee_id FROM users WHERE role='ceo' AND active=1 AND employee_id IS NOT NULL ORDER BY id").get();
  return activeEmp(db, u && u.employee_id) || activeEmp(db, getSetting(db, "managers_approver_employee_id", null));
}
/** The sender's manager: their direct manager, else their department's approver (never themself). */
function managerEmployee(db, emp) {
  if (!emp) return null;
  const dept = emp.department_id && db.prepare("SELECT approver_employee_id FROM departments WHERE id=? AND active=1").get(emp.department_id);
  for (const id of [emp.manager_employee_id, dept && dept.approver_employee_id]) if (id && id !== emp.id && activeEmp(db, id)) return id;
  return null;
}
const userOfEmployee = (db, empId) => { const u = empId && db.prepare("SELECT id FROM users WHERE employee_id=? AND active=1").get(empId); return u ? u.id : null; };

/** Sender, the person it went to (or any HR member for HR messages), and Admin. */
export function canReadVoice(sess, m) {
  const u = sess.user;
  return u.role === "admin" || m.user_id === u.id || isTo(sess, m);
}
const isTo = (sess, m) => (m.to_kind === "hr" ? sess.user.role === "hr" : (!!m.to_employee_id && m.to_employee_id === sess.user.employee_id) || (!!m.to_user_id && m.to_user_id === sess.user.id));
const isRecipient = (sess, m) => sess.user.id !== m.user_id && isTo(sess, m);
const recipientsOf = (db, m) => (m.to_kind === "hr" ? hrUsers(db) : [userOfEmployee(db, m.to_employee_id) || m.to_user_id]).filter((id) => id && id !== m.user_id);

const withNames = `SELECT m.*, e.name_ar, e.name_en, e.emp_no, tu.username to_username, te.name_ar to_name_ar, te.name_en to_name_en,
    (SELECT count(*) FROM voice_replies r WHERE r.message_id=m.id) replies
  FROM voice_messages m LEFT JOIN employees e ON e.id=m.employee_id LEFT JOIN employees te ON te.id=m.to_employee_id LEFT JOIN users tu ON tu.employee_id=te.id`;

/** Messages waiting for this person to open them (status "new"). */
export function voiceInboxCount(db, sess) {
  const u = sess.user;
  if (u.role === "admin") return 0; // Admin can read everything but isn't a recipient
  return db.prepare(`SELECT count(*) n FROM voice_messages WHERE status='new' AND user_id<>? AND (${u.role === "hr" ? "to_kind='hr' OR " : ""}(to_kind<>'hr' AND (to_employee_id=? OR to_user_id=?)))`).get(u.id, u.employee_id || -1, u.id).n;
}

export function registerVoice(api, ctx) {
  const { db } = ctx;
  const forbidden = () => new HttpError(403, "forbidden", "You do not have permission for this");
  const bad = (field, msg) => Object.assign(new HttpError(400, "invalid", msg), { field });
  const load = (sess, id) => {
    const m = db.prepare(`${withNames} WHERE m.id=?`).get(Number(id));
    if (!m) throw new HttpError(404, "not_found", "Message not found");
    if (!canReadVoice(sess, m)) throw forbidden();
    return m;
  };

  // where this person can send: their manager (if they have one with a login), HR, the CEO
  // where this person can send: their manager, HR (anyone with the HR role), the CEO; "missing" says what still needs setting up
  api.get("/api/voice/recipients", (req, res) => {
    const sess = req.sess, out = [], missing = [];
    const name = (empId) => db.prepare("SELECT name_ar, name_en FROM employees WHERE id=?").get(empId);
    const own = sess.employee && sess.employee.id;
    const mgr = managerEmployee(db, sess.employee);
    if (mgr && mgr !== own) out.push({ kind: "manager", ...name(mgr) }); else missing.push("manager");
    if (hrUsers(db).some((id) => id !== sess.user.id)) out.push({ kind: "hr" }); else missing.push("hr");
    const ceo = ceoEmployee(db);
    if (ceo && ceo !== own) out.push({ kind: "ceo", ...name(ceo) }); else if (!ceo) missing.push("ceo");
    send(req, res, 200, { items: out, missing, categories: CATEGORIES });
  });

  api.post("/api/voice", async (req, res) => {
    const sess = req.sess;
    if (!sess.employee) throw new HttpError(403, "no_profile", "Only staff with a profile can send messages");
    const b = await readJson(req);
    if (!CATEGORIES.includes(b.category)) throw bad("category", "Choose a type");
    const subject = String(b.subject || "").trim().slice(0, 150), body = String(b.body || "").trim().slice(0, 5000);
    if (!subject) throw bad("subject", "A subject is required");
    if (!body) throw bad("body", "Please write your message");
    const to = b.to;
    let toEmp = null;
    if (to === "manager") toEmp = managerEmployee(db, sess.employee);
    else if (to === "ceo") toEmp = ceoEmployee(db);
    else if (to !== "hr") throw bad("to", "Choose who receives it");
    if (to !== "hr" && (!toEmp || toEmp === sess.employee.id)) throw bad("to", "Nobody can receive this yet — choose another recipient");
    const toUser = to === "hr" ? null : userOfEmployee(db, toEmp);
    if (to === "hr" && !hrUsers(db).some((id) => id !== sess.user.id)) throw bad("to", "There is no HR login yet — choose another recipient");
    const m = tx(db, () => {
      const r = db.prepare("INSERT INTO voice_messages(employee_id,user_id,category,subject,body,to_kind,to_user_id,to_employee_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'new',?,?)")
        .run(sess.employee.id, sess.user.id, b.category, subject, body, to, toUser, toEmp, nowIso(), nowIso());
      const row = db.prepare("SELECT * FROM voice_messages WHERE id=?").get(r.lastInsertRowid);
      audit(db, sess.user.id, "voice.send", "voice", row.id, null, { category: row.category, to_kind: row.to_kind, to_employee_id: row.to_employee_id }); // content stays out of the log
      return row;
    });
    const [ar, en] = NAMES[m.category], e = sess.employee;
    notify(ctx, recipientsOf(db, m), { title_ar: `${ar} جديد من ${e.name_ar || e.name_en}`, title_en: `New ${en.toLowerCase()} from ${e.name_en || e.name_ar}`, body_ar: subject, body_en: subject, link: `#/voice/${m.id}` });
    send(req, res, 201, { message: db.prepare(`${withNames} WHERE m.id=?`).get(m.id) });
  });

  api.get("/api/voice", (req, res) => {
    const sess = req.sess, u = sess.user;
    const box = req.query.get("box") || "sent";
    const where = [], args = [];
    if (box === "sent") { where.push("m.user_id=?"); args.push(u.id); }
    else if (box === "inbox") {
      if (u.role === "admin") where.push("m.user_id<>?"), args.push(u.id); // Admin (developer) can see every message
      else { where.push(`m.user_id<>? AND (${u.role === "hr" ? "m.to_kind='hr' OR " : ""}(m.to_kind<>'hr' AND (m.to_employee_id=? OR m.to_user_id=?)))`); args.push(u.id, u.employee_id || -1, u.id); }
    } else throw bad("box", "unknown box");
    const status = req.query.get("status");
    if (status) { if (!STATUSES.includes(status)) throw bad("status", "unknown status"); where.push("m.status=?"); args.push(status); }
    const category = req.query.get("category");
    if (category) { where.push("m.category=?"); args.push(category); }
    send(req, res, 200, { items: db.prepare(`${withNames} WHERE ${where.join(" AND ")} ORDER BY m.updated_at DESC LIMIT 500`).all(...args) });
  });

  api.get("/api/voice/:id", (req, res) => {
    const m = load(req.sess, req.params.id);
    const replies = db.prepare(`SELECT r.*, u.username, u.role, e.name_ar, e.name_en FROM voice_replies r JOIN users u ON u.id=r.user_id LEFT JOIN employees e ON e.id=u.employee_id
      WHERE r.message_id=? ORDER BY r.id`).all(m.id);
    const files = db.prepare("SELECT id,name,mime,size,uploaded_by,uploaded_at FROM files WHERE voice_id=? ORDER BY id").all(m.id);
    // the recipient opening a new message moves it to "in review"
    if (m.status === "new" && isRecipient(req.sess, m)) { db.prepare("UPDATE voice_messages SET status='in_review', updated_at=? WHERE id=?").run(nowIso(), m.id); m.status = "in_review"; }
    send(req, res, 200, { message: m, replies, files, canReply: m.status !== "closed" && (m.user_id === req.sess.user.id || isRecipient(req.sess, m)), isRecipient: isRecipient(req.sess, m) });
  });

  api.post("/api/voice/:id/reply", async (req, res) => {
    const sess = req.sess, m = load(sess, req.params.id);
    const mine = m.user_id === sess.user.id, recipient = isRecipient(sess, m);
    if (!mine && !recipient) throw forbidden(); // Admin reads, but doesn't take part
    if (m.status === "closed") throw new HttpError(409, "closed", "This conversation is closed");
    const body = String((await readJson(req)).body || "").trim().slice(0, 5000);
    if (!body) throw bad("body", "Please write a reply");
    tx(db, () => {
      db.prepare("INSERT INTO voice_replies(message_id,user_id,body,created_at) VALUES(?,?,?,?)").run(m.id, sess.user.id, body, nowIso());
      db.prepare("UPDATE voice_messages SET status=?, updated_at=? WHERE id=?").run(recipient ? "answered" : m.status === "answered" ? "in_review" : m.status, nowIso(), m.id);
    });
    const who = sess.employee ? (sess.employee.name_ar || sess.employee.name_en) : sess.user.username;
    const whoEn = sess.employee ? (sess.employee.name_en || sess.employee.name_ar) : sess.user.username;
    const to = recipient ? [m.user_id] : recipientsOf(db, m);
    notify(ctx, to, { title_ar: `رد جديد: ${m.subject}`, title_en: `New reply: ${m.subject}`, body_ar: `من ${who}`, body_en: `From ${whoEn}`, link: `#/voice/${m.id}` });
    send(req, res, 200, { ok: true });
  });

  api.post("/api/voice/:id/status", async (req, res) => {
    const sess = req.sess, m = load(sess, req.params.id);
    const status = (await readJson(req)).status;
    if (!STATUSES.includes(status) || status === "new") throw bad("status", "unknown status");
    // the recipient moves it along; the sender may close or reopen their own message
    const ok = isRecipient(sess, m) || (m.user_id === sess.user.id && ["closed", "in_review"].includes(status));
    if (!ok) throw forbidden();
    db.prepare("UPDATE voice_messages SET status=?, updated_at=? WHERE id=?").run(status, nowIso(), m.id);
    audit(db, sess.user.id, "voice.status", "voice", m.id, { status: m.status }, { status });
    if (status === "closed" && isRecipient(sess, m)) notify(ctx, [m.user_id], { title_ar: `أُغلقت رسالتك: ${m.subject}`, title_en: `Your message was closed: ${m.subject}`, link: `#/voice/${m.id}` });
    send(req, res, 200, { ok: true });
  });

  api.post("/api/voice/:id/files", async (req, res) => {
    const sess = req.sess, m = load(sess, req.params.id);
    if (m.user_id !== sess.user.id && !isRecipient(sess, m)) throw forbidden();
    if (m.status === "closed") throw new HttpError(409, "closed", "This conversation is closed");
    const file = await storeUpload(ctx, req, { employeeId: m.employee_id, voiceId: m.id, kind: "voice" });
    send(req, res, 201, { file });
  });

  // counts only (no content), for management reports
  api.get("/api/reports/voice", (req, res) => {
    if (!["admin", "hr", "ceo"].includes(req.sess.user.role)) throw forbidden();
    const from = req.query.get("from") || "0000-01-01", to = req.query.get("to") || "9999-12-31";
    const rows = db.prepare(`SELECT category, status, count(*) n FROM voice_messages WHERE substr(created_at,1,10) BETWEEN ? AND ? GROUP BY category, status`).all(from, to);
    send(req, res, 200, { rows, categories: CATEGORIES, statuses: STATUSES });
  });
}
