// Online check-in log: who checked in and out from the portal, when and where — one line per person per day (the first
// check-in and the last check-out), with the place, the manager's decision for outside the work sites, the photo and the map.
import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, clear, select, field, pageHead, empty, num, dmy, todayIso, errText, durText, toast } from "../ui.js";
import { checkinPlace, flagLabel } from "../checkin.js";
import { letterPage, logoData, makePdf } from "../att-pdf.js";
import { saveXlsx } from "../xlsx-out.js";
import { pdfPreview } from "../pdf-preview.js";
import { icons } from "../day-rows.js";

/** The export's columns, Status last: [label, value(row)]. Names in the screen's language. */
const nameOf = (e) => (document.documentElement.lang === "en" ? e.name_en || e.name_ar : e.name_ar || e.name_en) || "";
const locText = (c) => (!c ? "" : c.outside ? `${t("ol_outside")}${c.distance ? ` · ${num(c.distance)} m` : (c.flags || []).some((f) => f.code === "outside" && f.km) ? ` · ${(c.flags.find((f) => f.code === "outside")).km} km` : ""}`
  : `${t("ol_inside")}${c.site && (c.site.name_en || c.site.name_ar) ? ` · ${document.documentElement.lang === "en" ? c.site.name_en || c.site.name_ar : c.site.name_ar || c.site.name_en}` : ""}`);
const methodText = (c) => { if (!c) return ""; const k = c.checks || {}; return [k.faceid || c.verified ? t("ol_m_faceid") : "", k.photo || c.photo_file_id ? t("ol_m_photo") : ""].filter(Boolean).join(" + ") || "—"; };
const flagText = (c) => (c && c.flags && c.flags.length ? c.flags.map(flagLabel).join(", ") : "");
const decisionText = (c) => (!c ? "" : c.flags && c.flags.length && c.flag_status ? t("ci_flag_" + c.flag_status) : c.approval ? t("ci_appr_" + c.approval) : "");
const statusText = (x) => { const cs = [x.in, x.out].filter(Boolean);
  if (cs.some((c) => c.approval === "rejected" || c.flag_status === "rejected")) return t("ol_st_rejected");
  if (cs.some((c) => c.approval === "pending" || c.flag_status === "open")) return t("ol_st_waiting");
  return x.in && x.out ? t("ol_st_ok") : t("ol_st_incomplete"); };
const both = (x, f) => [x.in && f(x.in), x.out && f(x.out)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" / ");
export const LOG_COLS = [["emp_no_short", (x) => x.employee.emp_no], ["employee", (x) => nameOf(x.employee)], ["date", (x) => dmy(x.date)],
  ["ol_c_in", (x) => (x.in ? x.in.time : "—")], ["ol_c_out", (x) => (x.out ? x.out.time : "—")], ["ol_c_loc", (x) => both(x, locText) || "—"],
  ["ol_c_method", (x) => both(x, methodText) || "—"], ["ol_c_flag", (x) => both(x, flagText) || "—"], ["ol_c_decision", (x) => both(x, decisionText) || "—"], ["status", statusText]];

const weekday = (iso) => new Intl.DateTimeFormat(document.documentElement.lang === "en" ? "en-GB" : "ar-OM", { weekday: "short", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));

