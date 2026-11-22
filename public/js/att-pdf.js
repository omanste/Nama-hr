// Monthly attendance report as a PDF (A4 landscape) and as Excel — for HR and managers (the whole pack: summary, a row per
// person, then a page per person), or one person's page (a staff member's own report). The data comes from
// /api/attendance/monthly, which only returns what this login may see (§7).
// The PDF is drawn by the browser's own text engine — each page through an SVG foreignObject onto a canvas, then
// html2pdf's jsPDF puts the pages together — so Arabic letters join and right-to-left order is exact. Self-hosted.
import { api } from "./api.js";
import { t, nm, getLang, tx } from "./i18n.js";
import { h, num, dmy, clockText, durText } from "./ui.js";
import { flagLabel } from "./checkin.js";

const W = 1123, H = 794; // A4 landscape at 96 dpi
const SCALE = 2; // whole pixels both ways: a page image a fraction taller than the page spills onto a blank page
const loc = () => (getLang() === "ar" ? "ar-OM-u-nu-latn" : "en-GB");
const monthName = (m) => new Intl.DateTimeFormat(loc(), { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
const weekday = (iso) => new Intl.DateTimeFormat(loc(), { weekday: "short", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));
const pct = (x) => (x === null || x === undefined ? "—" : `${num(x)}%`);
const hours = (m) => (m ? durText(m) : "—");
const pair = (n, m) => (n ? `${num(n)} · ${durText(m)}` : "—");
const nameOf = (e) => (getLang() === "en" ? e.name_en || e.name_ar : e.name_ar || e.name_en) || "";
const dept = (e) => (getLang() === "en" ? e.dept_en || e.dept_ar : e.dept_ar || e.dept_en) || "";

function loadScript(src, ready) {
  return new Promise((resolve, reject) => {
    if (ready()) return resolve();
    const s = document.createElement("script"); s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error(`${src} didn't load`)); document.head.append(s);
  });
}
const toData = (u) => fetch(u).then((r) => r.blob()).then((b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }));

/** The month's data for the report: the whole pack (people this login may see), or one person. */
export const monthlyData = (month, employeeId = null) => api.get(`/api/attendance/monthly?${new URLSearchParams({ month, ...(employeeId ? { employee_id: employeeId } : {}) })}`);

/** What a day's status says (present / leave type / absent / external task / …). */
export function statusText(d) {
  if (d.status === "leave") return d.leave ? t("lt_" + d.leave) : t("as_leave");
  if (d.status === "missing") return t(d.missing === "in" ? "as_missing_in" : "as_missing_out");
  return t("as_" + d.status);
}
const STATUS_COLOR = { present: "#1f7a4d", on_duty: "#1f7a4d", absent: "#b3261e", missing: "#a3670b", pending: "#a3670b", leave: "#2f5f8f", mission: "#2f5f8f", holiday: "#2f5f8f" };

/** The figures of a summary, in the order of the report (label, value). */
export function figures(s) {
  return [
    ["att_work_days", num(s.workDays)], ["att_compliance", pct(s.compliance)], ["att_late", pair(s.late, s.lateMin)], ["att_early", pair(s.early, s.earlyMin)],
    ["att_missing", num(s.missing)], ["att_absent", num(s.absent)], ["att_pending_abs", num(s.pending)], ["att_leave_days", num(s.leave)],
    ["att_mission_days", num(s.mission)], ["ci_outside", num(s.outside || 0)], ["att_after", s.afterMin ? pair(s.afterDays, s.afterMin) : "—"],
    ["att_extra", hours(s.extraMin)], ["att_flagged", s.unverified ? `${num(s.flagged || 0)} · ${t("att_unverified")} ${num(s.unverified)}` : num(s.flagged || 0)], ["att_total_hours", hours(s.worked ?? s.onSite)],
  ];
}
const COLS = ["att_h_work", "att_h_compliance", "att_h_late", "att_h_early", "att_h_missing", "att_h_absent", "att_h_pending", "att_h_leave", "att_h_mission", "att_h_outside", "att_h_after", "att_h_extra", "att_h_flagged", "att_h_hours"];
const rowCells = (s) => figures(s).map(([, v]) => v);
/** Under a name in the staff table: the checks switched off for that person (📷 🔐 📍 crossed). */
const offMark = (p) => (p.checksOff && p.checksOff.length ? ` · ${t("pdf_off_short")} ${p.checksOff.map((k) => ({ photo: "📷", faceid: "🔐", location: "📍" })[k]).join("")}` : "");

