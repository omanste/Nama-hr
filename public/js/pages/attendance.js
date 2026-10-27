// Monthly attendance sheet (policy §15): each day against the person's shift, the month's totals, and the person's review.
// Staff see their own; a manager their team; HR everyone (the picker lists who this login may open).
import { api } from "../api.js";
import { t, nm, getLang } from "../i18n.js";
import { h, select, pageHead, empty, num, dmy, todayIso, toast, errText, confirm, clockText, durText, dateTime } from "../ui.js";
import { render as rerender } from "../app.js";

const pad = (n) => String(n).padStart(2, "0");
const loc = () => (getLang() === "ar" ? "ar-OM-u-nu-latn" : "en-GB");
const shiftMonth = (m, n) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
const weekday = (iso) => new Intl.DateTimeFormat(loc(), { weekday: "short", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));
const STATUS_CLASS = { present: "b-approved", missing: "b-pending", absent: "b-rejected", pending: "b-pending", leave: "b-on_leave", mission: "b-on_leave", holiday: "b-on_leave", rest: "", rest_worked: "", holiday_worked: "", no_data: "" };

/** "Shift 2 · 09:00–18:00" */
export const shiftText = (sh) => `${t("shift_" + sh.no)} · ${clockText(sh.start)}–${clockText(sh.end)}${sh.ramadan ? ` (${t("ramadan")})` : ""}`;

/** The month's totals as tiles. */
export function summaryTiles(s) {
  const tile = (n, l, cls = "") => h("div", { class: `card tile ${cls}` }, h("div", { class: "n" }, n), h("div", { class: "l" }, l));
  return h("div", { class: "grid tiles att-tiles" },
    tile(s.compliance === null ? "—" : `${num(s.compliance)}%`, t("att_compliance"), s.compliance !== null && s.compliance < 80 ? "warn" : ""),
    tile(`${num(s.onTime)} / ${num(s.workDays)}`, t("att_on_time_days")),
    tile(num(s.late), `${t("att_late")} · ${durText(s.lateMin)}`, s.late ? "warn" : ""),
    tile(num(s.early), `${t("att_early")} · ${durText(s.earlyMin)}`, s.early ? "warn" : ""),
    tile(num(s.missing), t("att_missing"), s.missing ? "warn" : ""),
    tile(num(s.absent), t("att_absent"), s.absent ? "bad" : ""),
    tile(num(s.leave), t("att_leave_days")),
    tile(num(s.mission), t("att_mission_days")),
    s.restWorked ? tile(num(s.restWorked), t("att_rest_worked")) : null,
    tile(s.onSiteDays ? durText(Math.round(s.onSite / s.onSiteDays)) : "—", t("att_avg_on_site")));
}