export async function render(el, _p, { me, can, query }) {
  if (!["hr", "admin", "ceo", "chairman", "consultant", "accounts"].includes(me.user.role) && !me.isApprover && !me.hasTeam) throw { status: 403 };
  const today = todayIso();
  const [depts, people] = await Promise.all([can.viewAll() ? api.get("/api/departments").then((r) => r.items) : [], api.get("/api/attendance/people").then((r) => r.items).catch(() => [])]);
  const from = h("input", { type: "date", value: query.get("from") || today.slice(0, 8) + "01" }), to = h("input", { type: "date", value: query.get("to") || today });
  const dept = depts.length ? select("dept", [["", t("all")], ...depts.map((d) => [d.id, nm(d)])], query.get("dept") || "") : null;
  const emp = select("emp", [["", t("all")], ...people.map((p) => [p.id, `${nm(p)} · ${p.emp_no}`])], query.get("emp") || "");
  const flag = select("flag", [["", t("ol_flag_all")], ["flagged", t("ol_flag_flagged")], ["unverified", t("ol_flag_unverified")]], query.get("flag") || "");
  const out = h("div");
  const qsOf = (f = from.value, tt = to.value, fl = flag.value) => { const q = new URLSearchParams({ from: f, to: tt }); if (dept && dept.value) q.set("dept", dept.value); if (emp.value) q.set("emp", emp.value); if (fl) q.set("flag", fl); return q; };
  const fileBase = (f, tt) => `nama-online-checkin-log-${f}-${tt}`;
  const xlsBtn = h("button", { class: "btn", type: "button", onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { const r = await api.get(`/api/attendance/checkins?${qsOf()}`);
      await saveXlsx([{ name: t("nav_att_online"), center: [0, 2, 3, 4, 9], rows: [LOG_COLS.map(([k]) => t(k)), ...r.rows.map((x) => LOG_COLS.map(([, f]) => f(x)))] }], `${fileBase(r.from, r.to)}.xlsx`); }
    catch (x) { toast(errText(x), "bad"); } finally { b.disabled = false; }
  } }, "⬇ ", t("ol_export_xlsx"));
  const pdfBtn = h("button", { class: "btn primary", type: "button", onclick: () => {
    const pf = h("input", { type: "date", value: from.value }), pt = h("input", { type: "date", value: to.value });
    const pfl = select("flag", [...flag.options].map((o) => [o.value, o.textContent]), flag.value);
    pdfPreview({ title: t("nav_att_online"), options: [{ label: t("holiday_from"), control: pf }, { label: t("holiday_to"), control: pt }, { label: t("ol_flag_filter"), control: pfl }],
      make: async (onStep) => logPdf(await api.get(`/api/attendance/checkins?${qsOf(pf.value, pt.value, pfl.value)}`), onStep) });
  } }, "📄 ", t("ol_export_pdf"));

  const cell = (c) => (c ? h("td", { class: "punch" }, h("b", null, c.time), h("div", { class: "punch-src" }, checkinPlace(c))) : h("td", { "data-label": "" }));
  async function load() {
    const qs = new URLSearchParams({ from: from.value, to: to.value });
    if (dept && dept.value) qs.set("dept", dept.value);
    if (emp.value) qs.set("emp", emp.value);
    if (flag.value) qs.set("flag", flag.value);
    let r;
    try { r = await api.get(`/api/attendance/checkins?${qs}`); } catch (e) { clear(out).append(empty(errText(e))); return; }
    const outside = r.rows.filter((x) => (x.in && x.in.outside) || (x.out && x.out.outside)).length;
    const waiting = r.rows.filter((x) => [x.in, x.out].some((c) => c && (c.approval === "pending" || c.flag_status === "open"))).length;
    clear(out).append(
      h("div", { class: "grid tiles" },
        h("div", { class: "card tile" }, h("div", { class: "n" }, num(r.rows.length)), h("div", { class: "l" }, t("ol_days"))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, num(new Set(r.rows.map((x) => x.employee.id)).size)), h("div", { class: "l" }, t("ol_people"))),
        h("div", { class: `card tile ${outside ? "warn" : ""}` }, h("div", { class: "n" }, num(outside)), h("div", { class: "l" }, t("ci_outside"))),
        h("div", { class: `card tile ${waiting ? "warn" : ""}` }, h("div", { class: "n" }, num(waiting)), h("div", { class: "l" }, t("ci_appr_pending")))),
      h("section", { class: "card", style: { marginTop: "16px" } },
        h("p", { class: "sub" }, `${dmy(r.from)} – ${dmy(r.to)} · `, t("ol_note")),
        r.rows.length ? logRows(r.rows) : empty(t("ol_none"))));
  }
  for (const c of [from, to, dept, emp, flag].filter(Boolean)) c.addEventListener("change", load);
  el.append(pageHead(t("nav_att_online"), h("a", { class: "btn", href: "#/attendance/report" }, t("nav_att_report")), xlsBtn, pdfBtn),
    h("section", { class: "card" }, h("div", { class: "fields" }, field(t("holiday_from"), from), field(t("holiday_to"), to), dept ? field(t("f_department"), dept) : null, field(t("employee"), emp), field(t("ol_flag_filter"), flag))),
    out);
  await load();
}

