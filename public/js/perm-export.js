// Permissions report exports (for management): a PDF (A4 landscape, Nama letterhead, summary table with totals and,
// if asked, each permission per person) and an Excel workbook ("Summary" and "Details", header row frozen, filters on).
// The data is /api/reports/permissions, which only returns the people this login may see.
import { api } from "./api.js";
import { t, getLang, nm } from "./i18n.js";
import { h, num, dmy } from "./ui.js";
import { letterPage, logoData, savePdf, saveBlob, loadScript } from "./att-pdf.js";

const HOURS = (m) => Math.round((m || 0) / 6) / 10; // 210 → 3.5
export const pairText = (n, m) => (n ? t("times_hours", { n: num(n), h: num(HOURS(m)) }) : "—");
const nameOf = (e) => (getLang() === "en" ? e.name_en || e.name_ar : e.name_ar || e.name_en) || "";

/** The report's columns: [label key, value(row) → text] in the order of the screen. */
export function columns(types, classes) {
  return [
    ...types.map((k) => [`lt_${k}`, (r) => pairText(r[k].count, r[k].minutes)]),
    ["total", (r) => pairText(r.total.count, r.total.minutes)],
    ...classes.map((c) => [`pc_${c}`, (r) => pairText(r.classCounts ? r.classCounts[c] : 0, r.classes[c])]),
    ["att_awaiting_hr", (r) => pairText(r.classCounts ? r.classCounts.unclassified : 0, r.classes.unclassified)],
  ];
}
/** The totals over every row, in the same shape as a row. */
export function totals(items, types, classes) {
  const z = () => ({ count: 0, minutes: 0 });
  const T = { ...Object.fromEntries([...types, "total"].map((k) => [k, z()])), classes: {}, classCounts: {} };
  for (const c of [...classes, "unclassified"]) { T.classes[c] = 0; T.classCounts[c] = 0; }
  for (const r of items) {
    for (const k of [...types, "total"]) { T[k].count += r[k].count; T[k].minutes += r[k].minutes; }
    for (const c of [...classes, "unclassified"]) { T.classes[c] += r.classes[c] || 0; T.classCounts[c] += (r.classCounts && r.classCounts[c]) || 0; }
  }
  return T;
}

