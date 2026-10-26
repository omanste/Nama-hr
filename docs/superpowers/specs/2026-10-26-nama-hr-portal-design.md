# Nama HR Portal — Phase 1 Design

Date: 2026-10-26 · Owner: Eng. Hassan Al Riyami · Status: draft for review

## 1. Purpose

A separate HR portal for Nama Real Estate, not connected to the CRM. Phase 1 covers staff profiles, annual and early leave with an approval workflow, a balance that updates automatically, and an import of the existing staff and leave-balance Excel sheet. The design leaves room for attendance-machine import, KPIs and payroll later.

Success means:
- staff apply for leave from their phone
- the right manager approves it
- the balance is right without anyone doing arithmetic
- HR can answer "who approved what, and when" for any request

## 2. Hosting and environments

| Environment | Domain | Branch | `APP_ENV` |
|---|---|---|---|
| Dev (built first) | `dev.hr.nama.omanste.com` | `dev` | `dev` (gold **DEV** badge) |
| Production (later) | `hr.nama.omanste.com` | `main` | `production` |

- Repo: `omanste/nama-hr` (private). Own database. No shared code or data with the CRM.
- Dokploy "Application", Dockerfile build, container port 3000, a separate `/data` volume per environment, HTTPS through Let's Encrypt. This matches the CRM's deployment.
- Everything is served from one container. Fonts and libraries are local, with no CDN or third-party services.

## 3. Technology

The stack mirrors the CRM so the same person can run both:

