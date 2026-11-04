/* Online check-in / check-out from the portal (phone, tablet or computer). Each one records the server's time (Muscat),
 * where the person was (the device's location and its accuracy; the nearest work site from Settings) and who it was
 * (a photo taken live with the camera). Outside every site it's still allowed, with a reason, and the manager is told.
 * The check-ins are punches for the same attendance engine as the fingerprint machine (see employeeDays). */
import fs from "node:fs";
import path from "node:path";
import { tx, nowIso, getSetting } from "./db.mjs";
import { send, sendRaw, readJson, readBody, HttpError } from "./http.mjs";
import { isIsoDate, addDays, clockMin, TYPES } from "./leave.mjs";
import { shiftFor, isRestDay } from "./shifts.mjs";
import { fileForPerson } from "./requests.mjs";
import { audit } from "./audit.mjs";
import { notify } from "./notify.mjs";
import { storeUpload, MAX_FILE } from "./files.mjs";
import { attendanceExempt } from "./attendance.mjs";
import { approvedDepartments } from "./perm.mjs";
import { removeUpload } from "./files.mjs";

const bad = (field, message) => Object.assign(new HttpError(400, "invalid", message), { field });
const ipOf = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",").pop().trim();

/** Distance in metres between two points (haversine). */
export function metres(a, b) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** The work site this point is in (nearest one whose radius covers it), and the nearest site with its distance. */
export function siteOf(sites, p) {
  let near = null;
  for (const s of sites) { const d = metres(s, p); if (!near || d < near.d) near = { site: s, d }; }
  const inside = near && near.d <= near.site.radius_m ? near.site : null;
  return { inside, nearest: near ? near.site : null, distance: near ? Math.round(near.d) : null };
}

/** Extra time is asked about this many minutes after the shift's end. */
export const AFTER_HOURS_MIN = 30;
const pad2 = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** Is this a working day for the person (not a rest day, an official holiday, approved leave or an external task)? */
export function workingDay(db, emp, date) {
  if (isRestDay(date)) return false;
  if ((getSetting(db, "official_holidays", []) || []).some((x) => x.date === date)) return false;
  const on = db.prepare("SELECT type FROM leave_requests WHERE employee_id=? AND status='approved' AND start_date<=? AND end_date>=?").all(emp.id, date, date);
  return !on.some((r) => r.type === "mission" || (!TYPES[r.type].permission && !TYPES[r.type].attendance && r.type !== "comp_day"));
}
/** The last working day before today on which the person checked in online but never out (and asked no correction yet). */
export function missedCheckout(db, emp, today) {
  for (let k = 1, d = addDays(today, -1); k <= 7; k++, d = addDays(d, -1)) {
    if (!workingDay(db, emp, d)) continue;
    const last = db.prepare("SELECT kind FROM att_checkins WHERE employee_id=? AND substr(at,1,10)=? AND coalesce(approval,'approved')<>'rejected' ORDER BY at DESC, id DESC LIMIT 1").get(emp.id, d);
    if (!last || last.kind !== "in") return null; // that working day is fine (or had no online check-in): look no further
    if (db.prepare("SELECT 1 FROM leave_requests WHERE employee_id=? AND type='correction' AND start_date=? AND status IN ('pending','approved')").get(emp.id, d)) return null;
    return { date: d };
  }
  return null;
}
/** Today's open "I'm still working" request (no end yet), if any. */
export const openExtra = (db, empId, date) => db.prepare("SELECT * FROM leave_requests WHERE employee_id=? AND type='overtime' AND start_date=? AND status='pending' AND end_time IS NULL ORDER BY id DESC LIMIT 1").get(empId, date);
/** May this person check in online? Not the CEO/Chairman (outside the policy), not someone on the fingerprint machine only. */
export function canCheckIn(db, emp) {
  if (!emp) return { ok: false, why: "no_profile" };
  if (attendanceExempt(db).includes(emp.id)) return { ok: false, why: "exempt" };
  if ((emp.att_mode || "both") === "machine") return { ok: false, why: "machine_only" };
  return { ok: true };
}

