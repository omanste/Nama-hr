// Monthly attendance sheet (policy §15): each day against the person's shift, the month's totals, and the person's review.
// Staff see their own; a manager their team; HR everyone (the picker lists who this login may open).
import { api } from "../api.js";
import { t, nm, getLang, tx } from "../i18n.js";
import { h, select, pageHead, empty, num, dmy, todayIso, toast, errText, confirm, clockText, durText, dateTime, viewFile } from "../ui.js";
import { render as rerender } from "../app.js";
import { checkinPlace, flagLabel } from "../checkin.js";
import { monthlyData, monthlyPdf } from "../att-pdf.js";
import { pdfPreview } from "../pdf-preview.js";
import { currentSource, sourceTabs, sourceSelect, sourceNote, rememberSource } from "../att-source.js";
import { dayRows } from "../day-rows.js";

const pad = (n) => String(n).padStart(2, "0");
const loc = () => (getLang() === "ar" ? "ar-OM-u-nu-latn" : "en-GB");
const shiftMonth = (m, n) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
const weekday = (iso) => new Intl.DateTimeFormat(loc(), { weekday: "short", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));
const STATUS_CLASS = { present: "b-approved", missing: "b-pending", absent: "b-rejected", pending: "b-pending", leave: "b-on_leave", mission: "b-on_leave", holiday: "b-on_leave", rest: "", rest_worked: "", holiday_worked: "", no_data: "", today: "", on_duty: "b-approved" };

/** "Shift 2 · 09:00–18:00" */
export const shiftText = (sh) => (sh.flex ? `${t("pdf_flex_short")} · ${clockText(sh.from)}–${clockText(sh.to)} · ${t("hours", { n: num(sh.hours) })}` : `${t("shift_" + sh.no)} · ${clockText(sh.start)}–${clockText(sh.end)}`) + (sh.ramadan ? ` (${t("ramadan")})` : "");

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
    tile(s.afterMin ? durText(s.afterMin) : "—", `${t("att_after")} · ${t("att_n_days", { n: num(s.afterDays || 0) })}`),
    s.extraMin ? tile(durText(s.extraMin), t("att_extra")) : null,
    tile(num(s.flagged || 0), `⚠️ ${t("att_flagged")}${s.unverified ? ` · ${t("att_unverified")} ${num(s.unverified)}` : ""}`, s.flagged ? "warn" : ""),
    tile(s.worked || s.onSite ? durText(s.worked ?? s.onSite) : "—", t("att_total_hours")),
    tile(s.onSiteDays ? durText(Math.round(s.onSite / s.onSiteDays)) : "—", t("att_avg_on_site")));
}

/** One online check-in on the sheet: time, site (or outside, with the reason), the photo and the place on a map. */
// one online check-in in the day's full list: ⏱/🏁 time, then the place, the manager's decision, 📷 and 🗺
const checkinChip = (c) => h("div", { class: `ci-chip ${c.outside ? "outside" : ""}` }, h("b", null, c.kind === "in" ? "⏱ " : "🏁 ", c.time), " ", checkinPlace(c));

