/* Scheduled jobs (Muscat time): yearly leave credits on each join anniversary, HR reminders, nightly backup. */
import fs from "node:fs";
import path from "node:path";
import { tx, getSetting, setSetting } from "./db.mjs";
import { sendRaw, send, readJson, HttpError } from "./http.mjs";
import { can } from "./perm.mjs";
import { audit } from "./audit.mjs";
import { ANNUAL, DAY, dueCredits, capForfeit, probationEnd, addDays, fmtDays, todayMuscat } from "./leave.mjs";
import { postLedger, balanceOf } from "./ledger.mjs";
import { notify } from "./notify.mjs";
import { runBirthdayAlerts } from "./calendar.mjs";
import { runWeeklyAttendance } from "./attendance.mjs";

const dmy = (iso) => iso.split("-").reverse().join("/");

/** On the 1st of each month: a summary of the month before for the CEO and the Chairman — once.
 * Leave days and permission hours taken, requests decided and still waiting, headcount, and documents expiring soon. */
export function runMonthlySummary(ctx, today, force = false) {
  const { db } = ctx;
  if (!force && today.slice(8) !== "01") return null;
  const month = addDays(today.slice(0, 8) + "01", -1).slice(0, 7); // the month before
  if (!force && getSetting(db, "monthly_summary_sent", null) === month) return null;
  const to = db.prepare("SELECT id FROM users WHERE role IN ('ceo','chairman') AND active=1").all().map((u) => u.id);
  setSetting(db, "monthly_summary_sent", month);
  if (!to.length) return null;
  const inMonth = "substr(start_date,1,7)=?";
  const leave = db.prepare(`SELECT count(*) n, coalesce(sum(minutes),0) m FROM leave_requests WHERE status='approved' AND ${inMonth} AND type NOT IN ('early','late','break','correction','mission','comp_day')`).get(month);
  const perm = db.prepare(`SELECT count(*) n, coalesce(sum(minutes),0) m FROM leave_requests WHERE status='approved' AND ${inMonth} AND type IN ('early','late','break')`).get(month);
  const decided = db.prepare("SELECT status, count(*) n FROM leave_requests WHERE substr(decided_at,1,7)=? AND status IN ('approved','rejected') GROUP BY status").all(month);
  const nd = (s) => (decided.find((x) => x.status === s) || { n: 0 }).n;
  const waiting = db.prepare("SELECT count(*) n FROM leave_requests WHERE status='pending'").get().n;
  const staff = db.prepare("SELECT count(*) n FROM employees WHERE status IN ('active','on_leave')").get().n;
  const expiring = expiringItems(db, today, 30).length;
  const s = { month, staff, leaveRequests: leave.n, leaveDays: Math.round((leave.m / DAY) * 10) / 10, permissions: perm.n, permissionHours: Math.round((perm.m / 60) * 10) / 10,
    approved: nd("approved"), rejected: nd("rejected"), waiting, expiring };
  const [y, m] = month.split("-");
  notify(ctx, to, {
    title_ar: `ملخص شهر ${m}/${y}`, title_en: `Summary for ${m}/${y}`,
    body_ar: `الموظفون: ${s.staff} · إجازات: ${s.leaveRequests} طلب (${s.leaveDays} يوم) · استئذانات: ${s.permissions} (${s.permissionHours} ساعة) · وُوفق على ${s.approved} ورُفض ${s.rejected} · بانتظار القرار الآن: ${s.waiting} · مستندات تنتهي خلال 30 يوماً: ${s.expiring}`,
    body_en: `Staff: ${s.staff} · Leave: ${s.leaveRequests} requests (${s.leaveDays} days) · Permissions: ${s.permissions} (${s.permissionHours} h) · Approved ${s.approved}, rejected ${s.rejected} · Waiting now: ${s.waiting} · Documents expiring within 30 days: ${s.expiring}`,
    link: "#/reports",
  });
  return s;
}

