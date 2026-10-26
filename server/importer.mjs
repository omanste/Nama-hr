/* Excel import: the browser parses the sheet and sends rows (arrays of cells) plus a column mapping
 * {field: columnIndex}. The server normalises, validates and, on commit, creates everything in one transaction. */
import { tx, getSetting, setSetting } from "./db.mjs";
import { send, readJson, HttpError } from "./http.mjs";
import { can } from "./perm.mjs";
import { audit } from "./audit.mjs";
import { isIsoDate, DAY, CAP } from "./leave.mjs";
import { cleanEmployee, insertEmployee, nextEmpNo, createUser, STATUSES, LONG } from "./employees.mjs";
import { postLedger } from "./ledger.mjs";
import { toCountryCode } from "../public/js/countries.js";

const TEXT = ["emp_no", "name_ar", "name_en", "civil_id", "nationality", "mobile", "email", "address", "emergency_name", "emergency_relation", "emergency_phone", "job_title", "contract_type", "status", "department"];
const DATES = ["civil_id_expiry", "dob", "join_date", "contract_end"];
export const IMPORT_FIELDS = [...TEXT, ...LONG, ...DATES, "opening_days", "manager", "gender"];
const GENDER_WORDS = { male: ["male", "m", "ذكر", "رجل"], female: ["female", "f", "أنثى", "انثى", "امرأة"] };

const DIGITS = { "٠": 0, "١": 1, "٢": 2, "٣": 3, "٤": 4, "٥": 5, "٦": 6, "٧": 7, "٨": 8, "٩": 9, "۰": 0, "۱": 1, "۲": 2, "۳": 3, "۴": 4, "۵": 5, "۶": 6, "۷": 7, "۸": 8, "۹": 9 };
const asciiDigits = (s) => s.replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d]).replace(/[٫]/g, ".").replace(/[٬]/g, "");
const pad = (n) => String(n).padStart(2, "0");

/** Excel serial (days since 1899-12-30), ISO, ISO timestamp, D/M/YYYY or D-M-YYYY → ISO date, or undefined if not a date. */
export function toIsoDate(v) {
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v < 1 || v > 80000) return undefined;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = asciiDigits(String(v)).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) { const iso = `${m[1]}-${pad(m[2])}-${pad(m[3])}`; return isIsoDate(iso) ? iso : undefined; }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) { const iso = `${m[3]}-${pad(m[2])}-${pad(m[1])}`; return isIsoDate(iso) ? iso : undefined; }
  return undefined;
}

const blank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

export function normalizeRow(raw, mapping) {
  const values = {}, issues = [];
  for (const [field, idx] of Object.entries(mapping)) {
    if (!IMPORT_FIELDS.includes(field) || idx === null || idx === undefined || idx === "") continue;
    const v = raw[Number(idx)];
    if (blank(v)) { values[field] = null; continue; }
    if (DATES.includes(field)) {
      const iso = toIsoDate(v);
      if (iso === undefined) issues.push({ field, code: "invalid_date" }); else values[field] = iso;
    } else if (field === "opening_days") {
      const n = typeof v === "number" ? v : Number(asciiDigits(String(v)).trim());
      if (!Number.isFinite(n)) issues.push({ field, code: "invalid_number" }); else values[field] = n;
    } else {
      values[field] = asciiDigitsIfId(field, String(v).replace(/\s+/g, " ").trim());
      if (field === "nationality") values[field] = toCountryCode(values[field]);
    }
  }
  return { values, issues };
}
const asciiDigitsIfId = (field, s) => (["emp_no", "civil_id", "mobile", "emergency_phone"].includes(field) ? asciiDigits(s) : s);

const nameOf = (raw, mapping) => ["name_ar", "name_en"].some((f) => mapping[f] !== undefined && mapping[f] !== null && mapping[f] !== "" && !blank(raw[Number(mapping[f])]));
/** Data ends at the first row with no name (e.g. a second table below the staff list). */
export function cutAtFirstNameless(rows, mapping) {
  const i = rows.findIndex((r) => !Array.isArray(r) || !nameOf(r, mapping));
  return i === -1 ? rows : rows.slice(0, i);
}

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

