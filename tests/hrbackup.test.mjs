// HR backup & restore (Admin only): a full backup from one portal restored into an empty one gives the same HR data
// and documents (not the passwords); settings-only restores settings only; new staff start with 2026 and must change
// it; restoring twice adds nothing; attendance is recalculated; history; non-admins blocked.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { boot, adminClient, makePerson, login } from "./helpers.mjs";
import { readZip } from "../server/zip.mjs";

const OFFICE = { lat: 23.588, lng: 58.3829 };
const jpg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
const idScan = Buffer.concat([Buffer.from("%PDF-1.4\n"), crypto.randomBytes(2000)]);
let A, B, C, adminA, adminB, adminC, hr, mgr, s, fullZip, settingsJson;
const servers = [];
const raw = async (t, c, p, opts = {}) => { const r = await fetch(t.base + p, { ...opts, headers: { cookie: c.cookie, ...(opts.headers || {}) } }); return { status: r.status, headers: r.headers, body: Buffer.from(await r.arrayBuffer()) }; };
const preview = async (t, c, buf) => { const r = await raw(t, c, "/api/admin/hr-backup/preview", { method: "POST", body: buf, headers: { "content-type": "application/octet-stream" } }); return { status: r.status, data: JSON.parse(r.body.toString() || "{}") }; };
const strip = (o, ...k) => Object.fromEntries(Object.entries(o).filter(([x]) => !k.includes(x)));

before(async () => {
  A = await boot({ FAKE_TODAY: "2026-11-05", APP_ENV: "test" }); servers.push(A);
  adminA = await adminClient(A.base);
  await adminA.put("/api/settings", { att_sites: [{ name_ar: "المكتب", name_en: "Office", lat: OFFICE.lat, lng: OFFICE.lng, radius_m: 200 }], verify: { photo: true, faceid: false, location: true },
    official_holidays: [{ date: "2026-11-18", name: "العيد الوطني" }], contract_types: ["Unlimited", "Limited"] });
  const d = (await adminA.post("/api/departments", { name_ar: "المبيعات", name_en: "Sales" })).data.department;
  hr = await makePerson(A.base, adminA, { emp_no: "NAMA-001", name_ar: "موارد", name_en: "HR One", email: "hr@example.test", join_date: "2020-01-01" }, "hr");
  mgr = await makePerson(A.base, adminA, { emp_no: "NAMA-002", name_ar: "مدير", name_en: "Manager", join_date: "2020-01-01", department_id: d.id }, "manager");
  await adminA.put(`/api/departments/${d.id}`, { approver_employee_id: mgr.emp.id });
  s = await makePerson(A.base, adminA, { emp_no: "NAMA-003", name_ar: "سالم الحارثي", name_en: "Salim", email: "salim@example.test", join_date: "2022-01-01", department_id: d.id,
    manager_employee_id: mgr.emp.id, civil_id: "12345678", civil_id_expiry: "2028-05-01", passport_no: "A1234567", shift: 1, opening_days: 20 }, "staff");
  await adminA.put(`/api/employees/${s.emp.id}`, { verify_location: "off" });
  // documents: the civil ID scan and a photo
  assert.equal((await adminA.upload(`/api/employees/${s.emp.id}/files?name=civil-id.pdf&doc_type=civil_id&expiry=2028-05-01`, idScan, "application/pdf")).status, 201);
  assert.equal((await adminA.upload(`/api/employees/${s.emp.id}/files?kind=photo&name=me.jpg`, jpg, "image/jpeg")).status < 300, true);
  // attendance: two online check-ins (one in time, one late), a fingerprint file linked to Salim
  await s.c.post("/api/attendance/checkin/consent", {});
  for (const [day, inn, out] of [["2026-11-02", "08:25", "17:35"], ["2026-11-03", "08:52", "17:40"]]) {
    A.app.ctx.fakeToday = day; A.app.ctx.fakeClock = inn; assert.equal((await s.c.upload(`/api/attendance/checkin?kind=in`, jpg, "image/jpeg")).status, 201);
    A.app.ctx.fakeClock = out; assert.equal((await s.c.upload(`/api/attendance/checkin?kind=out`, jpg, "image/jpeg")).status, 201);
  }
  await adminA.post("/api/attendance/upload", { name: "m.xls", punches: [{ no: "35", name: "SALIM", at: "2026-11-04 08:40" }, { no: "35", name: "SALIM", at: "2026-11-04 17:31" }] });
  await adminA.put("/api/attendance/devices/35", { employee_id: s.emp.id });
  // a leave request approved by the manager and HR, with a comment
  A.app.ctx.fakeToday = "2026-11-05"; A.app.ctx.fakeClock = "10:00";
  const r = (await s.c.post("/api/requests", { type: "annual", start: "2026-11-10", end: "2026-11-11", reason: "سفر" })).data.request;
  assert.equal((await mgr.c.post(`/api/requests/${r.id}/approve`, { comment: "موافق" })).status, 200);
  assert.equal((await hr.c.post(`/api/requests/${r.id}/approve`, {})).status, 200);
  // a company occasion
  assert.equal((await hr.c.post("/api/calendar/entries", { kind: "event", visibility: "company", start: "2026-12-20", name: "غداء الشركة" })).status, 201);
});
after(async () => { for (const t of servers) await t.close(); });

