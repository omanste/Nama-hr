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

## What it does

The full, current list of features is in **[docs/FEATURES.md](docs/FEATURES.md)**: roles, leave rules (Oman Labour Law),
permissions, the company calendar, profiles and documents (ID reading, expiry alerts), Staff Voice, Excel import and backups.

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
