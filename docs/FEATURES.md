# Nama HR Portal — what it does (state on 27 Oct 2026)

Arabic and English everywhere (one language at a time), light and dark mode, works on phones, tablets and computers.
Everything runs on Nama's own server (Dokploy); no outside services — ID cards are read on the server itself.

## People and roles
| Role | Can do |
|---|---|
| Staff | Own profile, photo, contact details, documents, leave, permissions, Staff Voice |
| Manager | As staff; approves their department(s) (Settings → Departments); own leave goes to the CEO |
| HR Manager | All profiles, edit everything, import, disable/enable staff, calendar entries; does not approve |
| Accounts | View only |
| CEO | Approves managers' leave; receives Staff Voice messages sent to the CEO |
| Admin | Everything, including settings, users, delete records, hide/delete Staff Voice messages |

* **Disable** a person (keeps all history, no sign-in, hidden from lists) or **delete** a mistaken record with no history (Admin).
* Dev only: sign in by picking your name, shared password `2026` (off in production; Admin keeps their own password).

## Home page
* My balance, leave by type, permissions (month/year), last 10 requests; colleagues' birthdays in the next 5 days.
* HR/Admin boxes (tap to list below, 50 a page): awaiting approval, active staff, pending requests, documents expiring in 30 days,
  missing join date, balances over the cap, under 30 days taken in 2 years. On a computer the boxes stay fixed while you scroll.

## Leave (Oman Labour Law, RD 53/2023)
* 30 days a year from the join anniversary, calendar days, carry-over up to the 60-day cap (HR reviews any excess).
* Probation 3 months; annual leave from 6 months. Official holidays inside annual leave aren't deducted.
* Statutory leaves: sick (pay bands), bereavement by relation, marriage, paternity, maternity, Hajj, exam, patient care, child care, special unpaid.
* Emergency leave comes from annual leave. Worked on a holiday: a day off or payment (employee chooses).
* Approvers name a deputy for their own leave; requests route to the department approver, managers to the CEO.
* **My leave** page: year/month filter, every leave type with times and days, history with status.

## Permissions (استئذانات)
* Early leave, late arrival, personal break (from–to) — reason required, manager approves.
* Attendance policy §8: no monthly free hours and no automatic deduction. After the manager approves, HR classifies each one:
  statutory paid / special paid / unpaid / from annual leave (only the last uses the balance; changing it gives the hours back).
* Times follow the person's shift. **My permissions** page: year/month filter, times and hours per type, history. Report for HR/managers (by HR classification) with Excel download.

## Attendance (policy 007/2026)
* Two shifts (Shift 1 08:30–17:30, Shift 2 09:00–18:00; times in Settings), 8 actual hours + 1 unpaid hour, Sunday–Thursday. Staff choose their own shift from their profile (Change); HR can fix it per person ("Who chooses the shift: HR only") and Admin can switch self-choice off for everyone in Settings. HR can always set it in the profile form (default Shift 2). Shift 3 (10:00–17:00) is a special case only HR/Admin assign; staff on it cannot change it themselves. Ramadan: 6 hours from the shift start.
* HR uploads the fingerprint machine's export (Excel/CSV) weekly — **Upload fingerprint file**. Punches are never added twice. Each machine number is linked to a person once (name match suggested, HR confirms) or set aside.
* Each day against the person's shift: late from the first minute (no grace), left early, missing punch, unexcused absence, absence with a pending request, leave, external task, weekly rest / holiday (work on those shown for information, not overtime). Days before the policy start date are for information only.
* **Fingerprint correction** request (§5): employee → manager verifies → HR confirms; the corrected time counts only once confirmed; the original punches are kept.
* **External work task** (§10): time, place and purpose, manager approves; counts as work.
* **My attendance**: monthly sheet with totals; the employee confirms the review or sends HR a note (§15). Profile shows this month's summary.
* **Attendance reports** (§18): by department without names (CEO, Accounts); HR sees everyone by name, a manager their team. Compliance %, lateness, early leaving, missing punches, unexcused absence, unsettled requests, correction turnaround; Excel download. HR's queue of permissions to classify and corrections to confirm. Weekly notice to HR and the CEO each Sunday.
* Nothing is applied automatically: no penalties (violation cases are a later step).

## Calendar
* Month grid for everyone: leave (by what you may see), official holidays, blocked days, company occasions, birthdays (day/month only).
* HR/Admin add holidays, **blocked days** (no annual leave, unpaid leave or permissions; statutory leave can't be blocked) and occasions.
* Birthday heads-up to all colleagues 5 days before — never to the person.

## Profiles and documents
* Personal, contact (staff edit their own; e-mail is HR's), job, contract (join date, years of service, probation end), qualifications.
* Qualifications and job title in both languages (Arabic and English boxes).
* Documents with expiry; staff upload their own (ID, passport, visa, certificates, medical).
* ID card / passport photo: read on the server (check-digit verified), values offered for confirmation.
* Expiry alerts to HR and the person at 30 days, 7 days and on the day.

## Staff Voice (صوت الموظف)
* Suggestions, questions, complaints, notes — to my manager, HR or the CEO. Never anonymous.
* Seen only by the sender, the recipient(s) and Admin. Conversation with replies, attachment, status. Counts in reports.
* Admin can hide (only Admin sees it) or delete a message.

## Import from Excel
* **Add new staff** (with opening balances and optional logins) or **update existing staff** (by employee ID; only filled cells change).

## Data safety
* Nightly database backup on the server (`/data/backups`, kept 14 days); Admin can download a copy any time (Settings → Download backup).
* Audit log of every change (message text never logged). Staff data files are never stored in this repository.
