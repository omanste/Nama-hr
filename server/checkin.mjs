/* Online check-in / check-out from the portal (phone, tablet or computer). Each one records the server's time (Muscat),
 * where the person was (the device's location and its accuracy; the nearest work site from Settings) and who it was
 * (a photo taken live with the camera). Outside every site it's still allowed, with a reason, and the manager is told.
 * The check-ins are punches for the same attendance engine as the fingerprint machine (see employeeDays). */
import fs from "node:fs";
import path from "node:path";
import { tx, nowIso, getSetting } from "./db.mjs";
import { send, readJson, HttpError } from "./http.mjs";
import { audit } from "./audit.mjs";
import { notify } from "./notify.mjs";
import { storeUpload } from "./files.mjs";
import { attendanceExempt } from "./attendance.mjs";
import { approvedDepartments } from "./perm.mjs";

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

/** May this person check in online? Not the CEO/Chairman (outside the policy), not someone on the fingerprint machine only. */
export function canCheckIn(db, emp) {
  if (!emp) return { ok: false, why: "no_profile" };
  if (attendanceExempt(db).includes(emp.id)) return { ok: false, why: "exempt" };
  if ((emp.att_mode || "both") === "machine") return { ok: false, why: "machine_only" };
  return { ok: true };
}

/** Who approves a person's check-in outside the work sites: their direct manager, else their department's approver. */
export function approversOf(db, emp) {
  const dept = emp.department_id && db.prepare("SELECT approver_employee_id FROM departments WHERE id=?").get(emp.department_id);
  return [emp.manager_employee_id, dept && dept.approver_employee_id].filter((id) => id && id !== emp.id)
    .map((id) => (db.prepare("SELECT id FROM users WHERE employee_id=? AND active=1").get(id) || {}).id).filter(Boolean).slice(0, 1);
}
/** May this session approve or reject this check-in? The person's manager or department approver, HR or Admin — never one's own. */
export function mayDecideCheckin(db, sess, c) {
  if (sess.employee && sess.employee.id === c.employee_id) return false;
  if (["hr", "admin"].includes(sess.user.role)) return true;
  if (!sess.employee) return false;
  const emp = db.prepare("SELECT manager_employee_id, department_id FROM employees WHERE id=?").get(c.employee_id);
  return !!emp && (emp.manager_employee_id === sess.employee.id || approvedDepartments(db, sess.employee.id).includes(emp.department_id));
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
  for (const c of old) fs.rmSync(path.join(ctx.dataDir, "uploads", String(c.photo_file_id)), { force: true });
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
  const today = (sess) => db.prepare("SELECT c.id, c.kind, c.at, c.site_id, c.outside, c.reason FROM att_checkins c WHERE c.employee_id=? AND substr(c.at,1,10)=? ORDER BY c.at, c.id")
    .all(sess.employee.id, ctx.today());

  // the home page card: may I check in, have I accepted the notice, what did I record today
  api.get("/api/attendance/checkin/today", (req, res) => {
    const sess = req.sess;
    const may = canCheckIn(db, sess.employee);
    if (!may.ok) return send(req, res, 200, { enabled: false, why: may.why });
    const items = today(sess);
    const sites = sitesNow();
    send(req, res, 200, { enabled: true, consent: !!sess.user.checkin_consent_at, items: items.map((c) => ({ ...c, site: sites.find((s) => s.id === c.site_id) || null })),
      next: items.length && items[items.length - 1].kind === "in" ? "out" : "in", sites: sites.length });
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
    const photo = await storeUpload(ctx, req, { employeeId: emp.id, kind: "checkin" });
    const at = `${ctx.today()} ${ctx.clock()}`;
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
    send(req, res, 201, { checkin: { id: row.id, kind: row.kind, at: row.at, outside: !!row.outside, approval: row.approval, site: where.inside } });
  });

  // ---- check-ins outside the work sites: the manager approves or rejects (HR/Admin can too; never one's own)
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