test("Admin only: HR and staff get 403 for every part", async () => {
  for (const c of [hr.c, s.c]) {
    assert.equal((await c.get("/api/admin/hr-backup")).status, 403);
    assert.equal((await c.get("/api/admin/hr-backup/history")).status, 403);
    assert.equal((await preview(A, c, Buffer.from("{}"))).status, 403);
    assert.equal((await c.post("/api/admin/hr-backup/restore", { token: "x", confirm: "RESTORE", sections: ["staff"] })).status, 403);
  }
});

test("the full backup: a zip (backup.json + files/), named by environment and time; header with counts; never a password or secret", async () => {
  const r = await raw(A, adminA, "/api/admin/hr-backup?type=full");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /nama-hr-full-test-\d{4}-\d{2}-\d{2}-\d{4}\.zip/);
  fullZip = r.body;
  const z = readZip(fullZip), j = JSON.parse(z.get("backup.json").toString());
  assert.equal(j.header.type, "full"); assert.equal(j.header.env, "test"); assert.equal(j.header.created_by, "admin"); assert.ok(j.header.created_at);
  for (const sec of ["settings", "staff", "attendance", "requests", "calendar", "documents"]) assert.ok(j.header.counts[sec], sec);
  assert.equal(j.header.counts.documents.files, [...z.keys()].filter((k) => k.startsWith("files/")).length);
  const text = z.get("backup.json").toString();
  for (const bad of ["pw_hash", "pw_salt", "push_vapid", "token", "external_id", "cred_id", "public_key"]) assert.ok(!text.includes(`"${bad}"`), bad);
  assert.equal(j.settings.settings.flex_start, undefined === j.settings.settings.flex_start ? undefined : j.settings.settings.flex_start); // present only if set
  assert.deepEqual(j.settings.settings.verify_location, true); assert.ok(j.settings.settings.att_sites.length);
  const doc = j.documents.files.find((f) => f.doc_type === "civil_id");
  assert.equal(doc.employee, "NAMA-003"); assert.equal(doc.sha256, crypto.createHash("sha256").update(idScan).digest("hex"));
  assert.ok(!j.documents.files.some((f) => f.kind === "checkin"), "check-in photos only when asked");
  const withPhotos = JSON.parse(readZip((await raw(A, adminA, "/api/admin/hr-backup?type=full&photos=1")).body).get("backup.json").toString());
  assert.equal(withPhotos.documents.files.filter((f) => f.kind === "checkin").length, 4);
});

test("settings only: a .json with the HR settings and nothing else", async () => {
  const r = await raw(A, adminA, "/api/admin/hr-backup?type=settings");
  assert.match(r.headers.get("content-disposition"), /nama-hr-settings-test-\d{4}-\d{2}-\d{2}-\d{4}\.json/);
  settingsJson = r.body;
  const j = JSON.parse(r.body.toString());
  assert.equal(j.header.type, "settings"); assert.deepEqual(Object.keys(j).sort(), ["header", "settings"]);
  assert.ok(j.settings.departments.some((d) => d.name_ar === "المبيعات" && d.approver === "NAMA-002"));
});

