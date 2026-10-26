# Deploying on Dokploy · النشر على Dokploy

## ملخص بالعربية

1. أضف سجل DNS من نوع **A** باسم `dev.hr.nama` يشير إلى عنوان IP لخادم omanste. لاحقاً للإنتاج أضف `hr.nama`.
2. في Dokploy، داخل مشروع **Nama**، أنشئ تطبيقاً (Application) جديداً باسم **nama-hr-dev** من المستودع `omanste/Nama-hr`، الفرع `dev`.
3. اختر نوع البناء **Dockerfile** والمنفذ **3000**. أضف Volume خاصاً به على المسار **/data**، منفصلاً عن الـ CRM.
4. أضف المتغيرات: `APP_ENV=dev` و`ADMIN_USERNAME=hassan` و`ADMIN_PASSWORD=<كلمة مرور مؤقتة طويلة>` و`PUBLIC_URL=https://dev.hr.nama.omanste.com`، ثم إعدادات البريد إن أردت إرسال البريد.
5. أضف النطاق `dev.hr.nama.omanste.com` وفعّل HTTPS بشهادة Let's Encrypt، ثم اضغط Deploy.
6. ادخل باسم `hassan` وكلمة المرور المؤقتة، ثم اختر كلمة مرور جديدة.
7. من **الإعدادات**: أضف الأقسام وحدد المعتمد لكل قسم (المبيعات والتأجير والصيانة ← توفيق، المالية ← المدير المالي)، وحدد معتمد إجازات المديرين (الرئيس التنفيذي).
8. من **استيراد Excel**: ارفع ملف الإجازات، وراجع المعاينة، ثم استورد. يمكن إنشاء حسابات الدخول وتنزيل كلمات المرور المؤقتة.

Everything runs on your own server. Dokploy builds the image, Traefik (inside Dokploy) serves HTTPS, and Let's Encrypt issues the certificate.

---

## 0. Before you start

* You need the same Dokploy server as the CRM, with ports **80** and **443** open.
* The code is in **https://github.com/omanste/Nama-hr**.
  * Branch **`dev`** is for testing.
  * **`main`** will be production, later.
* Dokploy's GitHub App must be able to see the `Nama-hr` repository. In GitHub, go to **Settings → Applications → Dokploy → Configure**, and add `Nama-hr` to the allowed repositories.

## 1. DNS

At the DNS provider for `omanste.com`, add:

| Type | Name | Value |
|---|---|---|
| A | `dev.hr.nama` | your server's public IP (same as `dev.nama`) |
| A | `hr.nama` | your server's public IP. Add this later, for production. |

Check that it resolves: `nslookup dev.hr.nama.omanste.com`.

## 2. Create the dev application

In Dokploy, open the **Nama** project and choose **Create Service → Application**. Name it `nama-hr-dev`.

| Tab | Setting | Value |
|---|---|---|
| General → Provider | GitHub · Repository / Branch | `omanste/Nama-hr` · **`dev`** |
| General → Build Type | Dockerfile | Dockerfile path `Dockerfile`, context `.` |
| General | Auto Deploy | **On** (redeploys on every push to `dev`) |
| Environment | paste from `.env.example` and edit | see below |
| Domains → Add Domain | Host | `dev.hr.nama.omanste.com` |
| | Path · Container Port | `/` · **3000** |
| | HTTPS · Certificate | **On** · **Let's Encrypt** |
| Advanced → Volumes / Mounts → Add | Volume Mount · name · mount path | `nama-hr-dev-data` · **`/data`** |

Environment:

```env
APP_ENV=dev
ADMIN_USERNAME=hassan
ADMIN_PASSWORD=<a long temporary password — e.g. output of: openssl rand -base64 18>
PUBLIC_URL=https://dev.hr.nama.omanste.com
SESSION_HOURS=12
BACKUP_TIME=02:00
BACKUP_KEEP_DAYS=14
# optional — Nama's own mail server, for leave e-mails (in-app notifications always work)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

Press **Deploy**. When the log shows `Nama HR (dev) listening on :3000`, open https://dev.hr.nama.omanste.com.

> The `/data` volume is the whole system: the database `hr.db`, uploaded documents and nightly backups. Never delete it. Redeploying keeps it.
> It is separate from the CRM's volume, so the two systems never share data.

`ADMIN_USERNAME` / `ADMIN_PASSWORD` are used **only once**, when the database has no users yet.
After your first sign-in you must choose a new password. You can then delete `ADMIN_PASSWORD` from the Environment.

## 3. First setup in the app

1. **Sign in** as `hassan` with the temporary password, then choose your own password.
2. **Settings → Departments:** add the departments and pick each department's **leave approver**.
   * Sales, Rental and Maintenance → Tawfiq.
   * Finance → the Finance Manager.

   An approver has to exist as a staff member first. You can import staff first (step 3 below) and come back to this.
3. **Excel import:**
   1. Upload your leave sheet. The app detects the two-row header.
   2. Check the "balance as of" date.
   3. On the **Map columns** step, check the matches: the name, the join date, and the **total remaining balance** column. Any column you don't need stays on "Ignore".
   4. **Preview** the rows:
      * Red means the row is skipped.
      * Gold is a warning only. For example, a balance over 60 days is kept, and the cap applies at that person's next anniversary.
      * The list ends at the first row with no name, so the extra-days table under the staff list is ignored.
   5. Tick **Create logins** if you want accounts now, then **Import**.
   6. Download the one-time passwords CSV and hand them out. Each person must choose their own password when they first sign in.
4. **Settings → Managers' leave approver:** first add **Ishaq Al Hoqani** as an employee (role *CEO* in Users), then pick him with title *CEO*. Later you can switch this to the Chairman.
5. **Users:** give HR, Accounts and CEO logins their roles.
6. Complete each profile (English name, department, civil ID…) through **Staff → Edit**. The home page lists staff with a missing join date.

### Before go-live: Oman Labour Law settings
* **Settings → Official holidays:** enter this year's official holidays. They aren't deducted when they fall inside annual leave.
* **Settings → Ramadan hours:** enter the Ramadan dates and the end of the working day.
* **Profiles:** fill in **gender** (needed for maternity, paternity and child-care leave) and **nationality** (exam leave and accompanying a patient are for Omani staff).
* **Balance reviews:** decide each balance over 60 days, either *keep — work needs* or *forfeit*, with a reason.
* Give `docs/compliance/oman-labour-law-2023-check.md` to the legal adviser.

## 4. Production (later)

When dev has been tested:

```bash
git checkout main && git merge dev && git push
```

Then repeat step 2 with these differences:
* the application is named `nama-hr-prod`
* branch **`main`**
* domain `hr.nama.omanste.com`
* volume `nama-hr-prod-data`
* `APP_ENV=production`
* `PUBLIC_URL=https://hr.nama.omanste.com`

Production starts empty. Do the import there; dev data stays on dev.

## 5. Backups and restore

* **Automatic:** every night at `BACKUP_TIME` (Muscat time) the app writes `/data/backups/hr-YYYY-MM-DD.db`, and keeps the last `BACKUP_KEEP_DAYS` days.
  Copy that folder off the server regularly. Dokploy's **Volume Backups** can do this on a schedule.
* **On demand:** Admin → **Settings → Download backup** downloads the current database.
* **Restore:** stop the app, then delete `/data/hr.db-wal` and `/data/hr.db-shm` if they exist. Leftover journal files would otherwise be replayed onto the restored copy. Copy the backup over `/data/hr.db`, then start the app again.

## 6. Health and troubleshooting

* `https://dev.hr.nama.omanste.com/api/health` should return `{"ok":true,"env":"dev"}`. Docker also uses it as the health check.
* **No admin was created:** the log says `Set ADMIN_USERNAME and ADMIN_PASSWORD`. Add them and redeploy.
* **E-mails not arriving:** check the `SMTP_*` values. Failures are logged and never block a request. In-app notifications still work.
* **Too many wrong passwords:** wait 10 minutes, or have Admin use **Users → Reset password**.

## Later phases (designed for, not built yet)

* Attendance machine import
* KPIs (the profile already has an empty KPI section)
* Payroll
* Microsoft sign-in: `server/auth.mjs` has a provider interface for it

Each of these plugs in through `server/modules.mjs` without changing the leave rules.