- **Node 24**, built-in `node:http`, `node:sqlite`, `node:crypto`. The only runtime dependency is `nodemailer`, for email over Nama's own SMTP.
- **SQLite** at `/data/hr.db` in WAL mode, with foreign keys on. Uploads go in `/data/uploads` and nightly backups in `/data/backups`, kept for 14 days.
- **Frontend:** plain JavaScript ES modules, a hash router and no build step. The code is split into small page modules (unlike the CRM's single file).
- **Excel parsing:** SheetJS (`xlsx.full.min.js`), served locally (the same file the CRM ships).
- **Time zone:** `Asia/Muscat` for "today", anniversaries and scheduled jobs.

### Server modules

| File | Responsibility |
|---|---|
| `server/index.mjs` | HTTP server, static files, route table, security headers |
| `server/db.mjs` | Schema and numbered migrations, query helpers, transactions |
| `server/auth.mjs` | Sessions, password provider, provider interface (Microsoft later) |
| `server/perm.mjs` | Role and permission checks (one place) |
| `server/leave.mjs` | Pure leave rules: day/hour maths, balance summary, anniversary rollover. No I/O. |
| `server/routing.mjs` | Who approves a given request |
| `server/requests.mjs` | Request lifecycle (submit / approve / reject / cancel) in transactions |
| `server/notify.mjs` | In-app notifications + email |
| `server/importer.mjs` | Validate and commit Excel import rows |
| `server/files.mjs` | Photo and document upload / download |
| `server/jobs.mjs` | Daily anniversary credit, nightly backup |
| `server/audit.mjs` | Append-only audit log |

### Frontend layout

`public/index.html`, `public/js/{app,api,i18n,ui}.js`, and `public/js/pages/*.js`. There is one module per page: login, home, profile, profile edit, staff list, leave request form, approvals, my history, import, settings, users, audit.

## 4. Roles and permissions

Each user has **one role**. "Department manager" is not a role: a person becomes a manager by being set as the approver of one or more departments (see section 5). For example, Tawfiq can have role `staff` and approve Sales, Rental and Maintenance.

| Capability | Staff | Dept manager* | HR Manager | Accounts | CEO | Admin |
|---|---|---|---|---|---|---|
| Own profile, balance, history | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Apply for annual / early leave | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| View department staff and their requests | – | own depts | all | all | all | all |
| Approve / reject | – | own depts' staff | **✗** | ✗ | managers' requests | all (fallback) |
| View all profiles and balances | – | – | ✓ | ✓ (read-only) | ✓ (read-only) | ✓ |
| Create / edit staff, upload documents | – | – | ✓ | ✗ | ✗ | ✓ |
| Balance adjustment (with reason) | – | – | ✓ | ✗ | ✗ | ✓ |
| Excel import | – | – | ✓ | ✗ | ✗ | ✓ |
| Departments, approvers, settings, users, roles | – | – | ✗ | ✗ | ✗ | ✓ |
| Audit log | – | – | ✓ (read) | ✓ (read) | ✓ (read) | ✓ |

\* Derived from being a department's approver. It combines with whatever the person's role is.

Every check runs on the server in `perm.mjs`. The UI only hides what the server would refuse anyway.

## 5. Approval routing

- Each **department** has a configurable **approver** (an employee), set in Admin → Departments.
  - Initial setup: Sales, Rental and Maintenance → Tawfiq. Finance → the Finance Manager.
  - Other departments are filled in by the admin.
- **Settings → "Managers' leave approver"** names the employee who approves leave for managers, with a title of either *CEO* or *Chairman*. Switching to the Chairman later is a settings change, not a code change.

`routing.approverFor(employee)` decides who approves:

1. If the employee is the managers' leave approver (for example, the CEO) → **Admin**.
2. Else, if the employee approves any department, or has role `hr` or `ceo` → **managers' leave approver**.
3. Else → the approver of the employee's department.
4. If the target is empty, or is the requester themself → **Admin**.

The approver is **fixed when the request is submitted** and stored on the request. Admin can always approve or reject any pending request, and when they do it is recorded as "by Admin".

The *direct manager* profile field is for information only. It does not drive routing.

## 6. Leave rules

### Units

All balance amounts are stored as **integer minutes**:
- 1 day = 8 h = 480 min
- 30 days = 14,400 min
- 60 days = 28,800 min

This avoids rounding drift. The display shows days with up to two decimals, for example "12.75 days", plus hours for early leave.

### Ledger

The balance is the **sum of ledger rows**. It is never edited directly.

| `kind` | Sign | Created by |
|---|---|---|
| `opening` | + | Excel import or HR on profile creation (starting balance) |
| `annual_credit` | + | Anniversary job (+30 days) |
| `cap_forfeit` | − | Anniversary job (amount above 60 days) |
| `annual_leave` | − | Approval of an annual-leave request |
| `early_leave` | − | Approval of an early-leave request |
| `comp_credit` | + | Approval of a "worked on holiday" request (+1 day per date) |
| `reversal` | ± | Cancelling an already-approved request (undoes its row) |
| `adjustment` | ± | HR or Admin, with a required reason |

Every row stores:
- employee
- minutes
- the leave year it belongs to
- the related request (if any)
- who created it and when
- a note

Future modules (attendance, payroll) add new `kind`s. The rest of the ledger design stays the same.

### Leave year

- Each employee's leave year starts on their **join-date anniversary**. Someone who joined on 29 February uses 28 February in non-leap years.
- **New employee** (created in the app): an `annual_credit` of 30 days is posted for the leave year that starts on the join date.
- **Imported employee:** the sheet's *remaining* balance is posted as `opening`, as of the import date, even when it is above 60 days. The next `annual_credit` is posted on their next anniversary after the import date. The sheet's 1 January 2026 credit counts as their current leave year, so there is no double credit. The 60-day cap first applies at that next credit.
- **Missing join date** (existing staff): no anniversary credit is posted, and the person appears on HR's "needs attention" list until a date is set. The 6-month rule is not enforced for them.
- **Anniversary job** (daily, 00:05 Muscat):
  1. For each active employee whose anniversary is today, and who has no credit yet for the new leave year, post +30 days.
  2. If the total balance is then over 60 days, post a `cap_forfeit` for the excess.
  3. Unused days carry over automatically, because the ledger simply continues.
  4. The job is idempotent and catches up on missed days, for example if the server was down.

### Summary shown on the profile

Values are for the current leave year:
- **Entitlement:** credits posted this leave year, either the annual credit or the opening balance from the import.
- **Carried over:** the balance at the start of this leave year, before this year's credit. This is 0 for an imported opening balance.
- **Extra days:** approved "worked on holiday" credits this leave year.
- **Used:** approved annual and early leave this leave year, net of reversals.
- **Adjustments:** shown only if not zero.
- **Remaining:** the total ledger balance.
- **Pending:** the total of submitted requests that are not yet decided.
- **Available to request:** remaining minus pending.

### Service rules

- **Probation:** the first 3 months after the join date. The probation end date (join date + 3 months) is shown on the profile. On the end date HR gets an in-app reminder.
- **Leave eligibility:** annual and early leave can only start on or after **join date + 6 months**. An earlier date is refused with "Leave is available from DD/MM/YYYY". Record-only types are allowed at any time.

### Leave types

| Type | Input | Effect on balance |
|---|---|---|
| `annual` | start and end date | − calendar days × 480 |
| `early` | date and leave time | − (17:00 − time) |
| `emergency` (اضطرارية) | start and end date | none (recorded only) |
| `bereavement` (عزاء) | start and end date | none (recorded only) |
| `sick` (مرضية) | start and end date, optional attachment (medical note) | none (recorded only) |
| `comp_day` (worked on holiday) | the date worked, which must be today or earlier | + 1 day (480) |

- Every type goes through the same approval routing and history.
- Record-only types skip the balance check and the 6-month rule, but they do get overlap checks.
- The profile shows totals per type for the current leave year, mirroring the sheet's columns.
- A `comp_day` can only be claimed once per date.

### Annual leave

- The request has a start date and an end date, both inclusive. **Calendar days** are counted, weekends included.
  - Days = (end − start) + 1.
  - Minutes = days × 480.
- The end date must be on or after the start date, and the range is limited to 60 days.
- The request must not overlap another pending or approved request from the same employee.

### Early leave

- The request has a date and a leave time. The time is between 09:30 and 16:30, in **30-minute steps**.
  - Hours = 17:00 − leave time.
  - Minutes = hours × 60.
  - For example, leaving at 15:30 deducts 1.5 h, which is 0.19 days.
- One early-leave request per employee per date.
- It must not fall on a date covered by a pending or approved annual leave.

### Balance check

Applies to annual and early leave only.

- **At submission:** request minutes ≤ remaining − pending. If not, the request is refused with "exceeds your available balance (X days)".
- **At approval:** the check runs again (request minutes ≤ remaining − other pending requests). This catches balances that changed after the request was made.

### Lifecycle

`pending → approved | rejected | cancelled`, and an approved request can become `cancelled`.

- **Approve:** in one transaction, the request is marked approved and its ledger row is posted (a deduction for annual or early leave, a `comp_credit` for a comp day, nothing for record-only types).
- **Reject:** the rejection requires a comment.
- **Cancel (pending):** by the requester, HR or Admin.
- **Cancel (approved):** by its approver or Admin. This posts a `reversal` that undoes the ledger row, if there was one.

Every transition writes a `request_events` row recording:
- who acted
- the action
- when
- any comment

This gives the full history of who requested, who approved and when.

## 7. Notifications

- In-app: a `notifications` table, a bell with an unread count (polled every 60 s), and a list page.
- Email through nodemailer and the SMTP settings in env. If `SMTP_HOST` is empty, email is off. On dev, the subject is prefixed with `[dev]`.

| Event | Who is notified |
|---|---|
| Request submitted | Approver (copy to the requester) |
| Request approved / rejected / cancelled | Requester (copy to the approver when someone else acts) |
| Anniversary credit / cap forfeit | Employee |
| Civil ID expiring within 30 days (daily check) | HR (in-app) |

- Emails are bilingual: the Arabic text first, then the English. Each email has a link to the request.
- An email that fails to send is logged and never blocks the action.

## 8. Staff profile

Profile fields:
- Name (Arabic), Name (English)
- Employee ID (unique)
- Photo
- Civil ID number and civil ID expiry
- Nationality, date of birth
- Mobile, email, address
- Emergency contact (name, relationship, phone)
- Department, job title, direct manager (an employee)
- Join date
- Contract type (Unlimited / Limited / Probation / Part-time; admin can edit the list) and contract end date
- Status (Active / On leave / Resigned / Terminated)

Other parts of the profile:
- **Documents:** upload PDF, JPG or PNG files of up to 10 MB each. Each document has a type (Civil ID, Passport, Contract, Visa, Certificate, Other), an optional expiry date and a note. Downloads require a session and the right permission.
- **Leave section:** the summary from section 6, the request history, and the ledger history (HR and Admin see every row).
- **KPI section:** an empty placeholder card ("Coming in a later phase").

When status changes to Resigned or Terminated, the person's login is disabled, and they are excluded from the anniversary job and from approver choices.

## 9. Sign-in

The sign-in works the same way as the CRM:
- username and password
- PBKDF2-SHA256 hashes (150k iterations)
- an HttpOnly, SameSite=Lax session cookie (Secure behind HTTPS), lasting 12 h by default
- lock-out for 10 minutes after 6 failed attempts per username plus IP address
- a forced password change on first sign-in, with a minimum of 8 characters

Accounts work like this:
- `users` rows link to an `employee` (optional for a pure admin account) and carry `auth_provider` (`local` now) and `external_id` (empty now).
- **First boot:** if there are no users, the server creates the admin from `ADMIN_USERNAME` and `ADMIN_PASSWORD` in the environment, with a forced password change. Without those values, it refuses to create one and logs how to fix it.
- HR and Admin create logins from a profile. The username defaults to the employee ID, and the account starts with a one-time password that has to be changed.
- Admin can reset a password, which issues a new one-time password.

**Microsoft sign-in later:** `auth.mjs` exposes providers through `{ id, startLogin(req,res), finishLogin(req) → {externalId,email} }`. Adding Entra ID (OIDC) means adding one provider and matching users by email or `external_id`. Sessions, roles and every other part of the app stay unchanged.

## 10. Excel import (HR/Admin page)

The import is a full page with four steps:

1. **Upload:** an `.xlsx`, `.xls` or `.csv` file, parsed in the browser. Pick the sheet, the header rows and the "balance as of" date (default: today). A blank template can be downloaded.
   - The header can span 1 or 2 rows. Merged cells are filled across, and the two rows are joined into labels like "2026 / سنوية".
   - Data ends at the first row with no name, so the extra-days table underneath the staff list is ignored.
2. **Map columns:** each of the file's columns is mapped to a profile field or to *Opening balance (days)*, or ignored. Columns whose header names match a field are auto-matched, in Arabic or English. The mapping is remembered for next time.
3. **Preview:** the server validates every row and returns errors and warnings per row and per cell.
   - **Employee ID:** if the column is unmapped or the cell is empty, an ID is generated (`NAMA-001`, `NAMA-002`…, continuing from the highest existing one). This is shown in the preview as "generated".
   - **Errors** (the row is skipped): missing both names, Employee ID duplicated in the file or already in the system, invalid dates, non-numeric balance, negative balance.
   - **Warnings** (the row is imported): unknown department (it will be created), balance over 60 (kept as is; the cap applies at the next anniversary credit), missing join date (no anniversary credit until one is set), empty balance (imported as 0), civil ID already expired.
   - Counts are shown, and rows can be filtered to errors only.
4. **Commit:** one transaction creates the employees, the departments, the `opening` ledger rows and, optionally, their logins (username = employee ID, one-time password shown once on screen as a downloadable list). It ends with a summary and an entry in the audit log.

## 11. Interface

- **Arabic by default (RTL), with an English toggle (LTR).** The choice is saved per user. Every string is in `i18n.js`. Dates use the Gregorian calendar, written `DD/MM/YYYY`.
- **Brand:** the Nama logo and icons are copied from the CRM's `public/`, with the CRM's green and gold tokens:
  - brand `#154540`, gold `#A8843A`, background `#F2F5F3`
  - a dark-mode set
  - fonts: IBM Plex Sans Arabic and Readex Pro, local files
- **Mobile-first layout:** a bottom tab bar on phones and a sidebar on desktop.
- **Big forms open as full pages with their own URL:** leave request, profile edit, import, settings. Only short confirmations ("Reject — reason?") use a small dialog.
- **Home page by role:**
  - Staff: their balance card and an "Apply" button.
  - Managers: a count of pending approvals.
  - HR: staff counts, expiring civil IDs, recent requests.

## 12. Data model (SQLite)

- `users`(id, username UNIQUE, employee_id, role, auth_provider, external_id, pw_hash, pw_salt, pw_iter, must_change, active, lang, created_at, last_login_at)
- `sessions`(token, user_id, created_at, last_seen_at, ip, ua)
- `departments`(id, name_ar, name_en, approver_employee_id, active)
- `employees`(id, emp_no UNIQUE, name_ar, name_en, photo_file_id, civil_id, civil_id_expiry, nationality, dob, mobile, email, address, emergency_name, emergency_relation, emergency_phone, department_id, job_title, manager_employee_id, join_date, contract_type, contract_end, status, created_at, updated_at)
- `files`(id, employee_id, kind, doc_type, name, mime, size, expiry, note, uploaded_by, uploaded_at)
- `leave_requests`(id, employee_id, type `annual|early|emergency|bereavement|sick|comp_day`, start_date, end_date, early_time, minutes, reason, status, approver_user_id, decided_by, decided_at, decision_comment, created_by, created_at)
- `request_events`(id, request_id, action, actor_user_id, at, comment)
- `leave_ledger`(id, employee_id, kind, minutes, leave_year_start, request_id, note, created_by, created_at)
- `notifications`(id, user_id, title_ar, title_en, body_ar, body_en, link, read_at, created_at)
- `settings`(key PRIMARY KEY, value JSON). This holds the managers' approver, its title, contract types, SMTP display name and import mappings.
- `audit_log`(id, at, actor_user_id, action, entity, entity_id, before JSON, after JSON)
- `schema_migrations`(version, applied_at)

Placeholders for later phases (none of these are created in phase 1):
- `attendance_*` tables, whose results become `early_leave`-style ledger rows or their own records
- `kpi_*` tables
- `payroll_*` tables

## 13. Operations

- `/api/health` is used for the Docker health check.
- Nightly SQLite backup at 02:00 Muscat time, kept for 14 days. Admin can download a backup on demand.
- Environment variables: `APP_ENV`, `PORT`, `DATA_DIR`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_HOURS`, `PUBLIC_URL`, `SMTP_HOST/PORT/SECURE/USER/PASS/FROM`, `BACKUP_TIME`, `BACKUP_KEEP_DAYS`.
- Real staff data never goes in git. `.gitignore` blocks `data/`, `*.db`, `*.xlsx`, `.env` and backups.
- `DEPLOY-DOKPLOY.md` gives the step-by-step setup in Arabic and English, in the same style as the CRM's guide.

## 14. Testing

- **Unit tests** (`node --test`):
  - `leave.mjs`: day counts, early-leave hours, anniversary dates (including 29 February), rollover with the cap, summary figures
  - `routing.mjs`: every routing rule above
- **API tests:** a server started against a temporary data directory runs through every role. Each role tries its allowed and forbidden actions. They cover:
  - balance checks at submission and at approval
  - approve → ledger deduction
  - cancel → reversal
  - HR cannot approve
  - Accounts cannot write
  - import preview and commit
- **UI smoke test** with Playwright: login, apply, approve in Arabic and English, at phone width.

## 15. Out of scope for phase 1, but designed for

- Attendance-machine import: a new module plus ledger kinds, with no change to requests.
- KPIs: the empty profile section and future `kpi_*` tables.
- Payroll: future tables reading employees and the ledger.
- Microsoft sign-in: the provider interface in section 9.
- More leave types (unpaid, maternity, Hajj): `leave_requests.type` is an open list. A new type is a config entry saying whether it deducts, adds or only records.

## 16. Confirmed decisions and assumptions

| Item | Decision |
|---|---|
| Leave year | Join-date anniversary (confirmed) |
| Probation / eligibility | 3-month probation; annual and early leave only from join + 6 months (confirmed) |
| Imported balances over 60 | Kept; cap applies at next anniversary credit (confirmed) |
| Emergency / bereavement / sick | Record-only types with approval (confirmed) |
| Worked on holiday | Request + approval, +1 day each (confirmed) |
| Import with no Employee ID | Generated `NAMA-###` |
| Annual-leave day count | Calendar days (confirmed) |
| Early-leave step | 30 minutes (confirmed) |
| New joiner first credit | 30 days on join date |
| Imported staff | Sheet balance = opening; next +30 on next anniversary |
| Early leave | Same-day; deducts leave time → 17:00 |
| CEO's own leave | Approved / recorded by Admin |
| HR adjustments | Allowed with mandatory reason, audited |
| 60-day cap | Applied at each anniversary credit (and at import); excess forfeited and recorded |

## 17. Addendum (2026-10-26): staff questionnaire import

These changes were added after the spec was approved, for importing the staff questionnaire (a Google Form export).

- **Qualifications on the profile.** New text fields: education, specialization, years of experience, languages, skills, courses & certifications, main tasks. They can be edited by HR and Admin, and imported. Skills and main tasks hold up to 4000 characters; other text fields up to 300.
- **Import column "Direct manager".** Matched by employee ID or exact name (Arabic or English), against the file or existing staff. A manager the import can't find gives the warning `unknown_manager` and is left empty.
- **Departments written "English | Arabic".** A value like "Sales | المبيعات" creates or matches one department with both names.
- **Re-import protection.** A row without an employee ID is refused (`already_exists`) when someone with the same name and join date is already in the system.