/** The PDF: letterhead, From – To, the log (same columns as the Excel, Status last), page numbers. */
async function logPdf(r, onStep) {
  const logo = await logoData();
  const head = { title: t("ol_pdf_title"), period: `${dmy(r.from)} – ${dmy(r.to)}`, range: "", generated: r.generated_at || new Date().toISOString(), by: nm(r.by), note: t("pdf_confidential") };
  const c = document.createElement("canvas").getContext("2d"); c.font = "600 10px 'Plex PDF', sans-serif";
  const nameW = Math.min(260, Math.max(90, ...r.rows.map((x) => c.measureText(nameOf(x.employee)).width + 14)));
  const css = () => h("style", null, `.ol td,.ol th{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:middle;height:22px;font-size:9.5px}.ol th{white-space:normal;line-height:1.2}.ol td.s,.ol th.s{text-align:start;padding-inline:5px}.ol td.n{font-weight:600;overflow:visible}`);
  const widths = [62, nameW, 66, 50, 54, null, 70, null, 112, 70];
  const PER = 22, pages = [];
  for (let i = 0; i < Math.max(1, r.rows.length); i += PER) {
    const part = r.rows.slice(i, i + PER);
    pages.push(letterPage(head, logo, [css(),
      h("h2", null, t("ol_days"), h("small", null, `${num(r.rows.length)}${r.rows.length > PER ? ` · ${num(i + 1)}–${num(Math.min(i + PER, r.rows.length))}` : ""}`)),
      h("table", { class: "ol" }, h("colgroup", null, widths.map((w) => h("col", w ? { style: `width:${w}px` } : null))),
        h("thead", null, h("tr", null, LOG_COLS.map(([k], j) => h("th", { class: [1, 5, 7].includes(j) ? "s" : null }, t(k))))),
        h("tbody", null, part.map((x) => h("tr", null, LOG_COLS.map(([, f], j) => h("td", { class: j === 1 ? "s n" : [5, 7].includes(j) ? "s" : null }, f(x)))))))]));
  }
  return makePdf(pages, `nama-online-checkin-log-${r.from}-${r.to}.pdf`, onStep);
}

/** One line per person per day: Date | No. | Name (one line, never cut) | Department | In | Out | Hours | Location | Checks.
 * Each time has small icons (📷 photo, 🗺️ map, ⚠️ flag, ⏳ waiting); phones get a compact card per row. */
