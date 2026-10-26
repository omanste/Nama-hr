# Nama HR Portal Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted bilingual HR portal on dev, covering profiles, leave with approvals and a ledger, notifications and the Excel import.

**Architecture:** A single Node 24 process serves a JSON API and static ES-module frontend. SQLite (`node:sqlite`) holds relational tables. Leave balances are an append-only minutes ledger. The pure rule modules (`leave.mjs`, `routing.mjs`) are kept separate from I/O so they can be unit-tested.

**Tech Stack:** Node ≥ 24, `node:http`, `node:sqlite`, `node:crypto`, `node:test`, nodemailer 10, SheetJS (vendored), Playwright (pre-installed, tests only).

**Spec:** `docs/superpowers/specs/2026-10-26-nama-hr-portal-design.md`

## Global Constraints

- Runtime dependency is only `nodemailer`. No frameworks, no CDN. Fonts, logo and xlsx are copied from `omanste/nama` `public/`.
- Amounts are integer minutes. `DAY = 480`, `ANNUAL = 14400`, `CAP = 28800`.
- Time zone `Asia/Muscat`. Dates are ISO `YYYY-MM-DD` in the API and shown as `DD/MM/YYYY`.
- Early-leave time is from `09:30` to `16:30` in 30-minute steps. Minutes = `17:00 − time`.
- Annual leave counts calendar days inclusive, with a maximum range of 60 days.
- Roles are `staff | hr | accounts | ceo | admin`. "Manager" means the person is a department approver.
- Arabic is the default (RTL). Every UI string lives in `public/js/i18n.js` with both `ar` and `en`.
- Brand tokens: `--brand:#154540`, `--gold:#A8843A`, `--bg:#F2F5F3`, plus a dark set copied from the CRM.
- Big forms are full pages with their own hash route. Only confirmations use a dialog.
- API errors use the shape `{error:"code", message:"text"}` with the right HTTP status. Permission failures return 403.
- Real data never goes in git. `.gitignore` blocks `data/ *.db* *.xlsx *.xls *.csv .env backups/`.

## Review Focus

1. **Two pending requests that together exceed the balance.** The second submission is refused, because it is checked against remaining − pending. If balances changed later, approving the second one is still refused. (Test added in Task 6.)
2. **An anniversary on 29 February, or a job that missed several days** (server down). The credit is posted exactly once per leave year and the cap is applied. (Tasks 2 and 7.)
3. **Excel cells with Excel date serials, text dates `DD/MM/YYYY`, Arabic-Indic digits, or trailing spaces in an Employee ID.** These are normalised before validation, not flagged as errors. (Task 8.)
4. **The approver changes, or the approver resigns, while a request is pending.** The stored approver keeps it. Admin can still act. A resigned approver can't sign in. (Task 6.)
5. **A session for a user whose employee became Resigned.** The next request gets a 401. (Task 4.)

---

### Task 1: Scaffold, database, health, container

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`, `.dockerignore`, `Dockerfile`, `server/index.mjs`, `server/db.mjs`, `server/http.mjs`, `tests/helpers.mjs`, `tests/api.health.test.mjs`
- Create: `public/` (copy `fonts/`, `fonts.css`, `logo-wordmark.png`, `icon-192.png`, `icon-512.png`, `vendor/xlsx.full.min.js` from `/home/user/nama/public`)

**Interfaces (Produces):**
- `openDb(dataDir) → DatabaseSync`. Runs the numbered migrations in `MIGRATIONS[]`, which create every table in spec §12.
- `tx(db, fn)` wraps `fn` in BEGIN / COMMIT / ROLLBACK.
- `server/http.mjs`: `send(res, code, obj)`, `fail(res, code, err, msg)`, `readJson(req, limit)`, `serveStatic(req, res)`, `router()` with `.get/.post/.put/.delete(pattern, handler)`. `:param` segments go to `req.params`.
- `startServer({dataDir, port, env}) → {server, db, close()}`, exported so tests can start the server in-process.
- `tests/helpers.mjs`: `boot()` starts a server on a random port with a temp `DATA_DIR`, `ADMIN_USERNAME=admin` and `ADMIN_PASSWORD=Admin#2026`. It returns `{base, db, close}`. `client(base)` returns `{get, post, put, del, upload}` and keeps the cookie.

