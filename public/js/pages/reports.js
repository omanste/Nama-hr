// Permissions report: per person, how many times and how many hours of early leave, late arrival and personal breaks (approved).
import { api } from "../api.js";
import { t, nm, getLang } from "../i18n.js";
import { h, clear, select, field, pageHead, empty, num, dmy, todayIso, toast, errText } from "../ui.js";
import { columns, totals, permissionsPdf, permissionsXlsx } from "../perm-export.js";
import { pdfPreview } from "../pdf-preview.js";

const pad = (n) => String(n).padStart(2, "0");
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function period(key) {
  const d = todayIso(), y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  if (key === "last_month") { const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1; return [`${ly}-${pad(lm)}-01`, `${ly}-${pad(lm)}-${lastDay(ly, lm)}`]; }
  if (key === "this_year") return [`${y}-01-01`, `${y}-12-31`];
  return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${lastDay(y, m)}`];
}

export async function render(el, _p, { me, can, query }) {
  if (!can.viewAll() && !me.isApprover && !me.hasTeam) throw { status: 403 };
  const depts = can.viewAll() ? (await api.get("/api/departments")).items : [];
  const [f0, t0] = period("this_month");
  const from = h("input", { type: "date", value: query.get("from") || f0 });
  const to = h("input", { type: "date", value: query.get("to") || t0 });
  const quick = select("period", [["this_month", t("this_month")], ["last_month", t("last_month")], ["this_year", t("this_year")], ["custom", t("custom_period")]], "this_month");
  const dept = can.viewAll() ? select("department_id", [["", `${t("f_department")}: ${t("all")}`], ...depts.map((d) => [d.id, nm(d)])], "") : null;
  const onlyUsed = h("input", { type: "checkbox", checked: true, style: { width: "22px", height: "22px", minHeight: "0" } });
  const out = h("div");
  const hrs = (m) => num(Math.round(m / 6) / 10);

  async function load() {
    const qs = new URLSearchParams({ from: from.value, to: to.value });
    if (dept && dept.value) qs.set("department_id", dept.value);
    if (onlyUsed.checked) qs.set("only_used", "1");
    let r;
    try { r = await api.get(`/api/reports/permissions?${qs}`); } catch (e) { clear(out).append(empty(e && e.status === 403 ? t("perm_no_access") : errText(e))); return; }
    const sum = (k, f) => r.items.reduce((a, x) => a + x[k][f], 0);
    const tiles = h("div", { class: "grid tiles" },
      ...r.types.map((k) => h("div", { class: "card tile" }, h("div", { class: "n" }, num(sum(k, "count"))), h("div", { class: "l" }, t("lt_" + k), " · ", t("hours", { n: hrs(sum(k, "minutes")) })))),
      h("div", { class: "card tile warn" }, h("div", { class: "n" }, num(sum("total", "count"))), h("div", { class: "l" }, t("total"), " · ", t("hours", { n: hrs(sum("total", "minutes")) }))));
    // every column inside the card (no sideways scrolling): full names on one line with the staff ID under them;
    // "2 times · 3.5 h" as two short lines; a totals row; phones: one card per person
    const cols = columns(r.types, r.classes), T = totals(r.items, r.types, r.classes);
    const cell = (txt) => { const [a, b] = String(txt).split(" · "); return b ? h("span", { class: "pair" }, h("b", null, a), h("small", null, b)) : txt; };
    const grid = h("div", { class: "table-wrap keep-table att-grid perm-grid" }, h("table", null,
      h("thead", null, h("tr", null, h("th", { class: "name-col" }, t("employee")), cols.map(([k]) => h("th", { class: "num" }, t(k).replace(/ /, "\n"))))),
      h("tbody", null, r.items.map((x) => h("tr", null, h("td", { class: "name-col" }, h("a", { href: `#/staff/${x.employee.id}` }, nm(x.employee)), h("div", { class: "muted" }, x.employee.emp_no)),
        cols.map(([, f]) => h("td", { class: "num" }, cell(f(x)))))),
        h("tr", { class: "tot" }, h("td", { class: "name-col" }, h("b", null, t("pdf_totals"))), cols.map(([, f]) => h("td", { class: "num" }, cell(f(T))))))));
    const cards = h("div", { class: "att-cards" }, [...r.items.map((x) => [h("a", { href: `#/staff/${x.employee.id}` }, nm(x.employee)), x.employee.emp_no, x]), [h("b", null, t("pdf_totals")), "", T]].map(([title, sub, x]) =>
      h("div", { class: "card att-pcard" }, h("div", { class: "pc-head" }, title, sub ? h("div", { class: "muted" }, sub) : null),
        h("div", { class: "pc-grid" }, cols.map(([k, f]) => h("div", null, h("span", null, t(k)), h("b", null, cell(f(x)))))))));
    clear(out).append(
      h("p", { class: "sub" }, `${dmy(r.from)} – ${dmy(r.to)} · ${t("approved_only")} · ${t("perm_rule_policy")}`),
      tiles,
      r.items.length ? h("div", { style: { marginTop: "12px" } }, grid, cards) : empty(t("perm_none")));
  }
  const qs = () => { const q = new URLSearchParams({ from: from.value, to: to.value }); if (dept && dept.value) q.set("department_id", dept.value); if (onlyUsed.checked) q.set("only_used", "1"); return q; };
  const withDetails = h("input", { type: "checkbox", checked: true, style: { width: "20px", height: "20px", minHeight: "0" } });
  const run = (btn, fn) => async () => { const label = btn.textContent; btn.disabled = true; try { await fn(); } catch (e) { toast(errText(e), "bad"); } finally { btn.disabled = false; btn.textContent = label; } };
  const pdfBtn = h("button", { class: "btn primary", type: "button" }, "📄 ", t("perm_export_pdf"));
  // the preview: the period and "each permission" can be changed in it, and it redraws
  pdfBtn.onclick = () => {
    const pf = h("input", { type: "date", value: from.value }), pt = h("input", { type: "date", value: to.value });
    const det = select("details", [["1", t("yes")], ["0", t("no")]], withDetails.checked ? "1" : "0");
    pdfPreview({ title: t("report_permissions"), options: [{ label: t("holiday_from"), control: pf }, { label: t("holiday_to"), control: pt }, { label: t("perm_with_details"), control: det }],
      make: (onStep) => { const q = qs(); if (pf.value) q.set("from", pf.value); if (pt.value) q.set("to", pt.value); return permissionsPdf(q, { details: det.value === "1", onStep }); } });
  };
  const xlsBtn = h("button", { class: "btn", type: "button" }, "⬇ ", t("perm_export_xlsx"));
  xlsBtn.onclick = run(xlsBtn, () => permissionsXlsx(qs()));
  quick.addEventListener("change", () => { if (quick.value !== "custom") { [from.value, to.value] = period(quick.value); load(); } });
  for (const i of [from, to]) i.addEventListener("change", () => { quick.value = "custom"; if (from.value && to.value && from.value <= to.value) load(); else toast(t("err_end_before_start"), "bad"); });
  if (dept) dept.addEventListener("change", load);
  onlyUsed.addEventListener("change", load);

  el.append(pageHead(`${t("report_permissions")} · ${getLang() === "ar" ? "Permissions report" : "تقرير الاستئذانات"}`, pdfBtn, xlsBtn),
    h("section", { class: "card" }, h("div", { class: "fields" },
      field(t("period"), quick), field(t("holiday_from"), from), field(t("holiday_to"), to), dept ? field(t("f_department"), dept) : null,
      h("label", { class: "row", style: { alignSelf: "end", minHeight: "44px" } }, onlyUsed, t("only_used")),
      h("label", { class: "row", style: { alignSelf: "end", minHeight: "44px" } }, withDetails, t("perm_with_details")))),
    out);
  const voiceOut = h("div");
  if (["hr", "ceo", "chairman", "admin"].includes(me.user.role)) el.append(h("section", { class: "card", style: { marginTop: "16px" } }, h("h2", null, t("report_voice")), voiceOut));
  async function loadVoice() {
    if (!el.contains(voiceOut)) return;
    const r = await api.get(`/api/reports/voice?from=${from.value}&to=${to.value}`);
    const n = (c, open) => r.rows.filter((x) => (!c || x.category === c) && (!open || x.status !== "closed")).reduce((a, x) => a + x.n, 0);
    clear(voiceOut).append(h("p", { class: "sub" }, t("report_voice_note")),
      h("div", { class: "table-wrap" }, h("table", null,
        h("thead", null, h("tr", null, h("th", null, t("kind")), h("th", { class: "num" }, t("total")), h("th", { class: "num" }, t("still_open")))),
        h("tbody", null, r.categories.map((c) => h("tr", null, h("td", null, t("vc_" + c)), h("td", { class: "num" }, num(n(c))), h("td", { class: "num" }, num(n(c, true))))),
          h("tr", null, h("td", null, h("b", null, t("total"))), h("td", { class: "num" }, h("b", null, num(n()))), h("td", { class: "num" }, h("b", null, num(n(null, true)))))))));
  }
  for (const i of [from, to, quick]) i.addEventListener("change", () => setTimeout(loadVoice, 0));
  await Promise.all([load(), loadVoice()]);
}
