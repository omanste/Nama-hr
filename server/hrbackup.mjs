/* HR backup & restore (Admin only). Unlike the whole-portal .db backup (backup.mjs), this one is readable and
 * selective: a .zip with backup.json (sections) and a files/ folder, or a settings-only .json. Records are written
 * with stable keys (staff ID, username, department name, file hash) instead of database ids, so a backup can be
 * merged into another portal: nothing is duplicated, existing records are updated, and passwords, sessions, passkeys,
 * push keys and tokens are never in it. Restoring shows a preview first (the same code, rolled back), saves the
 * current HR state, then applies only the sections Admin ticked. Attendance, balances and reports are computed from
 * these records whenever they are read, so they are up to date as soon as a restore is done. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { nowIso, setSetting, clearSettingsCache } from "./db.mjs";
import { send, sendRaw, readBody, readJson, HttpError } from "./http.mjs";
import { audit } from "./audit.mjs";
import { hashPassword } from "./auth.mjs";
import { normEmpNo } from "./employees.mjs";
import { makeZip, readZip } from "./zip.mjs";

export const VERSION = 1;
export const SECTIONS = ["settings", "staff", "attendance", "requests", "calendar", "documents"];
const START_PASSWORD = "2026";
// never in a backup: secrets and the jobs' own bookkeeping
const SECRET_OR_STATE = /^(push_vapid|attendance_week_sent|birthday_notified|expiry_notified|monthly_summary_sent|id_reread_last)$|_(sent|notified|last|secret|token|key)$/;
// these settings belong with the calendar section (holidays, Ramadan, the shift times)
const CALENDAR_KEYS = /^(official_holidays|national_hidden|national_hidden_dates|ramadan_start|ramadan_end|ramadan_hours|shift_[1-4]_(start|end))$/;
const EMP_SETTINGS = ["managers_approver_employee_id", "chairman_employee_id"]; // hold a staff id → written as the staff ID
const REST_DAYS = ["friday", "saturday"];

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const stamp = (d = new Date()) => { const m = new Date(d.getTime() + 4 * 3600e3).toISOString(); return `${m.slice(0, 10)}-${m.slice(11, 13)}${m.slice(14, 16)}`; }; // Muscat time
const parse = (x) => { try { return JSON.parse(x); } catch { return x; } };

/* ------------------------------------------------------------------ export ------------------------------------------------------------------ */

