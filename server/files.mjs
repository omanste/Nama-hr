/* Photos and documents: stored in DATA_DIR/uploads/<id>, served only to people allowed to see the employee. */
import fs from "node:fs";
import path from "node:path";
import { nowIso, tx } from "./db.mjs";
import { send, sendRaw, readBody, HttpError } from "./http.mjs";
import { can, canViewEmployee } from "./perm.mjs";
import { audit } from "./audit.mjs";
import { isIsoDate } from "./leave.mjs";
import { getEmployee } from "./employees.mjs";

export const MAX_FILE = 10 * 1024 * 1024;
const IMAGES = ["image/jpeg", "image/png", "image/webp"];
const DOCS = [...IMAGES, "application/pdf"];
export const DOC_TYPES = ["civil_id", "passport", "contract", "visa", "certificate", "medical", "other"];

/** Store an uploaded body; returns the files row. Caller checks permissions. */
export async function storeUpload(ctx, req, { employeeId, requestId = null, kind = "doc" }) {
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
  const r = db.prepare("INSERT INTO files(employee_id,request_id,kind,doc_type,name,mime,size,expiry,note,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(employeeId, requestId, kind, docType, name, mime, body.length, expiry, (q.get("note") || "").slice(0, 300) || null, req.sess.user.id, nowIso());
  const id = Number(r.lastInsertRowid);
  fs.writeFileSync(path.join(ctx.dataDir, "uploads", String(id)), body);
  return db.prepare("SELECT id,employee_id,request_id,kind,doc_type,name,mime,size,expiry,note,uploaded_at FROM files WHERE id=?").get(id);
}

export function registerFiles(api, ctx) {
  const { db } = ctx;
  const forbidden = () => new HttpError(403, "forbidden", "You do not have permission for this");

  api.post("/api/employees/:id/files", async (req, res) => {
    if (!can(req.sess, "employee.edit")) throw forbidden();
    const emp = getEmployee(db, req.params.id);
    if (!emp) throw new HttpError(404, "not_found", "Employee not found");
    const kind = req.query.get("kind") === "photo" ? "photo" : "doc";
    const file = await storeUpload(ctx, req, { employeeId: emp.id, kind });
    tx(db, () => {
      if (kind === "photo") db.prepare("UPDATE employees SET photo_file_id=?,updated_at=? WHERE id=?").run(file.id, nowIso(), emp.id);
      audit(db, req.sess.user.id, "file.upload", "employee", emp.id, null, file);
    });
    send(req, res, 201, { file });
  });

  api.get("/api/files/:id", (req, res) => {
    const f = db.prepare("SELECT * FROM files WHERE id=?").get(Number(req.params.id));
    if (!f) throw new HttpError(404, "not_found", "File not found");
    const emp = getEmployee(db, f.employee_id);
    const approverOfRequest = f.request_id && (db.prepare("SELECT approver_user_id FROM leave_requests WHERE id=?").get(f.request_id) || {}).approver_user_id === req.sess.user.id;
    if (!approverOfRequest && !canViewEmployee(db, req.sess, emp)) throw forbidden();
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
    tx(db, () => {
      db.prepare("UPDATE employees SET photo_file_id=NULL WHERE photo_file_id=?").run(f.id);
      db.prepare("DELETE FROM files WHERE id=?").run(f.id);
      audit(db, req.sess.user.id, "file.delete", "employee", f.employee_id, f, null);
    });
    fs.rmSync(path.join(ctx.dataDir, "uploads", String(f.id)), { force: true });
    send(req, res, 200, { ok: true });
  });
}