const CSS = `
*{box-sizing:border-box}
.page{width:${W}px;height:${H}px;background:#fff;color:#1b2a28;font-family:'Plex PDF',sans-serif;font-size:11px;line-height:1.35;position:relative;overflow:hidden;padding:0 30px}
.lh{display:flex;align-items:center;gap:16px;background:#154540;color:#fff;margin:0 -30px;padding:12px 30px;height:70px}
.lh img{height:44px}
.lh .t{flex:1}
.lh .t b{display:block;font-size:17px;font-weight:600}
.lh .t span{font-size:11px;color:#e9dcb8}
.lh .m{text-align:end;font-size:11px;color:#e9dcb8}
.lh .m b{display:block;color:#fff;font-size:15px;font-weight:600}
.gold{height:3px;background:#a8843a;margin:0 -30px}
h2{font-size:15px;font-weight:600;margin:14px 0 8px;color:#154540}
h2 small{font-weight:400;color:#5b6b68;font-size:11px;margin-inline-start:8px}
.rules{font-size:10.5px;color:#5b6b68;margin:0 0 10px}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.tile{border:1px solid #dfe5e3;border-radius:8px;padding:9px 11px;background:#f7f9f8}
.tile b{display:block;font-size:17px;font-weight:600;color:#154540;font-variant-numeric:tabular-nums}
.tile span{font-size:10.5px;color:#5b6b68}
.tile.big{background:#154540;border-color:#154540}.tile.big b{color:#fff;font-size:22px}.tile.big span{color:#e9dcb8}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th{background:#154540;color:#fff;font-weight:600;font-size:9.5px;line-height:1.2;padding:5px 3px;white-space:pre-line;text-align:center;vertical-align:bottom}
td{border-bottom:1px solid #e3e8e6;padding:3px 3px;text-align:center;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden}
tbody tr:nth-child(even) td{background:#f5f8f7}
td.nm{text-align:start;font-weight:600;padding-inline:6px}
td.nm small{display:block;font-weight:400;color:#6b7a77;font-size:9px}
tr.tot td{background:#efe6cf!important;font-weight:600;border-top:2px solid #a8843a}
.days td{padding:1px 3px;font-size:10px;line-height:1.3}
.days th{padding:3px 3px}
.days td.st{font-weight:600;text-align:start;padding-inline:6px}
.days tr.q td{color:#8a9794}
.days td.st{white-space:normal;line-height:1.2}
.days td.st .flag{color:#a3670b;font-weight:600;font-size:9px;display:block}
.who{display:flex;gap:18px;align-items:baseline;margin:9px 0 5px}
.who b{font-size:16px;font-weight:600;color:#154540}
.who span{color:#5b6b68}
.mini{display:grid;grid-template-columns:repeat(14,1fr);gap:4px;margin-top:8px}
.mini div{border:1px solid #dfe5e3;border-radius:6px;padding:4px 5px;background:#f7f9f8}
.mini b{display:block;font-size:11.5px;font-weight:600;color:#154540;white-space:nowrap}
.mini span{font-size:8.5px;color:#5b6b68;white-space:pre-line;line-height:1.15;display:block}
.foot{position:absolute;bottom:10px;left:30px;right:30px;display:flex;justify-content:space-between;font-size:9.5px;color:#7a8885;border-top:1px solid #e3e8e6;padding-top:5px}
.note{font-size:10px;color:#5b6b68;margin-top:8px}
`;

