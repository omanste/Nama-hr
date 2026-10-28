/* Company calendar: everyone's leave (by what each person may see), official holidays, blocked days, company occasions and birthdays.
 * Blocked days stop annual leave, special unpaid leave and permissions; leave the Labour Law guarantees (sick, bereavement,
 * maternity, paternity, Hajj, exam, patient care, child care) and emergency leave can't be blocked. */
import { nowIso, tx, getSetting, setSetting } from "./db.mjs";
import { send, readJson, HttpError } from "./http.mjs";
import { can, approvedDepartments } from "./perm.mjs";
import { audit } from "./audit.mjs";
import { notify } from "./notify.mjs";
import { isIsoDate, addDays, addMonths, PERMISSION_TYPES } from "./leave.mjs";
import { omanOccasions } from "./oman-occasions.mjs";

export const BLOCKABLE = ["annual", "unpaid", ...PERMISSION_TYPES];
const editors = ["admin", "hr"];

/** The first blocked period that overlaps start–end, or null. */
export function blockedOverlap(db, type, start, end) {
  if (!BLOCKABLE.includes(type)) return null;
  return db.prepare("SELECT * FROM calendar_events WHERE kind='blocked' AND start_date<=? AND end_date>=? ORDER BY start_date LIMIT 1").get(end, start) || null;
}

