/* Scheduled jobs (Muscat time): yearly leave credits on each join anniversary, HR reminders, nightly backup. */
import fs from "node:fs";
import path from "node:path";
import { tx, getSetting, setSetting } from "./db.mjs";
import { sendRaw, send, readJson, HttpError } from "./http.mjs";
import { can } from "./perm.mjs";
import { audit } from "./audit.mjs";
import { ANNUAL, dueCredits, capForfeit, probationEnd, addDays, fmtDays, todayMuscat } from "./leave.mjs";
import { postLedger, balanceOf } from "./ledger.mjs";
import { notify } from "./notify.mjs";

const dmy = (iso) => iso.split("-").reverse().join("/");

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
export function runExpiryCheck(ctx, today) {
  const { db } = ctx;
  const hrUsers = db.prepare("SELECT id FROM users WHERE role='hr' AND active=1").all().map((r) => r.id);
  const seen = getSetting(db, "expiry_notified", {});
  const limit = addDays(today, 30);
  let sent = 0;
  const emps = db.prepare("SELECT * FROM employees WHERE status IN ('active','on_leave')").all();
  for (const e of emps) {
    const name = e.name_ar || e.name_en;
    if (e.civil_id_expiry && e.civil_id_expiry <= limit && seen[`civil:${e.id}`] !== e.civil_id_expiry) {
      notify(ctx, hrUsers, { title_ar: "بطاقة مدنية قاربت على الانتهاء", title_en: "Civil ID expiring soon", body_ar: `${name}: تنتهي في ${dmy(e.civil_id_expiry)}`, body_en: `${e.name_en || name}: expires ${dmy(e.civil_id_expiry)}`, link: `#/staff/${e.id}`, inAppOnly: true });
      seen[`civil:${e.id}`] = e.civil_id_expiry; sent++;
    }
    const pe = probationEnd(e.join_date);
    if (pe && pe === today && seen[`probation:${e.id}`] !== pe) {
      notify(ctx, hrUsers, { title_ar: "انتهاء فترة التجربة", title_en: "Probation ends today", body_ar: `${name}: تنتهي فترة التجربة اليوم`, body_en: `${e.name_en || name}: probation ends today`, link: `#/staff/${e.id}`, inAppOnly: true });
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
  api.get("/api/admin/backup", (req, res) => {
    if (!can(req.sess, "settings.edit")) throw new HttpError(403, "forbidden", "You do not have permission for this");
    const file = backup(ctx, ctx.today(), Number(env.BACKUP_KEEP_DAYS || 14));
    sendRaw(req, res, 200, fs.readFileSync(file), "application/octet-stream", { "Content-Disposition": `attachment; filename="nama-hr-${ctx.today()}.db"` });
  });
  if (env.NO_JOBS === "1") return;
  const state = { daily: null, backup: null };
  const tick = () => {
    try {
      const today = todayMuscat();
      if (state.daily !== today) { state.daily = today; const r = runAnniversaries(ctx, today); runExpiryCheck(ctx, today); if (r.credits) console.log(`Leave credits posted: ${r.credits}, balances over the cap for review: ${r.reviews}`); }
      if (state.backup !== today && muscatTime() >= (env.BACKUP_TIME || "02:00")) { state.backup = today; backup(ctx, today, Number(env.BACKUP_KEEP_DAYS || 14)); }
    } catch (e) { console.error("scheduled job failed:", e); }
  };
  tick();
  ctx.timers.push(setInterval(tick, 5 * 60e3).unref());
}