/** Post every missing yearly credit up to `today`, capping the balance at 60 days after each. Idempotent. */
export function runAnniversaries(ctx, today) {
  const { db } = ctx;
  let credits = 0, forfeits = 0;
  const emps = db.prepare("SELECT * FROM employees WHERE status IN ('active','on_leave') AND join_date IS NOT NULL").all();
  for (const emp of emps) {
    const credited = new Set(db.prepare("SELECT leave_year_start FROM leave_ledger WHERE employee_id=? AND kind='annual_credit'").all(emp.id).map((r) => r.leave_year_start));
    // never back-fill: only anniversaries after the first credit / the opening balance date count
    const opening = db.prepare("SELECT max(effective_date) d FROM leave_ledger WHERE employee_id=? AND kind='opening'").get(emp.id).d;
    const firstCredit = [...credited].sort()[0];
    const start = [opening, firstCredit].filter(Boolean).sort().pop();
    if (!start) continue;
    const due = dueCredits(emp.join_date, today, credited, addDays(start, 1));
    if (!due.length) continue;
    // Art. 78: up to 30 days may be carried over, unless leave wasn't taken because of the work. Nothing is forfeited
    // automatically: a balance over the cap opens an HR review (forfeit, or keep for work needs).
    let over = 0;
    tx(db, () => {
      for (const ys of due) {
        postLedger(db, emp, { kind: "annual_credit", minutes: ANNUAL, date: ys, yearStart: ys, note: "Yearly entitlement" });
        credits++;
      }
      over = cappedExcess(db, emp.id);
      if (over > 0) {
        const ins = db.prepare("INSERT OR IGNORE INTO cap_reviews(employee_id,year_start,excess,created_at) VALUES(?,?,?,?)").run(emp.id, due[due.length - 1], over, new Date().toISOString());
        if (ins.changes) forfeits++; else over = 0;
      }
    });
    if (over > 0) {
      const hrUsers = db.prepare("SELECT id FROM users WHERE role IN ('hr','admin') AND active=1").all().map((r) => r.id);
      notify(ctx, hrUsers, { title_ar: "رصيد يتجاوز الحد بحاجة لمراجعة", title_en: "Leave balance over the cap needs review", body_ar: `${emp.name_ar || emp.name_en}: ${fmtDays(over)} يوم فوق ٦٠`, body_en: `${emp.name_en || emp.name_ar}: ${fmtDays(over)} days over 60`, link: "#/cap-reviews", inAppOnly: true });
    }
    const user = db.prepare("SELECT id FROM users WHERE employee_id=? AND active=1").get(emp.id);
    if (user) {
      const bal = fmtDays(balanceOf(db, emp.id));
      notify(ctx, [user.id], {
        title_ar: "تمت إضافة رصيد الإجازة السنوية", title_en: "Your yearly leave balance was added",
        body_ar: `أضيف ٣٠ يوماً. رصيدك الآن ${bal} يوم.`,
        body_en: `30 days were added. Your balance is now ${bal} days.`,
        link: "#/me",
      });
    }
  }
  return { credits, reviews: forfeits };
}

/** Days above the 60-day cap, not counting days earned by working on holidays (compensatory rest stays outside the cap). */
export function cappedExcess(db, empId) {
  const comp = db.prepare(`SELECT coalesce(sum(minutes),0) n FROM leave_ledger WHERE employee_id=? AND (kind='comp_credit'
    OR (kind='reversal' AND request_id IN (SELECT id FROM leave_requests WHERE type='comp_day')))`).get(empId).n;
  return capForfeit(balanceOf(db, empId) - comp);
}

export function registerCapReviews(api, ctx) {
  const { db } = ctx;
  // documents and dates running out in the next 30 days (HR, accounts, CEO, admin)
  api.get("/api/expiring", (req, res) => {
    if (!can(req.sess, "employee.viewAll")) throw new HttpError(403, "forbidden", "You do not have permission for this");
    const items = expiringItems(db, ctx.today(), 30).map(({ employee: e, ...x }) => ({ ...x, employee: { id: e.id, emp_no: e.emp_no, name_ar: e.name_ar, name_en: e.name_en } }));
    send(req, res, 200, { items });
  });
  api.get("/api/cap-reviews", (req, res) => {
    if (!can(req.sess, "employee.viewAll")) throw new HttpError(403, "forbidden", "You do not have permission for this");
    const status = req.query.get("status");
    const items = db.prepare(`SELECT c.*, e.emp_no, e.name_ar, e.name_en, (SELECT coalesce(sum(minutes),0) FROM leave_ledger l WHERE l.employee_id=c.employee_id) balance
      FROM cap_reviews c JOIN employees e ON e.id=c.employee_id ${status ? "WHERE c.status=?" : ""} ORDER BY c.status='pending' DESC, c.id DESC`).all(...(status ? [status] : []));
    send(req, res, 200, { items });
  });
  api.post("/api/cap-reviews/:id", async (req, res) => {
    if (!can(req.sess, "ledger.adjust")) throw new HttpError(403, "forbidden", "You do not have permission for this");
    const { decision, reason } = await readJson(req);
    if (!["keep", "forfeit"].includes(decision)) throw Object.assign(new HttpError(400, "invalid", "decision must be keep or forfeit"), { field: "decision" });
    if (!String(reason || "").trim()) throw Object.assign(new HttpError(400, "invalid", "A reason is required"), { field: "reason" });
    const out = tx(db, () => {
      const r = db.prepare("SELECT * FROM cap_reviews WHERE id=?").get(Number(req.params.id));
      if (!r) throw new HttpError(404, "not_found", "Review not found");
      if (r.status !== "pending") throw new HttpError(409, "not_pending", "This review has already been decided");
      const emp = db.prepare("SELECT * FROM employees WHERE id=?").get(r.employee_id);
      if (req.sess.employee && req.sess.employee.id === emp.id) throw new HttpError(403, "forbidden", "You can't decide your own balance review");
      let minutes = 0;
      if (decision === "forfeit") {
        minutes = Math.min(r.excess, cappedExcess(db, emp.id)); // never more than is over the cap today
        if (minutes > 0) postLedger(db, emp, { kind: "cap_forfeit", minutes: -minutes, date: ctx.today(), yearStart: r.year_start, note: String(reason).trim().slice(0, 500), by: req.sess.user.id });
      }
      db.prepare("UPDATE cap_reviews SET status=?, reason=?, decided_by=?, decided_at=? WHERE id=?").run(decision === "keep" ? "kept" : "forfeited", String(reason).trim().slice(0, 500), req.sess.user.id, new Date().toISOString(), r.id);
      audit(db, req.sess.user.id, `cap_review.${decision}`, "employee", emp.id, r, { decision, reason, minutes });
      return { emp, minutes };
    });
    const user = db.prepare("SELECT id FROM users WHERE employee_id=? AND active=1").get(out.emp.id);
    if (user) notify(ctx, [user.id], decision === "keep"
      ? { title_ar: "تم الاحتفاظ برصيدك الزائد", title_en: "Your extra leave balance was kept", body_ar: String(reason), body_en: String(reason), link: "#/me" }
      : { title_ar: "سقط جزء من رصيد الإجازة", title_en: "Part of your leave balance was forfeited", body_ar: `${fmtDays(out.minutes)} يوم — ${reason}`, body_en: `${fmtDays(out.minutes)} days — ${reason}`, link: "#/me" });
    send(req, res, 200, { ok: true, forfeited: out.minutes });
  });
}