/** Birthdays (day and month only — never the year or age) of active staff falling between two dates of the same or next year. */
function birthdaysBetween(db, from, to) {
  const out = [];
  for (const e of db.prepare("SELECT id, name_ar, name_en, dob FROM employees WHERE dob IS NOT NULL AND status IN ('active','on_leave')").all()) {
    const md = e.dob.slice(5, 10);
    for (const y of new Set([from.slice(0, 4), to.slice(0, 4)])) {
      let d = `${y}-${md}`;
      if (md === "02-29" && !isIsoDate(d)) d = `${y}-02-28`; // born on 29 Feb → 28 Feb in other years
      if (d >= from && d <= to) out.push({ employee_id: e.id, name_ar: e.name_ar, name_en: e.name_en, date: d });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Daily: tell everyone (except the person) about a birthday 5 days ahead, so colleagues can prepare a surprise. In-app only. */
export function runBirthdayAlerts(ctx, today) {
  const { db } = ctx;
  const seen = getSetting(db, "birthday_notified", {});
  const day = addDays(today, 5);
  let sent = 0;
  for (const b of birthdaysBetween(db, day, day)) {
    const key = `${b.employee_id}:${b.date}`;
    if (seen[key]) continue;
    const users = db.prepare(`SELECT u.id FROM users u JOIN employees e ON e.id=u.employee_id WHERE u.active=1 AND e.status IN ('active','on_leave') AND u.employee_id<>?`).all(b.employee_id).map((r) => r.id);
    const [d, m] = [b.date.slice(8, 10), b.date.slice(5, 7)];
    notify(ctx, users, { title_ar: `🎂 عيد ميلاد ${b.name_ar || b.name_en} بعد 5 أيام`, title_en: `🎂 ${b.name_en || b.name_ar}'s birthday is in 5 days`,
      body_ar: `في ${d}/${m} — فرصة لمفاجأة زميلكم!`, body_en: `On ${d}/${m} — a chance to surprise your colleague!`, link: "#/calendar", inAppOnly: true });
    seen[key] = today; sent++;
  }
  // forget alerts older than a year
  for (const k of Object.keys(seen)) if (seen[k] < addDays(today, -400)) delete seen[k];
  setSetting(db, "birthday_notified", seen);
  return sent;
}

export function registerCalendar(api, ctx) {
  const { db } = ctx;
  const forbidden = () => new HttpError(403, "forbidden", "You do not have permission for this");
  const bad = (field, msg) => Object.assign(new HttpError(400, "invalid", msg), { field });
  const needEditor = (sess) => { if (!editors.includes(sess.user.role)) throw forbidden(); };

  api.get("/api/calendar", (req, res) => {
    const sess = req.sess;
    const month = req.query.get("month") || ctx.today().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad("month", "month must be YYYY-MM");
    const first = `${month}-01`, last = addDays(addMonths(first, 1), -1);
    // who's off: everyone for HR/Accounts/CEO/Admin, a manager's departments, otherwise only me
    const where = [], args = [];
    if (!can(sess, "requests.viewAll")) {
      const depts = approvedDepartments(db, sess.employee && sess.employee.id);
      const mine = sess.employee ? sess.employee.id : -1;
      if (depts.length) { where.push(`(e.department_id IN (${depts.map(() => "?").join(",")}) OR e.id=?)`); args.push(...depts, mine); }
      else { where.push("e.id=?"); args.push(mine); }
    }
    const items = db.prepare(`SELECT r.id, r.employee_id, r.type, r.status, r.start_date, r.end_date, r.early_time, r.end_time, r.minutes, e.name_ar, e.name_en, e.emp_no, e.department_id
      FROM leave_requests r JOIN employees e ON e.id=r.employee_id
      WHERE r.status IN ('pending','approved') AND r.type NOT IN ('comp_day','correction','mission') AND r.start_date<=? AND r.end_date>=? ${where.length ? "AND " + where.join(" AND ") : ""}
      ORDER BY r.start_date, e.name_ar`).all(last, first, ...args);
    const holidays = getSetting(db, "official_holidays", []).filter((x) => x.date >= first && x.date <= last);
    const events = db.prepare("SELECT * FROM calendar_events WHERE start_date<=? AND end_date>=? ORDER BY start_date").all(last, first);
    send(req, res, 200, { month, items, holidays, events, birthdays: birthdaysBetween(db, first, last), canEdit: editors.includes(sess.user.role), blockable: BLOCKABLE });
  });

  // add to the calendar: an official holiday (counts in leave), a blocked period, or a company occasion
  api.post("/api/calendar/entries", async (req, res) => {
    needEditor(req.sess);
    const b = await readJson(req);
    const kind = b.kind, start = b.start, end = b.end || b.start, name = String(b.name || "").trim().slice(0, 100);
    if (!["holiday", "blocked", "event", "national", "religious"].includes(kind)) throw bad("kind", "Choose what to add");
    if (!isIsoDate(start)) throw bad("start", "A valid date is required");
    if (!isIsoDate(end) || end < start) throw bad("end", "The end date is before the start");
    if (addDays(start, 92) < end) throw bad("end", "At most 3 months at a time");
    if (!name) throw bad("name", "A name is required");
    let out;
    tx(db, () => {
      if (kind === "holiday") {
        const list = getSetting(db, "official_holidays", []);
        const have = new Set(list.map((x) => x.date));
        for (let d = start; d <= end; d = addDays(d, 1)) if (!have.has(d)) list.push({ date: d, name });
        list.sort((x, y) => (x.date < y.date ? -1 : 1));
        setSetting(db, "official_holidays", list);
        out = { kind, start, end, name };
      } else {
        const r = db.prepare("INSERT INTO calendar_events(kind,start_date,end_date,name,created_by,created_at) VALUES(?,?,?,?,?,?)").run(kind, start, end, name, req.sess.user.id, nowIso());
        out = db.prepare("SELECT * FROM calendar_events WHERE id=?").get(r.lastInsertRowid);
      }
      audit(db, req.sess.user.id, `calendar.add_${kind}`, "calendar", out.id || start, null, out);
    });
    // a blocked period or company occasion is news for everyone
    if (kind === "blocked" || kind === "event") {
      const users = db.prepare("SELECT id FROM users WHERE active=1").all().map((r) => r.id);
      const when = start === end ? start.split("-").reverse().join("/") : `${start.split("-").reverse().join("/")} – ${end.split("-").reverse().join("/")}`;
      notify(ctx, users, kind === "blocked"
        ? { title_ar: "أيام لا تُقبل فيها الإجازات", title_en: "Days when leave can't be booked", body_ar: `${name}: ${when}`, body_en: `${name}: ${when}`, link: "#/calendar", inAppOnly: true }
        : { title_ar: `مناسبة للشركة: ${name}`, title_en: `Company occasion: ${name}`, body_ar: when, body_en: when, link: "#/calendar", inAppOnly: true });
    }
    send(req, res, 201, { entry: out });
  });

  // add Oman's national and religious occasions for a year (skips ones already there)
  api.post("/api/calendar/import-oman", async (req, res) => {
    needEditor(req.sess);
    const year = Number((await readJson(req)).year);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) throw bad("year", "Choose a year");
    const have = db.prepare("SELECT 1 FROM calendar_events WHERE kind=? AND start_date=? AND name=?");
    const ins = db.prepare("INSERT INTO calendar_events(kind,start_date,end_date,name,created_by,created_at) VALUES(?,?,?,?,?,?)");
    let added = 0;
    const list = omanOccasions(year);
    tx(db, () => {
      for (const o of list) if (!have.get(o.kind, o.date, o.name)) { ins.run(o.kind, o.date, o.date, o.name, req.sess.user.id, nowIso()); added++; }
      audit(db, req.sess.user.id, "calendar.import_oman", "calendar", year, null, { year, added });
    });
    send(req, res, 200, { year, added, total: list.length });
  });

  api.delete("/api/calendar/entries/:id", (req, res) => {
    needEditor(req.sess);
    const e = db.prepare("SELECT * FROM calendar_events WHERE id=?").get(Number(req.params.id));
    if (!e) throw new HttpError(404, "not_found", "Not found");
    tx(db, () => { db.prepare("DELETE FROM calendar_events WHERE id=?").run(e.id); audit(db, req.sess.user.id, "calendar.delete", "calendar", e.id, e, null); });
    send(req, res, 200, { ok: true });
  });
  api.delete("/api/calendar/holidays/:date", (req, res) => {
    needEditor(req.sess);
    const date = req.params.date;
    const list = getSetting(db, "official_holidays", []);
    if (!list.some((x) => x.date === date)) throw new HttpError(404, "not_found", "Not found");
    tx(db, () => { setSetting(db, "official_holidays", list.filter((x) => x.date !== date)); audit(db, req.sess.user.id, "calendar.delete_holiday", "calendar", date, list.find((x) => x.date === date), null); });
    send(req, res, 200, { ok: true });
  });

  // the next 5 days of colleagues' birthdays (never my own) — for the home page
  api.get("/api/birthdays/upcoming", (req, res) => {
    const today = ctx.today(), own = req.sess.employee ? req.sess.employee.id : -1;
    send(req, res, 200, { items: birthdaysBetween(db, today, addDays(today, 5)).filter((b) => b.employee_id !== own) });
  });
}