/** Any report page: the letterhead (title, period), a body, and the footer (page numbers filled in once all pages exist). */
export function letterPage({ title, period, range, generated, by, note }, logo, body) {
  return h("div", { class: "page" },
    h("div", { class: "lh" }, h("img", { src: logo, alt: "" }),
      h("div", { class: "t" }, h("b", null, title), h("span", null, t("company"))),
      h("div", { class: "m" }, h("b", null, period), h("span", { dir: "ltr" }, range))),
    h("div", { class: "gold" }),
    body,
    h("div", { class: "foot" }, h("span", null, t("pdf_generated", { d: new Intl.DateTimeFormat(loc(), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Muscat" }).format(new Date(generated)) }),
      by ? ` · ${t("pdf_by", { name: by })}` : "", " · ", note), h("span", { class: "pno" })));
}
const page = (D, logo, body) => letterPage({ title: t("pdf_title"), period: monthName(D.month), range: `${dmy(D.from)} – ${dmy(D.to)}`, generated: D.generated_at, note: t(D.own ? "pdf_confidential_own" : "pdf_confidential") }, logo, body);
export const logoData = () => toData("/logo-wordmark.png");
/** Number the pages ("Page 1 of 3"), draw them and save the PDF. */
export async function savePdf(pages, name, onStep) {
  pages.forEach((pg, i) => { pg.querySelector(".pno").textContent = t("pdf_page", { n: num(i + 1), of: num(pages.length) }); });
  const blob = await toPdf(pages, onStep);
  save(blob, name);
  return blob;
}
export { save as saveBlob, loadScript };

function rulesText(D) {
  return D.rules.flex ? t("pdf_rules_flex", { a: clockText(D.rules.from), b: clockText(D.rules.to), n: num(D.rules.hours) }) : t("pdf_rules_shift", { n: D.rules.grace });
}

/** Part 1: the company (or team) summary. */
function summaryPage(D, logo) {
  const T = D.total;
  const tile = (label, v, big = false) => h("div", { class: `tile ${big ? "big" : ""}` }, h("b", null, v), h("span", null, label));
  return page(D, logo, [
    h("h2", null, t(D.scope === "company" ? "pdf_part1_company" : "pdf_part1_team"), h("small", null, t("pdf_staff_n", { n: num(D.people.length) }))),
    h("p", { class: "rules" }, rulesText(D)),
    h("div", { class: "tiles" },
      tile(t("att_compliance"), pct(T.compliance), true), tile(t("pdf_working_days"), num(D.working_days), true), tile(t("att_work_days"), num(T.workDays), true),
      tile(t("att_total_hours"), hours(T.worked ?? T.onSite), true), tile(t("att_on_time_days"), num(T.onTime), true),
      tile(t("att_late"), pair(T.late, T.lateMin)), tile(t("att_early"), pair(T.early, T.earlyMin)), tile(t("att_missing"), num(T.missing)),
      tile(t("att_absent"), num(T.absent)), tile(t("att_pending_abs"), num(T.pending)), tile(t("att_leave_days"), num(T.leave)),
      tile(t("att_mission_days"), num(T.mission)), tile(t("ci_outside"), num(T.outside || 0)), tile(t("att_after"), T.afterMin ? pair(T.afterDays, T.afterMin) : "—"),
      tile(t("att_extra"), hours(T.extraMin)), tile(`⚠️ ${t("att_flagged")}`, num(T.flagged || 0))),
    h("p", { class: "note" }, t("pdf_note")),
  ]);
}

/** Part 2: a row per person (as many pages as needed), with the totals on the last. */
function staffPages(D, logo) {
  const PER = 17, out = [];
  const colgroup = h("colgroup", null, h("col", { style: "width:19%" }), COLS.map(() => h("col", null)));
  for (let i = 0; i < D.people.length; i += PER) {
    const chunk = D.people.slice(i, i + PER), last = i + PER >= D.people.length;
    out.push(page(D, logo, [
      h("h2", null, t("pdf_part2"), D.people.length > PER ? h("small", null, `${num(i + 1)}–${num(Math.min(i + PER, D.people.length))} / ${num(D.people.length)}`) : null),
      h("table", null, colgroup.cloneNode(true),
        h("thead", null, h("tr", null, h("th", { style: "text-align:start;padding-inline:6px" }, t("employee")), COLS.map((k) => h("th", null, t(k))))),
        h("tbody", null, chunk.map((p) => h("tr", null, h("td", { class: "nm" }, nameOf(p.employee), h("small", null, `${p.employee.emp_no} · ${dept(p.employee) || t("shift_" + (p.employee.shift || 2))}`, offMark(p))), rowCells(p.summary).map((v) => h("td", null, v)))),
          last ? h("tr", { class: "tot" }, h("td", { class: "nm" }, t("pdf_totals")), rowCells(D.total).map((v) => h("td", null, v))) : null)),
    ]));
  }
  return out;
}

/** Part 3: one person's month, day by day, and their totals. */
function personPage(D, logo, p) {
  const e = p.employee, s = p.summary;
  const rows = p.days.map((d) => {
    const quiet = ["rest", "holiday", "no_data", "today"].includes(d.status);
    const shift = d.shift ? (d.shift.flex ? t("pdf_flex_short") : t("shift_" + d.shift.no)) : "";
    return h("tr", { class: quiet ? "q" : null },
      h("td", null, dmy(d.date).slice(0, 5)), h("td", null, weekday(d.date)), h("td", null, quiet ? "" : shift),
      h("td", null, d.in !== null ? clockText(d.in) : quiet ? "" : "—"),
      h("td", null, d.expectedOut !== null && !quiet && d.status !== "leave" && d.status !== "mission" ? clockText(d.expectedOut) : ""),
      h("td", null, d.out !== null ? clockText(d.out) : quiet ? "" : "—"),
      h("td", null, d.worked ? durText(d.worked) : d.onSite ? durText(d.onSite) : ""), h("td", null, d.late ? num(d.late) : ""), h("td", null, d.early ? num(d.early) : ""),
      h("td", null, d.after ? durText(d.after) : ""), h("td", null, d.extra ? durText(d.extra) : ""),
      h("td", { class: "st", style: `color:${STATUS_COLOR[d.status] || "#8a9794"}` }, statusText(d), d.holiday ? ` · ${tx(d.holiday)}` : "", d.outside ? ` · ${t("pdf_outside_short")}` : "",
        (d.flags || []).map((f) => h("span", { class: "flag" }, ` ⚠️ ${f.time} ${f.flags.map(flagLabel).join("، ")}${f.status === "accepted" ? ` (${t("ci_flag_accepted")})` : f.status === "rejected" ? ` (${t("ci_flag_rejected")})` : ""}`))));
  });
  const heads = ["date", "pdf_day", "pdf_shift", "att_in", "pdf_expected_out", "att_out", "pdf_hours", "pdf_late_min", "pdf_early_min", "att_after", "pdf_extra_short", "status"];
  const widths = [6, 6, 7, 6.5, 8, 6.5, 6.5, 6.5, 6.5, 7.5, 7.5, 25];
  return page(D, logo, [
    h("div", { class: "who" }, h("b", null, nameOf(e)), h("span", null, `${t("emp_no_short")} ${e.emp_no}`), dept(e) ? h("span", null, dept(e)) : null,
      h("span", null, t("shift_" + (e.shift || 2))), h("span", null, rulesText(D))),
    h("table", { class: "days" }, h("colgroup", null, widths.map((w) => h("col", { style: `width:${w}%` }))),
      h("thead", null, h("tr", null, heads.map((k, i) => h("th", { style: i === 11 ? "text-align:start;padding-inline:6px" : null }, t(k))))),
      h("tbody", null, rows)),
    h("div", { class: "mini" }, figures(s).map(([k, v], i) => h("div", null, h("b", null, v), h("span", null, t(COLS[i]))))),
    p.checksOff && p.checksOff.length ? h("p", { class: "note" }, "ℹ️ ", t("ver_off_note", { list: p.checksOff.map((k) => t("ver_" + k)).join(getLang() === "ar" ? "، " : ", ") })) : null,
  ]);
}

/** Draw the pages and put them into one PDF (Blob). */
export async function toPdf(pages, onStep) {
  await loadScript("/vendor/html2pdf.bundle.min.js", () => !!window.html2pdf);
  // the fonts and the logo go inside each page (an SVG image can't load anything from outside)
  const faces = [];
  for (const [w, sub] of [[400, "arabic"], [400, "latin"], [600, "arabic"], [600, "latin"]]) {
    const range = sub === "arabic" ? "U+0600-06FF,U+0750-077F,U+08A0-08FF,U+200C-200E,U+FB50-FDFF,U+FE70-FEFC" : "U+0000-00FF,U+2000-206F,U+20AC,U+2212";
    faces.push(`@font-face{font-family:'Plex PDF';font-weight:${w};src:url(${await toData(`/fonts/ibm-plex-sans-arabic-${sub}-${w}-normal.woff2`)}) format('woff2');unicode-range:${range}}`);
  }
  const css = faces.join("") + CSS;
  // the browser loads the fonts before the first page is drawn
  const probe = h("div", { style: { position: "fixed", left: "-9999px", top: "0" } }, h("style", null, css), h("span", { style: { fontFamily: "'Plex PDF'" } }, "نماء Nama"), h("b", { style: { fontFamily: "'Plex PDF'", fontWeight: "600" } }, "نماء Nama"));
  document.body.append(probe);
  try { await document.fonts.load("400 12px 'Plex PDF'", "نماء"); await document.fonts.load("600 12px 'Plex PDF'", "نماء"); } catch { /* drawn with the fallback font */ }
  const dir = getLang() === "ar" ? "rtl" : "ltr";
  let pdf = null;
  try {
    for (let i = 0; i < pages.length; i++) {
      onStep && onStep(i + 1, pages.length);
      const xml = new XMLSerializer().serializeToString(pages[i]);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="${W}" height="${H}"><div xmlns="http://www.w3.org/1999/xhtml" dir="${dir}" lang="${getLang()}" style="margin:0;width:${W}px;height:${H}px"><style>${css}</style>${xml}</div></foreignObject></svg>`;
      const im = new Image();
      im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      await im.decode();
      const c = document.createElement("canvas"); c.width = Math.round(W * SCALE); c.height = Math.round(H * SCALE);
      const g = c.getContext("2d");
      const draw = () => { g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height); };
      draw();
      if (i === 0) { await new Promise((r) => setTimeout(r, 350)); draw(); } // the first draw can come before the embedded fonts are ready
      if (!pdf) {
        pdf = await window.html2pdf().set({ margin: 0, image: { type: "jpeg", quality: 0.86 }, jsPDF: { unit: "px", format: [W, H], orientation: "landscape", hotfixes: ["px_scaling"] } }).from(c, "canvas").toPdf().get("pdf");
        while (pdf.getNumberOfPages() > 1) pdf.deletePage(pdf.getNumberOfPages()); // never a stray blank page after the first
      } else { pdf.addPage([W, H], "landscape"); pdf.addImage(c.toDataURL("image/jpeg", 0.86), "JPEG", 0, 0, W, H); }
      await new Promise((r) => setTimeout(r, 0)); // let the page breathe between pages
    }
  } finally { probe.remove(); }
  return pdf.output("blob");
}

/** The pages of the report: the pack (Parts 1–3), or one person's page. */
export async function buildPages(D) {
  const logo = await toData("/logo-wordmark.png");
  const pages = D.scope === "person" ? D.people.map((p) => personPage(D, logo, p)) : [summaryPage(D, logo), ...staffPages(D, logo), ...D.people.map((p) => personPage(D, logo, p))];
  pages.forEach((pg, i) => { pg.querySelector(".pno").textContent = t("pdf_page", { n: num(i + 1), of: num(pages.length) }); });
  return pages;
}

export function fileName(D, ext) {
  const who = D.scope === "person" && D.people[0] ? `-${D.people[0].employee.emp_no}` : "";
  return `attendance-${D.month}${who}.${ext}`;
}
function save(blob, name) {
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/** Build and download the PDF. */
export async function downloadPdf(D, onStep) {
  const blob = await toPdf(await buildPages(D), onStep);
  save(blob, fileName(D, "pdf"));
  return blob;
}

/** The same three parts as an Excel workbook: Summary, Staff, Days. */
export async function downloadXlsx(D) {
  await loadScript("/vendor/xlsx.full.min.js", () => !!window.XLSX);
  const X = window.XLSX, wb = X.utils.book_new();
  const T = D.total, H2 = (m) => (m ? Math.round((m / 60) * 100) / 100 : 0);
  const summary = [[t("pdf_title")], [t("company")], [monthName(D.month), `${D.from} – ${D.to}`], [rulesText(D)], [],
    [t("pdf_working_days"), D.working_days], [t("pdf_staff"), D.people.length], [t("att_work_days"), T.workDays], [t("att_compliance"), T.compliance === null ? "" : T.compliance / 100],
    [t("att_on_time_days"), T.onTime], [`${t("att_late")} (${t("pdf_times")})`, T.late], [`${t("att_late")} (${t("pdf_hours_unit")})`, H2(T.lateMin)],
    [`${t("att_early")} (${t("pdf_times")})`, T.early], [`${t("att_early")} (${t("pdf_hours_unit")})`, H2(T.earlyMin)], [t("att_missing"), T.missing], [t("att_absent"), T.absent],
    [t("att_pending_abs"), T.pending], [t("att_leave_days"), T.leave], [t("att_mission_days"), T.mission], [t("ci_outside"), T.outside || 0],
    [`${t("att_after")} (${t("pdf_hours_unit")})`, H2(T.afterMin)], [`${t("att_extra")} (${t("pdf_hours_unit")})`, H2(T.extraMin)], [t("att_flagged"), T.flagged || 0], [t("att_unverified"), T.unverified || 0], [`${t("att_total_hours")} (${t("pdf_hours_unit")})`, H2(T.worked ?? T.onSite)]];
  const ws1 = X.utils.aoa_to_sheet(summary); ws1["!cols"] = [{ wch: 36 }, { wch: 24 }];
  const cell = ws1["B9"]; if (cell && cell.v !== "") cell.z = "0.0%";
  const head = [t("emp_no_short"), t("employee"), t("f_department"), t("att_work_days"), t("att_compliance"), `${t("att_late")} (${t("pdf_times")})`, `${t("att_late")} (${t("pdf_hours_unit")})`,
    `${t("att_early")} (${t("pdf_times")})`, `${t("att_early")} (${t("pdf_hours_unit")})`, t("att_missing"), t("att_absent"), t("att_pending_abs"), t("att_leave_days"), t("att_mission_days"),
    t("ci_outside"), `${t("att_after")} (${t("pdf_hours_unit")})`, `${t("att_extra")} (${t("pdf_hours_unit")})`, t("att_flagged"), t("att_unverified"), `${t("att_total_hours")} (${t("pdf_hours_unit")})`, t("ver_checks_off")];
  const line = (s) => [s.workDays, s.compliance === null ? "" : s.compliance, s.late, H2(s.lateMin), s.early, H2(s.earlyMin), s.missing, s.absent, s.pending, s.leave, s.mission, s.outside || 0, H2(s.afterMin), H2(s.extraMin), s.flagged || 0, s.unverified || 0, H2(s.worked ?? s.onSite)];
  const offText = (p) => (p.checksOff || []).map((k) => t("ver_" + k)).join(", ");
  const staff = [head, ...D.people.map((p) => [p.employee.emp_no, nameOf(p.employee), dept(p.employee), ...line(p.summary), offText(p)]), ["", t("pdf_totals"), "", ...line(T)]];
  const ws2 = X.utils.aoa_to_sheet(staff); ws2["!cols"] = [{ wch: 10 }, { wch: 32 }, { wch: 18 }, ...head.slice(3).map(() => ({ wch: 12 }))];
  const dh = [t("emp_no_short"), t("employee"), t("date"), t("pdf_day"), t("pdf_shift"), t("att_in"), t("pdf_expected_out"), t("att_out"), `${t("pdf_hours")} (h:mm)`, t("pdf_late_min"), t("pdf_early_min"), `${t("att_after")} (${t("pdf_minutes")})`, `${t("pdf_extra_short")} (${t("pdf_minutes")})`, t("status")];
  const days = [dh];
  for (const p of D.people) for (const d of p.days) {
    if (d.status === "no_data") continue;
    days.push([p.employee.emp_no, nameOf(p.employee), d.date, weekday(d.date), d.shift ? (d.shift.flex ? t("pdf_flex_short") : t("shift_" + d.shift.no)) : "", d.in !== null ? clockText(d.in) : "", d.expectedOut !== null ? clockText(d.expectedOut) : "",
      d.out !== null ? clockText(d.out) : "", d.worked ? durText(d.worked) : d.onSite ? durText(d.onSite) : "", d.late || 0, d.early || 0, d.after || 0, d.extra || 0, statusText(d) + (d.holiday ? ` · ${tx(d.holiday)}` : "") + (d.flags || []).map((f) => ` ⚠️ ${f.time} ${f.flags.map(flagLabel).join(", ")}${f.status && f.status !== "open" ? ` (${t("ci_flag_" + f.status)})` : ""}`).join("")]);
  }
  const ws3 = X.utils.aoa_to_sheet(days); ws3["!cols"] = [{ wch: 10 }, { wch: 30 }, { wch: 11 }, { wch: 8 }, { wch: 10 }, ...dh.slice(5, 13).map(() => ({ wch: 11 })), { wch: 28 }];
  if (D.scope !== "person") { X.utils.book_append_sheet(wb, ws1, t("pdf_sheet_summary").slice(0, 31)); X.utils.book_append_sheet(wb, ws2, t("pdf_sheet_staff").slice(0, 31)); }
  else X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([[nameOf(D.people[0].employee)], [monthName(D.month)], [], ...figures(D.people[0].summary).map(([k, v]) => [t(k), v])]), t("pdf_sheet_summary").slice(0, 31));
  X.utils.book_append_sheet(wb, ws3, t("pdf_sheet_days").slice(0, 31));
  if (getLang() === "ar") wb.Workbook = { Views: [{ RTL: true }] };
  const out = X.write(wb, { bookType: "xlsx", type: "array" });
  save(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName(D, "xlsx"));
}
