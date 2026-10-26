// Official holidays editor: add a day or a range (e.g. Eid), see them in a table and on a year calendar.
import { t, getLang } from "./i18n.js";
import { h, field, dmy, todayIso, num } from "./ui.js";

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => d.toISOString().slice(0, 10);
const loc = () => (getLang() === "ar" ? "ar-OM-u-nu-latn" : "en-GB");
const weekday = (s) => new Intl.DateTimeFormat(loc(), { weekday: "long", timeZone: "UTC" }).format(new Date(s + "T00:00:00Z"));
const isWeekend = (s) => [5, 6].includes(new Date(s + "T00:00:00Z").getUTCDay()); // Friday, Saturday

/** Returns { el, value() } — value() is the sorted [{date, name}] list to save. */
export function holidayEditor(initial) {
  let list = [...initial].sort((a, b) => (a.date < b.date ? -1 : 1));
  let year = Number((list.find((x) => x.date >= todayIso()) || { date: todayIso() }).date.slice(0, 4));
  const from = h("input", { type: "date" }), to = h("input", { type: "date" }), name = h("input", { dir: "auto", placeholder: t("holiday_name_ph") });
  const err = h("div", { class: "form-error" });
  const tableBox = h("div"), calBox = h("div");

  function add() {
    err.textContent = "";
    if (!from.value) { err.textContent = t("required"); return; }
    const end = to.value || from.value;
    if (end < from.value) { err.textContent = t("err_end_before_start"); return; }
    const days = [];
    for (let d = new Date(from.value + "T00:00:00Z"); iso(d) <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(iso(d));
    if (days.length > 31) { err.textContent = t("err_too_long"); return; }
    const taken = new Set(list.map((x) => x.date));
    list = [...list, ...days.filter((d) => !taken.has(d)).map((date) => ({ date, name: name.value.trim() }))].sort((a, b) => (a.date < b.date ? -1 : 1));
    year = Number(from.value.slice(0, 4));
    from.value = to.value = name.value = "";
    draw();
  }
  const remove = (date) => { list = list.filter((x) => x.date !== date); draw(); };

  function table() {
    const rows = list.filter((x) => x.date.startsWith(String(year)));
    if (!rows.length) return h("div", { class: "empty" }, t("holidays_none_year", { y: year }));
    const today = todayIso();
    return h("div", { class: "table-wrap" }, h("table", null,
      h("thead", null, h("tr", null, [t("date"), t("weekday"), t("holiday_name"), t("hol_status"), ""].map((x) => h("th", null, x)))),
      h("tbody", null, rows.map((x) => {
        const diff = Math.round((Date.parse(x.date) - Date.parse(today)) / 864e5);
        return h("tr", { class: diff < 0 ? "muted" : null },
          h("td", { class: "num" }, dmy(x.date)), h("td", null, weekday(x.date)), h("td", { dir: "auto" }, x.name || "—"),
          h("td", null, diff < 0 ? t("holiday_past") : diff === 0 ? h("span", { class: "badge b-approved" }, t("today")) : h("span", { class: "badge b-pending" }, t("in_days", { n: num(diff) }))),
          h("td", null, h("button", { class: "btn small danger", type: "button", onclick: () => remove(x.date) }, t("delete"))));
      }))));
  }

  function calendar() {
    const names = new Map(list.map((x) => [x.date, x.name]));
    const wk = [0, 1, 2, 3, 4, 5, 6].map((i) => new Intl.DateTimeFormat(loc(), { weekday: "narrow", timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + i)))); // Sun..Sat
    const today = todayIso();
    return h("div", { class: "year-cal" }, Array.from({ length: 12 }, (_, m) => {
      const first = new Date(Date.UTC(year, m, 1)), days = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
      const cells = [...Array(first.getUTCDay()).fill(null), ...Array.from({ length: days }, (_, i) => `${year}-${pad(m + 1)}-${pad(i + 1)}`)];
      return h("div", { class: "month" },
        h("div", { class: "mname" }, new Intl.DateTimeFormat(loc(), { month: "long", timeZone: "UTC" }).format(first)),
        h("div", { class: "mgrid" }, wk.map((w) => h("span", { class: "wk" }, w)),
          cells.map((d) => d === null ? h("span") : h("span", {
            class: ["d", names.has(d) ? "hol" : "", isWeekend(d) ? "we" : "", d === today ? "today" : ""].filter(Boolean).join(" "),
            title: names.has(d) ? `${dmy(d)} · ${names.get(d) || t("holiday")}` : dmy(d),
          }, String(Number(d.slice(8)))))));
    }));
  }

  function draw() {
    const count = list.filter((x) => x.date.startsWith(String(year))).length;
    tableBox.replaceChildren(
      h("div", { class: "row", style: { justifyContent: "space-between", margin: "16px 0 8px" } },
        h("button", { class: "btn small", type: "button", onclick: () => { year--; draw(); } }, getLang() === "ar" ? "→" : "←"),
        h("strong", { class: "num" }, `${year} · ${t("holidays_count", { n: count })}`),
        h("button", { class: "btn small", type: "button", onclick: () => { year++; draw(); } }, getLang() === "ar" ? "←" : "→")),
      table());
    calBox.replaceChildren(calendar(),
      h("div", { class: "row sub", style: { marginTop: "8px", gap: "14px" } },
        h("span", null, h("i", { class: "key hol" }), t("holiday")), h("span", null, h("i", { class: "key we" }), t("weekend")), h("span", null, h("i", { class: "key today" }), t("today"))));
  }
  draw();

  const el = h("div", null,
    h("div", { class: "fields" }, field(t("holiday_from"), from), field(t("holiday_to"), to, { hint: t("holiday_to_hint") }), field(t("holiday_name"), name),
      h("div", { class: "field", style: { alignSelf: "end" } }, h("button", { class: "btn", type: "button", onclick: add }, t("holiday_add")))),
    err, tableBox, calBox);
  return { el, value: () => list };
}
