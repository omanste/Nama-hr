// Team leave calendar: who is off on each day of a month (pending shown lighter).
import { api } from "../api.js";
import { t, nm, getLang } from "../i18n.js";
import { h, pageHead, empty, todayIso } from "../ui.js";

const pad = (n) => String(n).padStart(2, "0");
const shift = (month, n) => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };

export async function render(el, _p, { can, query }) {
  if (!can.staffList()) throw { status: 403 };
  const month = /^\d{4}-\d{2}$/.test(query.get("m") || "") ? query.get("m") : todayIso().slice(0, 7);
  const data = await api.get(`/api/calendar?month=${month}`);
  const [y, m] = month.split("-").map(Number);
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const title = new Intl.DateTimeFormat(getLang() === "ar" ? "ar-OM-u-nu-latn" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  const holidays = new Map(data.holidays.map((x) => [x.date, x.name]));
  const days = [];
  for (let d = 1; d <= daysIn; d++) {
    const iso = `${month}-${pad(d)}`;
    const off = data.items.filter((r) => r.start_date <= iso && r.end_date >= iso);
    const dow = new Date(iso + "T00:00:00Z").getUTCDay();
    if (!off.length && !holidays.has(iso)) continue;
    days.push(h("div", { class: "item", style: { alignItems: "flex-start", opacity: dow === 5 || dow === 6 ? 0.75 : 1 } },
      h("div", { style: { minWidth: "64px" } }, h("div", { class: "title num" }, pad(d)),
        h("div", { class: "meta" }, new Intl.DateTimeFormat(getLang() === "ar" ? "ar-OM" : "en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z")))),
      h("div", { class: "grow row" },
        holidays.has(iso) ? h("span", { class: "badge b-on_leave" }, `${t("holiday")}: ${holidays.get(iso)}`) : null,
        off.map((r) => h("a", { href: `#/leave/${r.id}`, class: `badge ${r.status === "approved" ? "b-approved" : "b-pending"}`, title: t("lt_" + r.type) }, `${nm(r)} · ${t("lt_" + r.type)}`))),
      off.length ? h("span", { class: "badge" }, t("off_count", { n: off.length })) : null));
  }
  el.append(pageHead(t("nav_calendar"),
      h("a", { class: "btn small", href: `#/calendar?m=${shift(month, -1)}`, "aria-label": t("prev_month") }, getLang() === "ar" ? "→" : "←"),
      h("span", { class: "title", style: { fontWeight: 600 } }, title),
      h("a", { class: "btn small", href: `#/calendar?m=${shift(month, 1)}`, "aria-label": t("next_month") }, getLang() === "ar" ? "←" : "→")),
    days.length ? h("div", { class: "list" }, days) : empty(t("calendar_none")));
}