/** "Sales | المبيعات" → {ar:"المبيعات", en:"Sales"}; a single name goes to whichever language it is written in. */
export function splitDept(value) {
  const parts = String(value).split("|").map((x) => x.trim()).filter(Boolean);
  const ar = parts.find((x) => /[\u0600-\u06FF]/.test(x)) || "";
  const en = parts.find((x) => !/[\u0600-\u06FF]/.test(x)) || "";
  return { ar, en };
}
const deptMatches = (d, value) => {
  const { ar, en } = splitDept(value);
  return (ar && norm(d.name_ar) === norm(ar)) || (en && (norm(d.name_en) === norm(en) || norm(d.name_ar) === norm(en)));
};

export function validateRows(db, rawRows, mapping, today, mode = "add") {
  if (mode === "update") return validateUpdates(db, rawRows, mapping, today);
  const rows = cutAtFirstNameless(rawRows, mapping);
  const depts = db.prepare("SELECT id,name_ar,name_en FROM departments").all();
  const people = db.prepare("SELECT emp_no, name_ar, name_en, join_date FROM employees").all();
  const sameName = (v) => people.filter((p) => (v.name_ar && norm(p.name_ar) === norm(v.name_ar)) || (v.name_en && norm(p.name_en) === norm(v.name_en)));
  const findDept = (name) => depts.find((d) => deptMatches(d, name));
  const out = rows.map((raw, i) => {
    const { values, issues } = normalizeRow(raw, mapping);
    const errors = [...issues], warnings = [];
    if (values.emp_no && db.prepare("SELECT 1 FROM employees WHERE emp_no=?").get(values.emp_no)) errors.push({ field: "emp_no", code: "exists" });
    if (!values.emp_no && !errors.some((e) => e.field === "join_date") && sameName(values).some((e) => (e.join_date || null) === (values.join_date || null)))
      errors.push({ field: "name_ar", code: "already_exists" });
    if (values.opening_days !== undefined && values.opening_days !== null) {
      if (values.opening_days < 0) errors.push({ field: "opening_days", code: "negative_balance" });
      else if (values.opening_days * DAY > CAP) warnings.push({ field: "opening_days", code: "over_cap" });
    } else if (!errors.some((e) => e.field === "opening_days")) warnings.push({ field: "opening_days", code: "empty_balance" });
    if (!values.join_date && !errors.some((e) => e.field === "join_date")) warnings.push({ field: "join_date", code: "missing_join_date" });
    if (values.department && !findDept(values.department)) warnings.push({ field: "department", code: "unknown_department" });
    if (values.civil_id_expiry && values.civil_id_expiry < today) warnings.push({ field: "civil_id_expiry", code: "civil_id_expired" });
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) { warnings.push({ field: "email", code: "invalid_email" }); values.email = null; }
    if (values.gender) {
      const g = Object.keys(GENDER_WORDS).find((k) => GENDER_WORDS[k].includes(norm(values.gender)));
      if (!g) warnings.push({ field: "gender", code: "unknown_gender" });
      values.gender = g || null;
    }
    if (values.status) {
      const s = norm(values.status).replace(/\s+/g, "_");
      if (STATUSES.includes(s)) values.status = s; else { warnings.push({ field: "status", code: "unknown_status" }); values.status = "active"; }
    }
    return { row: i, values, errors, warnings };
  });
  // a manager must be someone in this file or already in the system (by employee ID or exact name)
  const known = (v) => out.some((r) => [r.values.emp_no, r.values.name_ar, r.values.name_en].some((x) => x && norm(x) === norm(v)))
    || people.some((p) => [p.emp_no, p.name_ar, p.name_en].some((x) => x && norm(x) === norm(v)));
  for (const r of out) if (r.values.manager && !known(r.values.manager)) r.warnings.push({ field: "manager", code: "unknown_manager" });
  const seen = new Map();
  for (const r of out) if (r.values.emp_no) { const k = norm(r.values.emp_no); seen.set(k, (seen.get(k) || 0) + 1); }
  for (const r of out) if (r.values.emp_no && seen.get(norm(r.values.emp_no)) > 1) r.errors.push({ field: "emp_no", code: "duplicate_in_file" });
  // generated IDs only for rows that will be imported, so preview and commit agree
  let next = Number(nextEmpNo(db).slice(5));
  for (const r of out) if (!r.errors.length && !r.values.emp_no) { r.values.emp_no = `NAMA-${String(next++).padStart(3, "0")}`; r.warnings.push({ field: "emp_no", code: "generated_id" }); }
  return { rows: out, findDept };
}

