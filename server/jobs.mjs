/* Scheduled jobs (Muscat time): yearly leave credits on each join anniversary, HR reminders, nightly backup. */
import fs from "node:fs";
import path from "node:path";
import { tx, getSetting, setSetting } from "./db.mjs";
import { sendRaw, HttpError } from "./http.mjs";
import { can } from "./perm.mjs";
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
    const opening = db.prepare("SELECT max(effective_date) d FROM leave_ledger WHERE employee_id=? AND kind='opening'").get(emp.id).d;
    const due = dueCredits(emp.join_date, today, credited, opening ? addDays(opening, 1) : undefined);
    if (!due.length) continue;
    let lastForfeit = 0;
    tx(db, () => {
      for (const ys of due) {
        postLedger(db, emp, { kind: "annual_credit", minutes: ANNUAL, date: ys, yearStart: ys, note: "Yearly entitlement" });
        credits++;
        const over = capForfeit(balanceOf(db, emp.id));
        if (over > 0) { postLedger(db, emp, { kind: "cap_forfeit", minutes: -over, date: ys, yearStart: ys, note: "Balance above 60 days" }); forfeits++; lastForfeit = over; }
      }
    });
    const user = db.prepare("SELECT id FROM users WHERE employee_id=? AND active=1").get(emp.id);
    if (user) {
      const bal = fmtDays(balanceOf(db, emp.id));
      notify(ctx, [user.id], {
        title_ar: "تمت إضافة رصيد الإجازة السنوية", title_en: "Your yearly leave balance was added",
        body_ar: `أضيف ٣٠ يوماً. رصيدك الآن ${bal} يوم${lastForfeit ? ` (سقط ${fmtDays(lastForfeit)} يوم فوق الحد ٦٠)` : ""}.`,
        body_en: `30 days were added. Your balance is now ${bal} days${lastForfeit ? ` (${fmtDays(lastForfeit)} days above the 60-day cap were forfeited)` : ""}.`,
        link: "#/me",
      });
    }
  }
  return { credits, forfeits };
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
      if (state.daily !== today) { state.daily = today; const r = runAnniversaries(ctx, today); runExpiryCheck(ctx, today); if (r.credits) console.log(`Leave credits posted: ${r.credits}, forfeits: ${r.forfeits}`); }
      if (state.backup !== today && muscatTime() >= (env.BACKUP_TIME || "02:00")) { state.backup = today; backup(ctx, today, Number(env.BACKUP_KEEP_DAYS || 14)); }
    } catch (e) { console.error("scheduled job failed:", e); }
  };
  tick();
  ctx.timers.push(setInterval(tick, 5 * 60e3).unref());
}
