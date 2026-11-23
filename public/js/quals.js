// Degrees and courses with the year each was obtained: shown as "Bachelor · Marketing · 2008 · 18 years", newest first,
// and edited as small lists (level, specialization, year / course, year).
import { t } from "./i18n.js";
import { h, select, num, todayIso } from "./ui.js";

export const LEVELS = ["diploma", "higher_diploma", "bachelor", "master", "phd", "other"];
export const parseList = (v) => { if (!v) return []; if (Array.isArray(v)) return v; try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } };
/** "18 years" / "1 year" / "this year" since the given year. */
export const yearsSince = (year) => {
  if (!year) return "";
  const n = Number(todayIso().slice(0, 4)) - Number(year);
  // Arabic counts: سنة واحدة · سنتان · 3–10 سنوات · 11+ سنة
  return n <= 0 ? t("q_this_year") : n === 1 ? t("q_one_year") : n === 2 ? t("q_two_years") : n <= 10 ? t("q_few_years", { n: num(n) }) : t("q_n_years", { n: num(n) });
};
const line = (main, year) => h("li", null, h("span", null, main), year ? h("span", { class: "q-year" }, ` · ${year} · `, h("b", null, yearsSince(year))) : null);
/** The list as shown on the profile (a dash when empty). */
export function degreesView(v) {
  const L = parseList(v);
  return L.length ? h("ul", { class: "q-list" }, L.map((d) => line(`${t("dl_" + d.level)} · ${d.field}`, d.year))) : "—";
}
export function coursesView(v) {
  const L = parseList(v);
  return L.length ? h("ul", { class: "q-list" }, L.map((c) => line(c.name, c.year))) : "—";
}
/** Text for the profile-updates page ("Bachelor · Marketing · 2008; …"). */
export const listText = (k, v) => parseList(v).map((x) => [k === "degrees" ? `${t("dl_" + x.level)} · ${x.field}` : x.name, x.year].filter(Boolean).join(" · ")).join("; ");

/** An editable list: rows of inputs, "+ Add", ✕ per row; .read() gives the list. */
export function listEditor(kind, value) {
  const box = h("div", { class: "q-edit" });
  const rows = h("div", { class: "q-rows" });
  const year = (v) => h("input", { type: "number", inputmode: "numeric", min: "1950", max: todayIso().slice(0, 4), step: "1", placeholder: t("q_year"), value: v ?? "", "aria-label": t("q_year"), class: "q-y" });
  const add = (x = {}) => {
    const r = kind === "degrees"
      ? h("div", { class: "q-row" }, select("level", LEVELS.map((l) => [l, t("dl_" + l)]), x.level || "bachelor", { "aria-label": t("q_level") }),
          h("input", { value: x.field || "", maxlength: 150, dir: "auto", placeholder: t("f_specialization"), "aria-label": t("f_specialization"), class: "q-f" }), year(x.year))
      : h("div", { class: "q-row" }, h("input", { value: x.name || "", maxlength: 150, dir: "auto", placeholder: t("q_course_name"), "aria-label": t("q_course_name"), class: "q-f" }), year(x.year));
    r.append(h("button", { type: "button", class: "btn small", "aria-label": t("q_remove"), title: t("q_remove"), onclick: () => r.remove() }, "✕"));
    rows.append(r);
  };
  parseList(value).forEach(add);
  box.append(rows, h("button", { type: "button", class: "btn small", onclick: () => add() }, "+ ", t(kind === "degrees" ? "q_add_degree" : "q_add_course")));
  box.read = () => [...rows.children].map((r) => {
    const f = r.querySelector(".q-f").value.trim(), y = r.querySelector(".q-y").value.trim();
    if (!f && !y) return null;
    return kind === "degrees" ? { level: r.querySelector("select").value, field: f, year: y ? Number(y) : null } : { name: f, year: y ? Number(y) : null };
  }).filter(Boolean);
  return box;
}