- [ ] Write `tests/api.health.test.mjs`: `GET /api/health` → 200 `{ok:true, env:"test"}`. `GET /` → 200 HTML containing `lang="ar"`.
- [ ] Run `node --test tests/` → FAIL.
- [ ] Implement it, with the same security headers and gzip as the CRM `server/index.mjs`. The Dockerfile copies the CRM's (non-root `node` user, `/data` volume, health check), with the CMD `node server/index.mjs`.
- [ ] Run `node --test tests/` → PASS. `docker build` is not available; check the Dockerfile by reading it.
- [ ] Commit `feat: scaffold server, schema, health`.

### Task 2: Leave rules engine (pure)

**Files:** Create `server/leave.mjs`, `tests/leave.test.mjs`

**Interfaces (Produces):**
- `DAY, ANNUAL, CAP` constants
- `annualMinutes(start, end) → number`. Throws `RangeError` for end < start or a range over 60 days.
- `earlyMinutes(time) → number`. Valid values are `"09:30"…"16:30"` in 30-minute steps. Anything else throws.
- `anniversaryOn(joinDate, year) → "YYYY-MM-DD"` (29 February becomes 28 February in non-leap years)
- `leaveYearStart(joinDate, today) → "YYYY-MM-DD"`, the latest anniversary on or before today
- `dueCredits(joinDate, today, creditedYearStarts:Set) → string[]`, the leave-year starts that still need a credit. This is only from the join date onward, and only years at or after `firstCreditFrom` if one is given. The signature is `dueCredits(joinDate, today, credited, firstCreditFrom?)`.
- `capForfeit(balanceAfterCredit) → number`, which is `max(0, balance − CAP)`
- `summarize(ledgerRows, pendingMinutes, yearStart) → {entitlement, carried, used, adjustments, remaining, pending, available}`, all in minutes
- `fmtDays(min) → "12.75"`

- [ ] Write the tests:
  - `annualMinutes("2026-11-01","2026-11-05") === 2400`
  - same day → 480
  - a range over 60 days throws
  - `earlyMinutes("15:30") === 90`, `earlyMinutes("09:30") === 450`
  - `"15:15"` throws, and `"17:00"` throws
  - `anniversaryOn("2024-02-29", 2027) === "2027-02-28"`
  - `leaveYearStart("2020-03-10","2026-03-09") === "2025-03-10"`
  - `dueCredits("2024-01-10","2026-10-26", new Set(["2024-01-10"]))` deep-equals `["2025-01-10","2026-01-10"]`
  - `capForfeit(30000) === 1200`
  - `summarize`: carried 10 d + credit 30 d − used 5 d in the year → `{entitlement:14400, carried:4800, used:2400, remaining:16800}`
  - with pending 960 → `available:15840`
- [ ] Run `node --test tests/leave.test.mjs` → FAIL.
  - a 50-day carry with `cap_forfeit −20 d` in the year → `carried` is 30 d (after the cap) and `remaining` is 60 d
- [ ] Implement it. Date maths uses UTC `Date` on ISO strings only, with no local-time parsing. Every ledger row has `leave_year_start`. The summary values are:
  - `carried`: the sum of rows with `leave_year_start < yearStart`, plus this year's `cap_forfeit`
  - `entitlement`: `annual_credit` + `opening` rows in the year
  - `used`: −(`annual_leave` + `early_leave` + `reversal`) in the year
  - `adjustments`: `adjustment` rows in the year
  - `remaining`: the sum of all rows
- [ ] Run → PASS. Commit `feat: leave rules engine`.

### Task 3: Approval routing (pure)

**Files:** Create `server/routing.mjs`, `tests/routing.test.mjs`

**Interfaces (Produces):** `approverFor({employee, role}, ctx) → {userId, reason}`
- `ctx = {departments:[{id, approver_employee_id}], managersApproverEmployeeId, userIdByEmployee(id) → userId|null, adminUserId}`
- `reason ∈ "dept" | "managers" | "admin"`

- [ ] Write tests covering each rule in spec §5:
  - Sales staff → Tawfiq ("dept")
  - Tawfiq → CEO ("managers")
  - HR role → CEO
  - CEO → admin
  - a department with no approver → admin
  - an approver whose user is missing → admin
  - an employee who approves their own department → managers' approver
  - after switching `managersApproverEmployeeId` to the Chairman, Tawfiq → Chairman