/** Everything an HR backup holds, from this portal's database: { header, sections, files: Map(path → Buffer) }. */
export function buildBackup(ctx, { type = "full", photos = false, by = null } = {}) {
  const { db } = ctx;
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const empNo = new Map(all("SELECT id, emp_no FROM employees").map((e) => [e.id, e.emp_no]));
  const userName = new Map(all("SELECT id, username FROM users").map((u) => [u.id, u.username]));
  const deptName = new Map(all("SELECT id, name_ar, name_en FROM departments").map((d) => [d.id, d.name_ar || d.name_en]));
  const E = (id) => (id ? empNo.get(id) || null : null), U = (id) => (id ? userName.get(id) || null : null), D = (id) => (id ? deptName.get(id) || null : null);
  const R = (id) => (id ? `req:${id}` : null), F = (id) => (id ? `file:${id}` : null);
  const without = (row, ...cols) => { const o = { ...row }; for (const c of cols) delete o[c]; return o; };
  const settingsRows = all("SELECT key, value FROM settings").filter((r) => !SECRET_OR_STATE.test(r.key));
  const settingValue = (r) => (EMP_SETTINGS.includes(r.key) ? E(Number(parse(r.value))) : parse(r.value));
  const sections = {};

  sections.settings = {
    settings: Object.fromEntries(settingsRows.filter((r) => !CALENDAR_KEYS.test(r.key)).map((r) => [r.key, settingValue(r)])),
    departments: all("SELECT * FROM departments ORDER BY id").map((d) => ({ ...without(d, "id", "approver_employee_id"), approver: E(d.approver_employee_id) })),
  };
  if (type === "settings") return finish(ctx, { type, by, sections, files: new Map() });

  sections.staff = {
    employees: all("SELECT * FROM employees ORDER BY id").map((e) => ({ ...without(e, "id", "department_id", "manager_employee_id", "photo_file_id"),
      department: D(e.department_id), manager: E(e.manager_employee_id), photo: F(e.photo_file_id) })),
    // the sign-in accounts — never the password, the Microsoft link or the passkeys
    users: all("SELECT username, employee_id, role, active, lang, auth_provider, created_at, checkin_consent_at FROM users ORDER BY id")
      .map((u) => ({ ...without(u, "employee_id"), employee: E(u.employee_id) })),
    cover: all("SELECT * FROM approver_cover ORDER BY id").map((c) => ({ ...without(c, "id", "approver_user_id", "deputy_user_id", "created_by", "request_id"),
      approver: U(c.approver_user_id), deputy: U(c.deputy_user_id), created_by: U(c.created_by), request: R(c.request_id) })),
  };
  sections.attendance = {
    checkins: all("SELECT * FROM att_checkins ORDER BY id").map((c) => ({ ...without(c, "id", "employee_id", "decided_by", "flag_by", "photo_file_id"),
      employee: E(c.employee_id), decided_by: U(c.decided_by), flag_by: U(c.flag_by), photo: photos ? F(c.photo_file_id) : null })),
    machine_numbers: all("SELECT * FROM att_devices").map((d) => ({ ...without(d, "employee_id"), employee: E(d.employee_id) })),
    punches: all("SELECT machine_no, at FROM att_punches ORDER BY id"),
    uploads: all("SELECT name, rows, added, from_date, to_date, uploaded_by, uploaded_at FROM att_uploads ORDER BY id").map((u) => ({ ...u, uploaded_by: U(u.uploaded_by) })),
    reviews: all("SELECT * FROM att_reviews ORDER BY id").map((r) => ({ ...without(r, "id", "employee_id", "user_id"), employee: E(r.employee_id), user: U(r.user_id) })),
  };
  sections.requests = {
    requests: all("SELECT * FROM leave_requests ORDER BY id").map((r) => ({ ...without(r, "id", "employee_id", "approver_user_id", "decided_by", "created_by", "hr_by", "first_approved_by", "alt_approver_user_id"),
      key: R(r.id), employee: E(r.employee_id), approver: U(r.approver_user_id), decided_by: U(r.decided_by), created_by: U(r.created_by), hr_by: U(r.hr_by),
      first_approved_by: U(r.first_approved_by), alt_approver: U(r.alt_approver_user_id) })),
    events: all("SELECT * FROM request_events ORDER BY id").map((e) => ({ ...without(e, "id", "request_id", "actor_user_id"), request: R(e.request_id), actor: U(e.actor_user_id) })),
    ledger: all("SELECT * FROM leave_ledger ORDER BY id").map((l) => ({ ...without(l, "id", "employee_id", "request_id", "created_by", "file_id"),
      employee: E(l.employee_id), request: R(l.request_id), created_by: U(l.created_by), file: F(l.file_id) })),
    cap_reviews: all("SELECT * FROM cap_reviews ORDER BY id").map((c) => ({ ...without(c, "id", "employee_id", "decided_by"), employee: E(c.employee_id), decided_by: U(c.decided_by) })),
  };
  sections.calendar = {
    events: all("SELECT * FROM calendar_events ORDER BY id").map((c) => ({ ...without(c, "id", "created_by"), created_by: U(c.created_by) })),
    settings: Object.fromEntries(settingsRows.filter((r) => CALENDAR_KEYS.test(r.key)).map((r) => [r.key, parse(r.value)])),
    weekend: REST_DAYS,
    shifts: all("SELECT emp_no, shift, shift_locked FROM employees ORDER BY id"),
    // for reading only (they are restored with the requests): approved leave and external task dates
    approved: all("SELECT e.emp_no, r.type, r.start_date, r.end_date FROM leave_requests r JOIN employees e ON e.id=r.employee_id WHERE r.status='approved' ORDER BY r.start_date"),
  };
  // documents and attachments: always in a full backup; the check-in photos only when asked (they're many and large)
  const files = new Map(), docs = [];
  const up = (id) => path.join(ctx.dataDir, "uploads", String(id));
  for (const f of all(`SELECT * FROM files WHERE voice_id IS NULL ${photos ? "" : "AND kind<>'checkin'"} ORDER BY id`)) {
    if (!fs.existsSync(up(f.id))) continue;
    const data = fs.readFileSync(up(f.id)), hash = sha(data), ext = (path.extname(f.name || "") || "").slice(0, 8).replace(/[^.a-z0-9]/gi, "");
    const p = `files/${hash}${ext}`;
    files.set(p, data);
    docs.push({ ...without(f, "id", "employee_id", "request_id", "uploaded_by", "replaced_by", "voice_id"), key: F(f.id), employee: E(f.employee_id), request: R(f.request_id),
      uploaded_by: U(f.uploaded_by), replaced_by: F(f.replaced_by), sha256: hash, path: p });
  }
  sections.documents = { files: docs, checkin_photos: photos };
  return finish(ctx, { type, by, sections, files });
}