/** Update mode: each row changes an existing person (matched by employee ID, else by exact name); empty cells change nothing. */
function validateUpdates(db, rawRows, mapping, today) {
  const hasKey = (r) => Array.isArray(r) && ["emp_no", "name_ar", "name_en"].some((f) => mapping[f] !== undefined && mapping[f] !== null && mapping[f] !== "" && String(r[mapping[f]] ?? "").trim());
  const i0 = rawRows.findIndex((r) => !hasKey(r));
  const rows = i0 === -1 ? rawRows : rawRows.slice(0, i0);
  const people = db.prepare("SELECT id, emp_no, name_ar, name_en FROM employees").all();
  const depts = db.prepare("SELECT id,name_ar,name_en FROM departments").all();
  const findDept = (name) => depts.find((d) => deptMatches(d, name));
  const out = rows.map((raw, i) => {
    const { values, issues } = normalizeRow(raw, mapping);
    const errors = [...issues].filter((e) => e.field !== "opening_days"), warnings = [];
    delete values.opening_days; // balances never change through an update import
    let target = values.emp_no ? people.filter((p) => norm(p.emp_no) === norm(values.emp_no)) : [];
    if (!target.length && !values.emp_no) target = people.filter((p) => (values.name_ar && norm(p.name_ar) === norm(values.name_ar)) || (values.name_en && norm(p.name_en) === norm(values.name_en)));
    if (target.length !== 1) errors.push({ field: values.emp_no ? "emp_no" : "name_ar", code: target.length ? "ambiguous_match" : "no_match" });
    else values._target = target[0].id;
    if (values.department && !findDept(values.department)) warnings.push({ field: "department", code: "unknown_department" });
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) { warnings.push({ field: "email", code: "invalid_email" }); values.email = null; }
    if (values.gender) {
      const g = Object.keys(GENDER_WORDS).find((k) => GENDER_WORDS[k].includes(norm(values.gender)));
      if (!g) warnings.push({ field: "gender", code: "unknown_gender" });
      values.gender = g || null;
    }
    if (values.status) {
      const s = norm(values.status).replace(/\s+/g, "_");
      if (STATUSES.includes(s)) values.status = s; else { warnings.push({ field: "status", code: "unknown_status" }); values.status = null; }
    }
    return { row: i, values, errors, warnings, update: true };
  });
  return { rows: out, findDept };
}

const summary = (rows) => ({ total: rows.length, ok: rows.filter((r) => !r.errors.length).length, errors: rows.filter((r) => r.errors.length).length, warnings: rows.filter((r) => r.warnings.length).length });

