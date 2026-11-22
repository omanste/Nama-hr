/* Phone numbers (every phone field): saved as the full international number (+96899123456) — the country code and the
 * number come from it. Emergency contact relationship: family only, from Admin's list (Settings › Lists), saved as a
 * language-neutral key ("father", "brother", …) shown in the reader's language; "Other family member" is saved as
 * "other:<what>". */
import { parsePhone, splitPhone } from "../public/js/dialcodes.js";
import { getSetting } from "./db.mjs";

export const PHONE_FIELDS = ["mobile", "personal_phone", "emergency_phone"];
export const OTHER_FAMILY = "Other family";
export const DEFAULT_RELATIONS = [
  { key: "father", en: "Father", ar: "الأب" }, { key: "mother", en: "Mother", ar: "الأم" }, { key: "husband", en: "Husband", ar: "الزوج" }, { key: "wife", en: "Wife", ar: "الزوجة" },
  { key: "son", en: "Son", ar: "الابن" }, { key: "daughter", en: "Daughter", ar: "الابنة" }, { key: "brother", en: "Brother", ar: "الأخ" }, { key: "sister", en: "Sister", ar: "الأخت" },
  { key: "uncle", en: "Uncle", ar: "العم / الخال" }, { key: "aunt", en: "Aunt", ar: "العمة / الخالة" }, { key: "other", en: "Other family member", ar: "فرد آخر من العائلة", other: true },
];
/** A list item's key: its own, else made from the English word ("Grand father" → "grand_father"). */
export const relKey = (r) => r.other ? "other" : r.key || String(r.en || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "rel";
export const relationList = (db) => getSetting(db, "emergency_relations", DEFAULT_RELATIONS).map((r) => ({ ...r, key: relKey(r) }));

/** A typed or pasted number → the full number, or an error message for the field. Empty stays empty. */
export function cleanPhone(v) {
  if (v === null || v === undefined || String(v).trim() === "") return { value: null };
  const p = parsePhone(v, splitPhone(String(v).trim()) ? null : "968");
  if (p.error === "length") return { error: p.code === "968" ? "An Omani number has 8 digits" : `This number should have ${p.min === p.max ? p.min : `${p.min}–${p.max}`} digits after +${p.code}` };
  if (p.error) return { error: "Enter the country code and the number (digits only)" };
  return { value: p.e164 };
}
/** A relationship from the list (its key, or the English or Arabic word), or "other:<text>" (also the older "Other family:
 * <text>"); saved as the key. Anything else → an error. */
export function cleanRelation(db, v) {
  if (v === null || v === undefined || String(v).trim() === "") return { value: null };
  const s = String(v).trim(), list = relationList(db);
  const m = /^(?:other|other family(?: member)?|فرد آخر من العائلة)\s*[:：-]\s*(.*)$/i.exec(s);
  if (m) return m[1].trim().length >= 2 ? { value: `other:${m[1].trim().slice(0, 60)}` } : { error: "Say which family member" };
  const hit = list.find((r) => !r.other && [r.key, r.en, r.ar, ...(r.ar || "").split(" / ")].some((x) => x && x.toLowerCase() === s.toLowerCase()));
  if (hit) return { value: hit.key };
  if (list.some((r) => r.other && [r.en, r.ar].some((x) => x && x.toLowerCase() === s.toLowerCase()))) return { error: "Say which family member" };
  return { error: "Choose a family relationship from the list" };
}

// older free-text relationships → the list (English and Arabic, common spellings); anything else is listed for HR
const GUESS = [[/^(father|dad|abu|أب|الأب|ابي|أبي|الوالد|والد)$/i, "Father"], [/^(mother|mom|mum|أم|الأم|امي|أمي|الوالدة|والدة)$/i, "Mother"],
  [/^(husband|زوج|الزوج)$/i, "Husband"], [/^(wife|spouse|زوجة|الزوجة|زوجتي)$/i, "Wife"], [/^(son|ابن|الابن|ولد)$/i, "Son"], [/^(daughter|ابنة|الابنة|بنت|البنت)$/i, "Daughter"],
  [/^(brother|bro|أخ|اخ|الأخ|الاخ|اخوي|أخوي|أخي|اخي)$/i, "Brother"], [/^(sister|أخت|اخت|الأخت|الاخت|اختي)$/i, "Sister"],
  [/^(uncle|عم|العم|خال|الخال)$/i, "Uncle"], [/^(aunt|auntie|عمة|العمة|خالة|الخالة)$/i, "Aunt"],
  [/^(cousin|grand ?father|grand ?mother|grandson|granddaughter|nephew|niece|brother[- ]in[- ]law|sister[- ]in[- ]law|father[- ]in[- ]law|mother[- ]in[- ]law|son[- ]in[- ]law|daughter[- ]in[- ]law|جد|الجد|جدة|الجدة|حفيد|حفيدة|ابن العم|ابن الخال|ابن عم|ابن خال|بنت العم|بنت الخال|ابن الأخ|ابن الاخ|ابن الأخت|نسيب|النسيب|صهر|الصهر)$/i, "other"]];
/** An older relationship text → { value } when it matches the list, else { review: true }. */
export function guessRelation(db, v) {
  const s = String(v || "").trim().replace(/\s+/g, " ");
  if (!s) return { value: null };
  const c = cleanRelation(db, s); if (!c.error) return c;
  const g = GUESS.find(([re]) => re.test(s));
  if (!g) return { review: true };
  return g[1] === "other" ? { value: `other:${s}` } : cleanRelation(db, g[1]);
}

/** Once: every relationship already saved as a word ("Brother", "Other family: cousin") → its key ("brother",
 * "other:cousin"); anything that doesn't match stays as it is (it is on HR's review list). Returns how many changed. */
export function relationKeysOnce(db) {
  if (getSetting(db, "relation_keys_done", false)) return null;
  let n = 0;
  for (const e of db.prepare("SELECT id, emergency_relation v FROM employees WHERE emergency_relation IS NOT NULL AND emergency_relation<>''").all()) {
    const c = cleanRelation(db, e.v);
    if (!c.error && c.value !== e.v) { db.prepare("UPDATE employees SET emergency_relation=? WHERE id=?").run(c.value, e.id); n++; }
  }
  setSetting(db, "relation_keys_done", true);
  return n;
}

/* ---- the one-time conversion of the numbers and relationships already saved (on start, once) ---- */
import fs from "node:fs";
import path from "node:path";
import { setSetting, nowIso } from "./db.mjs";

const fieldOf = { mobile: "mobile", personal_phone: "personal_phone", emergency_phone: "emergency_phone" };
/** The numbers and relationships that still need a look (now): {phones:[…], relations:[…]}. */
export function reviewList(db) {
  const phones = [], relations = [];
  for (const e of db.prepare("SELECT id, emp_no, name_ar, name_en, mobile, personal_phone, emergency_phone, emergency_relation FROM employees ORDER BY emp_no").all()) {
    for (const f of PHONE_FIELDS) if (e[f] && !/^\+\d{7,18}$/.test(e[f])) phones.push({ id: e.id, emp_no: e.emp_no, name_ar: e.name_ar, name_en: e.name_en, field: fieldOf[f], value: e[f] });
    if (e.emergency_relation && cleanRelation(db, e.emergency_relation).error) relations.push({ id: e.id, emp_no: e.emp_no, name_ar: e.name_ar, name_en: e.name_en, value: e.emergency_relation });
  }
  return { phones, relations };
}
/** Convert once: a full HR backup first; numbers with a clear country code (or 8 digits: Oman) → +code…; relationships
 * matched to the list; the rest is left as it is and listed for review. The counts are kept (Settings report). */
export function convertOnce(ctx, backup) {
  const { db } = ctx;
  if (db.prepare("SELECT 1 FROM settings WHERE key='phone_conversion_report'").get()) return null;
  const people = db.prepare("SELECT * FROM employees").all();
  const report = { at: nowIso(), phones: { converted: 0, ok: 0, review: 0 }, relations: { converted: 0, ok: 0, review: 0 }, backup: null };
  if (people.length && backup) { try { report.backup = backup(); } catch (e) { console.error(`phone conversion: backup failed (${e.message}) — nothing converted`); return null; } }
  for (const e of people) {
    const set = {};
    for (const f of PHONE_FIELDS) {
      if (!e[f]) continue;
      if (/^\+\d{7,18}$/.test(e[f]) && !cleanPhone(e[f]).error) { report.phones.ok++; continue; }
      const p = cleanPhone(e[f]);
      if (p.error) report.phones.review++; else { set[f] = p.value; report.phones.converted++; }
    }
    if (e.emergency_relation) {
      const c = cleanRelation(db, e.emergency_relation);
      if (!c.error && c.value === e.emergency_relation) report.relations.ok++;
      else { const g = guessRelation(db, e.emergency_relation); if (g.review) report.relations.review++; else { set.emergency_relation = g.value; report.relations.converted++; } }
    }
    const k = Object.keys(set);
    if (k.length) {
      db.prepare(`UPDATE employees SET ${k.map((c) => `${c}=?`).join(",")} WHERE id=?`).run(...k.map((c) => set[c]), e.id);
      db.prepare("INSERT INTO audit_log(at,actor_user_id,action,entity,entity_id,before,after) VALUES(?,?,?,?,?,?,?)")
        .run(nowIso(), null, "employee.phone_format", "employee", String(e.id), JSON.stringify(Object.fromEntries(k.map((c) => [c, e[c]]))), JSON.stringify(set));
    }
  }
  setSetting(db, "phone_conversion_report", report);
  return report;
}