/** Who approves a person's check-in outside the work sites: their direct manager, else their department's approver. */
export function approversOf(db, emp) {
  // someone who reports straight to top management: the CEO, the Chairman, or both (either one decides)
  if (emp.reports_to_top) {
    const userOf = (key) => { const id = getSetting(db, key, null); return id ? (db.prepare("SELECT id FROM users WHERE employee_id=? AND active=1").get(id) || {}).id : null; };
    const ids = [emp.reports_to_top !== "chairman" ? userOf("managers_approver_employee_id") : null, emp.reports_to_top !== "ceo" ? userOf("chairman_employee_id") : null].filter(Boolean);
    if (ids.length) return ids;
  }
  const dept = emp.department_id && db.prepare("SELECT approver_employee_id FROM departments WHERE id=?").get(emp.department_id);
  return [emp.manager_employee_id, dept && dept.approver_employee_id].filter((id) => id && id !== emp.id)
    .map((id) => (db.prepare("SELECT id FROM users WHERE employee_id=? AND active=1").get(id) || {}).id).filter(Boolean).slice(0, 1);
}
/** May this session approve or reject this check-in? The person's manager or department approver, HR or Admin — never one's own. */
const TOP_ROLES = ["ceo", "chairman"];
export function mayDecideCheckin(db, sess, c) {
  if (sess.employee && sess.employee.id === c.employee_id) return false;
  if (["hr", "admin"].includes(sess.user.role)) return true;
  if (!sess.employee) return false;
  const emp = db.prepare("SELECT manager_employee_id, department_id, reports_to_top FROM employees WHERE id=?").get(c.employee_id);
  if (emp && emp.reports_to_top && TOP_ROLES.includes(sess.user.role) && [sess.user.role, "both"].includes(emp.reports_to_top)) return true;
  return !!emp && (emp.manager_employee_id === sess.employee.id || approvedDepartments(db, sess.employee.id).includes(emp.department_id));
}

/* Reminders (every few minutes, from the job runner). Only for people who check in online — on "online", or on "both"
 * with an online check-in in the last 14 days — on a working day, once a day each:
 *   start + 30 min with no check-in → "you haven't checked in yet";
 *   end + 30 min still checked in → "check out now, or tell us you're still working" (buttons on the pop-up);
 *   23:00, said "still working" and still checked in → one last reminder;
 *   from 09:00, each manager gets one list of their people with no check-out (or no check-in) on the last working day. */
