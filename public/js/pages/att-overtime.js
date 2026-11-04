// Overtime: the month's extra time after hours approved by the manager and confirmed by HR, for Accounts — the hours split
// into daytime and night / rest-day hours with their multipliers, and the paid hours to multiply by the hourly basic wage.
// HR (and Admin) set the multipliers at the top.
import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, clear, field, pageHead, empty, num, dmy, todayIso, toast, errText } from "../ui.js";

const hrs = (m) => `${(Number(m || 0) / 60).toFixed(2)} ${t("ot_h")}`;

export async function render(el, _p, { me, query }) {
  if (!["hr", "admin", "accounts", "ceo", "chairman"].includes(me.user.role)) throw { status: 403 };
  const mayRates = ["hr", "admin"].includes(me.user.role);
  const settings = await api.get("/api/settings");
  const month = h("input", { type: "month", value: /^\d{4}-\d{2}$/.test(query.get("m") || "") ? query.get("m") : todayIso().slice(0, 7) });
  const csv = h("a", { class: "btn", href: "#" }, "⬇ ", t("download_excel"));
  const out = h("div");

  const day = h("input", { type: "number", min: "1", max: "5", step: "0.05", inputmode: "decimal", value: settings.overtime_rate_day ?? 1.25 });
  const night = h("input", { type: "number", min: "1", max: "5", step: "0.05", inputmode: "decimal", value: settings.overtime_rate_night ?? 1.5 });
  const nightStart = h("input", { type: "time", value: settings.overtime_night_start || "21:00" });
  const rates = h("section", { class: "card" }, h("h2", null, t("ot_rates")), h("p", { class: "sub" }, t("ot_rates_hint")),
    mayRates
      ? h("div", { class: "fields" }, field(t("ot_day_rate"), day), field(t("ot_night_rate"), night), field(t("ot_night_start"), nightStart),
          h("div", { class: "field" }, h("label", null, " "), h("button", { class: "btn primary", type: "button", onclick: async () => {
            try { await api.put("/api/settings/overtime", { overtime_rate_day: Number(day.value || 1), overtime_rate_night: Number(night.value || 1), overtime_night_start: nightStart.value }); toast(t("saved")); load(); }
            catch (e) { toast(errText(e), "bad"); }
          } }, t("save"))))
      : h("p", null, t("ot_day_rate"), ": ", h("b", null, `×${settings.overtime_rate_day}`), " · ", t("ot_night_rate"), ": ", h("b", null, `×${settings.overtime_rate_night}`), " · ", t("ot_night_start"), ": ", h("b", null, settings.overtime_night_start)));

  async function load() {
    csv.href = `/api/reports/overtime?month=${month.value}&format=csv`;
    let r;
    try { r = await api.get(`/api/reports/overtime?month=${month.value}`); } catch (e) { clear(out).append(empty(errText(e))); return; }
    const per = new Map();
    for (const x of r.rows) { const p = per.get(x.employee.id) || { employee: x.employee, n: 0, minutes: 0, day_min: 0, night_min: 0, paid_min: 0 }; p.n++; for (const k of ["minutes", "day_min", "night_min", "paid_min"]) p[k] += x[k]; per.set(x.employee.id, p); }
    clear(out).append(...[
      h("div", { class: "grid tiles" },
        h("div", { class: "card tile" }, h("div", { class: "n" }, hrs(r.totals.paid_min)), h("div", { class: "l" }, t("ot_paid"))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, hrs(r.totals.minutes)), h("div", { class: "l" }, t("ot_hours"))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, num(per.size)), h("div", { class: "l" }, t("ol_people")))),
      per.size ? h("section", { class: "card", style: { marginTop: "16px" } }, h("h2", null, t("allow_by_person")),
        h("div", { class: "table-wrap" }, h("table", null,
          h("thead", null, h("tr", null, [t("employee"), t("ot_times"), t("ot_day_hours"), t("ot_night_hours"), t("ot_paid")].map((x, i) => h("th", { class: i ? "num" : null }, x)))),
          h("tbody", null, [...per.values()].map((p) => h("tr", null,
            h("td", null, nm(p.employee), h("div", { class: "muted" }, p.employee.emp_no)),
            h("td", { class: "num" }, num(p.n)), h("td", { class: "num" }, hrs(p.day_min)), h("td", { class: "num" }, hrs(p.night_min)), h("td", { class: "num" }, h("b", null, hrs(p.paid_min))))))))) : null,
      h("section", { class: "card", style: { marginTop: "16px" } }, h("h2", null, t("ot_list")), h("p", { class: "sub" }, t("ot_note")),
        r.rows.length ? h("div", { class: "table-wrap" }, h("table", null,
          h("thead", null, h("tr", null, [t("employee"), t("date"), t("ot_day_hours"), t("ot_night_hours"), t("ot_paid")].map((x, i) => h("th", { class: i > 1 ? "num" : null }, x)))),
          h("tbody", null, r.rows.map((x) => h("tr", null,
            h("td", null, nm(x.employee), h("div", { class: "muted" }, x.employee.emp_no)),
            h("td", null, h("a", { href: `#/leave/${x.id}` }, dmy(x.date)), h("div", { class: "muted" }, `${x.from}–${x.to}`), x.off_day ? h("div", { class: "muted" }, t("ot_off_day")) : null),
            h("td", { class: "num" }, hrs(x.day_min), h("div", { class: "muted" }, `×${x.rates.day}`)),
            h("td", { class: "num" }, hrs(x.night_min), h("div", { class: "muted" }, `×${x.rates.night}`)),
            h("td", { class: "num" }, h("b", null, hrs(x.paid_min)))))))) : empty(t("ot_none")))].filter(Boolean));   clear(out).append(...[
      h("div", { class: "grid tiles" },
        h("div", { class: "card tile" }, h("div", { class: "n" }, hrs(r.totals.paid_min)), h("div", { class: "l" }, t("ot_paid"))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, hrs(r.totals.minutes)), h("div", { class: "l" }, t("ot_hours"))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, num(per.size)), h("div", { class: "l" }, t("ol_people")))),
      per.size ? h("section", { class: "card", style: { marginTop: "16px" } }, h("h2", null, t("allow_by_person")),
        h("div", { class: "table-wrap" }, h("table", null,
          h("thead", null, h("tr", null, [t("employee"), t("ot_times"), t("ot_day_hours"), t("ot_night_hours"), t("ot_paid")].map((x, i) => h("th", { class: i ? "num" : null }, x)))),
          h("tbody", null, [...per.values()].map((p) => h("tr", null,
            h("td", null, nm(p.employee), h("div", { class: "muted" }, p.employee.emp_no)),
            h("td", { class: "num" }, num(p.n)), h("td", { class: "num" }, hrs(p.day_min)), h("td", { class: "num" }, hrs(p.night_min)), h("td", { class: "num" }, h("b", null, hrs(p.paid_min))))))))) : null,
      h("section", { class: "card", style: { marginTop: "16px" } }, h("h2", null, t("ot_list")), h("p", { class: "sub" }, t("ot_note")),
        r.rows.length ? h("div", { class: "table-wrap" }, h("table", null,
          h("thead", null, h("tr", null, [t("employee"), t("date"), t("ot_day_hours"), t("ot_night_hours"), t("ot_paid")].map((x, i) => h("th", { class: i > 1 ? "num" : null }, x)))),
          h("tbody", null, r.rows.map((x) => h("tr", null,
            h("td", null, nm(x.employee), h("div", { class: "muted" }, x.employee.emp_no)),
            h("td", null, h("a", { href: `#/leave/${x.id}` }, dmy(x.date)), h("div", { class: "muted" }, `${x.from}–${x.to}`), x.off_day ? h("div", { class: "muted" }, t("ot_off_day")) : null),
            h("td", { class: "num" }, hrs(x.day_min), h("div", { class: "muted" }, `×${x.rates.day}`)),
            h("td", { class: "num" }, hrs(x.night_min), h("div", { class: "muted" }, `×${x.rates.night}`)),
            h("td", { class: "num" }, h("b", null, hrs(x.paid_min)))))))) : empty(t("ot_none")))].filter(Boolean));
  }
  month.addEventListener("change", load);
  el.append(pageHead(t("nav_overtime"), h("a", { class: "btn", href: "#/attendance/report" }, t("nav_att_report")), csv),
    rates, h("section", { class: "card", style: { marginTop: "16px" } }, h("div", { class: "fields" }, field(t("month"), month))), out);
  await load();
}
