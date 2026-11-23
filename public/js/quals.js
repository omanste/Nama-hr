// Degrees and courses with the year each was obtained: shown as "Bachelor · Marketing · 2008 · 18 years", newest first,
// and edited as small lists (level, specialization, year / course, year).
import { t } from "./i18n.js";
import { h, select, num, todayIso, dmy } from "./ui.js";
import { splitLangs, joinLangs } from "./i18n.js";

export const LEVELS = ["general", "diploma", "higher_diploma", "bachelor", "master", "phd", "professional", "other"];
export const parseList = (v) => { if (!v) return []; if (Array.isArray(v)) return v; try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } };
/** "18 years" / "1 year" / "this year" since a graduation date (full years) or, for older entries, a year. */
export const yearsSince = (year, date = null) => {
  if (!year && !date) return "";
  const today = todayIso();
  const n = date ? Number(today.slice(0, 4)) - Number(date.slice(0, 4)) - (today.slice(5) < date.slice(5, 10) ? 1 : 0) : Number(today.slice(0, 4)) - Number(year);
  // Arabic counts: سنة واحدة · سنتان · 3–10 سنوات · 11+ سنة
  return n <= 0 ? t("q_this_year") : n === 1 ? t("q_one_year") : n === 2 ? t("q_two_years") : n <= 10 ? t("q_few_years", { n: num(n) }) : t("q_n_years", { n: num(n) });
};
const line = (main, year, date = null) => h("li", null, h("span", null, main), year || date ? h("span", { class: "q-year" }, ` · ${date ? dmy(date) : year} · `, h("b", null, yearsSince(year, date))) : null);
/** The list as shown on the profile (a dash when empty). */
export function degreesView(v) {
  const L = parseList(v);
  return L.length ? h("ul", { class: "q-list" }, L.map((d) => line(`${t("dl_" + d.level)} · ${d.field}`, d.year, d.date))) : "—";
}
export function coursesView(v) {
  const L = parseList(v);
  return L.length ? h("ul", { class: "q-list" }, L.map((c) => line(c.name, c.year))) : "—";
}
/** Text for the profile-updates page ("Bachelor · Marketing · 2008; …"). */
export const listText = (k, v) => parseList(v).map((x) => [k === "degrees" ? `${t("dl_" + x.level)} · ${x.field}` : x.name, x.date ? dmy(x.date) : x.year].filter(Boolean).join(" · ")).join("; ");
/** The highest degree in the list ("Master"), for the "Highest qualification" line. */
export const highestDegree = (v) => { const L = parseList(v); if (!L.length) return null; const rank = ["other", "general", "professional", "diploma", "higher_diploma", "bachelor", "master", "phd"];
  const top = [...L].sort((a, b) => rank.indexOf(b.level) - rank.indexOf(a.level))[0]; return `${t("dl_" + top.level)} · ${top.field}`; };

/** An editable list: rows of inputs, "+ Add", ✕ per row; .read() gives the list. */
export function listEditor(kind, value) {
  const box = h("div", { class: "q-edit" });
  const rows = h("div", { class: "q-rows" });
  const year = (v) => h("input", { type: "number", inputmode: "numeric", min: "1950", max: todayIso().slice(0, 4), step: "1", placeholder: t("q_year"), value: v ?? "", "aria-label": t("q_year"), class: "q-y" });
  const add = (x = {}) => {
    const r = kind === "degrees"
      ? h("div", { class: "q-row" }, select("level", LEVELS.map((l) => [l, t("dl_" + l)]), x.level || "bachelor", { "aria-label": t("q_level") }),
          h("input", { value: x.field || "", maxlength: 150, dir: "auto", placeholder: t("f_specialization"), "aria-label": t("f_specialization"), class: "q-f" }),
          // the graduation date (an older entry with a year only starts on 1 January of it, to be corrected)
          h("input", { type: "date", class: "q-d", value: x.date || (x.year ? `${x.year}-01-01` : ""), max: todayIso(), min: "1950-01-01", "aria-label": t("q_grad_date"), title: t("q_grad_date") }))
      : h("div", { class: "q-row" }, h("input", { value: x.name || "", maxlength: 150, dir: "auto", placeholder: t("q_course_name"), "aria-label": t("q_course_name"), class: "q-f" }), year(x.year));
    r.append(h("button", { type: "button", class: "btn small", "aria-label": t("q_remove"), title: t("q_remove"), onclick: () => r.remove() }, "✕"));
    rows.append(r);
  };
  parseList(value).forEach(add);
  box.append(rows, h("button", { type: "button", class: "btn small", onclick: () => add() }, "+ ", t(kind === "degrees" ? "q_add_degree" : "q_add_course")));
  box.read = () => [...rows.children].map((r) => {
    const f = r.querySelector(".q-f").value.trim();
    if (kind === "degrees") { const d = r.querySelector(".q-d").value; if (!f && !d) return null; return { level: r.querySelector("select").value, field: f, date: d || null }; }
    const y = r.querySelector(".q-y").value.trim();
    if (!f && !y) return null;
    return { name: f, year: y ? Number(y) : null };
  }).filter(Boolean);
  return box;
}

/** Languages as tick boxes (Arabic, English) and a box for any other; saved as "Arabic, English | العربية، الإنجليزية". */
const LANGS = [["ar", "العربية", "Arabic"], ["en", "الإنجليزية", "English"]];
export function languagesEditor(value) {
  const v = splitLangs(value), all = `${v.ar || ""} ${v.en || ""}`.toLowerCase();
  const rest = (v.en || v.ar || "").split(/[,،]\s*/).map((x) => x.trim()).filter((x) => x && !LANGS.some(([, a, e]) => [a, e.toLowerCase(), "عربي", "انجليزي", "إنجليزي"].includes(x.toLowerCase())));
  const ticks = LANGS.map(([k, ar, en]) => h("input", { type: "checkbox", value: k, checked: all.includes(en.toLowerCase()) || all.includes(ar) || (k === "ar" && /عربي/.test(all)) || (k === "en" && /انجليزي|إنجليزي/.test(all)) }));
  const other = h("input", { maxlength: 150, dir: "auto", placeholder: t("q_other_langs"), value: rest.join(", "), "aria-label": t("q_other_langs") });
  const box = h("div", { class: "q-langs" }, LANGS.map(([k, ar, en], i) => h("label", { class: "row", style: { gap: "6px" } }, ticks[i], t("lang_" + k))), other);
  box.read = () => {
    const picked = LANGS.filter((_, i) => ticks[i].checked), extra = other.value.split(/[,،]\s*/).map((x) => x.trim()).filter(Boolean);
    if (!picked.length && !extra.length) return null;
    return joinLangs([...picked.map(([, ar]) => ar), ...extra].join("، "), [...picked.map(([, , en]) => en), ...extra].join(", "));
  };
  return box;
}