const once = (db, empId, date, kind) => db.prepare("INSERT OR IGNORE INTO att_reminders(employee_id,date,kind,sent_at) VALUES(?,?,?,?)").run(empId, date, kind, nowIso()).changes > 0;
export function runReminders(ctx, today, now) {
  const { db } = ctx;
  const exempt = new Set(attendanceExempt(db)), since = addDays(today, -14);
  const people = db.prepare(`SELECT e.*, u.id user_id FROM employees e JOIN users u ON u.employee_id=e.id AND u.active=1
    WHERE e.status='active' AND coalesce(e.att_mode,'both')<>'machine'`).all()
    .filter((e) => !exempt.has(e.id) && (e.att_mode === "online" || db.prepare("SELECT 1 FROM att_checkins WHERE employee_id=? AND at>=?").get(e.id, since)));
  let sent = 0;
  const lastOf = (id, d) => db.prepare("SELECT kind FROM att_checkins WHERE employee_id=? AND substr(at,1,10)=? AND coalesce(approval,'approved')<>'rejected' ORDER BY at DESC, id DESC LIMIT 1").get(id, d);
  const missedBy = new Map(); // manager user → names
  for (const e of people) {
    const shift = shiftFor(db, e, today), last = lastOf(e.id, today);
    if (workingDay(db, e, today)) {
      if (!last && now >= shift.start + AFTER_HOURS_MIN && now < shift.end && once(db, e.id, today, "in")) {
        notify(ctx, [e.user_id], { title_ar: "لم تسجّل حضورك بعد", title_en: "You haven't checked in yet", body_ar: `بدأ دوامك الساعة ${pad2(shift.start)}`, body_en: `Your shift started at ${pad2(shift.start)}`, link: "#/", inAppOnly: true, tag: "ci-in" });
        sent++;
      }
      const open = openExtra(db, e.id, today);
      if (last && last.kind === "in" && !open && now >= shift.end + AFTER_HOURS_MIN && once(db, e.id, today, "out")) {
        notify(ctx, [e.user_id], { title_ar: "لم تسجّل انصرافك", title_en: "You haven't checked out", body_ar: `انتهى دوامك الساعة ${pad2(shift.end)} — سجّل انصرافك، أو أخبرنا إن كنت ما زلت في العمل`,
          body_en: `Your shift ended at ${pad2(shift.end)} — check out, or tell us you're still working`, link: "#/?ci=out", inAppOnly: true, tag: "ci-out",
          actions: [{ action: "#/?ci=out", title_ar: "انصراف الآن", title_en: "Check out now" }, { action: "#/?ci=stay", title_ar: "ما زلت في العمل", title_en: "I'm still working" }] });
        sent++;
      }
      if (last && last.kind === "in" && open && now >= 23 * 60 && once(db, e.id, today, "late")) {
        notify(ctx, [e.user_id], { title_ar: "ما زلت مسجّلاً في العمل", title_en: "You're still checked in", body_ar: "سجّل انصرافك عند الانتهاء", body_en: "Check out when you finish", link: "#/?ci=out", inAppOnly: true, tag: "ci-out" });
        sent++;
      }
    }
    // the managers' morning list: the last working day without a check-out
    if (now >= 9 * 60) {
      const m = missedCheckout(db, e, today);
      if (m) for (const to of approversOf(db, e)) { if (!missedBy.has(to)) missedBy.set(to, []); missedBy.get(to).push(e.name_ar || e.name_en); }
    }
  }
  for (const [to, names] of missedBy) {
    if (!once(db, -to, today, "mgr")) continue; // keyed by the manager (a negative id: not an employee)
    notify(ctx, [to], { title_ar: `لم يسجّلوا الانصراف: ${names.length}`, title_en: `Didn't check out: ${names.length}`, body_ar: names.join("، "), body_en: names.join(", "), link: "#/attendance/report", inAppOnly: true });
    sent++;
  }
  return sent;
}

/** Delete check-in photos older than 90 days and clear locations older than 12 months (privacy; audited). */
export function runCheckinRetention(ctx, today) {
  const { db } = ctx;
  const d90 = new Date(Date.parse(today + "T00:00:00Z") - 90 * 864e5).toISOString().slice(0, 10);
  const d365 = new Date(Date.parse(today + "T00:00:00Z") - 365 * 864e5).toISOString().slice(0, 10);
  const old = db.prepare("SELECT id, photo_file_id FROM att_checkins WHERE photo_file_id IS NOT NULL AND at<?").all(d90);
  const loc = db.prepare("SELECT count(*) n FROM att_checkins WHERE lat IS NOT NULL AND at<?").get(d365).n;
  const signIns = db.prepare("SELECT count(*) n FROM login_log WHERE lat IS NOT NULL AND at<?").get(d365).n;
  if (signIns) db.prepare("UPDATE login_log SET lat=NULL, lng=NULL, accuracy_m=NULL WHERE lat IS NOT NULL AND at<?").run(d365); // sign-in locations: a year too
  if (!old.length && !loc) return { photos: 0, locations: 0 };
  tx(db, () => {
    for (const c of old) {
      db.prepare("DELETE FROM files WHERE id=? AND kind='checkin'").run(c.photo_file_id);
      db.prepare("UPDATE att_checkins SET photo_file_id=NULL WHERE id=?").run(c.id);
    }
    db.prepare("UPDATE att_checkins SET lat=NULL, lng=NULL, accuracy_m=NULL WHERE lat IS NOT NULL AND at<?").run(d365);
    audit(db, null, "checkin.retention", "attendance", null, null, { photos: old.length, locations: loc, before_photos: d90, before_locations: d365 });
  });
  for (const c of old) removeUpload(ctx, c.photo_file_id); // the photo and its smaller copies
  return { photos: old.length, locations: loc };
}