function logRows(rows) {
  const L = document.documentElement.lang === "en" ? "en" : "ar";
  const dept = (e) => (L === "en" ? e.dept_en || e.dept_ar : e.dept_ar || e.dept_en) || "—";
  // the time, then 🔐 (Face ID), 📷 photo, 🗺️ map, ⚠️ flag (tooltip with the reason), ⏳ waiting for the manager
  const fid = (c) => (c.checks && c.checks.faceid) || c.verified ? h("span", { class: "ico", title: t("ol_m_faceid"), "aria-label": t("ol_m_faceid") }, "🔐") : null;
  const time = (c) => (c ? [h("b", { class: "tm" }, c.time), fid(c), ...icons({ ...c, site_ar: null, site_en: null, outside: false }, null, false).filter((i) => !/📍/.test(i.textContent))] : "—");
  // short in the table: the site's name inside; "Outside · 11.1 km" outside (the full text is in the tooltip and the files)
  const km = (c) => { const m = c.distance ?? (((c.flags || []).find((f) => f.code === "outside") || {}).km ?? null) * (c.distance ? 1 : 1000); return m ? (m >= 1000 ? `${num(Math.round(m / 100) / 10)} ${L === "en" ? "km" : "كم"}` : `${num(m)} ${L === "en" ? "m" : "م"}`) : ""; };
  const short = (c) => (!c ? "" : c.outside ? [t("ol_outside_short"), km(c)].filter(Boolean).join(" · ") : (c.site && (L === "en" ? c.site.name_en || c.site.name_ar : c.site.name_ar || c.site.name_en)) || t("ol_inside"));
  const where = (x) => both(x, short) || "—";
  const whereFull = (x) => both(x, locText) || "—";
  const more = (x) => (x.count > 2 ? ` · ${t("ol_count", { n: num(x.count) })}` : "");
  const hours = (x) => (x.minutes !== null ? durText(x.minutes) : "—");
  const table = h("div", { class: "table-wrap ol-wrap" }, h("table", { class: "ol-one" },
    h("colgroup", null, h("col", { style: "width:104px" }), h("col", { style: "width:82px" }), h("col", { class: "ol-name" }), h("col", { style: "width:110px" }),
      h("col", { style: "width:100px" }), h("col", { style: "width:100px" }), h("col", { style: "width:68px" }), h("col")),
    h("thead", null, h("tr", null, [t("date"), t("emp_no_short"), t("employee"), t("f_department"), t("att_in"), t("att_out"), t("pdf_hours"), t("ol_c_loc")]
      .map((k, i) => h("th", { class: [0, 1, 4, 5, 6].includes(i) ? "c" : null }, k)))),
    h("tbody", null, rows.map((x) => h("tr", null,
      h("td", { class: "c" }, h("b", null, dmy(x.date).slice(0, 5)), " ", h("span", { class: "muted" }, weekday(x.date))),
      h("td", { class: "c mono" }, x.employee.emp_no),
      h("td", { class: "nm" }, h("a", { href: `#/attendance?emp=${x.employee.id}&m=${x.date.slice(0, 7)}&source=online` }, nameOf(x.employee))),
      h("td", { class: "cut", title: dept(x.employee) }, dept(x.employee)),
      h("td", { class: "c tmc" }, time(x.in)), h("td", { class: "c tmc" }, time(x.out), x.count > 2 ? h("small", { class: "ol-n", title: t("ol_count", { n: num(x.count) }) }, `×${num(x.count)}`) : null), h("td", { class: "c" }, hours(x)),
      h("td", { class: `cut${(x.in && x.in.outside) || (x.out && x.out.outside) ? " bad-text" : ""}`, title: whereFull(x) + more(x) }, where(x)))))));
  const cards = h("div", { class: "ol-cards" }, rows.map((x) => h("div", { class: "dd-card" },
    // the name on its own line (the whole width; a slightly smaller font if long — never cut), the date under it
    h("div", { class: "ol-cname" }, nameOf(x.employee)), h("div", { class: "muted" }, `${dmy(x.date).slice(0, 5)} ${weekday(x.date)}`),
    h("div", { class: "dd-times" }, h("span", null, h("small", null, t("att_in")), " ", time(x.in)), h("span", null, h("small", null, t("att_out")), " ", time(x.out)), h("span", null, h("small", null, t("pdf_hours")), " ", hours(x))),
    h("div", { class: "sub" }, `${x.employee.emp_no} · ${dept(x.employee)} · ${where(x)}${more(x)}`))));
  const box = h("div", null, table, cards);
  // the name column as wide as the longest name as drawn, never cut (a little smaller font if the screen is tight)
  const fit = () => {
    const tb = box.querySelector(".ol-one"); if (!tb || !tb.offsetParent) return;
    const cells = [...tb.querySelectorAll("td.nm")]; if (!cells.length) return;
    const room = tb.parentElement.clientWidth - (104 + 82 + 110 + 100 + 100 + 68) - 130; // and 130 px at least for the location
    let px = 14, need = 0;
    for (;;) { tb.style.setProperty("--ol-name", `${px}px`); need = Math.ceil(Math.max(...cells.map((td) => td.firstChild.scrollWidth)) + 30); if (need <= room || px <= 11) break; px -= 0.5; }
    tb.querySelector("col.ol-name").style.width = `${Math.max(120, need)}px`;
  };
  const shrink = () => box.querySelectorAll(".ol-cname").forEach((n) => { if (!n.offsetParent) return; n.style.fontSize = ""; let px = parseFloat(getComputedStyle(n).fontSize); while (n.scrollWidth > n.clientWidth + 1 && px > 10) { px -= 0.5; n.style.fontSize = `${px}px`; } });
  requestAnimationFrame(() => { fit(); shrink(); }); if (document.fonts) document.fonts.ready.then(() => requestAnimationFrame(() => { fit(); shrink(); }));
  return box;
}
