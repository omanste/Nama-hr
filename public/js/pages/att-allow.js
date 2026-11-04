// External work task allowances: the month's approved tasks with their days outside Muscat, nights and amount — for
// Accounts, HR and top management. HR (and Admin) set the two rates at the top.
import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, clear, select, field, pageHead, empty, num, dmy, todayIso, toast, errText } from "../ui.js";

const omr = (n) => `${Number(n || 0).toFixed(3)} ${t("omr")}`;

export async function render(el, _p, { me, query }) {
  if (!["hr", "admin", "accounts", "ceo", "chairman"].includes(me.user.role)) throw { status: 403 };
  const mayRates = ["hr", "admin"].includes(me.user.role);
  const settings = await api.get("/api/settings");
  const month = h("input", { type: "month", value: /^\d{4}-\d{2}$/.test(query.get("m") || "") ? query.get("m") : todayIso().slice(0, 7) });
  const csv = h("a", { class: "btn", href: "#" }, "⬇ ", t("download_excel"));
  const out = h("div");

  // the rates (HR / Admin)
  const day = h("input", { type: "number", min: "0", max: "1000", step: "0.001", inputmode: "decimal", value: settings.mission_day_allowance ?? 0 });
  const night = h("input", { type: "number", min: "0", max: "1000", step: "0.001", inputmode: "decimal", value: settings.mission_night_allowance ?? 0 });
  const rates = h("section", { class: "card" }, h("h2", null, t("allow_rates")), h("p", { class: "sub" }, t("allow_rates_hint")),
    mayRates
      ? h("div", { class: "fields" }, field(t("allow_day_rate"), day), field(t("allow_night_rate"), night),
          h("div", { class: "field" }, h("label", null, " "), h("button", { class: "btn primary", type: "button", onclick: async () => {
            try { await api.put("/api/settings/allowances", { mission_day_allowance: Number(day.value || 0), mission_night_allowance: Number(night.value || 0) }); toast(t("saved")); load(); }
            catch (e) { toast(errText(e), "bad"); }
          } }, t("save"))))
      : h("p", null, t("allow_day_rate"), ": ", h("b", null, omr(settings.mission_day_allowance)), " · ", t("allow_night_rate"), ": ", h("b", null, omr(settings.mission_night_allowance))));

  async function load() {
    csv.href = `/api/reports/mission-allowances?month=${month.value}&format=csv`;
    let r;
    try { r = await api.get(`/api/reports/mission-allowances?month=${month.value}`); } catch (e) { clear(out).append(empty(errText(e))); return; }
    // totals per person
    const per = new Map();
    for (const x of r.rows) { const p = per.get(x.employee.id) || { employee: x.employee, tasks: 0, days: 0, nights: 0, amount: 0 }; p.tasks++; p.days += x.days_outside; p.nights += x.nights; p.amount += x.allowance; per.set(x.employee.id, p); }
    clear(out).append(...[
      h("div", { class: "grid tiles" },
        h("div", { class: "card tile" }, h("div", { class: "n" }, omr(r.total)), h("div", { class: "l" }, t("allow_total"))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, num(r.rows.length)), h("div", { class: "l" }, t("allow_tasks"))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, num(per.size)), h("div", { class: "l" }, t("ol_people")))),
      per.size ? h("section", { class: "card", style: { marginTop: "16px" } }, h("h2", null, t("allow_by_person")),
        h("div", { class: "table-wrap" }, h("table", null,
          h("thead", null, h("tr", null, [t("employee"), t("allow_tasks"), t("allow_days_out"), t("allow_nights"), t("allow_amount")].map((x, i) => h("th", { class: i ? "num" : null }, x)))),
          h("tbody", null, [...per.values()].map((p) => h("tr", null,
            h("td", null, nm(p.employee), h("div", { class: "muted" }, p.employee.emp_no)),
            h("td", { class: "num" }, num(p.tasks)), h("td", { class: "num" }, num(p.days)), h("td", { class: "num" }, num(p.nights)), h("td", { class: "num" }, h("b", null, omr(p.amount))))))))) : null,
      h("section", { class: "card", style: { marginTop: "16px" } }, h("h2", null, t("allow_tasks_list")),
        r.rows.length ? h("div", { class: "table-wrap" }, h("table", null,
          h("thead", null, h("tr", null, [t("employee"), t("date"), t("mission_place"), t("allow_days_out"), t("allow_nights"), t("allow_amount")].map((x, i) => h("th", { class: i > 2 ? "num" : null }, x)))),
          h("tbody", null, r.rows.map((x) => h("tr", null,
            h("td", null, nm(x.employee), h("div", { class: "muted" }, x.employee.emp_no)),
            h("td", null, h("a", { href: `#/leave/${x.id}` }, x.start_date === x.end_date ? dmy(x.start_date) : `${dmy(x.start_date)} – ${dmy(x.end_date)}`), h("div", { class: "muted" }, `${x.time}–${x.end_time} · ${t("allow_n_days", { n: num(x.days) })}`)),
            h("td", null, x.place, x.outside_muscat ? null : h("div", { class: "muted" }, t("allow_in_muscat"))),
            h("td", { class: "num" }, num(x.days_outside)), h("td", { class: "num" }, num(x.nights)),
            h("td", { class: "num" }, h("b", null, omr(x.allowance)), x.note ? h("div", { class: "muted", title: x.note }, "✎ ", t("allow_corrected")) : null)))))) : empty(t("allow_none")))].filter(Boolean));
  }
  month.addEventListener("change", load);
  el.append(pageHead(t("nav_allowances"), h("a", { class: "btn", href: "#/attendance/report" }, t("nav_att_report")), csv),
    rates, h("section", { class: "card", style: { marginTop: "16px" } }, h("div", { class: "fields" }, field(t("month"), month))), out);
  await load();
}