/** Coordinates in a Google Maps link or text: "@23.58,58.38", "!3d23.58!4d58.38", "?q=23.58,58.38", "ll=…", or "23.58, 58.38". */
export function coordsFrom(text) {
  const s = decodeURIComponent(String(text || ""));
  const ok = (lat, lng) => (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null);
  let m = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(s); // the place's own pin
  if (m) return ok(+m[1], +m[2]);
  m = /[?&](?:q|query|ll|center|destination)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(s);
  if (m) return ok(+m[1], +m[2]);
  m = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(s); // the map's centre
  if (m) return ok(+m[1], +m[2]);
  m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,،\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(s);
  if (m) return ok(+m[1], +m[2]);
  return null;
}
const MAP_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|(www\.)?google\.[a-z.]+|maps\.google\.[a-z.]+)$/i;
/** A Google Maps link (a short maps.app.goo.gl one too) or plain "lat, lng" → {lat, lng}. Short links are followed on the server. */
export async function resolveMapLink(text, fetchImpl = fetch) {
  const direct = coordsFrom(text);
  if (direct) return direct;
  let url;
  try { url = new URL(String(text).trim()); } catch { return null; }
  for (let hop = 0; hop < 5; hop++) {
    if (url.protocol !== "https:" || !MAP_HOSTS.test(url.hostname)) return null; // only Google Maps, never an arbitrary address
    const r = await fetchImpl(url.href, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (Nama HR)" }, signal: AbortSignal.timeout(8000) });
    const loc = r.headers.get("location");
    if (loc) { const c = coordsFrom(loc); if (c) return c; url = new URL(loc, url); continue; }
    const body = (await r.text()).slice(0, 400000);
    return coordsFrom(url.href) || coordsFrom((/https:\/\/www\.google\.[^"']*\/maps\/[^"'\s]*/.exec(body) || [""])[0]) || coordsFrom((/\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/.exec(body) || []).slice(1).join(","));
  }
  return null;
}

export function registerCheckin(api, ctx) {
  const { db } = ctx;
  const sitesNow = () => getSetting(db, "att_sites", []);
  const today = (sess) => db.prepare("SELECT c.id, c.kind, c.at, c.site_id, c.outside, c.reason, c.approval, c.decision_note FROM att_checkins c WHERE c.employee_id=? AND substr(c.at,1,10)=? ORDER BY c.at, c.id")
    .all(sess.employee.id, ctx.today());

  // the home page card: may I check in, have I accepted the notice, what did I record today
  api.get("/api/attendance/checkin/today", (req, res) => {
    const sess = req.sess;
    const may = canCheckIn(db, sess.employee);
    if (!may.ok) return send(req, res, 200, { enabled: false, why: may.why });
    const items = today(sess);
    const sites = sitesNow();
    const emp = sess.employee, day = ctx.today(), now = clockMin(ctx.clock()), shift = shiftFor(db, emp, day);
    const next = items.length && items[items.length - 1].kind === "in" ? "out" : "in";
    const open = openExtra(db, emp.id, day);
    send(req, res, 200, { enabled: true, consent: !!sess.user.checkin_consent_at, items: items.map((c) => ({ ...c, site: sites.find((s) => s.id === c.site_id) || null })),
      next, sites: sites.length, shift_end: pad2(shift.end),
      // 30 minutes after the shift and still checked in: "check out now" or "I'm still working" (with a reason)
      after_hours: next === "out" && workingDay(db, emp, day) && now > shift.end + AFTER_HOURS_MIN, staying: open ? { reason: open.reason } : null,
      missed: missedCheckout(db, emp, day) });
  });

  // Settings › Work sites: a Google Maps link (or "lat, lng") → the coordinates (Admin)
  api.post("/api/settings/map-link", async (req, res) => {
    if (req.sess.user.role !== "admin") throw new HttpError(403, "forbidden", "You do not have permission for this");
    const b = await readJson(req);
    let c = null;
    try { c = await resolveMapLink(String(b.link || "").slice(0, 2000), ctx.fetchImpl || fetch); } catch { c = null; }
    if (!c) throw bad("link", "Couldn't read a location from this — paste the Google Maps link of the place, or its coordinates");
    send(req, res, 200, { lat: Math.round(c.lat * 1e6) / 1e6, lng: Math.round(c.lng * 1e6) / 1e6 });
  });

  api.post("/api/attendance/checkin/consent", (req, res) => {
    const sess = req.sess;
    if (!canCheckIn(db, sess.employee).ok) throw new HttpError(403, "forbidden", "Online check-in isn't on for you");
    db.prepare("UPDATE users SET checkin_consent_at=coalesce(checkin_consent_at, ?) WHERE id=?").run(nowIso(), sess.user.id);
    audit(db, sess.user.id, "checkin.consent", "user", sess.user.id, null, null);
    send(req, res, 200, { ok: true });
  });

  // body: the photo (JPEG/PNG/WebP); query: kind, lat, lng, acc, reason, device
  api.post("/api/attendance/checkin", async (req, res) => {
    const sess = req.sess, emp = sess.employee;
    // the photo is read in full before any check: answering early while a phone is still sending it makes mobile
    // browsers drop the connection ("Load failed") instead of showing the answer (e.g. "you're outside — say why")
    const photoBody = await readBody(req, MAX_FILE);
    const may = canCheckIn(db, emp);
    if (!may.ok) throw new HttpError(403, "forbidden", may.why === "exempt" ? "Top management isn't under the attendance policy" : "Online check-in isn't on for you");
    if (!sess.user.checkin_consent_at) throw new HttpError(409, "consent_required", "Please read and accept the notice first");
    const q = req.query;
    const kind = q.get("kind");
    if (!["in", "out"].includes(kind)) throw bad("kind", "Check in or check out?");
    const lat = Number(q.get("lat")), lng = Number(q.get("lng")), acc = q.get("acc") === null ? null : Number(q.get("acc"));
    if (!q.get("lat") || !q.get("lng") || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      throw bad("location", "Your location is needed — allow location for this site and try again");
    const where = siteOf(sitesNow(), { lat, lng });
    const reason = String(q.get("reason") || "").trim().slice(0, 300);
    if (!where.inside && !reason) throw Object.assign(bad("reason", "You're outside every work site — say why"), { extra: { outside: true, nearest: where.nearest, distance: where.distance } });
    // leaving more than 30 minutes after the shift on a working day: why (the extra time goes to the manager, then HR)
    const today = ctx.today(), now = clockMin(ctx.clock()), shift = shiftFor(db, emp, today);
    const lateOut = kind === "out" && workingDay(db, emp, today) && now > shift.end + AFTER_HOURS_MIN;
    const open = lateOut ? openExtra(db, emp.id, today) : null;
    const extraReason = String(q.get("extra_reason") || "").trim().slice(0, 300) || (open && open.reason) || "";
    if (lateOut && !extraReason)
      throw Object.assign(bad("extra_reason", "You're leaving after your working hours — say why"), { extra: { after_hours: true, shift_end: pad2(shift.end) } });
    const photo = await storeUpload(ctx, req, { employeeId: emp.id, kind: "checkin", body: photoBody });
    const at = `${today} ${ctx.clock()}`;
    const row = tx(db, () => {
      const r = db.prepare(`INSERT INTO att_checkins(employee_id,kind,at,lat,lng,accuracy_m,site_id,outside,reason,photo_file_id,device_id,ip,user_agent,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(emp.id, kind, at, lat, lng, Number.isFinite(acc) ? Math.round(acc) : null, where.inside ? where.inside.id : null,
        where.inside ? 0 : 1, reason || null, photo.id, String(q.get("device") || "").slice(0, 64) || null, ipOf(req), String(req.headers["user-agent"] || "").slice(0, 200), nowIso());
      // outside every site: it counts only once the manager approves it
      if (!where.inside) db.prepare("UPDATE att_checkins SET approval='pending' WHERE id=?").run(r.lastInsertRowid);
      const c = db.prepare("SELECT * FROM att_checkins WHERE id=?").get(r.lastInsertRowid);
      audit(db, sess.user.id, `checkin.${kind}`, "employee", emp.id, null, { id: c.id, at, site: c.site_id, outside: c.outside }); // no location or photo in the log
      return c;
    });
    // outside every site: the manager is asked to approve it (the direct manager, else the department's approver; HR if neither)
    if (row.outside) {
      const to = approversOf(db, emp);
      notify(ctx, to.length ? to : db.prepare("SELECT id FROM users WHERE role='hr' AND active=1").all().map((u) => u.id), {
        title_ar: `${kind === "in" ? "تسجيل حضور" : "تسجيل انصراف"} خارج مواقع العمل بانتظار موافقتك`, title_en: `${kind === "in" ? "Check-in" : "Check-out"} outside the work sites awaiting your approval`,
        body_ar: `${emp.name_ar || emp.name_en} · ${at.slice(11)} — ${reason}`, body_en: `${emp.name_en || emp.name_ar} · ${at.slice(11)} — ${reason}`, link: "#/approvals" });
    }
    let extra = null;
    if (lateOut) {
      const v = { start_date: today, end_date: today, early_time: pad2(shift.end), end_time: pad2(now), minutes: now - shift.end };
      if (open) { // they said "I'm still working": the request gets its end now
        db.prepare("UPDATE leave_requests SET end_time=?, minutes=?, reason=? WHERE id=?").run(v.end_time, v.minutes, extraReason, open.id);
        extra = db.prepare("SELECT * FROM leave_requests WHERE id=?").get(open.id);
      } else extra = fileForPerson(ctx, emp, sess.user.id, { type: "overtime", ...v, reason: extraReason, details: { source: "checkout", checkin_id: row.id } });
    }
    send(req, res, 201, { checkin: { id: row.id, kind: row.kind, at: row.at, outside: !!row.outside, approval: row.approval, site: where.inside }, extra: extra && { id: extra.id, minutes: extra.minutes } });
  });

  // before taking the photo: is this place inside a work site, and is it a check-out after hours? (no photo is sent)
  api.get("/api/attendance/checkin/check", (req, res) => {
    const sess = req.sess, emp = sess.employee, q = req.query;
    if (!canCheckIn(db, emp).ok) throw new HttpError(403, "forbidden", "Online check-in isn't on for you");
    const kind = q.get("kind") === "out" ? "out" : "in", lat = Number(q.get("lat")), lng = Number(q.get("lng"));
    if (!q.get("lat") || !q.get("lng") || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      throw bad("location", "Your location is needed — allow location for this site and try again");
    const where = siteOf(sitesNow(), { lat, lng });
    const today = ctx.today(), now = clockMin(ctx.clock()), shift = shiftFor(db, emp, today);
    const after = kind === "out" && workingDay(db, emp, today) && now > shift.end + AFTER_HOURS_MIN;
    const open = after ? openExtra(db, emp.id, today) : null;
    send(req, res, 200, { inside: !!where.inside, site: where.inside, nearest: where.nearest, distance: where.distance,
      after_hours: after && !(open && open.reason), shift_end: pad2(shift.end) });
  });

  // "I'm still working" (asked 30 minutes after the shift): a reason; the extra time goes to the manager once they check out
  api.post("/api/attendance/checkin/stay", async (req, res) => {
    const sess = req.sess, emp = sess.employee;
    if (!canCheckIn(db, emp).ok) throw new HttpError(403, "forbidden", "Online check-in isn't on for you");
    const reason = String((await readJson(req)).reason || "").trim().slice(0, 300);
    if (!reason) throw bad("reason", "Say why you're staying after your working hours");
    const today = ctx.today(), last = db.prepare("SELECT kind FROM att_checkins WHERE employee_id=? AND substr(at,1,10)=? ORDER BY at DESC, id DESC LIMIT 1").get(emp.id, today);
    if (!last || last.kind !== "in") throw new HttpError(409, "not_checked_in", "You haven't checked in today");
    const shift = shiftFor(db, emp, today), open = openExtra(db, emp.id, today);
    const r = open
      ? (db.prepare("UPDATE leave_requests SET reason=? WHERE id=?").run(reason, open.id), db.prepare("SELECT * FROM leave_requests WHERE id=?").get(open.id))
      : fileForPerson(ctx, emp, sess.user.id, { type: "overtime", start_date: today, end_date: today, early_time: pad2(shift.end), end_time: null, minutes: 0, reason, details: { source: "staying" } });
    db.prepare("INSERT OR IGNORE INTO att_reminders(employee_id,date,kind,sent_at) VALUES(?,?,?,?)").run(emp.id, today, "stay", nowIso());
    send(req, res, 200, { request: { id: r.id } });
  });

  // ---- check-ins outside the work sites: the manager approves or rejects (HR/Admin can too; never one's own)
  // ---- the online check-in log: one row per person per day (first check-in, last check-out), for HR, top management,
  // Accounts and the consultant (everyone), or an approver (their departments and the people who report to them)
  const LOG_ALL = ["hr", "admin", "ceo", "chairman", "consultant", "accounts"];
  api.get("/api/attendance/checkins", (req, res) => {
    const sess = req.sess, q = req.query, today = ctx.today();
    const mineDepts = approvedDepartments(db, sess.employee && sess.employee.id);
    const all = LOG_ALL.includes(sess.user.role);
    if (!all && !mineDepts.length && !(sess.employee && db.prepare("SELECT 1 FROM employees WHERE manager_employee_id=?").get(sess.employee.id)))
      throw new HttpError(403, "forbidden", "You do not have permission for this");
    const from = q.get("from") || today.slice(0, 8) + "01", to = q.get("to") || today;
    if (!isIsoDate(from) || !isIsoDate(to) || to < from) throw new HttpError(400, "invalid", "Choose a valid period");
    if (addDays(from, 400) < to) throw new HttpError(400, "invalid", "At most about a year at a time");
    const where = ["substr(c.at,1,10) BETWEEN ? AND ?"], args = [from, to];
    if (!all) {
      where.push(`(e.manager_employee_id=? ${mineDepts.length ? `OR e.department_id IN (${mineDepts.map(() => "?").join(",")})` : ""})`);
      args.push(sess.employee.id, ...mineDepts);
    }
    if (Number(q.get("dept"))) { where.push("e.department_id=?"); args.push(Number(q.get("dept"))); }
    if (Number(q.get("emp"))) { where.push("e.id=?"); args.push(Number(q.get("emp"))); }
    const list = db.prepare(`SELECT c.*, e.emp_no, e.name_ar, e.name_en, d.name_ar dept_ar, d.name_en dept_en FROM att_checkins c
      JOIN employees e ON e.id=c.employee_id LEFT JOIN departments d ON d.id=e.department_id
      WHERE ${where.join(" AND ")} ORDER BY c.at, c.id`).all(...args);
    const sites = sitesNow(), siteName = (id) => sites.find((x) => x.id === id) || null;
    const one = (c) => c && { id: c.id, time: c.at.slice(11, 16), site: c.site_id ? { name_ar: (siteName(c.site_id) || {}).name_ar || null, name_en: (siteName(c.site_id) || {}).name_en || null } : null,
      outside: !!c.outside, reason: c.reason || null, approval: c.approval || null, decision_note: c.decision_note || null,
      photo_file_id: c.photo_file_id || null, lat: c.lat, lng: c.lng, accuracy: c.accuracy_m };
    const byKey = new Map();
    for (const c of list) {
      const k = `${c.employee_id}|${c.at.slice(0, 10)}`;
      if (!byKey.has(k)) byKey.set(k, { employee: { id: c.employee_id, emp_no: c.emp_no, name_ar: c.name_ar, name_en: c.name_en, dept_ar: c.dept_ar, dept_en: c.dept_en }, date: c.at.slice(0, 10), all: [] });
      byKey.get(k).all.push(c);
    }
    const toMin = (at) => Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16));
    const rows = [...byKey.values()].map((r) => {
      const inn = r.all.find((c) => c.kind === "in"), out = [...r.all].reverse().find((c) => c.kind === "out");
      return { employee: r.employee, date: r.date, in: one(inn), out: one(out), count: r.all.length,
        minutes: inn && out && out.at > inn.at ? toMin(out.at) - toMin(inn.at) : null };
    }).sort((a, b) => (a.date === b.date ? String(a.employee.name_ar || a.employee.name_en).localeCompare(String(b.employee.name_ar || b.employee.name_en), "ar") : a.date < b.date ? 1 : -1));
    if (q.get("format") === "csv") {
      const place = (x) => (!x ? "" : x.outside ? `Outside the work sites${x.reason ? ` — ${x.reason}` : ""}` : (x.site && (x.site.name_en || x.site.name_ar)) || "");
      const appr = (x) => (x && x.approval ? { pending: "Awaiting manager", approved: "Approved", rejected: "Rejected" }[x.approval] : "");
      const map = (x) => (x && x.lat !== null && x.lat !== undefined ? `https://maps.google.com/?q=${x.lat},${x.lng}` : "");
      const lines = [["Date", "Employee ID", "Name (Arabic)", "Name (English)", "Department", "Check-in", "Check-in place", "Check-in approval", "Check-in map",
        "Check-out", "Check-out place", "Check-out approval", "Check-out map", "Hours", "Check-ins that day"].join(",")];
      for (const r of rows) lines.push([r.date, r.employee.emp_no, r.employee.name_ar, r.employee.name_en, r.employee.dept_en || r.employee.dept_ar || "",
        r.in ? r.in.time : "", place(r.in), appr(r.in), map(r.in), r.out ? r.out.time : "", place(r.out), appr(r.out), map(r.out),
        r.minutes === null ? "" : (r.minutes / 60).toFixed(2), r.count].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
      return sendRaw(req, res, 200, Buffer.from("\ufeff" + lines.join("\r\n"), "utf8"), "text/csv; charset=utf-8",
        { "Content-Disposition": `attachment; filename="online-checkins-${from}-to-${to}.csv"`, "Cache-Control": "no-store" });
    }
    send(req, res, 200, { from, to, rows });
  });

  api.get("/api/attendance/checkins/pending", (req, res) => {
    const items = db.prepare(`SELECT c.*, e.emp_no, e.name_ar, e.name_en, e.photo_file_id emp_photo FROM att_checkins c JOIN employees e ON e.id=c.employee_id
      WHERE c.approval='pending' ORDER BY c.at`).all().filter((c) => mayDecideCheckin(db, req.sess, c));
    const sites = getSetting(db, "att_sites", []);
    send(req, res, 200, { items: items.map((c) => ({ ...c, nearest: siteOf(sites, c).nearest, distance: c.lat === null ? null : siteOf(sites, c).distance })) });
  });
  for (const action of ["approve", "reject"]) api.post(`/api/attendance/checkins/:id/${action}`, async (req, res) => {
    const sess = req.sess;
    const b = await readJson(req);
    const note = String(b.note || "").trim().slice(0, 300);
    const c = db.prepare("SELECT * FROM att_checkins WHERE id=?").get(Number(req.params.id));
    if (!c) throw new HttpError(404, "not_found", "Not found");
    if (!mayDecideCheckin(db, sess, c)) throw new HttpError(403, "forbidden", "You do not have permission for this");
    if (c.approval !== "pending") throw new HttpError(409, "not_pending", "This has already been decided");
    if (action === "reject" && !note) throw bad("note", "Please give a reason");
    const approval = action === "approve" ? "approved" : "rejected";
    tx(db, () => {
      db.prepare("UPDATE att_checkins SET approval=?, decided_by=?, decided_at=?, decision_note=? WHERE id=?").run(approval, sess.user.id, nowIso(), note || null, c.id);
      audit(db, sess.user.id, `checkin.${action}`, "employee", c.employee_id, { id: c.id, approval: c.approval }, { id: c.id, approval, note });
    });
    const owner = (db.prepare("SELECT id FROM users WHERE employee_id=? AND active=1").get(c.employee_id) || {}).id;
    if (owner) notify(ctx, [owner], { title_ar: approval === "approved" ? "تمت الموافقة على تسجيلك خارج مواقع العمل" : "رُفض تسجيلك خارج مواقع العمل",
      title_en: approval === "approved" ? "Your check-in outside the work sites was approved" : "Your check-in outside the work sites was rejected",
      body_ar: `${c.at}${note ? ` — ${note}` : ""}`, body_en: `${c.at}${note ? ` — ${note}` : ""}`, link: `#/attendance?m=${c.at.slice(0, 7)}` });
    send(req, res, 200, { ok: true, approval });
  });
}
