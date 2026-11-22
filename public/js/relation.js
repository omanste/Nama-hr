// The emergency contact's relationship: family only, from Admin's list; "Other family member" asks which (saved as
// "Other family: <what>").
import { api } from "./api.js";
import { t, getLang } from "./i18n.js";
import { h, select } from "./ui.js";

let cache = null;
export const relations = () => (cache ||= api.get("/api/emergency-relations").then((r) => r.items).catch(() => []));
const OTHER = /^Other family:\s*/i;

/** The saved value shown in the reader's language: "Brother" → «الأخ»; "Other family: cousin" → «فرد آخر من العائلة: cousin». */
export function relationText(v, list) {
  if (!v) return "";
  const ar = getLang() === "ar";
  if (OTHER.test(v)) { const o = (list || []).find((r) => r.other); return `${o ? (ar ? o.ar : o.en) : "Other family member"}: ${v.replace(OTHER, "")}`; }
  const r = (list || []).find((x) => x.en === v);
  return r ? (ar ? r.ar : r.en) : v;
}
/** A dropdown (and the "which family member" box), named `name` for FormData; .value is what is saved. */
export function relationInput(name, value, list, { required = false } = {}) {
  const ar = getLang() === "ar";
  const known = list.find((r) => !r.other && r.en === value), isOther = value && OTHER.test(value);
  const old = value && !known && !isOther; // an older free-text value: shown until a family relationship is chosen
  const sel = select(`${name}__pick`, [["", "—"], ...list.map((r) => [r.other ? "__other" : r.en, ar ? `${r.ar} · ${r.en}` : `${r.en} · ${r.ar}`]), ...(old ? [["__old", `${value} (${t("rel_choose")})`]] : [])],
    known ? value : isOther ? "__other" : old ? "__old" : "", { required });
  const other = h("input", { placeholder: t("rel_other_hint"), value: isOther ? value.replace(OTHER, "") : "", maxlength: 60 });
  const hidden = h("input", { type: "hidden", name });
  const read = () => (sel.value === "__other" ? (other.value.trim() ? `Other family: ${other.value.trim()}` : "Other family:") : sel.value === "__old" ? value : sel.value || "");
  const sync = () => { other.hidden = sel.value !== "__other"; other.required = !other.hidden; hidden.value = read(); };
  sel.addEventListener("change", () => { sync(); if (!other.hidden) other.focus(); });
  other.addEventListener("input", sync);
  sync();
  const el = h("div", { class: "grid", style: { gap: "6px" } }, sel, other, hidden);
  Object.defineProperty(el, "value", { get: read });
  el.name = name;
  return el;
}
