// Permissions report: per person, how many times and how many hours of early leave, late arrival and personal breaks (approved).
import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, clear, select, field, pageHead, empty, num, dmy, todayIso, toast, errText } from "../ui.js";

const pad = (n) => String(n).padStart(2, "0");
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function period(key) {
  const d = todayIso(), y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  if (key === "last_month") { const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1; return [`${ly}-${pad(lm)}-01`, `${ly}-${pad(lm)}-${lastDay(ly, lm)}`]; }
  if (key === "this_year") return [`${y}-01-01`, `${y}-12-31`];
  return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${lastDay(y, m)}`];
}

export async function render(el, _p, { me, can, query }) {
  if (!can.viewAll() && !me.isApprover) throw { status: 403 };
  const depts = can.viewAll() ? (await api.get("/api/departments")).items : [];
  const [f0, t0] = period("this_month");
  const from = h("input", { type: "date", value: query.get("from") || f0 });
  const to = h("input", { type: "date", value: query.get("to") || t0 });
  const quick = select("period", [["this_month", t("this_month")], ["last_month", t("last_month")], ["this_year", t("this_year")], ["custom", t("custom_period")]], "this_month");
  const dept = can.viewAll() ? select("department_id", [["", `${t("f_department")}: ${t("all")}`], ...depts.map((d) => [d.id, nm(d)])], "") : null;
  const onlyUsed = h("input", { type: "checkbox", checked: true, style: { width: "22px", height: "22px", minHeight: "0" } });
  const out = h("div");
  const csv = h("a", { class: "btn", href: "#" }, "⬇ ", t("download_excel"));
  const hrs = (m) => num(Math.round(m / 6) / 10);

  async function load() {
    const qs = new URLSearchParams({ from: from.value, to: to.value });
    if (dept && dept.value) qs.set("department_id", dept.value);
    if (onlyUsed.checked) qs.set("only_used", "1");
    csv.href = `/api/reports/permissions?${qs}&format=csv`;
    let r;
    try { r = await api.get(`/api/reports/permissions?${qs}`); } catch (e) { clear(out).append(empty(errText(e))); return; }
    const sum = (k, f) => r.items.reduce((a, x) => a + x[k][f], 0);
    const totals = h("div", { class: "grid tiles" },
      ...r.types.map((k) => h("div", { class: "card tile" }, h("div", { class: "n" }, num(sum(k, "count"))), h("div", { class: "l" }, t("lt_" + k), " · ", t("hours", { n: hrs(sum(k, "minutes")) })))),
      h("div", { class: "card tile warn" }, h("div", { class: "n" }, num(sum("total", "count"))), h("div", { class: "l" }, t("total"), " · ", t("hours", { n: hrs(sum("total", "minutes")) }))));
    clear(out).append(
      h("p", { class: "sub" }, `${dmy(r.from)} – ${dmy(r.to)} · ${t("approved_only")} · ${t("perm_rule_policy")}`),
      totals,
      r.items.length ? h("div", { class: "table-wrap", style: { marginTop: "12px" } }, h("table", null,
        h("thead", null, h("tr", null, h("th", null, t("employee")), ...r.types.map((k) => h("th", { class: "num" }, t("lt_" + k))), h("th", { class: "num" }, t("total")), ...r.classes.map((c) => h("th", { class: "num" }, t("pc_" + c))), h("th", { class: "num" }, t("att_awaiting_hr")))),
        h("tbody", null, r.items.map((x) => h("tr", null,
          h("td", null, h("a", { href: `#/staff/${x.employee.id}` }, nm(x.employee)), h("div", { class: "muted" }, x.employee.emp_no)),
          ...r.types.map((k) => h("td", { class: "num" }, x[k].count ? t("times_hours", { n: num(x[k].count), h: hrs(x[k].minutes) }) : "—")),
          h("td", { class: "num" }, h("b", null, x.total.count ? t("times_hours", { n: num(x.total.count), h: hrs(x.total.minutes) }) : "—")),
          ...[...r.classes, "unclassified"].map((c) => h("td", { class: "num" }, x.classes[c] ? t("hours", { n: hrs(x.classes[c]) }) : "—"))))))) : empty(t("perm_none")));
  }
  quick.addEventListener("change", () => { if (quick.value !== "custom") { [from.value, to.value] = period(quick.value); load(); } });
  for (const i of [from, to]) i.addEventListener("change", () => { quick.value = "custom"; if (from.value && to.value && from.value <= to.value) load(); else toast(t("err_end_before_start"), "bad"); });
  if (dept) dept.addEventListener("change", load);
  onlyUsed.addEventListener("change", load);

  el.append(pageHead(t("report_permissions"), csv),
    h("section", { class: "card" }, h("div", { class: "fields" },
      field(t("period"), quick), field(t("holiday_from"), from), field(t("holiday_to"), to), dept ? field(t("f_department"), dept) : null,
      h("label", { class: "row", style: { alignSelf: "end", minHeight: "44px" } }, onlyUsed, t("only_used")))),
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