/** File name: nama-permissions-report-2026-11 (a whole month) or -2026-11-01_2026-11-15. */
export function fileBase(from, to) {
  const last = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)).getUTCDate();
  const month = from.slice(8) === "01" && to === `${from.slice(0, 8)}${String(last).padStart(2, "0")}`;
  return `nama-permissions-report-${month ? from.slice(0, 7) : `${from}_${to}`}`;
}
const periodText = (from, to) => {
  const f = new Intl.DateTimeFormat(getLang() === "ar" ? "ar-OM-u-nu-latn" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return from.slice(0, 7) === to.slice(0, 7) ? f.format(new Date(`${from.slice(0, 7)}-01T00:00:00Z`)) : `${dmy(from)} – ${dmy(to)}`;
};

const load = (qs, details) => api.get(`/api/reports/permissions?${qs}${details ? "&details=1" : ""}`);

/** The PDF: summary pages, then (if asked) one section per person with each permission. */
export async function permissionsPdf(qs, { details = false, onStep } = {}) {
  const R = await load(qs, details);
  const logo = await logoData();
  const head = { title: `${t("report_permissions")} · ${getLang() === "ar" ? "Permissions report" : "تقرير الاستئذانات"}`, period: periodText(R.from, R.to),
    range: `${dmy(R.from)} – ${dmy(R.to)}`, generated: R.generated_at, by: nm(R.by), note: t("pdf_confidential") };
  const cols = columns(R.types, R.classes), T = totals(R.items, R.types, R.classes);
  const pages = [], PER = 17;
  const colgroup = () => h("colgroup", null, h("col", { style: "width:22%" }), cols.map(() => h("col", null)));
  for (let i = 0; i < Math.max(1, R.items.length); i += PER) {
    const chunk = R.items.slice(i, i + PER), last = i + PER >= R.items.length;
    pages.push(letterPage(head, logo, [
      h("h2", null, t("perm_pdf_summary"), R.items.length > PER ? h("small", null, `${num(i + 1)}–${num(Math.min(i + PER, R.items.length))} / ${num(R.items.length)}`) : null),
      h("p", { class: "rules" }, t("approved_only"), " · ", t("perm_rule_policy")),
      h("table", null, colgroup(),
        h("thead", null, h("tr", null, h("th", { style: "text-align:start;padding-inline:6px" }, t("employee")), cols.map(([k]) => h("th", null, t(k).replace(/ /, "\n"))))),
        h("tbody", null, chunk.map((r) => h("tr", null, h("td", { class: "nm" }, nameOf(r.employee), h("small", null, r.employee.emp_no)), cols.map(([, f]) => h("td", null, f(r))))),
          last ? h("tr", { class: "tot" }, h("td", { class: "nm" }, t("pdf_totals")), cols.map(([, f]) => h("td", null, f(T)))) : null)),
    ]));
  }
  if (details && R.details) {
    // one section per person; long lists continue on the next page
    const byEmp = new Map();
    for (const d of R.details) { if (!byEmp.has(d.employee.id)) byEmp.set(d.employee.id, []); byEmp.get(d.employee.id).push(d); }
    const ROWS = 24;
    let body = [], used = 0;
    const flush = () => { if (body.length) pages.push(letterPage(head, logo, [h("h2", null, t("perm_pdf_details")), ...body])); body = []; used = 0; };
    for (const [, list] of byEmp) {
      for (let i = 0; i < list.length; i += ROWS) {
        const part = list.slice(i, i + ROWS);
        if (used + part.length + 3 > ROWS + 4) flush();
        body.push(h("div", { class: "who" }, h("b", null, nameOf(part[0].employee)), h("span", null, part[0].employee.emp_no)),
          h("table", { class: "days" }, h("colgroup", null, [10, 12, 11, 8, 13, 10, 18, 18].map((w) => h("col", { style: `width:${w}%` }))),
            h("thead", null, h("tr", null, ["date", "permission_type", "perm_from_to", "pdf_hours", "perm_paid", "status", "perm_approved_by", "comment"].map((k) => h("th", null, t(k))))),
            h("tbody", null, part.map((d) => h("tr", null, h("td", null, dmy(d.date)), h("td", { class: "st" }, t("lt_" + d.type)),
              h("td", null, h("span", { dir: "ltr" }, d.taken ? `${d.taken.from}–${d.taken.to || "…"}` : `${d.from || ""}–${d.to || ""}`)), h("td", null, num(HOURS(d.minutes))),
              h("td", null, d.hr_class ? t("pc_" + d.hr_class) : d.status === "approved" ? t("att_awaiting_hr") : "—"), h("td", null, t("rs_" + d.status)),
              h("td", { class: "st" }, d.decided_by ? nm(d.decided_by) : "—"), h("td", { class: "st" }, d.comment || ""))))));
        used += part.length + 3;
      }
    }
    flush();
  }
  return savePdf(pages, `${fileBase(R.from, R.to)}.pdf`, onStep);
}

/** The Excel workbook: Summary (empNo, name, counts and hours, totals) and Details (one row per permission). */
export async function permissionsXlsx(qs) {
  const R = await load(qs, true);
  await loadScript("/vendor/xlsx.full.min.js", () => !!window.XLSX);
  await loadScript("/vendor/jszip.min.js", () => !!window.JSZip);
  const X = window.XLSX, wb = X.utils.book_new(), H = HOURS;
  const cls = [...R.classes, "unclassified"], label = (c) => t(c === "unclassified" ? "att_awaiting_hr" : `pc_${c}`);
  const head = [t("emp_no_short"), t("employee"), t("f_department"),
    ...[...R.types, "total"].flatMap((k) => [`${t(k === "total" ? "total" : `lt_${k}`)} (${t("pdf_times")})`, `${t(k === "total" ? "total" : `lt_${k}`)} (${t("pdf_hours_unit")})`]),
    ...cls.flatMap((c) => [`${label(c)} (${t("pdf_times")})`, `${label(c)} (${t("pdf_hours_unit")})`])];
  const line = (r) => [...[...R.types, "total"].flatMap((k) => [r[k].count, H(r[k].minutes)]), ...cls.flatMap((c) => [(r.classCounts && r.classCounts[c]) || 0, H(r.classes[c])])];
  const T = totals(R.items, R.types, R.classes);
  const sum = [head, ...R.items.map((r) => [r.employee.emp_no, nameOf(r.employee), (getLang() === "en" ? r.employee.dept_en || r.employee.dept_ar : r.employee.dept_ar || r.employee.dept_en) || "", ...line(r)]),
    ["", t("pdf_totals"), "", ...line(T)]];
  const ws1 = X.utils.aoa_to_sheet(sum);
  ws1["!cols"] = [{ wch: 11 }, { wch: Math.max(24, ...R.items.map((r) => nameOf(r.employee).length + 2)) }, { wch: 16 }, ...head.slice(3).map((x) => ({ wch: Math.max(10, Math.min(28, x.length + 2)) }))];
  ws1["!autofilter"] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, sum.length - 2), c: head.length - 1 } }) };
  const dh = [t("emp_no_short"), t("employee"), t("date"), t("permission_type"), t("perm_from"), t("perm_to"), `${t("pdf_hours")}`, t("perm_paid"), t("status"), t("perm_approved_by"), t("comment")];
  const rows = (R.details || []).map((d) => [d.employee.emp_no, nameOf(d.employee), d.date, t("lt_" + d.type), d.taken ? d.taken.from : d.from || "", d.taken ? d.taken.to || "" : d.to || "", H(d.minutes),
    d.hr_class ? t("pc_" + d.hr_class) : d.status === "approved" ? t("att_awaiting_hr") : "", t("rs_" + d.status), d.decided_by ? nm(d.decided_by) : "", d.comment || ""]);
  const ws2 = X.utils.aoa_to_sheet([dh, ...rows]);
  ws2["!cols"] = [{ wch: 11 }, { wch: Math.max(24, ...rows.map((r) => String(r[1]).length + 2)) }, { wch: 11 }, { wch: 16 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 18 }, { wch: 12 }, { wch: 24 }, { wch: 40 }];
  ws2["!autofilter"] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, rows.length), c: dh.length - 1 } }) };
  X.utils.book_append_sheet(wb, ws1, t("pdf_sheet_summary").slice(0, 31));
  X.utils.book_append_sheet(wb, ws2, t("perm_sheet_details").slice(0, 31));
  if (getLang() === "ar") wb.Workbook = { Views: [{ RTL: true }] };
  const raw = X.write(wb, { bookType: "xlsx", type: "array" });
  // the header row stays in view while scrolling: a frozen pane in each sheet (the library doesn't write one itself)
  const zip = await window.JSZip.loadAsync(raw);
  for (const name of Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
    let xml = await zip.file(name).async("string");
    const pane = '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>';
    xml = /<sheetView\b[^>]*\/>/.test(xml) ? xml.replace(/<sheetView\b([^>]*)\/>/, `<sheetView$1>${pane}</sheetView>`)
      : /<sheetView\b[^>]*>/.test(xml) ? xml.replace(/(<sheetView\b[^>]*>)/, `$1${pane}`)
      : xml.replace(/(<sheetFormatPr|<cols|<sheetData)/, `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>$1`); // before these, as the format requires
    zip.file(name, xml);
  }
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  saveBlob(blob, `${fileBase(R.from, R.to)}.xlsx`);
}