- [ ] FAIL → implement → PASS. Commit `feat: approval routing`.

### Task 4: Auth, sessions, permissions, audit

**Files:** Create `server/auth.mjs`, `server/perm.mjs`, `server/audit.mjs`, `tests/api.auth.test.mjs`

**Interfaces (Produces):**
- `hashPassword(pw) → {hash, salt, iter}` and `verifyPassword(pw, row) → bool` (PBKDF2-SHA256, 150000 iterations, 32 bytes, base64)
- `providers = {local}`. Each provider is `{id, login(body) → user|null}`. Microsoft is a later addition with the same shape plus `startLogin` / `finishLogin`.
- `getSession(req) → {user, employee}|null`. The cookie is `hr_sid`. It returns null when the session is expired (`SESSION_HOURS`, default 12), the user is inactive, or the employee status is `resigned` or `terminated`.
- `ensureAdmin(db, env)` runs on boot when there are no users.
- `perm.can(sess, action, target?) → bool`. Actions: `employee.view`, `employee.viewAll`, `employee.edit`, `ledger.adjust`, `request.decide`, `import.run`, `settings.edit`, `users.manage`, `audit.view`. The matrix is spec §4. `request.decide` is true for the stored approver or admin. HR, accounts and ceo are false unless they are the stored approver.
- `isApprover(db, employeeId) → bool`
- `audit(db, actorUserId, action, entity, entityId, before, after)`
- Routes:
  - `POST /api/login {username, password}` → `{user, mustChange}`
  - `POST /api/logout`
  - `GET /api/me` → `{user:{id, username, role, lang, mustChange}, employee, isApprover}`
  - `POST /api/me/password {current, next}` (8 or more characters)
  - `PUT /api/me/lang`
  - While `mustChange` is set, every other `/api/*` call apart from those four returns 403 `must_change_password`.
- Lock-out: 6 failures per `username|ip` locks for 10 minutes, returning 429 `locked`.

- [ ] Write the tests:
  - admin login with the env password → `mustChange:true`
  - `GET /api/employees` → 403 `must_change_password`
  - changing the password → 200, and the old password then fails
  - 6 bad tries → 429
  - logout → `/api/me` 401
  - a session for a user whose employee status is set to `resigned` → 401 (Review Focus 5)
- [ ] FAIL → implement → PASS. Commit `feat: auth, sessions, permissions, audit`.

### Task 5: Employees, departments, settings, users, files

**Files:** Create `server/employees.mjs`, `server/files.mjs`, `server/admin.mjs`, `tests/api.employees.test.mjs`

**Interfaces (Produces):**
- `GET /api/employees?q=&dept=&status=`. Results depend on the caller:
  - HR, accounts, ceo, admin → all employees
  - an approver → their departments' employees plus themself
  - staff → 403
- `GET /api/employees/:id`. Allowed for the employee themself or anyone with `employee.viewAll`, or for the approver of their department. It returns the profile plus `leave: summarize(...)`, `requests`, and `ledger` (HR and admin only).
- `POST /api/employees` and `PUT /api/employees/:id` require `employee.edit`. Both validate the spec §8 fields. `emp_no` is unique, so a duplicate returns 409 `duplicate_emp_no`. Dates must be ISO. `name_ar` or `name_en` is required.
  - On create with `join_date`, post an `annual_credit` of `ANNUAL` for `leaveYearStart(join_date, today)`.
  - An optional `opening_days` posts an `opening` row instead of that credit.
  - Changing status to resigned or terminated deactivates the user.
- `POST /api/employees/:id/adjust {minutes, note}` requires `ledger.adjust`. The note is required.
- `GET/POST/PUT /api/departments`, `GET/PUT /api/settings` (keys `managers_approver_employee_id`, `managers_approver_title ∈ ceo|chairman`, `contract_types`), and `GET/POST/PUT /api/users` with `POST /api/users/:id/reset`, which returns `{tempPassword}`.
  - Writes require `settings.edit` or `users.manage` (admin only). Reads of departments are available to any logged-in user.