/** Remind HR (in-app) about probation ending today and civil IDs expiring within 30 days — once per item. */
const DOC_NAMES = { civil_id: ["البطاقة المدنية", "Civil ID"], passport: ["جواز السفر", "Passport"], visa: ["التأشيرة / الإقامة", "Visa / residence"], contract: ["عقد العمل", "Employment contract"],
  certificate: ["الشهادة العلمية", "Academic certificate"], resume: ["السيرة الذاتية", "Resume"], course: ["شهادة دورة تدريبية", "Course certificate"], medical: ["مستند طبي", "Medical document"], consent: ["موافقة", "Consent"], other: ["مستند", "Document"] };

/** Everything with an expiry date that ends within `days` (or already ended), for active staff. */
export function expiringItems(db, today, days = 30) {
  const limit = addDays(today, days), out = [];
  const emps = db.prepare("SELECT * FROM employees WHERE status IN ('active','on_leave')").all();
  const byId = new Map(emps.map((e) => [e.id, e]));
  for (const e of emps) {
    if (e.civil_id_expiry && e.civil_id_expiry <= limit) out.push({ key: `civil:${e.id}`, employee: e, what: "civil_id", expiry: e.civil_id_expiry });
    if (e.passport_expiry && e.passport_expiry <= limit) out.push({ key: `passport:${e.id}`, employee: e, what: "passport", expiry: e.passport_expiry });
    if (e.visa_expiry && e.visa_expiry <= limit) out.push({ key: `visa:${e.id}`, employee: e, what: "visa", expiry: e.visa_expiry });
    if (e.contract_end && e.contract_end <= limit) out.push({ key: `contract_end:${e.id}`, employee: e, what: "contract", expiry: e.contract_end });
  }
  for (const f of db.prepare("SELECT * FROM files WHERE kind='doc' AND request_id IS NULL AND archived_at IS NULL AND expiry IS NOT NULL AND expiry<=?").all(limit)) {
    const e = byId.get(f.employee_id);
    if (!e) continue;
    // the civil ID copy carries the same date as the profile field: one alert is enough
    if ((f.doc_type === "civil_id" && e.civil_id_expiry === f.expiry) || (f.doc_type === "passport" && e.passport_expiry === f.expiry) || (f.doc_type === "visa" && e.visa_expiry === f.expiry)) continue;
    // only the newest copy of each kind counts (an older passport stays on file after a renewal)
    const newer = db.prepare("SELECT 1 FROM files WHERE employee_id=? AND kind='doc' AND doc_type=? AND request_id IS NULL AND expiry>? LIMIT 1").get(e.id, f.doc_type, f.expiry);
    if (newer) continue;
    out.push({ key: `file:${f.id}`, employee: e, what: f.doc_type || "other", expiry: f.expiry, file: { id: f.id, name: f.name } });
  }
  return out.map((x) => ({ ...x, days: Math.round((Date.parse(x.expiry) - Date.parse(today)) / 864e5) })).sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
}