export function registerImport(api, ctx) {
  const { db } = ctx;
  const need = (sess) => { if (!can(sess, "import.run")) throw new HttpError(403, "forbidden", "You do not have permission for this"); };
  const input = async (req) => {
    const b = await readJson(req, 20 * 1024 * 1024);
    if (!Array.isArray(b.rows) || !b.mapping || typeof b.mapping !== "object") throw new HttpError(400, "invalid", "rows and mapping are required");
    if (b.rows.length > 5000) throw new HttpError(400, "invalid", "At most 5000 rows per import");
    const keys = b.mode === "update" ? ["emp_no", "name_ar", "name_en"] : ["name_ar", "name_en"];
    if (!keys.some((f) => b.mapping[f] !== undefined && b.mapping[f] !== null && b.mapping[f] !== "")) throw new HttpError(400, "invalid", b.mode === "update" ? "Map the employee ID or a name column first" : "Map a name column first");
    const asOf = b.asOf || ctx.today();
    if (!isIsoDate(asOf)) throw new HttpError(400, "invalid", "asOf must be a date");
    return { ...b, asOf };
  };

  api.post("/api/import/preview", async (req, res) => {
    need(req.sess);
    const b = await input(req);
    const { rows } = validateRows(db, b.rows, b.mapping, ctx.today(), b.mode);
    send(req, res, 200, { rows, summary: summary(rows) });
  });

  api.post("/api/import/commit", async (req, res) => {
    need(req.sess);
    const b = await input(req);
    const by = req.sess.user.id;
    if (b.mode === "update") {
      const result = tx(db, () => {
        const { rows, findDept } = validateRows(db, b.rows, b.mapping, ctx.today(), "update");
        let updated = 0;
        const all = db.prepare("SELECT id, emp_no, name_ar, name_en FROM employees").all();
        for (const r of rows) {
          if (r.errors.length) continue;
          const { _target: id, department, manager, emp_no, ...rest } = r.values;
          const fields = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null && v !== undefined && v !== ""));
          if (department) { const d = findDept(department); if (d) fields.department_id = d.id; }
          if (manager) { const m = all.find((e) => norm(e.emp_no) === norm(manager)) || all.find((e) => norm(e.name_ar) === norm(manager) || norm(e.name_en) === norm(manager)); if (m && m.id !== id) fields.manager_employee_id = m.id; }
          const cur = db.prepare("SELECT * FROM employees WHERE id=?").get(id);
          const values = cleanEmployee(db, fields, cur);
          const cols = Object.keys(values).filter((c) => String(values[c] ?? "") !== String(cur[c] ?? ""));
          if (!cols.length) continue;
          db.prepare(`UPDATE employees SET ${cols.map((c) => `${c}=?`).join(",")},updated_at=? WHERE id=?`).run(...cols.map((c) => values[c]), new Date().toISOString(), id);
          audit(db, by, "employee.update", "employee", id, Object.fromEntries(cols.map((c) => [c, cur[c]])), Object.fromEntries(cols.map((c) => [c, values[c]])));
          updated++;
        }
        const s = summary(rows);
        audit(db, by, "import.update", "import", null, null, { ...s, updated });
        return { created: 0, updated, skipped: s.errors, departments: 0, logins: [] };
      });
      return send(req, res, 200, result);
    }
    const result = tx(db, () => {
      const { rows, findDept } = validateRows(db, b.rows, b.mapping, ctx.today());
      const createdDepts = [];
      let created = 0;
      const logins = [];
      const managerOf = [];
      for (const r of rows) {
        if (r.errors.length) continue;
        const { department, opening_days, manager, ...fields } = r.values;
        if (department) {
          let d = findDept(department) || createdDepts.find((x) => deptMatches(x, department));
          if (!d) {
            const { ar, en } = splitDept(department);
            const ins = db.prepare("INSERT INTO departments(name_ar,name_en) VALUES(?,?)").run(ar || en, en);
            d = { id: Number(ins.lastInsertRowid), name_ar: ar || en, name_en: en };
            createdDepts.push(d);
            audit(db, by, "department.create", "department", d.id, null, { ...d, via: "import" });
          }
          fields.department_id = d.id;
        }
        const emp = insertEmployee(db, cleanEmployee(db, fields), by);
        if (manager) managerOf.push([emp.id, manager]);
        // booked on the import date so the first yearly credit is the next anniversary after the import (spec §6)
        postLedger(db, emp, { kind: "opening", minutes: Math.round((opening_days || 0) * DAY), date: ctx.today(), note: `Imported balance as of ${b.asOf}`, by });
        created++;
        if (b.createLogins) {
          const username = emp.emp_no.toLowerCase().replace(/[^a-z0-9._-]/g, "");
          if (username.length >= 2 && !db.prepare("SELECT 1 FROM users WHERE username=?").get(username)) {
            const u = createUser(db, req.sess, { username, role: "staff", employee_id: emp.id });
            logins.push({ emp_no: emp.emp_no, name_ar: emp.name_ar, name_en: emp.name_en, username, tempPassword: u.tempPassword });
          }
        }
      }
      const all = db.prepare("SELECT id, emp_no, name_ar, name_en FROM employees").all();
      for (const [id, v] of managerOf) {
        const exact = (x) => x && norm(x) === norm(v);
        const m = all.find((e) => exact(e.emp_no)) || all.find((e) => exact(e.name_ar) || exact(e.name_en));
        if (m && m.id !== id) db.prepare("UPDATE employees SET manager_employee_id=? WHERE id=?").run(m.id, id);
      }
      const s = summary(rows);
      audit(db, by, "import.commit", "import", null, null, { ...s, created, departments: createdDepts.length, asOf: b.asOf });
      return { created, skipped: s.errors, departments: createdDepts.length, logins };
    });
    send(req, res, 200, result);
  });

  api.get("/api/import/mapping", (req, res) => { need(req.sess); send(req, res, 200, getSetting(db, "import_mapping", { headers: [], mapping: {} })); });
  api.put("/api/import/mapping", async (req, res) => {
    need(req.sess);
    const { headers, mapping } = await readJson(req);
    if (!Array.isArray(headers) || typeof mapping !== "object" || !mapping) throw new HttpError(400, "invalid", "headers and mapping are required");
    setSetting(db, "import_mapping", { headers: headers.map(String).slice(0, 200), mapping });
    send(req, res, 200, { ok: true });
  });
}