- `POST /api/employees/:id/files?doc_type=&expiry=&kind=photo|doc` takes a raw body and the `Content-Type` header. Allowed types are pdf, jpeg, png and webp (photo: images only), up to 10 MB. The file is stored as `/data/uploads/<id>`.
  - `GET /api/files/:id` uses the same view permission as the employee.
  - `DELETE /api/files/:id` requires `employee.edit`.
- Every write calls `audit`.

- [ ] Write the tests:
  - HR creates an employee → 201, and the summary shows `remaining 14400`
  - accounts POST → 403, accounts GET list → 200
  - a staff user GETs another employee → 403
  - staff GETs self → 200
  - duplicate `emp_no` → 409
  - uploading a `.exe` content type → 415
  - adjustment without a note → 400
  - admin sets the Sales department approver; a non-admin PUT on settings → 403
- [ ] FAIL → implement → PASS. Commit `feat: employees, departments, settings, files`.

### Task 6: Leave requests, ledger postings, notifications

**Files:** Create `server/requests.mjs`, `server/notify.mjs`, `tests/api.requests.test.mjs`

**Interfaces (Consumes):** `annualMinutes`, `earlyMinutes`, `summarize` (Task 2), `approverFor` (Task 3), `perm.can` (Task 4)

**Interfaces (Produces):**
- `POST /api/requests {type:"annual", start, end, reason}` or `{type:"early", date, time, reason}`
  - Validates the input, checks for overlaps, and checks the request against `available`. Errors: 400 `invalid`, 409 `overlap`, 409 `insufficient_balance` (message contains the available days).
  - Stores `approver_user_id` from `approverFor`, writes the `submitted` event, and notifies.
- `GET /api/requests?scope=mine|approvals|all&status=`
  - `approvals` = pending requests where I am the stored approver, or all pending requests for admin
  - `all` requires `employee.viewAll`
- `GET /api/requests/:id` returns the request with its events.
- `POST /api/requests/:id/approve {comment?}`
  - Requires `perm.can(sess, "request.decide", req)`. Re-checks the balance, then in one `tx` sets the status and posts a ledger row of kind `annual_leave` or `early_leave` with `−minutes`.
- `POST /api/requests/:id/reject {comment}`. The comment is required.
- `POST /api/requests/:id/cancel {comment?}`
  - For a pending request: the owner, HR or admin.
  - For an approved request: the stored approver or admin. This posts a `reversal` of `+minutes`.
- `notify(db, userIds, {title_ar, title_en, body_ar, body_en, link})` inserts notifications and sends email if SMTP is configured. On dev the subject is prefixed `[dev]`. A failed send is logged and never thrown. Mail sending is injectable (`setTransport(fn)`) so tests can capture it.
- `GET /api/notifications` → `{items, unread}`, and `POST /api/notifications/read {ids|all}`.

- [ ] Write the tests. Seed admin, CEO, Tawfiq (approver of Sales), an HR user and a Sales staff member with a 10-day balance.
  - Staff requests 5 days → pending, approver = Tawfiq, and Tawfiq has a notification and a captured email.
  - A second 6-day request → 409 `insufficient_balance` (Review Focus 1).
  - HR approves → 403. Tawfiq approves → 200, and the staff member's remaining is 2400.
  - An early request at `15:30` → pending. When approved, remaining is 2310.
  - Cancelling the approved annual request as Tawfiq → reversal, and remaining is back.
  - Tawfiq requests leave → approver = CEO.
  - Admin changes Sales' approver while a request is pending → the request keeps Tawfiq, and admin can still approve (Review Focus 4).
  - Rejecting without a comment → 400.
  - An overlapping annual request → 409 `overlap`.
  - The event history lists submitted and approved, with actor and time.
- [ ] FAIL → implement → PASS. Commit `feat: leave requests, approvals, notifications`.

### Task 7: Scheduled jobs

**Files:** Create `server/jobs.mjs`, `tests/jobs.test.mjs`