export async function render(el, _p, { me, query, can }) {
  const empId = Number(query.get("emp")) || (me.employee && me.employee.id);
  if (!empId) { el.append(empty(t("no_profile"))); return; }
  const month = /^\d{4}-\d{2}$/.test(query.get("m") || "") ? query.get("m") : todayIso().slice(0, 7);
  const [d, people] = await Promise.all([api.get(`/api/attendance/employee/${empId}?month=${month}`), api.get("/api/attendance/people")]);
  const own = d.own;
  const go = (m, e = empId) => { location.hash = `#/attendance?${e !== (me.employee && me.employee.id) ? `emp=${e}&` : ""}m=${m}`; };

  const monthSel = select("month", Array.from({ length: 12 }, (_, i) => [pad(i + 1), new Intl.DateTimeFormat(loc(), { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, i, 1)))]), month.slice(5), { "aria-label": t("month") });
  const y = Number(month.slice(0, 4)), years = []; for (let k = y - 2; k <= y + 1; k++) years.push(k);
  const yearSel = select("year", years.map((k) => [k, String(k)]), y, { "aria-label": t("year") });
  for (const s of [monthSel, yearSel]) s.addEventListener("change", () => go(`${yearSel.value}-${monthSel.value}`));
  const opts = [...(me.employee ? [[me.employee.id, `${nm(me.employee)} (${t("me_short")})`]] : []), ...people.items.filter((p) => !me.employee || p.id !== me.employee.id).map((p) => [p.id, `${nm(p)} · ${p.emp_no}`])];
  const who = opts.length > 1 ? select("emp", opts, empId, { "aria-label": t("employee") }) : null;
  if (who) who.addEventListener("change", () => go(month, Number(who.value)));

  const notes = [];
  if (!d.linked.length) notes.push(h("div", { class: "note" }, t("att_not_linked")));
  if (d.start && `${month}-01` < d.start) notes.push(h("div", { class: "note" }, t("att_info_before", { d: dmy(d.start) })));
  if (d.dataTo) notes.push(h("p", { class: "sub" }, t("att_data_to", { d: dmy(d.dataTo) }), " · ", t("att_shift_now"), ": ", h("b", null, t("shift_" + (d.employee.shift || 2)))));

  const rows = d.days.filter((x) => x.status !== "no_data" || x.date <= todayIso()).map((x) => {
    const reqLinks = x.requests.filter((r) => r.type !== "comp_day").map((r) => h("a", { class: "chip", href: `#/leave/${r.id}` }, t("lt_" + r.type), r.status === "pending" ? ` · ${t("rs_pending")}` : r.hr_class === null && ["correction", "early", "late", "break"].includes(r.type) ? ` · ${t("att_awaiting_hr")}` : ""));
    const canAsk = own && !x.info && x.date <= todayIso() && !x.correctionPending;
    const ask = canAsk && (x.status === "missing" || x.status === "absent")
      ? h("a", { class: "btn small", href: `#/attendance/correction?date=${x.date}` }, t("att_ask_correction")) : null;
    const status = x.status === "leave" ? t("lt_" + x.leave) : x.status === "missing" ? t(x.missing === "in" ? "as_missing_in" : "as_missing_out") : t("as_" + x.status);
    return h("tr", { class: ["rest", "holiday", "no_data"].includes(x.status) ? "muted-row" : null },
      h("td", null, h("b", null, dmy(x.date).slice(0, 5)), " ", h("span", { class: "muted" }, weekday(x.date)), x.holiday ? h("div", { class: "muted" }, x.holiday) : null),
      h("td", { class: "num" }, clockText(x.in)), h("td", { class: "num" }, clockText(x.out)), h("td", { class: "num" }, durText(x.onSite)),
      h("td", { class: "num" }, x.late ? h("span", { class: "bad-text" }, durText(x.late)) : "—"),
      h("td", { class: "num" }, x.early ? h("span", { class: "bad-text" }, durText(x.early)) : "—"),
      h("td", null, h("span", { class: `badge ${STATUS_CLASS[x.status] || ""}` }, status), x.info && ["absent", "missing"].includes(x.status) ? h("span", { class: "muted" }, " ", t("att_info_only")) : null),
      h("td", null, reqLinks, ask));
  });

  const reviewBox = h("section", { class: "card" }, h("h2", null, t("att_review_title")),
    d.review ? h("p", null, "✓ ", t("att_reviewed_at", { d: dateTime(d.review.at) }), d.review.note ? h("div", { class: "note", style: { marginTop: "8px" } }, d.review.note) : null) : h("p", { class: "sub" }, t("att_review_hint")),
    own ? h("div", { class: "row" },
      h("button", { class: "btn primary", type: "button", onclick: () => review(null) }, t("att_review_ok")),
      h("button", { class: "btn", type: "button", onclick: async () => { const n = await confirm(t("att_review_note_q"), { input: t("att_review_note"), required: true, okText: t("send") }); if (n) review(n); } }, t("att_review_problem"))) : null);
  async function review(note) {
    try { await api.post(`/api/attendance/employee/${empId}/review`, { month, note }); toast(t("saved")); rerender(); } catch (e) { toast(errText(e), "bad"); }
  }

  el.append(
    pageHead(own ? t("my_attendance") : t("att_of", { name: nm(d.employee) }),
      own ? h("a", { class: "btn", href: "#/attendance/correction" }, t("lt_correction")) : null,
      own ? h("a", { class: "btn primary", href: "#/attendance/mission" }, t("lt_mission")) : null,
      !own && (can.viewAll() || me.isApprover) ? h("a", { class: "btn", href: `#/staff/${empId}` }, t("open_profile")) : null),
    h("div", { class: "toolbar cal-nav" },
      h("button", { class: "btn", type: "button", "aria-label": t("prev_month"), onclick: () => go(shiftMonth(month, -1)) }, getLang() === "ar" ? "→" : "←"),
      monthSel, yearSel,
      h("button", { class: "btn", type: "button", "aria-label": t("next_month"), onclick: () => go(shiftMonth(month, 1)) }, getLang() === "ar" ? "←" : "→"),
      who),
    notes,
    summaryTiles(d.summary),
    h("section", { class: "card", style: { marginTop: "16px" } },
      h("div", { class: "card-head" }, h("h2", null, t("att_days")), h("span", { class: "sub" }, t("att_policy_note"))),
      rows.length ? h("div", { class: "table-wrap keep-table" }, h("table", { class: "att-table" },
        h("thead", null, h("tr", null, [t("date"), t("att_in"), t("att_out"), t("att_on_site"), t("att_late"), t("att_early"), t("status"), ""].map((x, i) => h("th", { class: i > 0 && i < 6 ? "num" : null }, x)))),
        h("tbody", null, rows))) : empty()),
    reviewBox);
}