function finish(ctx, { type, by, sections, files }) {
  const counts = {};
  for (const [s, v] of Object.entries(sections)) {
    counts[s] = { records: Object.values(v).reduce((n, x) => n + (Array.isArray(x) ? x.length : x && typeof x === "object" ? Object.keys(x).length : 0), 0) };
    if (s === "documents") counts[s].files = files.size;
  }
  const header = { app: "nama-hr", kind: "hr-backup", type: type === "settings" ? "settings" : "full", type_label: type === "settings" ? "Settings only · الإعدادات فقط" : "HR full · نسخة كاملة للموارد البشرية",
    version: VERSION, schema: ctx.db.prepare("SELECT max(version) v FROM schema_migrations").get().v, env: ctx.appEnv, created_by: by, created_at: nowIso(), counts };
  return { header, sections, files };
}

/** The backup as a file: a .zip (backup.json + files/) or, for settings only, a .json. */
export function backupFile(ctx, opts) {
  const b = buildBackup(ctx, opts);
  const json = JSON.stringify({ header: b.header, ...b.sections }, null, 1);
  const when = stamp();
  if (b.header.type === "settings") return { name: `nama-hr-settings-${ctx.appEnv}-${when}.json`, body: Buffer.from(json, "utf8"), mime: "application/json", header: b.header };
  const body = makeZip([{ name: "backup.json", data: json }, ...[...b.files].map(([name, data]) => ({ name, data }))]);
  return { name: `nama-hr-full-${ctx.appEnv}-${when}.zip`, body, mime: "application/zip", header: b.header };
}

/** Read an uploaded backup (.zip or .json) → { header, sections, files }. */
export function readBackup(buf) {
  let json, files = new Map();
  if (buf.subarray(0, 4).toString("latin1") === "PK\u0003\u0004") {
    let z;
    try { z = readZip(buf); } catch { throw new HttpError(400, "invalid", "This file can't be read as a zip"); }
    if (!z.has("backup.json")) throw new HttpError(400, "invalid", "This zip has no backup.json — it isn't an HR backup");
    json = z.get("backup.json").toString("utf8");
    for (const [k, v] of z) if (k.startsWith("files/")) files.set(k, v);
  } else json = buf.toString("utf8").replace(/^﻿/, "");
  let o;
  try { o = JSON.parse(json); } catch { throw new HttpError(400, "invalid", "This is not an HR backup file"); }
  if (!o || !o.header || o.header.kind !== "hr-backup") throw new HttpError(400, "invalid", "This is not an HR backup file");
  if (o.header.version > VERSION) throw new HttpError(400, "invalid", "This backup was made by a newer version of the portal");
  const { header, ...sections } = o;
  return { header, sections, files };
}

/* ------------------------------------------------------------------ restore ------------------------------------------------------------------ */

/** Restore the ticked sections of a backup into this portal. With dryRun the same work is done inside a transaction
 * that is rolled back, so the preview's counts are exactly what applying would do. */