export async function render(el, _p, { me, query, can }) {
  const empId = Number(query.get("emp")) || (me.employee && me.employee.id);
  if (!empId) { el.append(empty(t("no_profile"))); return; }
  const month = /^\d{4}-\d{2}$/.test(query.get("m") || "") ? query.get("m") : todayIso().slice(0, 7);
  const source = currentSource(query);
  const [d, people] = await Promise.all([api.get(`/api/attendance/employee/${empId}?month=${month}&source=${source}`), api.get("/api/attendance/people")]);
  const own = d.own;
  const go = (m, e = empId, src = source) => { location.hash = `#/attendance?${e !== (me.employee && me.employee.id) ? `emp=${e}&` : ""}m=${m}&source=${src}`; };
  const srcTabs = sourceTabs(source, (k) => go(month, empId, k));

  const monthSel = select("month", Array.from({ length: 12 }, (_, i) => [pad(i + 1), new Intl.DateTimeFormat(loc(), { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, i, 1)))]), month.slice(5), { "aria-label": t("month") });
  const y = Number(month.slice(0, 4)), years = []; for (let k = y - 2; k <= y + 1; k++) years.push(k);
  const yearSel = select("year", years.map((k) => [k, String(k)]), y, { "aria-label": t("year") });
  for (const s of [monthSel, yearSel]) s.addEventListener("change", () => go(`${yearSel.value}-${monthSel.value}`));
  const opts = [...(me.employee ? [[me.employee.id, `${nm(me.employee)} (${t("me_short")})`]] : []), ...people.items.filter((p) => !me.employee || p.id !== me.employee.id).map((p) => [p.id, `${nm(p)} · ${p.emp_no}`])];
  const who = opts.length > 1 ? select("emp", opts, empId, { "aria-label": t("employee") }) : null;
  if (who) who.addEventListener("change", () => go(month, Number(who.value)));

  const notes = [];
  const online = d.days.some((x) => x.checkins && x.checkins.length);
  if (!d.linked.length && !online && d.employee.att_mode === "machine") notes.push(h("div", { class: "note" }, t("att_not_linked")));
  if (d.start && `${month}-01` < d.start) notes.push(h("div", { class: "note" }, t("att_info_before", { d: dmy(d.start) })));
  // a check switched off for this person (photo, Face ID, location): said, so a missing 📷 / 🔐 / 📍 isn't a surprise
  if (d.checksOff && d.checksOff.length) notes.push(h("p", { class: "sub" }, t("ver_off_note", { list: d.checksOff.map((k) => t("ver_" + k)).join(getLang() === "ar" ? "، " : ", ") })));
  if (d.dataTo) notes.push(h("p", { class: "sub" }, t("att_data_to", { d: dmy(d.dataTo) }), " · ", t("att_shift_now"), ": ", h("b", null, t("shift_" + (d.employee.shift || 2)))));

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
      // the PDF in the preview: the month and the source can be changed there
      h("button", { class: "btn primary", type: "button", onclick: () => {
        const m2 = h("input", { type: "month", value: month, dir: "ltr" }), s2 = sourceSelect(source);
        s2.addEventListener("change", () => rememberSource(s2.value));
        pdfPreview({ title: t(own ? "pdf_my" : "pdf_person"), options: [{ label: t("month"), control: m2 }, { label: t("src_label"), control: s2 }],
          make: async (onStep) => monthlyPdf(await monthlyData(m2.value, empId, s2.value), onStep) });
      } }, "📄 ", t(own ? "pdf_my" : "pdf_person")),
      own ? h("a", { class: "btn", href: "#/attendance/correction" }, t("lt_correction")) : null,
      // the external work task is asked for from Permissions and the home page, not here
      !own && (can.viewAll() || me.isApprover) ? h("a", { class: "btn", href: `#/staff/${empId}` }, t("open_profile")) : null),
    h("div", { class: "toolbar cal-nav" },
      h("button", { class: "btn", type: "button", "aria-label": t("prev_month"), onclick: () => go(shiftMonth(month, -1)) }, getLang() === "ar" ? "→" : "←"),
      monthSel, yearSel,
      h("button", { class: "btn", type: "button", "aria-label": t("next_month"), onclick: () => go(shiftMonth(month, 1)) }, getLang() === "ar" ? "←" : "→"),
      who),
    srcTabs,
    sourceNote(source),
    notes,
    summaryTiles(d.summary),
    h("section", { class: "card", style: { marginTop: "16px" } },
      h("div", { class: "card-head" }, h("h2", null, t("att_days")), h("span", { class: "sub" }, d.flex && d.days.some((x) => x.shift && x.shift.flex) ? t("att_policy_flex", { a: clockText(d.flex.from), b: clockText(d.flex.to), n: num(d.flex.hours) }) : t("att_policy_note", { n: d.grace ?? 15 }))),
      d.days.length ? dayRows(d.days, { source, own, today: todayIso() }) : empty()),
    reviewBox);
}