/** Alerts to HR and to the person: 30 days before, 7 days before and on/after the date — once each. */
export function runExpiryCheck(ctx, today) {
  const { db } = ctx;
  const hrUsers = db.prepare("SELECT id FROM users WHERE role IN ('hr','admin') AND active=1").all().map((r) => r.id);
  const seen = getSetting(db, "expiry_notified", {});
  let sent = 0;
  for (const x of expiringItems(db, today, 30)) {
    const stage = x.days <= 0 ? "expired" : x.days <= 7 ? "7" : "30";
    const tag = `${x.key}:${x.expiry}:${stage}`;
    if (seen[tag]) continue;
    const e = x.employee, nameAr = e.name_ar || e.name_en, nameEn = e.name_en || e.name_ar;
    const [docAr, docEn] = DOC_NAMES[x.what] || DOC_NAMES.other;
    const when = { ar: x.days <= 0 ? `انتهى في ${dmy(x.expiry)}` : `ينتهي في ${dmy(x.expiry)} (بعد ${x.days} يوم)`, en: x.days <= 0 ? `expired on ${dmy(x.expiry)}` : `expires on ${dmy(x.expiry)} (in ${x.days} days)` };
    const title = x.days <= 0 ? { title_ar: `${docAr} منتهي`, title_en: `${docEn} expired` } : { title_ar: `${docAr} قارب على الانتهاء`, title_en: `${docEn} expiring soon` };
    notify(ctx, hrUsers, { ...title, body_ar: `${nameAr}: ${docAr} ${when.ar}`, body_en: `${nameEn}: ${docEn} ${when.en}`, link: `#/staff/${e.id}` });
    const own = db.prepare("SELECT id FROM users WHERE employee_id=? AND active=1").get(e.id);
    if (own && !hrUsers.includes(own.id)) notify(ctx, [own.id], { ...title, body_ar: `${docAr} ${when.ar}. يرجى التجديد ورفع النسخة الجديدة في ملفك.`, body_en: `Your ${docEn.toLowerCase()} ${when.en}. Please renew it and upload the new copy to your profile.`, link: "#/me" });
    seen[tag] = today; sent++;
  }
  // probation ends today (unchanged)
  const hrOnly = db.prepare("SELECT id FROM users WHERE role='hr' AND active=1").all().map((r) => r.id);
  for (const e of db.prepare("SELECT * FROM employees WHERE status IN ('active','on_leave')").all()) {
    const name = e.name_ar || e.name_en;
    const pe = probationEnd(e.join_date);
    if (pe && pe === today && seen[`probation:${e.id}`] !== pe) {
      notify(ctx, hrOnly, { title_ar: "انتهاء فترة التجربة", title_en: "Probation ends today", body_ar: `${name}: تنتهي فترة التجربة اليوم`, body_en: `${e.name_en || name}: probation ends today`, link: `#/staff/${e.id}`, inAppOnly: true });
      seen[`probation:${e.id}`] = pe; sent++;
    }
  }
  setSetting(db, "expiry_notified", seen);
  return sent;
}

/** Copy the database to backups/hr-<date>.db and delete copies older than keepDays. */
export function backup(ctx, today, keepDays) {
  const dir = path.join(ctx.dataDir, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `hr-${today}.db`);
  fs.rmSync(file, { force: true });
  ctx.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const cutoff = addDays(today, -keepDays);
  for (const f of fs.readdirSync(dir)) {
    const m = /^hr-(\d{4}-\d{2}-\d{2})\.db$/.exec(f);
    if (m && m[1] < cutoff) fs.rmSync(path.join(dir, f), { force: true });
  }
  return file;
}

const muscatTime = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Muscat", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

export function registerJobs(api, ctx) {
  const { env } = ctx;
  if (env.NO_JOBS === "1") return;
  const state = { daily: null, backup: null };
  const tick = () => {
    try {
      const today = todayMuscat();
      if (state.daily !== today) { state.daily = today; const r = runAnniversaries(ctx, today); runExpiryCheck(ctx, today); runBirthdayAlerts(ctx, today); runWeeklyAttendance(ctx, today); runMonthlySummary(ctx, today); if (r.credits) console.log(`Leave credits posted: ${r.credits}, balances over the cap for review: ${r.reviews}`); }
      if (state.backup !== today && muscatTime() >= (env.BACKUP_TIME || "02:00")) { state.backup = today; backup(ctx, today, Number(env.BACKUP_KEEP_DAYS || 14)); }
    } catch (e) { console.error("scheduled job failed:", e); }
  };
  tick();
  ctx.timers.push(setInterval(tick, 5 * 60e3).unref());
}
