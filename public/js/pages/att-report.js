// Attendance report (policy §18): by department without names for management; HR and managers also see their people.
// HR's queue (permissions to classify, fingerprint corrections to confirm) sits underneath.
import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, clear, select, field, pageHead, empty, num, dmy, todayIso, toast, errText, durText, when, amountText } from "../ui.js";
import { monthlyData, monthlyPdf, downloadXlsx } from "../att-pdf.js";
import { pdfPreview } from "../pdf-preview.js";
import { currentSource, rememberSource, sourceTabs, sourceSelect, sourceNote } from "../att-source.js";

/** The monthly report window (HR and managers, §7): a month, the whole pack or one person, the punch source, then PDF (a
 * preview where the same choices can be changed) or Excel. */
export async function monthlyDialog(defaultMonth, source = currentSource()) {
  const { items } = await api.get("/api/attendance/people");
  const month = h("input", { type: "month", name: "month", value: defaultMonth, dir: "ltr", required: true });
  const whoOpts = [["", t("pdf_scope_all")], ...items.map((p) => [p.id, `${nm(p)} · ${p.emp_no}`])];
  const who = select("employee", whoOpts, "");
  const src = sourceSelect(source);
  const msg = h("p", { class: "sub", "aria-live": "polite" });
  const close = () => { dlg.close(); dlg.remove(); };
  const pdf = () => {
    if (!/^\d{4}-\d{2}$/.test(month.value)) { month.focus(); return; }
    // the preview has the same three choices; changing one redraws it
    const m2 = h("input", { type: "month", value: month.value, dir: "ltr" }), w2 = select("employee", whoOpts, who.value), s2 = sourceSelect(src.value);
    s2.addEventListener("change", () => rememberSource(s2.value));
    close();
    pdfPreview({ title: t("pdf_title"), options: [{ label: t("month"), control: m2 }, { label: t("pdf_scope"), control: w2 }, { label: t("src_label"), control: s2 }],
      make: async (onStep) => {
        const D = await monthlyData(m2.value, w2.value || null, s2.value);
        if (!D.people.length) throw new Error(t("att_no_data"));
        return monthlyPdf(D, onStep);
      } });
  };
  const xlsx = async (b) => {
    if (!/^\d{4}-\d{2}$/.test(month.value)) { month.focus(); return; }
    b.disabled = true;
    try { msg.textContent = t("loading"); const D = await monthlyData(month.value, who.value || null, src.value); if (!D.people.length) { msg.textContent = t("att_no_data"); return; } await downloadXlsx(D); msg.textContent = "✓"; }
    catch (e) { msg.textContent = ""; toast(errText(e), "bad"); } finally { b.disabled = false; }
  };
  src.addEventListener("change", () => rememberSource(src.value));
  const dlg = h("dialog", { class: "dialog" },
    h("h2", null, t("pdf_title")), h("p", { class: "sub" }, t("att_by_person_note")),
    h("div", { class: "fields" }, field(t("month"), month), field(t("pdf_scope"), who), field(t("src_label"), src)),
    msg, h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: close }, t("close")),
      h("button", { class: "btn primary", type: "button", onclick: pdf }, "📄 ", t("pdf_download_pdf")),
      h("button", { class: "btn", type: "button", onclick: (e) => xlsx(e.currentTarget) }, "⬇ ", t("pdf_download_xlsx"))));
  dlg.addEventListener("cancel", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

const pad = (n) => String(n).padStart(2, "0");
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function period(key) {
  const d = todayIso(), y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  if (key === "last_week") { const end = addDays(d, -new Date(d + "T00:00:00Z").getUTCDay() - 1); return [addDays(end, -6), end]; }
  if (key === "this_week") return [addDays(d, -new Date(d + "T00:00:00Z").getUTCDay()), d];
  if (key === "last_month") { const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1; return [`${ly}-${pad(lm)}-01`, `${ly}-${pad(lm)}-${lastDay(ly, lm)}`]; }
  return [`${y}-${pad(m)}-01`, d];
}
const pct = (x) => (x === null || x === undefined ? "—" : `${num(x)}%`);

export async function render(el, _p, { me, can, query }) {
  if (!["hr", "admin", "ceo", "chairman", "consultant", "accounts"].includes(me.user.role) && !me.isApprover && !me.hasTeam) throw { status: 403 };
  const depts = can.viewAll() ? (await api.get("/api/departments")).items : [];
  const [f0, t0] = query.get("from") ? [query.get("from"), query.get("to")] : period("last_week");
  const from = h("input", { type: "date", value: f0 }), to = h("input", { type: "date", value: t0 });
  const quick = select("period", [["last_week", t("last_week")], ["this_week", t("this_week")], ["this_month", t("this_month")], ["last_month", t("last_month")], ["custom", t("custom_period")]], query.get("from") ? "custom" : "last_week");
  const dept = depts.length ? select("department_id", [["", `${t("f_department")}: ${t("all")}`], ...depts.map((d) => [d.id, nm(d)])], "") : null;
  // which punches count: the fingerprint machine, the online check-ins, or both (kept apart while both are on trial)
  let source = currentSource(query);
  const srcTabs = h("div");
  const drawTabs = () => srcTabs.replaceChildren(sourceTabs(source, (k) => { source = k; drawTabs(); load(); }));
  drawTabs();
  const out = h("div"), queue = h("div");
  // HR / Admin: older check-ins whose source couldn't be told (they count nowhere until sorted out)
  const unclear = can.edit() ? await api.get("/api/attendance/punch-sources").catch(() => null) : null;
  const csv = h("a", { class: "btn", href: "#" }, "⬇ ", t("download_excel"));

  // short two-line headers and compact cells, so every column fits in the card without scrolling (phones: one card per person)
  const COLS = [["att_h_work", (s) => num(s.workDays)], ["att_h_compliance", (s) => pct(s.compliance)],
    ["att_h_late", (s) => pair(s.late, s.lateMin)], ["att_h_early", (s) => pair(s.early, s.earlyMin)],
    ["att_h_missing", (s) => num(s.missing)], ["att_h_absent", (s) => num(s.absent)], ["att_h_pending", (s) => num(s.pending)],
    ["att_h_leave", (s) => num(s.leave)], ["att_h_mission", (s) => num(s.mission)], ["att_h_outside", (s) => num(s.outside || 0)],
    ["att_h_after", (s) => (s.afterMin ? pair(s.afterDays, s.afterMin) : "—")], ["att_h_extra", (s) => (s.extraMin ? durText(s.extraMin) : "—")],
    ["att_h_flagged", (s) => (s.flagged ? h("span", { class: "pair bad-text" }, h("b", null, "⚠️ ", num(s.flagged)), s.unverified ? h("small", null, `${t("att_unverified")} ${num(s.unverified)}`) : null) : "0")], ["att_h_hours", (s) => (s.worked || s.onSite ? durText(s.worked ?? s.onSite) : "—")]];
  // "3" over "1:25": how many times, then how long
  function pair(n, min) { return n ? h("span", { class: "pair" }, h("b", null, num(n)), h("small", null, durText(min))) : "—"; }
  const thead = (first) => h("thead", null, h("tr", null, h("th", { class: "name-col" }, first), COLS.map(([k]) => h("th", { class: "num" }, t(k)))));
  const cells = (s) => COLS.map(([, f]) => h("td", { class: "num" }, f(s)));
  const grid = (first, rows) => h("div", { class: "table-wrap keep-table att-grid" }, h("table", null, thead(first), h("tbody", null, rows)));
  // phones: a card per row — the name, then the figures as small labelled boxes
  const cardOf = (title, sub, s) => h("div", { class: "card att-pcard" }, h("div", { class: "pc-head" }, title, sub ? h("div", { class: "muted" }, sub) : null),
    h("div", { class: "pc-grid" }, COLS.map(([k, f]) => h("div", null, h("span", null, t(k)), h("b", null, f(s))))));

  const personSub = (p) => `${p.employee.emp_no} · ${t("shift_" + (p.employee.shift || 2))}`;
  async function load() {
    const qs = new URLSearchParams({ from: from.value, to: to.value });
    if (dept && dept.value) qs.set("department_id", dept.value);
    qs.set("source", source);
    csv.href = `/api/attendance/report?${qs}&format=csv`;
    let r;
    try { r = await api.get(`/api/attendance/report?${qs}`); } catch (e) { clear(out).append(empty(errText(e))); return; }
    const T = r.total;
    clear(out).append(...[
      sourceNote(source),
      unclear && unclear.unclear.length ? h("details", { class: "note warn" }, h("summary", null, "⚠️ ", t("src_unclear", { n: num(unclear.unclear.length) })),
        h("ul", null, unclear.unclear.slice(0, 50).map((c) => h("li", null, `${c.emp_no} · ${nm(c)} · ${dmy(c.at.slice(0, 10))} ${c.at.slice(11, 16)} (${t(c.kind === "in" ? "att_in" : "att_out")})`)))) : null,
      h("p", { class: "sub" }, `${dmy(r.from)} – ${dmy(r.to)} · `, t("att_report_note"), r.dataTo && source !== "online" ? ` · ${t("att_data_to", { d: dmy(r.dataTo) })}` : ""),
      r.start && r.from < r.start ? h("div", { class: "note", style: { marginBottom: "12px" } }, t("att_info_before", { d: dmy(r.start) })) : null,
      h("div", { class: "grid tiles" },
        h("div", { class: `card tile ${T.compliance !== null && T.compliance < 80 ? "warn" : ""}` }, h("div", { class: "n" }, pct(T.compliance)), h("div", { class: "l" }, t("att_compliance"))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, num(T.late || 0)), h("div", { class: "l" }, t("att_late"), " · ", durText(T.lateMin || 0))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, T.afterMin ? durText(T.afterMin) : "—"), h("div", { class: "l" }, t("att_after"), " · ", t("att_n_days", { n: num(T.afterDays || 0) }))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, num(T.absent || 0)), h("div", { class: "l" }, t("att_absent"))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, num(T.missing || 0)), h("div", { class: "l" }, t("att_missing"))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, num(r.openRequests)), h("div", { class: "l" }, t("att_open_requests"))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, r.correctionHours === null ? "—" : t("hours", { n: num(r.correctionHours) })), h("div", { class: "l" }, t("att_corr_time")))),
      h("section", { class: "card", style: { marginTop: "16px" } }, h("h2", null, t("att_by_department")),
        r.departments.length ? [grid(t("f_department"), r.departments.map((d) => h("tr", null, h("td", { class: "name-col" }, h("b", null, nm(d) || t("no_department")), h("div", { class: "muted" }, t("att_n_staff", { n: num(d.staff) }))), cells(d)))),
          h("div", { class: "att-cards" }, r.departments.map((d) => cardOf(h("b", null, nm(d) || t("no_department")), t("att_n_staff", { n: num(d.staff) }), d)))] : empty(t("att_no_data"))),
      r.people.length ? h("section", { class: "card", style: { marginTop: "16px" } }, h("h2", null, t("att_by_person")), h("p", { class: "sub" }, t("att_by_person_note")),
        grid(t("employee"), r.people.map((p) => h("tr", null, h("td", { class: "name-col" }, personLink(p), h("div", { class: "muted" }, personSub(p))), cells(p)))),
        h("div", { class: "att-cards" }, r.people.map((p) => cardOf(personLink(p), personSub(p), p)))) : null].filter(Boolean));
    function personLink(p) { return h("a", { href: `#/attendance?emp=${p.employee.id}&m=${r.to.slice(0, 7)}&source=${source}` }, nm(p.employee)); }
  }

  async function loadQueue() {
    if (!can.edit()) return;
    const { items } = await api.get("/api/attendance/hr-queue");
    clear(queue).append(h("section", { class: "card", style: { marginTop: "16px" } },
      h("h2", null, t("att_hr_queue"), items.length ? h("span", { class: "pill" }, items.length) : null), h("p", { class: "sub" }, t("att_hr_queue_hint")),
      items.length ? h("div", { class: "list" }, items.map((r) => h("a", { class: "item", href: `#/leave/${r.id}` },
        h("span", { class: "badge b-pending" }, t("lt_" + r.type)),
        h("div", { class: "grow" }, h("div", { class: "title" }, nm(r)), h("div", { class: "meta" }, when(r), r.type !== "correction" ? ` · ${amountText(r)}` : ""))))) : empty(t("att_queue_empty"))));
  }

  quick.addEventListener("change", () => { if (quick.value !== "custom") { [from.value, to.value] = period(quick.value); load(); } });
  for (const i of [from, to]) i.addEventListener("change", () => { quick.value = "custom"; if (from.value && to.value && from.value <= to.value) load(); else toast(t("err_end_before_start"), "bad"); });
  if (dept) dept.addEventListener("change", load);

  // HR / Admin and managers with people of their own (§7): the monthly PDF / Excel
  const canMonthly = ["hr", "admin"].includes(me.user.role) || me.isApprover || me.hasTeam;
  const lastMonth = (() => { const d = todayIso(); return d.slice(8) <= "05" ? period("last_month")[0].slice(0, 7) : d.slice(0, 7); })();
  el.append(pageHead(t("nav_att_report"),
    canMonthly ? h("button", { class: "btn primary", type: "button", onclick: () => monthlyDialog(lastMonth, source).catch((e) => toast(errText(e), "bad")) }, "📄 ", t("pdf_btn")) : null, h("a", { class: "btn", href: "#/attendance/online" }, "📍 ", t("nav_att_online")), ["hr", "admin", "accounts", "ceo", "chairman"].includes(me.user.role) ? h("a", { class: "btn", href: "#/attendance/allowances" }, "💰 ", t("nav_allowances")) : null, ["hr", "admin", "accounts", "ceo", "chairman"].includes(me.user.role) ? h("a", { class: "btn", href: "#/attendance/overtime" }, "⏱ ", t("nav_overtime")) : null, can.edit() ? h("a", { class: "btn", href: "#/attendance/upload" }, "⬆ ", t("nav_att_upload")) : null, csv),
    srcTabs,
    h("section", { class: "card" }, h("div", { class: "fields" }, field(t("period"), quick), field(t("holiday_from"), from), field(t("holiday_to"), to), dept ? field(t("f_department"), dept) : null)),
    out, queue);
  await Promise.all([load(), loadQueue()]);
}