export function restoreBackup(ctx, b, { sections: chosen, dryRun = false, by = null }) {
  const { db } = ctx;
  const S = b.sections, pick = new Set((chosen || []).filter((s) => SECTIONS.includes(s) && S[s]));
  const out = Object.fromEntries([...pick].map((s) => [s, { added: 0, changed: 0, unchanged: 0, skipped: 0 }]));
  const skipped = []; // [{section, what, why}]
  const pendingFiles = []; // [id, Buffer] written only when applied
  const tally = (sec, r) => { if (out[sec]) out[sec][r]++; };
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const rawSetting = (k) => { const r = one("SELECT value FROM settings WHERE key=?", k); return r ? JSON.parse(r.value) : undefined; };
  const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
  /** Insert or update one row; returns [id, result]. `row` holds only real columns. */
  function upsert(sec, table, existing, row, idCol = "id") {
    const have = cols(table), r = Object.fromEntries(Object.entries(row).filter(([k, v]) => have.has(k) && v !== undefined));
    if (existing) {
      const diff = Object.keys(r).filter((k) => String(existing[k] ?? "") !== String(r[k] ?? ""));
      if (diff.length) { db.prepare(`UPDATE ${table} SET ${diff.map((k) => `"${k}"=?`).join(",")} WHERE "${idCol}"=?`).run(...diff.map((k) => r[k]), existing[idCol]); tally(sec, "changed"); }
      else tally(sec, "unchanged");
      return [existing[idCol], diff.length ? "changed" : "unchanged"];
    }
    const k = Object.keys(r);
    const res = db.prepare(`INSERT INTO ${table}(${k.map((x) => `"${x}"`).join(",")}) VALUES(${k.map(() => "?").join(",")})`).run(...k.map((x) => r[x]));
    tally(sec, "added");
    return [Number(res.lastInsertRowid), "added"];
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    // ---- staff: who is who here (staff ID first, then e-mail, then the Arabic name; two possible matches → skipped)
    const people = (S.staff && S.staff.employees) || [];
    const emps = db.prepare("SELECT id, emp_no, email, name_ar FROM employees").all();
    const empMap = new Map(); // backup staff ID → id here
    const match = (p) => {
      let m = emps.filter((e) => normEmpNo(e.emp_no).toUpperCase() === normEmpNo(p.emp_no).toUpperCase());
      if (!m.length && p.email) m = emps.filter((e) => e.email && e.email.toLowerCase() === String(p.email).toLowerCase());
      if (!m.length && p.name_ar) m = emps.filter((e) => e.name_ar && e.name_ar.trim() === String(p.name_ar).trim());
      return m.length === 1 ? m[0] : m.length > 1 ? "ambiguous" : null;
    };
    const ambiguous = new Set();
    for (const p of people) { const m = match(p); if (m === "ambiguous") ambiguous.add(p.emp_no); else if (m) empMap.set(p.emp_no, m.id); }
    // the staff IDs other sections use, even without the staff section (matched by the staff ID alone)
    const empId = (no) => { if (!no) return null; if (empMap.has(no)) return empMap.get(no); if (ambiguous.has(no)) return null;
      const m = emps.filter((e) => normEmpNo(e.emp_no).toUpperCase() === normEmpNo(no).toUpperCase()); return m.length === 1 ? m[0].id : null; };
    const userId = (name) => (name ? (one("SELECT id FROM users WHERE username=?", name) || {}).id || null : null);
    const deptId = (name) => (name ? (one("SELECT id FROM departments WHERE name_ar=? OR name_en=?", name, name) || {}).id || null : null);
    const reqMap = new Map(), fileMap = new Map();
    const reqId = (k) => (k ? reqMap.get(k) ?? null : null), fileId = (k) => (k ? fileMap.get(k) ?? null : null);

    // ---- 1. settings and departments
    if (pick.has("settings")) {
      for (const d of S.settings.departments || []) {
        const ex = one("SELECT * FROM departments WHERE name_ar=? OR (name_ar='' AND name_en=?)", d.name_ar || "", d.name_en || "");
        upsert("settings", "departments", ex, { name_ar: d.name_ar, name_en: d.name_en, active: d.active });
      }
      for (const [k, v0] of Object.entries(S.settings.settings || {})) {
        if (SECRET_OR_STATE.test(k)) continue;
        const v = EMP_SETTINGS.includes(k) ? (v0 ? empId(v0) : null) : v0;
        if (EMP_SETTINGS.includes(k) && v0 && !v) { skipped.push({ section: "settings", what: k, why: `staff ${v0} not found` }); tally("settings", "skipped"); continue; }
        const cur = rawSetting(k);
        if (JSON.stringify(cur) === JSON.stringify(v)) tally("settings", "unchanged"); else { setSetting(db, k, v); tally("settings", cur === undefined ? "added" : "changed"); }
      }
    }
    // ---- 2. staff profiles and their accounts
    if (pick.has("staff")) {
      for (const p of people) {
        if (ambiguous.has(p.emp_no)) { skipped.push({ section: "staff", what: `${p.emp_no} ${p.name_ar || p.name_en || ""}`, why: "more than one possible match" }); tally("staff", "skipped"); continue; }
        const { department, manager, photo, ...row } = p;
        const ex = empMap.has(p.emp_no) ? one("SELECT * FROM employees WHERE id=?", empMap.get(p.emp_no)) : null;
        const now = nowIso();
        const [id] = upsert("staff", "employees", ex, { ...row, emp_no: ex ? ex.emp_no : normEmpNo(p.emp_no), department_id: deptId(department) ?? (ex ? ex.department_id : null),
          created_at: ex ? ex.created_at : row.created_at || now, updated_at: ex ? ex.updated_at : row.updated_at || now });
        empMap.set(p.emp_no, id);
      }
      // managers once everyone exists
      for (const p of people) if (p.manager && empMap.has(p.emp_no) && empId(p.manager)) db.prepare("UPDATE employees SET manager_employee_id=? WHERE id=?").run(empId(p.manager), empMap.get(p.emp_no));
      for (const d of (S.settings && S.settings.departments) || []) if (d.approver && empId(d.approver)) db.prepare("UPDATE departments SET approver_employee_id=? WHERE name_ar=? OR (name_ar='' AND name_en=?)").run(empId(d.approver), d.name_ar || "", d.name_en || "");
      for (const u of S.staff.users || []) {
        const emp = empId(u.employee);
        const ex = one("SELECT * FROM users WHERE username=?", u.username) || (emp ? one("SELECT * FROM users WHERE employee_id=?", emp) : null);
        if (ex) {
          // an existing account keeps its password; the role, language and active flag follow the backup — not the
          // account of the Admin doing the restore
          if (by && ex.id === by.id) { tally("staff", "unchanged"); continue; }
          upsert("staff", "users", ex, { role: u.role, active: u.active, lang: u.lang, employee_id: ex.employee_id || emp, checkin_consent_at: ex.checkin_consent_at || u.checkin_consent_at });
        } else {
          // a new account: the starting password 2026, changed at the first sign-in (no data until then)
          const h = hashPassword(START_PASSWORD);
          upsert("staff", "users", null, { username: u.username, employee_id: emp, role: u.role, active: u.active, lang: u.lang || "ar", auth_provider: "local",
            pw_hash: h.hash, pw_salt: h.salt, pw_iter: h.iter, must_change: 1, created_at: u.created_at || nowIso(), checkin_consent_at: u.checkin_consent_at || null });
        }
      }
    }
    // ---- 6. documents (before requests and attendance, which point at them)
    if (pick.has("documents")) {
      for (const f of S.documents.files || []) {
        const emp = empId(f.employee);
        if (f.employee && !emp) { skipped.push({ section: "documents", what: `${f.employee} · ${f.name}`, why: "staff not found" }); tally("documents", "skipped"); continue; }
        const data = b.files.get(f.path);
        if (!data || sha(data) !== f.sha256) { skipped.push({ section: "documents", what: f.name, why: "file missing or damaged in the backup" }); tally("documents", "skipped"); continue; }
        // the same document (staff + type + content) is never added twice
        const same = db.prepare("SELECT * FROM files WHERE coalesce(employee_id,0)=? AND coalesce(doc_type,'')=? AND kind=? AND size=?").all(emp || 0, f.doc_type || "", f.kind, data.length)
          .find((x) => { const p = path.join(ctx.dataDir, "uploads", String(x.id)); return fs.existsSync(p) && sha(fs.readFileSync(p)) === f.sha256; });
        const { key, employee, request, uploaded_by, replaced_by, sha256, path: _p, ...row } = f;
        const [id, r] = upsert("documents", "files", same, { ...row, employee_id: emp, uploaded_by: userId(uploaded_by) ?? (same ? same.uploaded_by : null) });
        fileMap.set(key, id);
        if (r === "added") pendingFiles.push([id, data]);
      }
      for (const f of S.documents.files || []) if (f.replaced_by && fileMap.has(f.key) && fileMap.has(f.replaced_by)) db.prepare("UPDATE files SET replaced_by=? WHERE id=?").run(fileMap.get(f.replaced_by), fileMap.get(f.key));
      // profile photos
      for (const p of people) if (p.photo && fileMap.has(p.photo) && empId(p.emp_no)) db.prepare("UPDATE employees SET photo_file_id=? WHERE id=?").run(fileMap.get(p.photo), empId(p.emp_no));
    } else for (const f of (S.documents && S.documents.files) || []) { // links to documents already here (same staff, type and content)
      const emp = empId(f.employee);
      const ex = db.prepare("SELECT id FROM files WHERE coalesce(employee_id,0)=? AND coalesce(doc_type,'')=? AND kind=? AND name=?").get(emp || 0, f.doc_type || "", f.kind, f.name);
      if (ex) fileMap.set(f.key, ex.id);
    }
    // ---- 4. requests
    if (pick.has("requests") || pick.has("staff")) {
      // requests are matched by the person, type, dates and when they were made (the same request on both portals)
      const findReq = (r, emp) => one("SELECT * FROM leave_requests WHERE employee_id=? AND type=? AND start_date=? AND end_date=? AND created_at=?", emp, r.type, r.start_date, r.end_date, r.created_at);
      for (const r of (S.requests && S.requests.requests) || []) {
        const emp = empId(r.employee);
        if (!emp) { if (pick.has("requests")) { skipped.push({ section: "requests", what: `${r.employee} · ${r.type} ${r.start_date}`, why: "staff not found" }); tally("requests", "skipped"); } continue; }
        const ex = findReq(r, emp);
        if (!pick.has("requests")) { if (ex) reqMap.set(r.key, ex.id); continue; }
        const { key, employee, approver, decided_by, created_by, hr_by, first_approved_by, alt_approver, ...row } = r;
        const [id] = upsert("requests", "leave_requests", ex, { ...row, employee_id: emp, approver_user_id: userId(approver), decided_by: userId(decided_by), created_by: userId(created_by),
          hr_by: userId(hr_by), first_approved_by: userId(first_approved_by), alt_approver_user_id: userId(alt_approver) });
        reqMap.set(key, id);
      }
    }
    if (pick.has("requests")) {
      for (const e of S.requests.events || []) {
        const rid = reqId(e.request); if (!rid) continue;
        const ex = one("SELECT * FROM request_events WHERE request_id=? AND action=? AND at=?", rid, e.action, e.at);
        upsert("requests", "request_events", ex, { request_id: rid, action: e.action, actor_user_id: userId(e.actor), at: e.at, comment: e.comment });
      }
      for (const l of S.requests.ledger || []) {
        const emp = empId(l.employee); if (!emp) continue;
        const ex = one("SELECT * FROM leave_ledger WHERE employee_id=? AND kind=? AND effective_date IS ? AND minutes=? AND created_at=?", emp, l.kind, l.effective_date, l.minutes, l.created_at);
        const { employee, request, created_by, file, ...row } = l;
        upsert("requests", "leave_ledger", ex, { ...row, employee_id: emp, request_id: reqId(request), created_by: userId(created_by), file_id: fileId(file) });
      }
      for (const c of S.requests.cap_reviews || []) {
        const emp = empId(c.employee); if (!emp) continue;
        const ex = one("SELECT * FROM cap_reviews WHERE employee_id=? AND year_start=?", emp, c.year_start);
        const { employee, decided_by, ...row } = c;
        upsert("requests", "cap_reviews", ex, { ...row, employee_id: emp, decided_by: userId(decided_by) });
      }
      // request attachments point at their request
      if (pick.has("documents")) for (const f of S.documents.files || []) if (f.request && fileMap.has(f.key) && reqId(f.request)) db.prepare("UPDATE files SET request_id=? WHERE id=?").run(reqId(f.request), fileMap.get(f.key));
    }
    if (pick.has("staff")) for (const c of S.staff.cover || []) {
      const a = userId(c.approver), d = userId(c.deputy); if (!a || !d) continue;
      const ex = one("SELECT * FROM approver_cover WHERE approver_user_id=? AND deputy_user_id=? AND start_date=?", a, d, c.start_date);
      const { approver, deputy, created_by, request, ...row } = c;
      upsert("staff", "approver_cover", ex, { ...row, approver_user_id: a, deputy_user_id: d, created_by: userId(created_by), request_id: reqId(request) });
    }
    // ---- 3. attendance: check-ins by person + date and time + in/out; machine punches by number + time
    if (pick.has("attendance")) {
      const A = S.attendance;
      for (const u of A.uploads || []) {
        const ex = one("SELECT * FROM att_uploads WHERE from_date=? AND to_date=? AND uploaded_at=?", u.from_date, u.to_date, u.uploaded_at);
        upsert("attendance", "att_uploads", ex, { ...u, uploaded_by: userId(u.uploaded_by) });
      }
      for (const d of A.machine_numbers || []) {
        const ex = one("SELECT * FROM att_devices WHERE machine_no=?", d.machine_no);
        const { employee, ...row } = d;
        upsert("attendance", "att_devices", ex, { ...row, employee_id: empId(employee) ?? (ex ? ex.employee_id : null) }, "machine_no");
      }
      const insP = db.prepare("INSERT OR IGNORE INTO att_punches(machine_no,at) VALUES(?,?)");
      for (const p of A.punches || []) tally("attendance", insP.run(p.machine_no, p.at).changes ? "added" : "unchanged");
      for (const c of A.checkins || []) {
        const emp = empId(c.employee);
        if (!emp) { skipped.push({ section: "attendance", what: `${c.employee} · ${c.at}`, why: "staff not found" }); tally("attendance", "skipped"); continue; }
        const ex = one("SELECT * FROM att_checkins WHERE employee_id=? AND at=? AND kind=?", emp, c.at, c.kind);
        const { employee, decided_by, flag_by, photo, ...row } = c;
        upsert("attendance", "att_checkins", ex, { ...row, employee_id: emp, decided_by: userId(decided_by), flag_by: userId(flag_by), photo_file_id: fileId(photo) ?? (ex ? ex.photo_file_id : null) });
      }
      for (const r of A.reviews || []) {
        const emp = empId(r.employee); if (!emp) continue;
        const ex = one("SELECT * FROM att_reviews WHERE employee_id=? AND month=?", emp, r.month);
        const { employee, user, ...row } = r;
        upsert("attendance", "att_reviews", ex, { ...row, employee_id: emp, user_id: userId(user) });
      }
    }
    // ---- 5. calendar: occasions by date + kind (+ name), holidays / Ramadan / shift times, each person's shift
    if (pick.has("calendar")) {
      const C = S.calendar;
      for (const e of C.events || []) {
        const ex = one("SELECT * FROM calendar_events WHERE start_date=? AND kind=? AND name=?", e.start_date, e.kind, e.name);
        upsert("calendar", "calendar_events", ex, { ...e, created_by: userId(e.created_by) });
      }
      for (const [k, v] of Object.entries(C.settings || {})) {
        if (!CALENDAR_KEYS.test(k)) continue;
        const cur = rawSetting(k);
        if (JSON.stringify(cur) === JSON.stringify(v)) tally("calendar", "unchanged"); else { setSetting(db, k, v); tally("calendar", cur === undefined ? "added" : "changed"); }
      }
      for (const s of C.shifts || []) {
        const id = empId(s.emp_no); if (!id) continue;
        upsert("calendar", "employees", one("SELECT id, shift, shift_locked FROM employees WHERE id=?", id), { shift: s.shift, shift_locked: s.shift_locked });
      }
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new HttpError(400, "invalid", "The backup's records don't fit together");
    if (dryRun) db.exec("ROLLBACK"); else db.exec("COMMIT");
  } catch (e) { try { db.exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
  finally { clearSettingsCache(db); } // a preview may have read settings it then rolled back
  if (!dryRun) {
    fs.mkdirSync(path.join(ctx.dataDir, "uploads"), { recursive: true });
    for (const [id, data] of pendingFiles) fs.writeFileSync(path.join(ctx.dataDir, "uploads", String(id)), data);
  }
  return { sections: out, skipped, header: b.header };
}

/* ------------------------------------------------------------------ API ------------------------------------------------------------------ */

const KEEP = 30; // backup files kept on the server for the history list
export function registerHrBackup(api, ctx) {
  const { db } = ctx;
  const dir = path.join(ctx.dataDir, "hr-backups");
  const admin = (sess) => { if (sess.user.role !== "admin") throw new HttpError(403, "forbidden", "Admin only"); };
  const record = (kind, type, sections, counts, file, by) => {
    const r = db.prepare("INSERT INTO hr_backups(kind,type,sections,counts,env,file,by_user_id,at) VALUES(?,?,?,?,?,?,?,?)")
      .run(kind, type, JSON.stringify(sections), JSON.stringify(counts), ctx.appEnv, file, by, nowIso());
    // keep the latest files only (the list itself stays)
    const old = db.prepare("SELECT id, file FROM hr_backups WHERE file IS NOT NULL ORDER BY id DESC LIMIT -1 OFFSET ?").all(KEEP);
    for (const o of old) { fs.rmSync(path.join(dir, o.file), { force: true }); db.prepare("UPDATE hr_backups SET file=NULL WHERE id=?").run(o.id); }
    return Number(r.lastInsertRowid);
  };
  const save = (f) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, f.name), f.body); return f.name; };

  // the two buttons: the full HR backup (zip) or the settings (json); the check-in photos only when asked
  api.get("/api/admin/hr-backup", (req, res) => {
    admin(req.sess);
    const type = req.query.get("type") === "settings" ? "settings" : "full";
    const f = backupFile(ctx, { type, photos: type === "full" && req.query.get("photos") === "1", by: req.sess.user.username });
    record("backup", type, type === "settings" ? ["settings"] : SECTIONS, f.header.counts, save(f), req.sess.user.id);
    audit(db, req.sess.user.id, "hr_backup.download", "settings", null, null, { type, file: f.name, counts: f.header.counts });
    sendRaw(req, res, 200, f.body, f.mime, { "Content-Disposition": `attachment; filename="${f.name}"`, "Cache-Control": "no-store" });
  });

  // restore, step 1: upload → what would change, per section (nothing is written)
  api.post("/api/admin/hr-backup/preview", async (req, res) => {
    admin(req.sess);
    const body = await readBody(req, 1024 * 1024 * 1024);
    const b = readBackup(body);
    const token = crypto.randomBytes(12).toString("hex");
    fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(dir, "uploads", token), body);
    const available = SECTIONS.filter((s) => b.sections[s]);
    const p = restoreBackup(ctx, b, { sections: available, dryRun: true, by: req.sess.user });
    send(req, res, 200, { token, header: b.header, available, preview: p.sections, skipped: p.skipped });
  });

  // restore, step 2: the ticked sections, typed RESTORE; the current HR state is saved first (to undo)
  api.post("/api/admin/hr-backup/restore", async (req, res) => {
    admin(req.sess);
    const b0 = await readJson(req);
    if (b0.confirm !== "RESTORE") throw Object.assign(new HttpError(400, "confirm", "Type RESTORE to confirm"), { field: "confirm" });
    if (!/^[a-f0-9]{24}$/.test(String(b0.token || ""))) throw new HttpError(400, "invalid", "Upload the backup again");
    const file = path.join(dir, "uploads", b0.token);
    if (!fs.existsSync(file)) throw new HttpError(400, "invalid", "Upload the backup again");
    const b = readBackup(fs.readFileSync(file));
    const sections = (Array.isArray(b0.sections) ? b0.sections : []).filter((s) => SECTIONS.includes(s) && b.sections[s]);
    if (!sections.length) throw Object.assign(new HttpError(400, "invalid", "Tick at least one section"), { field: "sections" });
    // the current HR state, to undo (full, with the check-in photos)
    const before = backupFile(ctx, { type: "full", photos: true, by: `${req.sess.user.username} (before restore)` });
    before.name = before.name.replace("nama-hr-full-", "nama-hr-before-restore-");
    const undoId = record("auto", "full", SECTIONS, before.header.counts, save(before), req.sess.user.id);
    const r = restoreBackup(ctx, b, { sections, by: req.sess.user });
    fs.rmSync(file, { force: true });
    const summary = { from_env: b.header.env, made_at: b.header.created_at, type: b.header.type, sections, result: r.sections, skipped: r.skipped.length, undo_backup: undoId };
    record("restore", b.header.type, sections, r.sections, null, req.sess.user.id);
    audit(db, req.sess.user.id, "hr_backup.restore", "settings", null, null, summary);
    send(req, res, 200, { ok: true, ...summary, skipped_items: r.skipped });
  });

  // history: backups made, restores done (who, when, environment, type, sections, counts), with download
  api.get("/api/admin/hr-backup/history", (req, res) => {
    admin(req.sess);
    const items = db.prepare("SELECT h.*, u.username FROM hr_backups h LEFT JOIN users u ON u.id=h.by_user_id ORDER BY h.id DESC LIMIT 100").all()
      .map((h) => ({ ...h, sections: JSON.parse(h.sections || "[]"), counts: JSON.parse(h.counts || "{}"), downloadable: !!(h.file && fs.existsSync(path.join(dir, h.file))) }));
    send(req, res, 200, { items });
  });
  api.get("/api/admin/hr-backup/history/:id/download", (req, res) => {
    admin(req.sess);
    const h = db.prepare("SELECT * FROM hr_backups WHERE id=?").get(Number(req.params.id));
    if (!h || !h.file || !fs.existsSync(path.join(dir, h.file))) throw new HttpError(404, "not_found", "This backup file is no longer kept");
    sendRaw(req, res, 200, fs.readFileSync(path.join(dir, h.file)), h.file.endsWith(".json") ? "application/json" : "application/zip",
      { "Content-Disposition": `attachment; filename="${h.file}"`, "Cache-Control": "no-store" });
  });
}
