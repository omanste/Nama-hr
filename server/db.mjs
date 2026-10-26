/* Database: one SQLite file (/data/hr.db) with numbered migrations.
 * Balances live in leave_ledger as integer minutes (1 day = 480); nothing edits a balance in place. */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS = [
  `CREATE TABLE users(
     id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, employee_id INTEGER REFERENCES employees(id),
     role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('staff','hr','accounts','ceo','admin')),
     auth_provider TEXT NOT NULL DEFAULT 'local', external_id TEXT,
     pw_hash TEXT, pw_salt TEXT, pw_iter INTEGER, must_change INTEGER NOT NULL DEFAULT 1,
     active INTEGER NOT NULL DEFAULT 1, lang TEXT NOT NULL DEFAULT 'ar',
     created_at TEXT NOT NULL, last_login_at TEXT);
   CREATE TABLE sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, ip TEXT, ua TEXT);
   CREATE TABLE departments(id INTEGER PRIMARY KEY, name_ar TEXT NOT NULL, name_en TEXT NOT NULL DEFAULT '',
     approver_employee_id INTEGER REFERENCES employees(id), active INTEGER NOT NULL DEFAULT 1);
   CREATE TABLE employees(
     id INTEGER PRIMARY KEY, emp_no TEXT NOT NULL UNIQUE COLLATE NOCASE, name_ar TEXT NOT NULL DEFAULT '', name_en TEXT NOT NULL DEFAULT '',
     photo_file_id INTEGER, civil_id TEXT, civil_id_expiry TEXT, nationality TEXT, dob TEXT, mobile TEXT, email TEXT, address TEXT,
     emergency_name TEXT, emergency_relation TEXT, emergency_phone TEXT,
     department_id INTEGER REFERENCES departments(id), job_title TEXT, manager_employee_id INTEGER REFERENCES employees(id),
     join_date TEXT, contract_type TEXT, contract_end TEXT,
     status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','on_leave','resigned','terminated')),
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE files(id INTEGER PRIMARY KEY, employee_id INTEGER REFERENCES employees(id), request_id INTEGER,
     kind TEXT NOT NULL DEFAULT 'doc', doc_type TEXT, name TEXT, mime TEXT, size INTEGER, expiry TEXT, note TEXT,
     uploaded_by INTEGER, uploaded_at TEXT NOT NULL);
   CREATE TABLE leave_requests(
     id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), type TEXT NOT NULL,
     start_date TEXT NOT NULL, end_date TEXT NOT NULL, early_time TEXT, minutes INTEGER NOT NULL, reason TEXT,
     status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
     approver_user_id INTEGER REFERENCES users(id), route_reason TEXT,
     decided_by INTEGER, decided_at TEXT, decision_comment TEXT, created_by INTEGER, created_at TEXT NOT NULL);
   CREATE INDEX lr_emp ON leave_requests(employee_id, status);
   CREATE INDEX lr_appr ON leave_requests(approver_user_id, status);
   CREATE TABLE request_events(id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES leave_requests(id),
     action TEXT NOT NULL, actor_user_id INTEGER, at TEXT NOT NULL, comment TEXT);
   CREATE TABLE leave_ledger(id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
     kind TEXT NOT NULL, minutes INTEGER NOT NULL, leave_year_start TEXT, effective_date TEXT NOT NULL, request_id INTEGER,
     note TEXT, created_by INTEGER, created_at TEXT NOT NULL);
   CREATE INDEX ll_emp ON leave_ledger(employee_id);
   CREATE TABLE notifications(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), title_ar TEXT, title_en TEXT,
     body_ar TEXT, body_en TEXT, link TEXT, read_at TEXT, created_at TEXT NOT NULL);
   CREATE INDEX nt_user ON notifications(user_id, read_at);
   CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE audit_log(id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor_user_id INTEGER, action TEXT NOT NULL,
     entity TEXT, entity_id TEXT, before TEXT, after TEXT);`,
  // 2: qualifications (from the staff questionnaire)
  `ALTER TABLE employees ADD COLUMN education TEXT; ALTER TABLE employees ADD COLUMN specialization TEXT;
   ALTER TABLE employees ADD COLUMN experience TEXT; ALTER TABLE employees ADD COLUMN languages TEXT;
   ALTER TABLE employees ADD COLUMN skills TEXT; ALTER TABLE employees ADD COLUMN certifications TEXT;
   ALTER TABLE employees ADD COLUMN main_tasks TEXT;`,
  // 3: Oman Labour Law — gender (maternity/paternity/child care), statutory leave details, HR review of balances over the cap
  `ALTER TABLE employees ADD COLUMN gender TEXT;
   ALTER TABLE leave_requests ADD COLUMN relation TEXT; ALTER TABLE leave_requests ADD COLUMN event_date TEXT;
   CREATE TABLE cap_reviews(id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), year_start TEXT NOT NULL,
     excess INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','forfeited','kept')),
     reason TEXT, decided_by INTEGER, decided_at TEXT, created_at TEXT NOT NULL, UNIQUE(employee_id, year_start));`,
];

export function openDb(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, "hr.db"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version));
  MIGRATIONS.forEach((sql, i) => {
    const v = i + 1;
    if (done.has(v)) return;
    tx(db, () => { db.exec(sql); db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)").run(v, new Date().toISOString()); });
  });
  return db;
}

let depth = 0;
/** Run fn inside a transaction; nested calls join the outer one. */
export function tx(db, fn) {
  if (depth > 0) return fn();
  db.exec("BEGIN IMMEDIATE");
  depth++;
  try { const out = fn(); db.exec("COMMIT"); return out; }
  catch (e) { try { db.exec("ROLLBACK"); } catch {} throw e; }
  finally { depth--; }
}

export const nowIso = () => new Date().toISOString();

export function getSetting(db, key, fallback = null) {
  const r = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return r ? JSON.parse(r.value) : fallback;
}
export function setSetting(db, key, value) {
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
}
