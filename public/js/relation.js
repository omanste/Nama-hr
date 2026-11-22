// The emergency contact's relationship: family only, from Admin's list. Saved as a language-neutral key ("father",
// "brother", …; "other:<who>" for another family member) and always shown in the reader's language.
import { api } from "./api.js";
import { getLang } from "./i18n.js";
import { h, select } from "./ui.js";

let cache = null;
export const relations = () => (cache ||= api.get("/api/emergency-relations").then((r) => r.items).catch(() => []));
const OTHER = /^(?:other|other family(?: member)?)\s*:\s*/i; // "other:cousin" (and the older "Other family: cousin")
const keyOf = (r) => (r.other ? "other" : r.key || String(r.en || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
/** The list item a saved value stands for: by its key, or (older records) by the English or Arabic word. */
const itemOf = (v, list) => (list || []).find((r) => !r.other && [keyOf(r), r.en, r.ar].some((x) => x && x.toLowerCase() === String(v).toLowerCase()));

/** The saved value in the reader's language: "brother" → «الأخ» / "Brother"; "other:cousin" → «فرد آخر من العائلة: cousin». */
export function relationText(v, list) {
  if (!v) return "";
  const ar = getLang() === "ar";
  if (OTHER.test(v)) { const o = (list || []).find((r) => r.other); return `${o ? (ar ? o.ar : o.en) : ar ? "فرد آخر من العائلة" : "Other family member"}: ${v.replace(OTHER, "")}`; }
  const r = itemOf(v, list);
  return r ? (ar ? r.ar : r.en) : v;
}
/** A dropdown in the reader's language only (and, for "Other family member", a required box saying who), named `name`
 * for FormData; .value is what is saved (the key). */
export function relationInput(name, value, list, { required = false } = {}) {
  const ar = getLang() === "ar";
  const known = value && !OTHER.test(value) ? itemOf(value, list) : null, isOther = !!value && OTHER.test(value);
  const old = value && !known && !isOther; // an older free-text value: shown as it is until a family relationship is chosen
  const sel = select(`${name}__pick`, [["", "—"], ...list.map((r) => [keyOf(r), ar ? r.ar : r.en]), ...(old ? [["__old", value]] : [])],
    known ? keyOf(known) : isOther ? "other" : old ? "__old" : "", { required, dir: ar ? "rtl" : "ltr", class: "rel-pick" });
  const other = h("input", { name: `${name}__other`, value: isOther ? value.replace(OTHER, "") : "", maxlength: 60, dir: "auto", "aria-label": ar ? "من هو؟" : "Who is it?" });
  const hidden = h("input", { type: "hidden", name });
  const read = () => (sel.value === "other" ? `other:${other.value.trim()}` : sel.value === "__old" ? value : sel.value || "");
  const sync = () => {
    other.hidden = sel.value !== "other"; other.required = !other.hidden; other.disabled = other.hidden;
    // "Other family member" can't be saved without saying who
    other.setCustomValidity(!other.hidden && other.value.trim().length < 2 ? (ar ? "اكتب من هو فرد العائلة" : "Write who this family member is") : "");
    hidden.value = read();
  };
  sel.addEventListener("change", () => { sync(); if (!other.hidden) other.focus(); });
  other.addEventListener("input", sync);
  sync();
  const el = h("div", { class: "grid rel-input", style: { gap: "6px" } }, sel, other, hidden);
  Object.defineProperty(el, "value", { get: read });
  el.name = name;
  return el;
}