**Interfaces (Produces):**
- `runAnniversaries(db, today)` posts the missing credits from `dueCredits` (with `firstCreditFrom` = the day after the employee's `opening` row date, if they have one), followed by `capForfeit` rows. It notifies and returns a count.
- `runExpiryCheck(db, today)` notifies HR users about civil IDs expiring within 30 days, at most once per employee per expiry date (tracked in settings key `expiry_notified`).
- `backup(db, dataDir, keepDays)` uses `VACUUM INTO /data/backups/hr-YYYY-MM-DD.db` and prunes old copies.
- `scheduleJobs(db, env)` runs the anniversary and expiry checks at boot and every day at 00:05 Muscat, and the backup at `BACKUP_TIME` (default `02:00`).
- `GET /api/admin/backup` (admin) downloads the current database file.

- [ ] Write the tests:
  - an employee joined `2024-02-29` with a credit for `2024-02-29`; run for today `2026-03-01` → credits for 2025-02-28 and 2026-02-28 are posted
  - running again posts nothing
  - a 50-day balance plus a credit → a forfeit of 20 days
  - an imported opening on `2026-10-01` with a join date of `2019-05-05` → no credit until `2027-05-05`
- [ ] FAIL → implement → PASS. Commit `feat: anniversary credits, expiry alerts, backups`.

### Task 8: Excel import API

**Files:** Create `server/importer.mjs`, `tests/import.test.mjs`

**Interfaces (Produces):**
- `normalizeRow(raw, mapping) → {values, issues}`. This handles:
  - Excel serial numbers turned into ISO dates
  - `DD/MM/YYYY` and `D-M-YYYY` turned into ISO
  - Arabic-Indic digits turned into ASCII
  - trimming
  - department matched by `name_en` or `name_ar`, case-insensitive
- `validateRows(db, rows, mapping) → [{row, values, errors:[{field,code}], warnings:[{field,code}]}]`, using the codes in spec §10.
- `POST /api/import/preview {rows, mapping}` and `POST /api/import/commit {rows, mapping, createLogins}` require `import.run`.
  - Commit runs validation again, and rows with errors are skipped.
  - In one `tx` it creates departments, employees and `opening` rows (capped, plus a `cap_forfeit`), and optionally users with a random 10-character temporary password and `must_change`.
  - It returns `{created, skipped, logins:[{emp_no, username, tempPassword}]}` and writes an audit entry.
- Mapping fields are the spec §8 field keys plus `opening_days`.

- [ ] Write the tests:
  - `normalizeRow` turns `45658` into `"2025-01-01"`, `"٢٥/١٢/٢٠٢٤"` into `"2024-12-25"`, and `" E001 "` into `"E001"` (Review Focus 3)
  - preview flags a duplicate ID in the file, an existing ID, a bad date and a negative balance as errors
  - an unknown department and a balance of 75 are warnings
  - commit creates N employees; the 75-day row has remaining 28800 plus a forfeit row
  - `createLogins` returns temporary passwords that work for login
  - accounts calling preview → 403
- [ ] FAIL → implement → PASS. Commit `feat: excel import validation and commit`.

### Task 9: Frontend shell (i18n, layout, login, home)

**Files:** Create `public/index.html`, `public/app.css`, `public/js/app.js`, `public/js/api.js`, `public/js/i18n.js`, `public/js/ui.js`, `public/js/pages/login.js`, `public/js/pages/home.js`, `public/js/pages/password.js`, `public/manifest.webmanifest`

**Interfaces (Produces):**
- `api.get/post/put/del/upload(path, body)` returns the parsed JSON or throws `{status, error, message}`. A 401 sends the user to `#/login`.
- `t(key, vars)` and `setLang("ar"|"en")`, which sets `<html dir lang>`.
- `route(pattern, render)`. A page module exports `async render(el, params, ctx)`, where `ctx = {me, can(action)}`.
- `ui.h(tag, attrs, ...children)`, `ui.field(...)`, `ui.toast(msg)`, `ui.confirm(msg, {input})`, `ui.badge(status)`, `ui.daysText(min)`.
- Layout:
  - top bar: logo, DEV badge when `env==="dev"`, notification bell with the unread count (polls `/api/notifications` every 60 s), AR/EN toggle
  - sidebar at 900 px and wider; bottom tab bar below that

- [ ] Implement the pages:
  - the login page
  - a forced password-change page
  - a home page per role:
    - balance card and an "Apply for leave" button
    - pending approvals count for approvers
    - HR tiles: staff count, civil IDs expiring, recent requests
- [ ] Verify with a quick Playwright script in the scratchpad: log in as admin, change the password, see the home page in Arabic (`dir=rtl`), switch to English (`dir=ltr`), at 390 px and 1280 px wide. Take screenshots and review them.
- [ ] Commit `feat: frontend shell, login, home`.

### Task 10: Frontend staff and profiles

**Files:** Create `public/js/pages/staff.js`, `public/js/pages/profile.js`, `public/js/pages/profile-edit.js`

- [ ] Staff list (`#/staff`): search, department and status filters, cards on mobile and a table on desktop.
- [ ] Profile (`#/staff/:id`, `#/me`): photo, every §8 field grouped (Personal, Contact, Job, Contract), the documents list with upload and download, and the leave section showing the summary tiles (entitlement / carried / used / pending / remaining / available) plus request and ledger history.
  - An adjustment button for HR and admin (dialog: days or hours, a required note).
  - An empty KPI card that says "Coming in a later phase".
- [ ] Profile edit (`#/staff/:id/edit`, `#/staff/new`): a full-page form and client-side required-field checks. Server errors are shown next to the relevant field.
- [ ] Verify with Playwright: HR creates an employee, uploads a photo and a PDF, and the profile shows a 30.00-day balance. Commit `feat: staff list and profiles`.

### Task 11: Frontend leave and approvals

**Files:** Create `public/js/pages/request-new.js`, `public/js/pages/requests.js`, `public/js/pages/request.js`, `public/js/pages/approvals.js`, `public/js/pages/notifications.js`

- [ ] Request form (`#/leave/new`), a full page:
  - the type toggles between annual and early
  - annual: start and end dates, with a live day count and "available after this request"
  - early: a date and a time select (09:30…16:30 in 30-minute steps), with live hours
  - the submit button is disabled when the request is over the available balance
  - the server's `insufficient_balance` error is shown inline
- [ ] My requests (`#/leave`), request detail (`#/leave/:id`) with the event timeline, and cancel.
- [ ] Approvals (`#/approvals`): pending cards showing the employee, dates, days and current balance, with approve and reject buttons (reject asks for a reason).
- [ ] Notifications (`#/notifications`).
- [ ] Verify with Playwright: staff applies; Tawfiq approves on a 390 px viewport; the staff member's balance drops. Commit `feat: leave requests and approvals UI`.

### Task 12: Frontend import, settings, users, audit

**Files:** Create `public/js/pages/import.js`, `public/js/pages/settings.js`, `public/js/pages/users.js`, `public/js/pages/audit.js`, `server/audit.mjs` (add `GET /api/audit?entity=&q=&page=`)

- [ ] Import (`#/import`), a full-page four-step wizard (spec §10):
  - SheetJS reads the file in the browser
  - choose the sheet and header row
  - map columns, auto-matched against Arabic and English synonyms in `i18n.js`; the mapping is saved to settings `import_mapping`
  - preview table with red errors and gold warnings, and an "errors only" filter
  - commit, then download the temporary logins as a CSV
  - a template download button
- [ ] Settings (`#/settings`), admin only:
  - departments, with names and an approver picker
  - managers' approver employee, plus a title selector (CEO / Chairman)
  - contract types
- [ ] Users (`#/users`), admin only: list, role select, activate or deactivate, reset password (the temporary password is shown once).
- [ ] Audit (`#/audit`): a filterable list.
- [ ] Verify with Playwright: import a generated 5-row xlsx containing one error row → 4 created. Commit `feat: import wizard, settings, users, audit UI`.

### Task 13: End-to-end smoke, docs, push

**Files:** Create `tests/e2e.smoke.mjs`, `README.md`, `DEPLOY-DOKPLOY.md`

- [ ] `tests/e2e.smoke.mjs` (Playwright, run with `npm run test:e2e`) covers the whole of Task 11's scenario in both languages at 390 px.
- [ ] README (what's inside, run locally, test). DEPLOY guide in Arabic and English:
  - DNS `dev.hr.nama`
  - Dokploy app `nama-hr-dev` (branch `dev`, port 3000, volume `nama-hr-dev-data:/data`, env incl. `ADMIN_USERNAME=hassan`, `ADMIN_PASSWORD`, `PUBLIC_URL`, SMTP)
  - later `nama-hr-prod` on `main`
  - first login
  - the import steps
  - backups
- [ ] Run the full `npm test` and `npm run test:e2e` → all pass. Push `dev`. Commit `docs: readme and Dokploy guide`.
