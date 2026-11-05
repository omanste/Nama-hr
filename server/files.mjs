/* Photos and documents: stored in DATA_DIR/uploads/<id>, served only to people allowed to see the employee. */
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { nowIso, tx, getSetting, setSetting } from "./db.mjs";
import { send, sendRaw, readBody, readJson, HttpError } from "./http.mjs";
import { can, canViewEmployee } from "./perm.mjs";
import { audit } from "./audit.mjs";
import { isIsoDate } from "./leave.mjs";
import { getEmployee } from "./employees.mjs";
import { deputyOf } from "./requests.mjs";
import { readDocument, readPdf } from "./idread.mjs";
import { toArabicName, completeArabicName } from "./names-ar.mjs";
import { canReadVoice } from "./voice.mjs";
import { canSeeAttendance } from "./attendance.mjs";
import { runExpiryCheck } from "./jobs.mjs";
import { recordSelfChange } from "./profile-changes.mjs";
import { cleanEmployee } from "./employees.mjs";

export const MAX_FILE = 10 * 1024 * 1024;
const IMAGES = ["image/jpeg", "image/png", "image/webp"];
const DOCS = [...IMAGES, "application/pdf"];
export const DOC_TYPES = ["civil_id", "passport", "visa", "resume", "certificate", "course", "contract", "medical", "consent", "other"];
// what staff may upload to their own profile (a copy of their contract too); payout consents stay with HR. Only HR deletes.
const READABLE = ["civil_id", "passport", "visa"];
export const RENEWABLE = ["civil_id", "passport", "visa"];
const pick = (e) => ({ civil_id: e.civil_id, civil_id_expiry: e.civil_id_expiry, passport_no: e.passport_no, passport_expiry: e.passport_expiry, visa_expiry: e.visa_expiry,
  dob: e.dob, gender: e.gender, nationality: e.nationality, name_en: e.name_en, name_ar: e.name_ar });
export const SELF_DOC_TYPES = ["civil_id", "passport", "visa", "resume", "certificate", "course", "contract", "medical", "other"];

