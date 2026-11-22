/* Check-in verification (Admin › Settings): a live photo, Face ID / fingerprint on the phone, and the location (GPS within a
 * work site) — each on or off for the whole company, and Default / On / Off for a person (location off for field staff…).
 * A check that is on but fails (outside every site, no location, no photo or a dark one, Face ID not confirmed) never
 * stops the check-in: the check-in is saved and flagged, the manager and HR are told, and the manager accepts it or not. */
import { getSetting } from "./db.mjs";

export const CHECKS = ["photo", "faceid", "location"];
let faceDefault = () => true;
/** The Face ID company default follows the older faceid_mode setting until Admin sets the switch (set by webauthn.mjs). */
export const setFaceDefault = (f) => { faceDefault = f; };

/** The company's switches. */
export function verifyDefaults(db) {
  const v = (k, d) => { const x = getSetting(db, `verify_${k}`, null); return x === null || x === undefined ? d : x !== false; };
  return { photo: v("photo", true), faceid: v("faceid", faceDefault(db)), location: v("location", true) };
}
/** What this person is asked for at check-in: their own setting (On / Off), else the company's. */
export function verifyFor(db, emp) {
  const d = verifyDefaults(db), out = {};
  for (const c of CHECKS) {
    const o = emp ? emp[`verify_${c}`] : null;
    out[c] = o === "on" ? true : o === "off" ? false : c === "faceid" && emp && emp.faceid_exempt ? false : d[c];
  }
  return out;
}
/** The checks a person has off, for notes in reports: ["location", …]. */
export const checksOff = (db, emp) => { const v = verifyFor(db, emp); return CHECKS.filter((c) => !v[c]); };

/** Why a check-in is flagged, in words: { ar, en } for one reason {code, km?}. */
export function flagText(f) {
  switch (f.code) {
    case "outside": return { ar: `خارج مواقع العمل${f.km !== undefined && f.km !== null ? ` (على بعد ${f.km} كم)` : ""}`, en: `outside work site${f.km !== undefined && f.km !== null ? ` (${f.km} km away)` : ""}` };
    case "no_location": return { ar: "الموقع غير متاح", en: "location unavailable" };
    case "no_photo": return { ar: "بدون صورة", en: "no photo" };
    case "photo_unclear": return { ar: "الصورة غير واضحة", en: "photo unclear" };
    case "faceid_failed": return { ar: "لم يُتحقق بالوجه أو البصمة", en: "Face ID / fingerprint not confirmed" };
    default: return { ar: f.code, en: f.code };
  }
}
export const flagsText = (flags, lang) => (flags || []).map((f) => flagText(f)[lang]).join(lang === "ar" ? "، " : ", ");
