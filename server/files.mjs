/* Photos and documents: stored in DATA_DIR/uploads/<id>, served only to people allowed to see the employee. */
import fs from "node:fs";
import path from "node:path";
import { nowIso, tx } from "./db.mjs";
import { send, sendRaw, readBody, readJson, HttpError } from "./http.mjs";
import { can, canViewEmployee } from "./perm.mjs";
import { audit } from "./audit.mjs";
import { isIsoDate } from "./leave.mjs";
import { getEmployee } from "./employees.mjs";
import { deputyOf } from "./requests.mjs";
import { readDocument, readPdf } from "./idread.mjs";
import { canReadVoice } from "./voice.mjs";
import { runExpiryCheck } from "./jobs.mjs";
import { recordSelfChange } from "./profile-changes.mjs";
import { cleanEmployee } from "./employees.mjs";

export const MAX_FILE = 10 * 1024 * 1024;
const IMAGES = ["image/jpeg", "image/png", "image/webp"];
const DOCS = [...IMAGES, "application/pdf"];
export const DOC_TYPES = ["civil_id", "passport", "contract", "visa", "certificate", "medical", "consent", "other"];
// what staff may upload to their own profile; contracts and payout consents stay with HR
const READABLE = ["civil_id", "passport", "visa"];
const pick = (e) => ({ civil_id: e.civil_id, civil_id_expiry: e.civil_id_expiry, passport_no: e.passport_no, passport_expiry: e.passport_expiry, visa_expiry: e.visa_expiry,
  dob: e.dob, gender: e.gender, nationality: e.nationality, name_en: e.name_en });
export const SELF_DOC_TYPES = ["civil_id", "passport", "visa", "certificate", "medical", "other"];

