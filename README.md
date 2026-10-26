# Nama HR Portal · بوابة الموارد البشرية

Nama Real Estate's HR portal: staff profiles, leave balances, leave requests with approvals, and import from Excel.
It is **separate from the CRM**, with its own repository, database and domain, and runs entirely on Nama's own server through Dokploy.
There is no CDN and there are no third-party services.

Designed by Eng. Hassan Al Riyami.

| Environment | Domain | Git branch | `APP_ENV` |
|---|---|---|---|
| Development / testing | https://dev.hr.nama.omanste.com | `dev` | `dev` (shows a **DEV** badge, e-mails tagged `[dev]`) |
| Production (later) | https://hr.nama.omanste.com | `main` | `production` |

To deploy, follow **[DEPLOY-DOKPLOY.md](DEPLOY-DOKPLOY.md)**.
The design is in `docs/superpowers/specs/` and the build plan is in `docs/superpowers/plans/`.

## What it does (phase 1)

* **Roles:**

  | Role | Can do |
  |---|---|
  | Staff | Own profile, balance, requests |
  | Department manager | Approves their department, set in Settings |
  | HR Manager | All profiles, edits staff, Excel import; cannot approve |
  | Accounts | View only |
  | CEO | Approves managers' leave |
  | Admin | Everything |

* **Approval routing:**
  * Each department has an approving manager.
  * Managers, HR and the CEO go to the **managers' leave approver**. That is the CEO now, and can be switched to the Chairman in Settings.
  * The CEO's own leave goes to Admin.
* **Leave rules:**
  * Each leave year runs from the employee's join anniversary and gives 30 days. Unused days carry over.
  * The balance is capped at 60 days. The cap is checked when the yearly credit is added, and the excess is recorded as forfeited.
  * Annual leave counts calendar days.
  * Early leave deducts hours until 17:00 (8 h = 1 day), in 30-minute steps.
  * Probation is 3 months. Annual and early leave are allowed only after 6 months of service.
  * Emergency, bereavement and sick leave are recorded and approved, but do not reduce the balance.
  * "Worked on a holiday" adds 1 day once approved.
  * A request can never be more than the remaining balance minus requests still pending.
* **History:** balances are a ledger of entries (opening, yearly credit, cap, leave, reversal, adjustment), so every change records who made it and when. Every request keeps its full timeline.
* **Notifications:** in the app, plus e-mail through Nama's own SMTP server.
* **Excel import (HR/Admin):**
  * Upload a file and map its columns. Two-row headers are supported.
  * Preview the result, with errors and warnings shown for each row.
  * Import the staff with their opening balances. Optionally create logins with one-time passwords.
* **Interface:** Arabic first, with an English toggle. Works on phones. Green and gold Nama brand.

## What is inside

```
server/index.mjs      HTTP server, static files, routing
server/db.mjs         SQLite schema and migrations (/data/hr.db)
server/leave.mjs      leave rules (pure functions — day counts, anniversaries, cap, summary)
server/routing.mjs    who approves a request (pure function)
server/auth.mjs       sign-in, sessions, password hashing; provider interface ready for Microsoft sign-in
server/perm.mjs       the role/permission matrix
server/employees.mjs  profiles, adjustments, logins from a profile
server/requests.mjs   request lifecycle + ledger postings
server/importer.mjs   Excel import validation and commit
server/jobs.mjs       yearly credits, HR reminders, nightly backup
server/notify.mjs     in-app + e-mail notifications
server/modules.mjs    where feature modules register (attendance, KPIs, payroll plug in here later)
public/               the app (plain JavaScript modules, no build step), fonts, logo, SheetJS
tests/                API + rules tests (node:test) and a browser smoke test (Playwright)
```

## Run locally

Requires Node 22.13 or newer (24 recommended).

```bash
npm ci
npm run dev        # http://localhost:3000 — first admin: admin / Admin#2026 (you must change it)
```

## Tests

```bash
npm test           # rules, permissions, API (86 tests)
npm run test:e2e   # browser smoke test (needs Playwright + Chromium)
node tests/fixtures/make-sample.mjs   # builds a made-up spreadsheet with the same layout as the real leave sheet
```

## Private data: never in this repository

Staff data, spreadsheets, backups and `.env` files must **never** be committed.
`.gitignore` already blocks `data/`, `*.db`, `*.xlsx`, `*.xls`, `*.csv` and `.env`.
Import staff only through the **Excel import** page in the app.
