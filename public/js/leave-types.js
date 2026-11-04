// Which leave types apply to a person — shared by the pages and the server (server/ledger.mjs), so every list agrees.
// Maternity and child care are for women, paternity for men (Art. 84, Art. 83); exam and patient-care leave for Omani staff.
// With no gender on record none of the three is offered (HR records it, or the ID-card reader fills it in).
import { isOmani } from "./countries.js";

export const GENDER_TYPES = { maternity: "female", childcare: "female", paternity: "male" };
export const OMANI_TYPES = ["exam", "patient_care"];

/** Does this leave type apply to the person? */
export function appliesTo(emp, type) {
  if (!emp) return true;
  if (GENDER_TYPES[type]) return emp.gender === GENDER_TYPES[type];
  if (OMANI_TYPES.includes(type)) return !emp.nationality || isOmani(emp.nationality);
  return true;
}