/** Store an uploaded body; returns the files row. Caller checks permissions. */
export async function storeUpload(ctx, req, { employeeId, requestId = null, voiceId = null, kind = "doc" }) {
  const mime = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!(kind === "photo" ? IMAGES : DOCS).includes(mime)) throw new HttpError(415, "unsupported_type", kind === "photo" ? "Photo must be JPG, PNG or WebP" : "Only PDF, JPG, PNG or WebP files are accepted");
  const body = await readBody(req, MAX_FILE);
  if (!body.length) throw new HttpError(400, "empty_file", "The file is empty");
  const q = req.query;
  const docType = q.get("doc_type") || (kind === "photo" ? null : "other");
  if (docType && !DOC_TYPES.includes(docType)) throw new HttpError(400, "invalid", "unknown document type");
  const expiry = q.get("expiry") || null;
  if (expiry && !isIsoDate(expiry)) throw new HttpError(400, "invalid", "expiry must be a valid date");
  const name = String(q.get("name") || (kind === "photo" ? "photo" : "document")).replace(/[\\/\r\n"]/g, "_").slice(0, 120);
  const { db } = ctx;
  const r = db.prepare("INSERT INTO files(employee_id,request_id,voice_id,kind,doc_type,name,mime,size,expiry,note,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(employeeId, requestId, voiceId, kind, docType, name, mime, body.length, expiry, (q.get("note") || "").slice(0, 300) || null, req.sess.user.id, nowIso());
  const id = Number(r.lastInsertRowid);
  fs.writeFileSync(path.join(ctx.dataDir, "uploads", String(id)), body);
  return db.prepare("SELECT id,employee_id,request_id,kind,doc_type,name,mime,size,expiry,note,uploaded_at FROM files WHERE id=?").get(id);
}

export function registerFiles(api, ctx) {
  const { db } = ctx;
  const forbidden = () => new HttpError(403, "forbidden", "You do not have permission for this");

  api.post("/api/employees/:id/files", async (req, res) => {
    const emp = getEmployee(db, req.params.id);
    const kind = req.query.get("kind") === "photo" ? "photo" : "doc";
    const own = !!emp && emp.id === req.sess.user.employee_id;
    // staff add their own photo and papers; contracts and payout consents stay with HR
    const ownDoc = own && (kind === "photo" || SELF_DOC_TYPES.includes(req.query.get("doc_type") || "other"));
    if (!can(req.sess, "employee.edit") && !ownDoc) throw forbidden();
    if (!emp) throw new HttpError(404, "not_found", "Employee not found");
    const file = await storeUpload(ctx, req, { employeeId: emp.id, kind });
    tx(db, () => {
      if (kind === "photo") {
        db.prepare("UPDATE employees SET photo_file_id=?,updated_at=? WHERE id=?").run(file.id, nowIso(), emp.id);
        recordSelfChange(ctx, req.sess, emp, { photo_file_id: emp.photo_file_id }, { photo_file_id: file.id }, "photo");
      }
      audit(db, req.sess.user.id, "file.upload", "employee", emp.id, null, file);
    });
    // ID card or passport photo: read it on our own server and offer the values (never applied without a person confirming)
    let read = null;
    const pdf = file.mime === "application/pdf";
    if (kind === "doc" && READABLE.includes(file.doc_type) && (file.mime.startsWith("image/") || pdf) && ctx.env.OCR !== "off") {
      try {
        const body = fs.readFileSync(path.join(ctx.dataDir, "uploads", String(file.id)));
        const r = pdf ? await readPdf(body, ctx.readDocument || readDocument) : await (ctx.readDocument || readDocument)(body);
        read = r && Object.keys(r.found).some((k) => k !== "verified" && k !== "kind") ? r.found : null;
        if (read) {
          db.prepare("UPDATE files SET extracted=? WHERE id=?").run(JSON.stringify(read), file.id);
          if (read.expiry && !file.expiry) { db.prepare("UPDATE files SET expiry=? WHERE id=?").run(read.expiry, file.id); file.expiry = read.expiry; }
        }
      } catch (e) { console.error(`reading document ${file.id} failed: ${e.message}`); read = null; }
    }
    try { runExpiryCheck(ctx, ctx.today()); } catch (e) { console.error(e); }
    send(req, res, 201, { file, read, current: read ? pick(getEmployee(db, emp.id)) : undefined });
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
    // the expiry goes to the matching profile date: civil ID, passport or visa
    const map = { civil_id: "civil_id", passport_no: f.doc_type === "passport" ? "passport_no" : null, dob: "dob", gender: "gender", nationality: "nationality", name_en: "name_en",
      expiry: { civil_id: "civil_id_expiry", passport: "passport_expiry", visa: "visa_expiry" }[f.doc_type] || null };
    const change = {};
    for (const k of Array.isArray(b.fields) ? b.fields : []) {
      const col = map[k];
      if (!col || found[k] === undefined) continue;
      if (col === "name_en" && !hr && emp.name_en) continue; // staff may fill an empty English name, not rename themselves
      change[col] = found[k];
    }
    if (!Object.keys(change).length) throw new HttpError(400, "invalid", "Choose at least one value");
    const clean = cleanEmployee(db, change, emp);
    tx(db, () => {
      const cols = Object.keys(clean);
      db.prepare(`UPDATE employees SET ${cols.map((c) => `${c}=?`).join(",")},updated_at=? WHERE id=?`).run(...cols.map((c) => clean[c]), nowIso(), emp.id);
      audit(db, req.sess.user.id, "employee.update_from_id", "employee", emp.id, pick(emp), { ...clean, file_id: f.id });
      recordSelfChange(ctx, req.sess, emp, emp, clean, "id");
    });
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
    tx(db, () => {
      db.prepare("UPDATE files SET expiry=? WHERE id=?").run(expiry, f.id);
      audit(db, req.sess.user.id, "file.expiry", "employee", f.employee_id, { file_id: f.id, expiry: f.expiry }, { file_id: f.id, expiry });
    });
    try { runExpiryCheck(ctx, ctx.today()); } catch (e) { console.error(e); }
    send(req, res, 200, { file: db.prepare("SELECT id,employee_id,kind,doc_type,name,mime,size,expiry,note,uploaded_at FROM files WHERE id=?").get(f.id) });
  });

  api.get("/api/files/:id", (req, res) => {
    const f = db.prepare("SELECT * FROM files WHERE id=?").get(Number(req.params.id));
    if (!f) throw new HttpError(404, "not_found", "File not found");
    const emp = getEmployee(db, f.employee_id);
    const reqRow = f.request_id && db.prepare("SELECT * FROM leave_requests WHERE id=?").get(f.request_id);
    const approverOfRequest = !!reqRow && (reqRow.approver_user_id === req.sess.user.id || deputyOf(db, reqRow.approver_user_id, ctx.today()) === req.sess.user.id);
    if (f.voice_id) { // Staff Voice attachments: only the people who can read the message
      const m = db.prepare("SELECT * FROM voice_messages WHERE id=?").get(f.voice_id);
      if (!m || !canReadVoice(req.sess, m)) throw forbidden();
    } else if (!approverOfRequest && !canViewEmployee(db, req.sess, emp)) throw forbidden();
    const p = path.join(ctx.dataDir, "uploads", String(f.id));
    if (!fs.existsSync(p)) throw new HttpError(404, "not_found", "File missing on disk");
    const ext = { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" }[f.mime] || "";
    const fname = /\.\w{2,4}$/.test(f.name) ? f.name : f.name + ext;
    sendRaw(req, res, 200, fs.readFileSync(p), f.mime, {
      "Content-Disposition": `${req.query.get("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fname)}`,
      "Cache-Control": "private, max-age=300",
    });
  });

  api.delete("/api/files/:id", (req, res) => {
    if (!can(req.sess, "employee.edit")) throw forbidden();
    const f = db.prepare("SELECT * FROM files WHERE id=?").get(Number(req.params.id));
    if (!f) throw new HttpError(404, "not_found", "File not found");
    if (f.voice_id && req.sess.user.role !== "admin") throw forbidden(); // a Staff Voice attachment is part of a private message
    tx(db, () => {
      db.prepare("UPDATE employees SET photo_file_id=NULL WHERE photo_file_id=?").run(f.id);
      db.prepare("DELETE FROM files WHERE id=?").run(f.id);
      audit(db, req.sess.user.id, "file.delete", "employee", f.employee_id, f, null);
    });
    fs.rmSync(path.join(ctx.dataDir, "uploads", String(f.id)), { force: true });
    send(req, res, 200, { ok: true });
  });
}