/** Store an uploaded body; returns the files row. Caller checks permissions. */
export async function storeUpload(ctx, req, { employeeId, requestId = null, voiceId = null, kind = "doc", body: given = null }) {
  const mime = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const image = kind === "photo" || kind === "checkin";
  if (!(image ? IMAGES : DOCS).includes(mime)) throw new HttpError(415, "unsupported_type", image ? "Photo must be JPG, PNG or WebP" : "Only PDF, JPG, PNG or WebP files are accepted");
  const body = given || (await readBody(req, MAX_FILE)); // (a check-in reads its photo first, before its checks)
  if (!body.length) throw new HttpError(400, "empty_file", "The file is empty");
  const q = req.query;
  const docType = image ? null : q.get("doc_type") || "other";
  if (docType && !DOC_TYPES.includes(docType)) throw new HttpError(400, "invalid", "unknown document type");
  let expiry = q.get("expiry") || null;
  if (expiry && !isIsoDate(expiry)) throw new HttpError(400, "invalid", "expiry must be a valid date");
  if (expiry && expiry === ctx.today() && !q.get("confirm_past")) expiry = null; // a phone's date picker filling in today: asked again after the upload
  const name = String(q.get("name") || (image ? "photo" : "document")).replace(/[\\/\r\n"]/g, "_").slice(0, 120);
  const { db } = ctx;
  const r = db.prepare("INSERT INTO files(employee_id,request_id,voice_id,kind,doc_type,name,mime,size,expiry,note,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(employeeId, requestId, voiceId, kind, docType, name, mime, body.length, expiry, (q.get("note") || "").slice(0, 300) || null, req.sess.user.id, nowIso());
  const id = Number(r.lastInsertRowid);
  fs.writeFileSync(path.join(ctx.dataDir, "uploads", String(id)), body);
  return db.prepare("SELECT id,employee_id,request_id,kind,doc_type,name,mime,size,expiry,note,uploaded_at FROM files WHERE id=?").get(id);
}

const run = promisify(execFile);
const previewDir = (ctx) => { const d = path.join(ctx.dataDir, "previews"); fs.mkdirSync(d, { recursive: true }); return d; };
/** Delete an uploaded file and every copy made from it (PDF pages, smaller photos). */
export function removeUpload(ctx, id) {
  fs.rmSync(path.join(ctx.dataDir, "uploads", String(id)), { force: true });
  const d = path.join(ctx.dataDir, "previews");
  for (const x of fs.existsSync(d) ? fs.readdirSync(d) : []) if (x.startsWith(`${id}-`)) fs.rmSync(path.join(d, x), { force: true });
}
/* Photos are shown small (a 40-pixel face on the staff list) but may be uploaded at full camera size (several MB): a
 * smaller copy is made once with ImageMagick and kept with the previews. Without ImageMagick the original is sent. */
const SIZES = [96, 192, 400, 800, 1600];
async function smallerImage(ctx, f, w) {
  const out = path.join(previewDir(ctx), `${f.id}-w${w}.jpg`);
  if (!fs.existsSync(out)) {
    const src = path.join(ctx.dataDir, "uploads", String(f.id));
    const args = [src, "-auto-orient", "-resize", `${w}x${w}>`, "-strip", "-quality", "82", "jpg:" + out];
    let ok = false;
    for (const cmd of ["magick", "convert"]) { try { await run(cmd, args, { timeout: 30000 }); ok = true; break; } catch (e) { if (e.code !== "ENOENT") break; } }
    if (!ok || !fs.existsSync(out)) return null;
  }
  return fs.readFileSync(out);
}
/** Number of pages in a stored PDF (0 when poppler isn't installed). */
async function pdfPages(ctx, f) {
  try {
    const out = (await run("pdfinfo", [path.join(ctx.dataDir, "uploads", String(f.id))], { timeout: 15000 })).stdout;
    return Math.min(50, Number((/^Pages:\s+(\d+)/m.exec(out) || [0, 0])[1]));
  } catch { return 0; }
}
/** One page of a stored PDF as a PNG (made once, then kept in DATA_DIR/previews). */
async function pdfPage(ctx, f, n) {
  const out = path.join(previewDir(ctx), `${f.id}-${n}.jpg`);
  if (!fs.existsSync(out)) {
    try { await run("pdftoppm", ["-jpeg", "-jpegopt", "quality=80", "-r", "110", "-f", String(n), "-l", String(n), "-singlefile", path.join(ctx.dataDir, "uploads", String(f.id)), out.slice(0, -4)], { timeout: 60000 }); }
    catch { return null; }
  }
  return fs.existsSync(out) ? fs.readFileSync(out) : null;
}

export function registerFiles(api, ctx) {
  const { db } = ctx;
  // an uploaded file never changes under its id: the browser keeps it a day, then asks again (a tiny 304 if unchanged)
  const tagOf = (f, variant) => `"f${f.id}-${variant}-${String(f.uploaded_at || "").replace(/\D/g, "")}"`;
  const fileCache = (f, variant) => ({ "Cache-Control": "private, max-age=86400", ETag: tagOf(f, variant) });
  const notModified = (req, res, f, variant) => {
    if ((req.headers["if-none-match"] || "") !== tagOf(f, variant)) return false;
    res.writeHead(304, fileCache(f, variant)); res.end(); return true;
  };
  const forbidden = () => new HttpError(403, "forbidden", "You do not have permission for this");
  // read value → profile column. Personal details come from the civil ID card only; a passport gives just its number and
  // expiry, a visa its expiry (passports spell names differently and were the source of wrong names and nationalities)
  const readMap = (docType) => docType === "civil_id"
    ? { civil_id: "civil_id", dob: "dob", gender: "gender", nationality: "nationality", name_en: "name_en", name_ar: "name_ar", expiry: "civil_id_expiry" }
    : docType === "passport" ? { passport_no: "passport_no", expiry: "passport_expiry" }
    : docType === "visa" ? { expiry: "visa_expiry" } : {};
  /** Only what this kind of document may fill (plus how it was read). */
  const forDoc = (docType, read) => read && Object.fromEntries(Object.entries(read).filter(([k]) => readMap(docType)[k] || ["verified", "kind", "name_ar_from"].includes(k)));
  /** Read a stored ID, passport or visa (image or PDF) on our server; keeps what was read on the file. Returns the values, or null. */
  async function readStored(file) {
    const pdf = file.mime === "application/pdf";
    if (!READABLE.includes(file.doc_type) || !(file.mime.startsWith("image/") || pdf) || ctx.env.OCR === "off") return null;
    try {
      const body = fs.readFileSync(path.join(ctx.dataDir, "uploads", String(file.id)));
      const opts = { arabic: ["civil_id", "passport"].includes(file.doc_type) }; // the Arabic name is printed on IDs and passports
      const r = pdf ? await readPdf(body, ctx.readDocument || readDocument, opts) : await (ctx.readDocument || readDocument)(body, opts);
      const read = r && Object.keys(r.found).some((k) => k !== "verified" && k !== "kind") ? r.found : null;
      if (read) {
        db.prepare("UPDATE files SET extracted=? WHERE id=?").run(JSON.stringify(read), file.id);
        // a date read only from the printed front (not check-digit verified) that is today or earlier, or before the birth date, is a misread
        if (read.expiry && !(read.verified || []).includes("expiry") && (read.expiry <= ctx.today() || (read.dob && read.expiry <= read.dob))) delete read.expiry;
        if (read.expiry && !file.expiry) { db.prepare("UPDATE files SET expiry=? WHERE id=?").run(read.expiry, file.id); file.expiry = read.expiry; }
      }
      return read;
    } catch (e) { console.error(`reading document ${file.id} failed: ${e.message}`); return null; }
  }
  /** No Arabic name on the card (or not readable): the English one spelled in Arabic, when every word is a known name — used
   * only to fill an empty Arabic name or complete a shorter one (جواهر سالم الجابري → جواهر سالم خلفان الجابري), never to
   * replace a different spelling someone typed. */
  function arabicFallback(emp, read) {
    if (read.name_ar || !read.name_en) return;
    const ar = String(emp.name_ar || "").trim() ? completeArabicName(read.name_en, emp.name_ar) : toArabicName(read.name_en);
    if (ar) { read.name_ar = ar; read.name_ar_from = "english"; }
  }
  /** Which read values go on the profile without asking: the ones the "<<<" lines' check digits confirm, the Arabic name
   * (the reader only returns a clean 2–7-word name), and anything for a field that is still empty. */
  const autoKeys = (emp, file, read) => {
    const verified = new Set(read.verified || []), map = readMap(file.doc_type);
    return Object.keys(map).filter((k) => read[k] !== undefined && (verified.has(k) || k === "name_ar" || [null, undefined, ""].includes(emp[map[k]])));
  };

  /** Put values read from a document on the profile (a person's own changes are listed for HR to verify). Returns the columns changed. */
  function applyRead(sess, emp, f, found, keys) {
    const map = readMap(f.doc_type), change = {};
    for (const k of keys) { const col = map[k]; if (col && found[k] !== undefined && String(emp[col] ?? "") !== String(found[k])) change[col] = found[k]; }
    if (!Object.keys(change).length) return [];
    let clean;
    try { clean = cleanEmployee(db, change, emp); }
    catch { // e.g. a civil number already on someone else's profile: keep the rest
      clean = {};
      for (const [c, v] of Object.entries(change)) { try { Object.assign(clean, cleanEmployee(db, { [c]: v }, emp)); } catch { /* skipped */ } }
    }
    const cols = Object.keys(clean);
    if (!cols.length) return [];
    tx(db, () => {
      db.prepare(`UPDATE employees SET ${cols.map((c) => `${c}=?`).join(",")},updated_at=? WHERE id=?`).run(...cols.map((c) => clean[c]), nowIso(), emp.id);
      audit(db, sess.user.id, "employee.update_from_id", "employee", emp.id, pick(emp), { ...clean, file_id: f.id });
      recordSelfChange(ctx, sess, emp, emp, clean, "id", f.id);
    });
    return cols;
  }

  api.post("/api/employees/:id/files", async (req, res) => {
    const emp = getEmployee(db, req.params.id);
    const kind = req.query.get("kind") === "photo" ? "photo" : "doc";
    const own = !!emp && emp.id === req.sess.user.employee_id;
    // staff add their own photo and papers; contracts and payout consents stay with HR
    const ownDoc = own && (kind === "photo" || SELF_DOC_TYPES.includes(req.query.get("doc_type") || "other"));
    if (!can(req.sess, "employee.edit") && !ownDoc) throw forbidden();
    if (!emp) throw new HttpError(404, "not_found", "Employee not found");
    // renewing an ID, passport or visa: the new one takes the old one's place and the old one is archived
    const old = req.query.get("replaces") ? db.prepare("SELECT * FROM files WHERE id=?").get(Number(req.query.get("replaces"))) : null;
    if (req.query.get("replaces") && (!old || old.employee_id !== emp.id || old.kind !== "doc" || old.archived_at || !RENEWABLE.includes(old.doc_type)
      || (req.query.get("doc_type") || old.doc_type) !== old.doc_type)) throw new HttpError(400, "invalid", "This document can't be renewed");
    const file = await storeUpload(ctx, req, { employeeId: emp.id, kind });
    tx(db, () => {
      if (kind === "photo") {
        db.prepare("UPDATE employees SET photo_file_id=?,updated_at=? WHERE id=?").run(file.id, nowIso(), emp.id);
        recordSelfChange(ctx, req.sess, emp, { photo_file_id: emp.photo_file_id }, { photo_file_id: file.id }, "photo", file.id);
      }
      audit(db, req.sess.user.id, "file.upload", "employee", emp.id, null, file);
      if (old) {
        db.prepare("UPDATE files SET archived_at=?, replaced_by=? WHERE id=?").run(nowIso(), file.id, old.id);
        audit(db, req.sess.user.id, "file.renew", "employee", emp.id, { file_id: old.id, expiry: old.expiry }, { file_id: file.id });
      }
    });
    // ID card or passport: read it on our own server and offer what was read (see below). HR sees a person's own changes.
    let read = null, applied = [];
    // nothing is applied here: the person sees each value read next to the current one and ticks what to save (a scanner
    // can misread), then /apply saves only those
    if (kind === "doc") read = forDoc(file.doc_type, await readStored(file));
    if (read && !Object.keys(read).some((k) => readMap(file.doc_type)[k])) read = null;
    if (read) {
      if (file.doc_type === "civil_id") arabicFallback(emp, read);
      db.prepare("UPDATE files SET extracted=? WHERE id=?").run(JSON.stringify(read), file.id); // with the Arabic name, if spelled from the English
    }
    try { runExpiryCheck(ctx, ctx.today()); } catch (e) { console.error(e); }
    send(req, res, 201, { file, read, applied, current: read ? pick(getEmployee(db, emp.id)) : undefined });
  });

  // Read an ID, passport or visa already on file again (the person, HR, Admin): returns what it shows next to the profile,
  // to tick and confirm with /apply. Nothing is saved here.
  api.post("/api/files/:id/reread", async (req, res) => {
    const f = db.prepare("SELECT * FROM files WHERE id=?").get(Number(req.params.id));
    if (!f || f.kind !== "doc" || f.archived_at || !READABLE.includes(f.doc_type)) throw new HttpError(404, "not_found", "No ID, passport or visa to read");
    const emp = getEmployee(db, f.employee_id);
    if (!emp || (!can(req.sess, "employee.edit") && emp.id !== req.sess.user.employee_id)) throw forbidden();
    let read = forDoc(f.doc_type, await readStored(f));
    if (read && !Object.keys(read).some((k) => readMap(f.doc_type)[k])) read = null;
    if (!read) throw new HttpError(422, "not_read", "Nothing could be read from this document — upload a clearer copy");
    if (f.doc_type === "civil_id") arabicFallback(emp, read);
    db.prepare("UPDATE files SET extracted=? WHERE id=?").run(JSON.stringify(read), f.id);
    send(req, res, 200, { file: db.prepare("SELECT id,employee_id,kind,doc_type,name,mime,size,expiry,uploaded_at FROM files WHERE id=?").get(f.id), read, applied: [], current: pick(getEmployee(db, emp.id)) });
  });

  // ---------- feedback on a reading: what it got wrong, the right value, a comment — one list for HR / Admin ----------
  api.post("/api/files/:id/feedback", async (req, res) => {
    const f = db.prepare("SELECT * FROM files WHERE id=?").get(Number(req.params.id));
    if (!f || !READABLE.includes(f.doc_type)) throw new HttpError(404, "not_found", "Document not found");
    if (!can(req.sess, "employee.edit") && f.employee_id !== req.sess.user.employee_id) throw forbidden();
    const b = await readJson(req);
    const read = f.extracted ? JSON.parse(f.extracted) : {}, map = readMap(f.doc_type);
    const items = (Array.isArray(b.items) ? b.items : []).filter((x) => x && map[x.field]).slice(0, 12)
      .map((x) => ({ field: x.field, read: read[x.field] ?? null, correct: String(x.correct || "").trim().slice(0, 200) || null }));
    const comment = String(b.comment || "").trim().slice(0, 1000);
    if (!items.length && !comment) throw Object.assign(new HttpError(400, "invalid", "Write what's wrong"), { field: "comment" });
    const id = Number(db.prepare("INSERT INTO read_feedback(file_id,employee_id,user_id,doc_type,items,comment,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(f.id, f.employee_id, req.sess.user.id, f.doc_type, JSON.stringify(items), comment || null, nowIso()).lastInsertRowid);
    audit(db, req.sess.user.id, "file.read_feedback", "employee", f.employee_id, null, { file_id: f.id, items, comment });
    send(req, res, 201, { id });
  });
  api.get("/api/read-feedback", (req, res) => {
    needHr(req.sess);
    const status = ["open", "resolved", "all"].includes(req.query.get("status")) ? req.query.get("status") : "open";
    const rows = db.prepare(`SELECT r.*, e.emp_no, e.name_ar, e.name_en, u.username, f.name file_name, f.mime, ru.username resolved_username
      FROM read_feedback r JOIN employees e ON e.id=r.employee_id LEFT JOIN users u ON u.id=r.user_id LEFT JOIN files f ON f.id=r.file_id LEFT JOIN users ru ON ru.id=r.resolved_by
      ${status === "all" ? "" : "WHERE r.status=?"} ORDER BY r.id DESC LIMIT 500`).all(...(status === "all" ? [] : [status])).map((r) => ({ ...r, items: JSON.parse(r.items || "[]") }));
    if (req.query.get("format") === "csv") {
      const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [["Date", "Employee ID", "Name (Arabic)", "Name (English)", "Document", "File", "Field", "Read as", "Correct value", "Comment", "By", "Status"].join(",")];
      for (const r of rows) for (const it of r.items.length ? r.items : [{}])
        lines.push([r.created_at, r.emp_no, r.name_ar, r.name_en, r.doc_type, r.file_name, it.field || "", it.read ?? "", it.correct ?? "", r.comment || "", r.username, r.status].map(q).join(","));
      return sendRaw(req, res, 200, Buffer.from("\ufeff" + lines.join("\r\n"), "utf8"), "text/csv; charset=utf-8",
        { "Content-Disposition": `attachment; filename="reading-feedback.csv"`, "Cache-Control": "no-store" });
    }
    send(req, res, 200, { items: rows });
  });
  api.post("/api/read-feedback/:id/resolve", (req, res) => {
    needHr(req.sess);
    const r = db.prepare("SELECT * FROM read_feedback WHERE id=?").get(Number(req.params.id));
    if (!r) throw new HttpError(404, "not_found", "Not found");
    db.prepare("UPDATE read_feedback SET status=?, resolved_by=?, resolved_at=? WHERE id=?").run(r.status === "open" ? "resolved" : "open", req.sess.user.id, nowIso(), r.id);
    send(req, res, 200, { ok: true });
  });

  // Apply chosen values read from an ID photo to the profile. Only values the reader found are used — nobody can type new ones here.
  api.post("/api/files/:id/apply", async (req, res) => {
    const f = db.prepare("SELECT * FROM files WHERE id=?").get(Number(req.params.id));
    if (!f || !f.extracted) throw new HttpError(404, "not_found", "Nothing was read from this file");
    const emp = getEmployee(db, f.employee_id);
    const hr = can(req.sess, "employee.edit");
    if (!emp || (!hr && emp.id !== req.sess.user.employee_id)) throw forbidden();
    const b = await readJson(req);
    const found = JSON.parse(f.extracted);
    const keys = (Array.isArray(b.fields) ? b.fields : []).filter((k) => readMap(f.doc_type)[k] && found[k] !== undefined);
    if (!keys.length) throw new HttpError(400, "invalid", "Choose at least one value");
    applyRead(req.sess, emp, f, found, keys);
    try { runExpiryCheck(ctx, ctx.today()); } catch (e) { console.error(e); }
    send(req, res, 200, { employee: getEmployee(db, emp.id) });
  });

  // set or correct a document's expiry date (what drives the 30-day reminders): the person for their own papers, HR for anyone
  api.put("/api/files/:id", async (req, res) => {
    const f = db.prepare("SELECT * FROM files WHERE id=?").get(Number(req.params.id));
    if (!f || f.kind !== "doc" || f.request_id || f.voice_id) throw new HttpError(404, "not_found", "File not found");
    const own = f.employee_id === req.sess.user.employee_id && SELF_DOC_TYPES.includes(f.doc_type || "other");
    if (!can(req.sess, "employee.edit") && !own) throw forbidden();
    const b = await readJson(req);
    const expiry = b.expiry || null;
    if (expiry !== null && !isIsoDate(expiry)) throw Object.assign(new HttpError(400, "invalid", "Choose a valid date"), { field: "expiry" });
    // today as the expiry is nearly always a phone's date picker filling in today: it must be confirmed
    if (expiry !== null && expiry === ctx.today() && expiry !== f.expiry && !b.confirm_past)
      throw Object.assign(new HttpError(409, "expiry_today", "Today as the expiry date? Check the date on the document"), { field: "expiry" });
    tx(db, () => {
      db.prepare("UPDATE files SET expiry=? WHERE id=?").run(expiry, f.id);
      audit(db, req.sess.user.id, "file.expiry", "employee", f.employee_id, { file_id: f.id, expiry: f.expiry }, { file_id: f.id, expiry });
    });
    try { runExpiryCheck(ctx, ctx.today()); } catch (e) { console.error(e); }
    send(req, res, 200, { file: db.prepare("SELECT id,employee_id,kind,doc_type,name,mime,size,expiry,note,uploaded_at FROM files WHERE id=?").get(f.id) });
  });

  /** The file row if this session may open it (its person, HR/managers who see them, the request's approver, Voice readers). */
  function fileFor(req) {
    const f = db.prepare("SELECT * FROM files WHERE id=?").get(Number(req.params.id));
    if (!f) throw new HttpError(404, "not_found", "File not found");
    const emp = getEmployee(db, f.employee_id);
    const reqRow = f.request_id && db.prepare("SELECT * FROM leave_requests WHERE id=?").get(f.request_id);
    const approverOfRequest = !!reqRow && (reqRow.approver_user_id === req.sess.user.id || deputyOf(db, reqRow.approver_user_id, ctx.today()) === req.sess.user.id);
    if (f.voice_id) { // Staff Voice attachments: only the people who can read the message
      const m = db.prepare("SELECT * FROM voice_messages WHERE id=?").get(f.voice_id);
      if (!m || !canReadVoice(req.sess, m)) throw forbidden();
    } else if (f.kind === "checkin") { // a check-in photo: the person, HR/Admin and their manager — like their attendance
      if (!canSeeAttendance(db, req.sess, emp)) throw forbidden();
    } else if (!approverOfRequest && !canViewEmployee(db, req.sess, emp)) throw forbidden();
    if (f.archived_at && !["hr", "admin"].includes(req.sess.user.role)) throw new HttpError(404, "not_found", "File not found"); // an old, replaced copy
    if (req.sess.user.role === "consultant" && f.kind !== "photo" && f.employee_id !== req.sess.user.employee_id && !f.request_id && !f.voice_id) throw forbidden(); // a consultant sees no one's papers
    return f;
  }

  // a PDF shown as pictures, page by page, so it looks the same on every phone (poppler renders it; cached)
  api.get("/api/files/:id/pages", async (req, res) => {
    const f = fileFor(req);
    if (f.mime !== "application/pdf") return send(req, res, 200, { pages: 0 });
    send(req, res, 200, { pages: await pdfPages(ctx, f) });
  });
  api.get("/api/files/:id/page/:n", async (req, res) => {
    const f = fileFor(req);
    const n = Number(req.params.n);
    if (f.mime !== "application/pdf" || !Number.isInteger(n) || n < 1 || n > 50) throw new HttpError(404, "not_found", "No such page");
    if (notModified(req, res, f, `p${n}`)) return;
    const jpg = await pdfPage(ctx, f, n);
    if (!jpg) throw new HttpError(404, "not_found", "This page can't be shown here — download the file");
    sendRaw(req, res, 200, jpg, "image/jpeg", fileCache(f, `p${n}`));
  });

  api.get("/api/files/:id", async (req, res) => {
    const f = fileFor(req);
    const p = path.join(ctx.dataDir, "uploads", String(f.id));
    if (!fs.existsSync(p)) throw new HttpError(404, "not_found", "File missing on disk");
    const ext = { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" }[f.mime] || "";
    const fname = /\.\w{2,4}$/.test(f.name) ? f.name : f.name + ext;
    // ?w=… a smaller copy of a photo (faces on lists, the viewer); the original for a download
    const w = Number(req.query.get("w")) || 0, size = w > 0 && !req.query.get("download") && f.mime.startsWith("image/") && (SIZES.find((x) => x >= w) || SIZES.at(-1));
    if (notModified(req, res, f, size ? `w${size}` : "o")) return;
    const small = size ? await smallerImage(ctx, f, size) : null;
    sendRaw(req, res, 200, small || fs.readFileSync(p), small ? "image/jpeg" : f.mime, {
      "Content-Disposition": `${req.query.get("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fname)}`,
      ...fileCache(f, size ? `w${size}` : "o"),
    });
  });

  // ---------- every profile from its uploaded ID card and passport (HR/Admin, in the background) ----------
  // Re-reads the latest civil IDs (up to 3 files: front and back) and passports (up to 2) of each person with the current reader and updates the profile the same way an
  // upload does (passport first, so the ID card has the last word on the shared details). The result — who changed, old → new,
  // what couldn't be read, who has no ID uploaded — is kept until the next run.
  let batch = null;
  const needHr = (sess) => { if (!["hr", "admin"].includes(sess.user.role)) throw forbidden(); };
  const COLS_OF = { civil_id: readMap("civil_id"), passport: readMap("passport") };
  // why a document gave nothing: a file type the reader can't open, or nothing readable in it (too dark, blurred, cut off)
  const why = (f) => (f.mime.startsWith("image/") || f.mime === "application/pdf" ? "unreadable" : "type");
  async function runBatch(sess) {
    const people = db.prepare("SELECT id, emp_no, name_ar, name_en FROM employees WHERE status NOT IN ('resigned','terminated','disabled') ORDER BY name_ar").all();
    // the latest few of each (the front and the back of an ID are often two files), oldest first so the newest has the last word
    const latest = db.prepare(`SELECT * FROM (SELECT * FROM files WHERE employee_id=? AND kind='doc' AND doc_type=? AND request_id IS NULL AND voice_id IS NULL AND archived_at IS NULL
      ORDER BY uploaded_at DESC, id DESC LIMIT ?) ORDER BY uploaded_at, id`);
    const work = people.map((p) => ({ p, docs: [...latest.all(p.id, "passport", 2), ...latest.all(p.id, "civil_id", 3)] }));
    batch.total = work.reduce((n, w) => n + w.docs.length, 0);
    batch.check = []; batch.matches = 0; batch.noPassport = [];
    for (const { p, docs } of work) {
      const who = { id: p.id, emp_no: p.emp_no, name_ar: p.name_ar, name_en: p.name_en };
      if (!docs.some((d) => d.doc_type === "civil_id")) batch.noId.push(who);
      if (!docs.some((d) => d.doc_type === "passport")) batch.noPassport.push(who);
      if (!docs.length) continue;
      const row = { id: p.id, emp_no: p.emp_no, docs: [] };
      const seen = {}; // per profile column: the value the documents agree on, after the run
      for (const f of docs) {
        const read = forDoc(f.doc_type, await readStored(f));
        const item = { file_id: f.id, doc_type: f.doc_type, name: f.name, mime: f.mime, status: "not_read", changes: {} };
        if (read && Object.keys(read).some((k) => COLS_OF[f.doc_type][k])) {
          const before = getEmployee(db, p.id);
          if (f.doc_type === "civil_id") arabicFallback(before, read);
          const auto = autoKeys(before, f, read);
          let cols = [];
          try { cols = applyRead(sess, before, f, read, auto); } catch (e) { item.error = e.message; }
          const after = getEmployee(db, p.id);
          for (const c of cols) item.changes[c] = [before[c] ?? null, after[c] ?? null];
          item.status = cols.length ? "updated" : "same";
          // what the card shows but couldn't confirm: left as it is, for HR to look at
          for (const [k, col] of Object.entries(COLS_OF[f.doc_type])) {
            if (read[k] === undefined || read[k] === null || read[k] === "") continue;
            const cur = after[col];
            if (String(cur ?? "") === String(read[k])) { seen[col] = true; continue; }
            if (auto.includes(k)) continue; // applied, or refused by validation (item.error)
            seen[col] = seen[col] || false;
            batch.check.push({ ...who, field: col, profile: cur ?? null, document: read[k], file_id: f.id, doc_type: f.doc_type, file_name: f.name, mime: f.mime,
              reason: (read.verified || []).length ? "not_confirmed" : "front_only" });
          }
        } else item.reason = why(f);
        row.docs.push(item); batch.done++;
      }
      batch.matches += Object.values(seen).filter(Boolean).length;
      // a later document already put that value on the profile: not a mismatch; the same difference twice is listed once
      const fin = getEmployee(db, p.id), keys = new Set();
      batch.check = batch.check.filter((c) => {
        if (c.id !== p.id) return true;
        const k = `${c.field}|${c.document}`;
        if (String(fin[c.field] ?? "") === String(c.document) || keys.has(k)) return false;
        keys.add(k); c.profile = fin[c.field] ?? null; return true;
      });
      const e = getEmployee(db, p.id); row.name_ar = e.name_ar; row.name_en = e.name_en;
      batch.results.push(row);
    }
    try { runExpiryCheck(ctx, ctx.today()); } catch (e) { console.error(e); }
  }
  api.post("/api/profiles/reread-ids", (req, res) => {
    needHr(req.sess);
    if (batch && batch.running) throw new HttpError(409, "busy", "Already running");
    batch = { running: true, done: 0, total: 0, started_at: nowIso(), by: req.sess.user.username, results: [], noId: [], noPassport: [], check: [], matches: 0 };
    audit(db, req.sess.user.id, "profiles.reread_ids", "employee", null, null, null);
    const job = batch;
    runBatch(req.sess)
      .catch((e) => { job.error = e.message; console.error(`re-reading IDs failed: ${e.message}`); })
      .finally(() => { job.running = false; job.finished_at = nowIso(); setSetting(db, "id_reread_last", job); });
    send(req, res, 202, { started: true });
  });
  api.get("/api/profiles/reread-ids", (req, res) => {
    needHr(req.sess);
    const b = batch || getSetting(db, "id_reread_last", null);
    if (req.query.get("format") === "csv" && b) {
      const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [["Result", "Employee ID", "Name (Arabic)", "Name (English)", "Document", "File", "Field", "Before / on profile", "After / on document", "Note"].join(",")];
      for (const r of b.results) for (const d of r.docs) {
        if (d.status === "updated") for (const [c, [a, v]] of Object.entries(d.changes)) lines.push(["Updated", r.emp_no, r.name_ar, r.name_en, d.doc_type, d.name, c, a, v, ""].map(q).join(","));
        if (d.status === "not_read") lines.push(["Could not read", r.emp_no, r.name_ar, r.name_en, d.doc_type, d.name, "", "", "", d.reason || ""].map(q).join(","));
        if (d.error) lines.push(["Not saved", r.emp_no, r.name_ar, r.name_en, d.doc_type, d.name, "", "", "", d.error].map(q).join(","));
      }
      for (const c of b.check || []) lines.push(["To check", c.emp_no, c.name_ar, c.name_en, c.doc_type, c.file_name, c.field, c.profile, c.document, c.reason].map(q).join(","));
      for (const p of b.noId || []) lines.push(["No civil ID uploaded", p.emp_no, p.name_ar, p.name_en, "", "", "", "", "", ""].map(q).join(","));
      for (const p of b.noPassport || []) lines.push(["No passport uploaded", p.emp_no, p.name_ar, p.name_en, "", "", "", "", "", ""].map(q).join(","));
      return sendRaw(req, res, 200, Buffer.from("\ufeff" + lines.join("\r\n"), "utf8"), "text/csv; charset=utf-8",
        { "Content-Disposition": `attachment; filename="profile-check-${String(b.finished_at || b.started_at || "").slice(0, 10)}.csv"`, "Cache-Control": "no-store" });
    }
    send(req, res, 200, { batch: b });
  });

  api.delete("/api/files/:id", (req, res) => {
    if (!can(req.sess, "employee.edit")) throw forbidden();
    const f = db.prepare("SELECT * FROM files WHERE id=?").get(Number(req.params.id));
    if (!f) throw new HttpError(404, "not_found", "File not found");
    if (f.voice_id && req.sess.user.role !== "admin") throw forbidden(); // a Staff Voice attachment is part of a private message
    tx(db, () => {
      db.prepare("UPDATE employees SET photo_file_id=NULL WHERE photo_file_id=?").run(f.id);
      db.prepare("DELETE FROM files WHERE id=?").run(f.id);
      db.prepare("UPDATE files SET archived_at=NULL, replaced_by=NULL WHERE replaced_by=?").run(f.id); // the copy it replaced is current again
      audit(db, req.sess.user.id, "file.delete", "employee", f.employee_id, f, null);
    });
    removeUpload(ctx, f.id);
    send(req, res, 200, { ok: true });
  });
}