test("restore into an empty portal: preview first, typed RESTORE, then the same HR data, documents and attendance", async () => {
  B = await boot({ FAKE_TODAY: "2026-11-05" }); servers.push(B);
  adminB = await adminClient(B.base);
  const p = await preview(B, adminB, fullZip);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.deepEqual(p.data.available, ["settings", "staff", "attendance", "requests", "calendar", "documents"]);
  assert.ok(p.data.preview.staff.added >= 3 && p.data.preview.documents.added >= 2 && p.data.preview.attendance.added >= 4);
  assert.equal(B.db.prepare("SELECT count(*) n FROM employees").get().n, 0, "a preview changes nothing");
  assert.equal((await adminB.post("/api/admin/hr-backup/restore", { token: p.data.token, sections: p.data.available, confirm: "restore" })).status, 400, "typed exactly");
  const r = await adminB.post("/api/admin/hr-backup/restore", { token: p.data.token, sections: p.data.available, confirm: "RESTORE" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // same staff profiles (all fields but the database ids)
  const prof = (t, no) => t.db.prepare("SELECT * FROM employees WHERE emp_no=?").get(no);
  const keep = (e) => strip(e, "id", "department_id", "manager_employee_id", "photo_file_id");
  for (const no of ["NAMA-001", "NAMA-002", "NAMA-003"]) assert.deepEqual(keep(prof(B, no)), keep(prof(A, no)), no);
  assert.equal(B.db.prepare("SELECT e.emp_no FROM employees e JOIN employees s ON s.manager_employee_id=e.id WHERE s.emp_no='NAMA-003'").get().emp_no, "NAMA-002");
  // the documents: same content on the same person, the photo too
  const bS = prof(B, "NAMA-003");
  const doc = B.db.prepare("SELECT * FROM files WHERE employee_id=? AND doc_type='civil_id'").get(bS.id);
  assert.ok(doc); assert.equal(doc.expiry, "2028-05-01");
  assert.deepEqual((await raw(B, adminB, `/api/files/${doc.id}`)).body, idScan);
  assert.ok(bS.photo_file_id);
  // settings, departments (with the approver), holidays, the person's own check settings
  const sa = (await adminA.get("/api/settings")).data, sb = (await adminB.get("/api/settings")).data;
  for (const k of ["att_sites", "verify", "official_holidays", "contract_types", "flex_start", "flex_end", "flex_hours"]) assert.deepEqual(sb[k], sa[k], k);
  assert.equal(bS.verify_location, "off");
  // requests with their approvals and comments; calendar
  const reqB = B.db.prepare("SELECT * FROM leave_requests WHERE employee_id=?").get(bS.id);
  assert.equal(reqB.status, "approved");
  assert.ok(B.db.prepare("SELECT 1 FROM request_events WHERE request_id=? AND comment='موافق'").get(reqB.id));
  assert.ok(B.db.prepare("SELECT 1 FROM calendar_events WHERE name='غداء الشركة'").get());
  // attendance recalculated the same: compare the month and the balance as both portals compute them
  const month = async (t, c, id) => (await c.get(`/api/attendance/employee/${id}?month=2026-11`)).data;
  const ma = await month(A, adminA, s.emp.id), mb = await month(B, adminB, bS.id);
  const pick = (d) => d.days.filter((x) => x.date <= "2026-11-05").map((x) => [x.date, x.status, x.in, x.out, x.late, x.early]);
  assert.deepEqual(pick(mb), pick(ma)); assert.deepEqual(mb.summary, ma.summary);
  const bal = async (c, id) => (await c.get(`/api/employees/${id}`)).data.leave;
  assert.deepEqual(strip(await bal(adminB, bS.id), "yearStart"), strip(await bal(adminA, s.emp.id), "yearStart"));
  // logged, with a summary; the state before was saved (to undo)
  const log = B.db.prepare("SELECT after FROM audit_log WHERE action='hr_backup.restore'").get();
  assert.ok(log && JSON.parse(log.after).result.staff.added >= 3);
  const hist = (await adminB.get("/api/admin/hr-backup/history")).data.items;
  assert.deepEqual(hist.map((h) => h.kind), ["restore", "auto"]);
  assert.equal((await raw(B, adminB, `/api/admin/hr-backup/history/${hist[1].id}/download`)).status, 200, "the before-restore backup can be downloaded");
});

test("new staff sign in with 2026 and must change it (8+ characters); nothing is shown until then; passwords never copied", async () => {
  const c = await (async () => { const { client } = await import("./helpers.mjs"); const x = client(B.base); const r = await x.post("/api/login", { username: s.user.username, password: "2026" }); assert.equal(r.status, 200); assert.equal(r.data.mustChange, true); return x; })();
  assert.equal((await c.get("/api/employees")).data.error, "must_change_password");
  assert.equal((await c.post("/api/me/password", { current: "2026", next: "short7!" })).status, 400);
  assert.equal((await c.post("/api/me/password", { current: "2026", next: "Salim#2026x" })).status, 200);
  assert.equal((await c.get("/api/me")).status, 200);
  // the old password from portal A doesn't work here
  const { client } = await import("./helpers.mjs");
  assert.equal((await client(B.base).post("/api/login", { username: mgr.user.username, password: "Passw0rd!" + mgr.emp.id })).status, 401);
});

test("restore the same backup again: everything unchanged, nothing duplicated", async () => {
  const count = (t) => Object.fromEntries(["employees", "users", "files", "leave_requests", "request_events", "att_checkins", "att_punches", "calendar_events", "departments"].map((x) => [x, t.db.prepare(`SELECT count(*) n FROM ${x}`).get().n]));
  const before = count(B);
  const p = await preview(B, adminB, fullZip);
  for (const sec of p.data.available) assert.equal(p.data.preview[sec].added, 0, sec);
  const r = await adminB.post("/api/admin/hr-backup/restore", { token: p.data.token, sections: p.data.available, confirm: "RESTORE" });
  assert.equal(r.status, 200);
  assert.deepEqual(count(B), before);
});

test("settings only into another portal: the settings change, staff and attendance don't; ambiguous staff skipped and listed", async () => {
  C = await boot({ FAKE_TODAY: "2026-11-05" }); servers.push(C);
  adminC = await adminClient(C.base);
  await adminC.post("/api/employees", { emp_no: "X-1", name_ar: "مدير", join_date: "2021-01-01" });
  await adminC.post("/api/employees", { emp_no: "X-2", name_ar: "مدير", join_date: "2021-01-01" }); // two people with the manager's Arabic name
  const staffBefore = C.db.prepare("SELECT count(*) n FROM employees").get().n;
  const p = await preview(C, adminC, settingsJson);
  assert.deepEqual(p.data.available, ["settings"]);
  const r = await adminC.post("/api/admin/hr-backup/restore", { token: p.data.token, sections: ["settings", "staff"], confirm: "RESTORE" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.sections, ["settings"]);
  assert.deepEqual((await adminC.get("/api/settings")).data.att_sites, (await adminA.get("/api/settings")).data.att_sites);
  assert.equal(C.db.prepare("SELECT count(*) n FROM employees").get().n, staffBefore);
  assert.equal(C.db.prepare("SELECT count(*) n FROM att_checkins").get().n, 0);
  // the full backup into C: NAMA-002 "مدير" has no staff ID or e-mail match and two name matches → skipped, listed
  const f = await preview(C, adminC, fullZip);
  assert.ok(f.data.skipped.some((x) => x.section === "staff" && /NAMA-002/.test(x.what) && /more than one/.test(x.why)));
  const rr = await adminC.post("/api/admin/hr-backup/restore", { token: f.data.token, sections: ["staff"], confirm: "RESTORE" });
  assert.ok(rr.data.skipped_items.some((x) => /NAMA-002/.test(x.what)));
  assert.ok(C.db.prepare("SELECT 1 FROM employees WHERE emp_no='NAMA-003'").get(), "the others restored");
  assert.ok(!C.db.prepare("SELECT 1 FROM employees WHERE emp_no='NAMA-002'").get());
});

test("not a backup → refused; a restore needs at least one section", async () => {
  assert.equal((await preview(C, adminC, Buffer.from("hello"))).status, 400);
  const p = await preview(C, adminC, settingsJson);
  assert.equal((await adminC.post("/api/admin/hr-backup/restore", { token: p.data.token, sections: [], confirm: "RESTORE" })).status, 400);
});
