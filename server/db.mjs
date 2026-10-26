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
  // 4: holiday work compensated as a day off ("leave") or payment ("pay") — the employee chooses
  `ALTER TABLE leave_requests ADD COLUMN comp_choice TEXT;`,
  // 5: an approver names a deputy for a period (e.g. while on leave)
  `CREATE TABLE approver_cover(id INTEGER PRIMARY KEY, approver_user_id INTEGER NOT NULL REFERENCES users(id), deputy_user_id INTEGER NOT NULL REFERENCES users(id),
     start_date TEXT NOT NULL, end_date TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL);`,
  // 6: cover created with an approver's own leave request (removed if that request is cancelled or rejected)
  `ALTER TABLE approver_cover ADD COLUMN request_id INTEGER;`,
  // 7: the consent document behind a cash payment (each consent pays out once)
  `ALTER TABLE leave_ledger ADD COLUMN file_id INTEGER;`,
  // 8: what was read from an ID/passport photo (suggestions; a person confirms before the profile changes)
  `ALTER TABLE files ADD COLUMN extracted TEXT;`,
  // 9: permissions — a personal break has a from and a to time (early_time holds the first, end_time the second)
  `ALTER TABLE leave_requests ADD COLUMN end_time TEXT;`,
  // 10: Staff Voice — suggestions, questions, complaints and notes to a manager, HR or the CEO, with replies
  `CREATE TABLE voice_messages(id INTEGER PRIMARY KEY, employee_id INTEGER REFERENCES employees(id), user_id INTEGER NOT NULL REFERENCES users(id),
     category TEXT NOT NULL CHECK(category IN ('suggestion','question','complaint','note','other')), subject TEXT NOT NULL, body TEXT NOT NULL,
     to_kind TEXT NOT NULL CHECK(to_kind IN ('manager','hr','ceo')), to_user_id INTEGER REFERENCES users(id),
     status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_review','answered','closed')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX vm_user ON voice_messages(user_id); CREATE INDEX vm_to ON voice_messages(to_kind, to_user_id, status);
   CREATE TABLE voice_replies(id INTEGER PRIMARY KEY, message_id INTEGER NOT NULL REFERENCES voice_messages(id), user_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL);
   ALTER TABLE files ADD COLUMN voice_id INTEGER;`,
  // 11: Staff Voice goes to a person (employee), so a manager without a login yet still receives it at first sign-in
  `ALTER TABLE voice_messages ADD COLUMN to_employee_id INTEGER REFERENCES employees(id);
   UPDATE voice_messages SET to_employee_id=(SELECT employee_id FROM users WHERE users.id=voice_messages.to_user_id) WHERE to_user_id IS NOT NULL;`,
  // 12: a "manager" role, and a "disabled" staff status (no access, kept on record). SQLite can't change a CHECK in place,
  // so both tables are rebuilt from their own current definition with only the CHECK widened.
  (db) => {
    rebuildWithCheck(db, "users", "CHECK(role IN ('staff','hr','accounts','ceo','admin'))", "CHECK(role IN ('staff','manager','hr','accounts','ceo','admin'))");
    rebuildWithCheck(db, "employees", "CHECK(status IN ('active','on_leave','resigned','terminated'))", "CHECK(status IN ('active','on_leave','resigned','terminated','disabled'))");
  },
  // 13: company calendar — days when leave can't be booked, and company occasions (official holidays stay in settings)
  `CREATE TABLE calendar_events(id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('blocked','event')), start_date TEXT NOT NULL, end_date TEXT NOT NULL,
     name TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL);
   CREATE INDEX ce_dates ON calendar_events(start_date, end_date);`,
  // 14: Admin can hide a Staff Voice message (then only Admin sees it)
  `ALTER TABLE voice_messages ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;`,
];

/** Recreate a table with one CHECK changed, keeping every row, id and column (foreign keys are off while this runs). */
function rebuildWithCheck(db, table, from, to) {
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!sql.includes(from)) throw new Error(`migration: ${table} does not have the expected CHECK`);
  const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table).map((r) => r.sql);
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name).join(",");
  db.exec(sql.replace(`CREATE TABLE ${table}`, `CREATE TABLE ${table}__new`).replace(from, to));
  db.exec(`INSERT INTO ${table}__new(${cols}) SELECT ${cols} FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}__new RENAME TO ${table};`);
  for (const i of indexes) db.exec(i);
}

export function openDb(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, "hr.db"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version));
  MIGRATIONS.forEach((m, i) => {
    const v = i + 1;
    if (done.has(v)) return;
    // table rebuilds run with foreign keys off (they must be switched outside a transaction), then are checked
    if (typeof m === "function") db.exec("PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON;");
    try {
      tx(db, () => { typeof m === "function" ? m(db) : db.exec(m); db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)").run(v, new Date().toISOString()); });
    } finally {
      if (typeof m === "function") db.exec("PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON;");
    }
    if (typeof m === "function") { const bad = db.prepare("PRAGMA foreign_key_check").all(); if (bad.length) throw new Error(`migration ${v} broke ${bad.length} links`); }
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
