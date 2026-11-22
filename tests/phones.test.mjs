// Phone numbers (country code + number, saved as +96899123456) and the emergency contact's family relationship; the
// one-time conversion of older records (a backup first; counts; what needs a look). Made-up people and numbers.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { convertOnce } from "../server/phone.mjs";
import { parsePhone, dialList, DIAL } from "../public/js/dialcodes.js";

let t, admin, hr, s;
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-11-23" });
  admin = await adminClient(t.base);
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  s = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف", join_date: "2022-01-01" }, "staff");
});
after(async () => { await t.close(); });

test("the country list: every country (with Arabic names), Oman first, then the GCC, the common ones, the rest A–Z", () => {
  const L = dialList();
  assert.ok(Object.keys(DIAL).length >= 240, "the full ITU list");
  assert.deepEqual(L.slice(0, 18).map((x) => x.iso), ["OM", "AE", "SA", "QA", "KW", "BH", "IN", "PK", "BD", "EG", "PH", "LK", "NP", "JO", "SD", "YE", "SY", "TN"]);
  const rest = L.slice(18).map((x) => x.en);
  assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b, "en")));
  assert.equal(L[0].ar, "عُمان");
  // typed or pasted in any common way
  for (const v of ["99123456", "+968 9912 3456", "0096899123456", "968 9912 3456", "٩٩١٢٣٤٥٦"]) assert.equal(parsePhone(v).e164, "+96899123456", v);
  assert.equal(parsePhone("9876543210", "91").e164, "+919876543210");
  assert.equal(parsePhone("+44 07911 123456").e164, "+447911123456", "a leading 0 after the code goes");
  assert.equal(parsePhone("9912345").error, "length", "Oman: 8 digits");
  assert.equal(parsePhone("+91 98765").error, "length");
});

test("profile: numbers saved in full; Oman must have 8 digits; foreign numbers by their country", async () => {
  const put = (b) => hr.c.put(`/api/employees/${s.emp.id}`, b);
  assert.equal((await put({ mobile: "9912 3456" })).data.employee.mobile, "+96899123456");
  assert.equal((await put({ mobile: "+91 98765 43210" })).data.employee.mobile, "+919876543210");
  assert.equal((await put({ mobile: "00971 50 123 4567" })).data.employee.mobile, "+971501234567");
  const bad = await put({ mobile: "991234" });
  assert.equal(bad.status, 400); assert.equal(bad.data.field, "mobile"); assert.match(bad.data.message, /8 digits/);
  assert.equal((await put({ personal_phone: "call me" })).status, 400);
});

test("emergency contact: family only — every relationship in the list, 'Other family member' with what it is; all three together", async () => {
  const rels = (await s.c.get("/api/emergency-relations")).data.items;
  assert.deepEqual(rels.map((r) => r.en), ["Father", "Mother", "Husband", "Wife", "Son", "Daughter", "Brother", "Sister", "Uncle", "Aunt", "Other family member"]);
  const put = (b) => s.c.put(`/api/employees/${s.emp.id}/contact`, { emergency_name: "قريب", emergency_phone: "92223333", ...b });
  for (const r of rels.filter((x) => !x.other)) assert.equal((await put({ emergency_relation: r.en })).data.employee.emergency_relation, r.en, r.en);
  assert.equal((await put({ emergency_relation: "الأخت" })).data.employee.emergency_relation, "Sister", "Arabic works too");
  assert.equal((await put({ emergency_relation: "Other family: grandfather" })).data.employee.emergency_relation, "Other family: grandfather");
  assert.equal((await put({ emergency_relation: "Other family:" })).status, 400, "say which family member");
  assert.equal((await put({ emergency_relation: "Friend" })).status, 400, "no friends or colleagues");
  assert.equal((await put({ emergency_relation: "زميل" })).status, 400);
  assert.equal((await s.c.put(`/api/employees/${s.emp.id}/contact`, { emergency_name: "فلان", emergency_relation: null, emergency_phone: null })).status, 400, "name, relationship and phone together");
  const e = (await hr.c.get(`/api/employees/${s.emp.id}`)).data.employee;
  assert.equal(e.emergency_phone, "+96892223333");
});

test("Admin edits the relationship list (family only; 'Other family member' always kept); HR can't", async () => {
  assert.equal((await hr.c.put("/api/settings", { emergency_relations: [] })).status, 403);
  assert.equal((await admin.put("/api/settings", { emergency_relations: [{ en: "Father", ar: "الأب" }, { en: "Friend", ar: "صديق" }] })).status, 400);
  const r = await admin.put("/api/settings", { emergency_relations: [{ en: "Father", ar: "الأب" }, { en: "Mother", ar: "الأم" }, { en: "Grandfather", ar: "الجد" }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.emergency_relations.map((x) => x.en), ["Father", "Mother", "Grandfather", "Other family member"]);
  await admin.put("/api/settings", { emergency_relations: (await import("../server/phone.mjs")).DEFAULT_RELATIONS });
});

test("the one-time conversion of older records: a backup first; converted / already OK / to review; nothing unclear changed", async () => {
  const ins = t.db.prepare("INSERT INTO employees(emp_no,name_ar,mobile,personal_phone,emergency_phone,emergency_relation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)");
  const now = new Date().toISOString();
  const a = ins.run("OLD1", "قديم أ", "9912 3456", "00971501234567", "+968 9222 3333", "أخوي", now, now).lastInsertRowid;
  const b = ins.run("OLD2", "قديم ب", "+96891112222", "12345", "ask HR", "صديق", now, now).lastInsertRowid;
  t.db.prepare("DELETE FROM settings WHERE key='phone_conversion_report'").run();
  let backedUp = false;
  const r = convertOnce(t.app.ctx, () => { backedUp = true; return "backup.zip"; });
  assert.ok(backedUp, "the backup is taken first"); assert.equal(r.backup, "backup.zip");
  const row = (id) => ({ ...t.db.prepare("SELECT mobile, personal_phone, emergency_phone, emergency_relation FROM employees WHERE id=?").get(id) });
  assert.deepEqual(row(a), { mobile: "+96899123456", personal_phone: "+971501234567", emergency_phone: "+96892223333", emergency_relation: "Brother" });
  assert.deepEqual(row(b), { mobile: "+96891112222", personal_phone: "12345", emergency_phone: "ask HR", emergency_relation: "صديق" }, "unclear: left as is");
  assert.ok(r.phones.converted >= 3 && r.phones.ok >= 1 && r.phones.review >= 2 && r.relations.converted >= 1 && r.relations.review >= 1);
  assert.equal(convertOnce(t.app.ctx, () => { throw new Error("not again"); }), null, "once only");
  // the list HR works through
  const rep = (await hr.c.get("/api/admin/phone-report")).data;
  assert.ok(rep.phones.some((x) => x.emp_no === "OLD2" && x.field === "personal_phone"));
  assert.ok(rep.relations.some((x) => x.emp_no === "OLD2" && x.value === "صديق"));
  assert.equal((await s.c.get("/api/admin/phone-report")).status, 403);
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE action='employee.phone_format' AND entity_id=?").get(String(a)), "each change logged");
});
