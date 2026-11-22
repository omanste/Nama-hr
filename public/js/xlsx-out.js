// One Excel workbook from plain rows: each sheet with its header row frozen, filters on, column widths fitted, text not
// wrapped, right-to-left when the portal is in Arabic. Used by the Staff list and the HR system updates exports.
import { getLang } from "./i18n.js";
import { saveBlob, loadScript } from "./att-pdf.js";

/** Display width of a text in Excel "characters" (Arabic letters are a little wider than the default). */
const widthOf = (v) => { const s = String(v ?? ""); return [...s].reduce((n, ch) => n + (/[؀-ۿ]/.test(ch) ? 1.15 : 1), 0); };

/** sheets: [{ name, rows: [[header…], [row…], …], widths?: [wch…], center?: [column index…] }] → saves `file`. Every cell is
 * vertically centred; the `center` columns are also centred across. */
export async function saveXlsx(sheets, file) {
  await loadScript("/vendor/xlsx.full.min.js", () => !!window.XLSX);
  await loadScript("/vendor/jszip.min.js", () => !!window.JSZip);
  const X = window.XLSX, wb = X.utils.book_new();
  for (const sh of sheets) {
    const ws = X.utils.aoa_to_sheet(sh.rows);
    const cols = sh.rows[0].length;
    ws["!cols"] = Array.from({ length: cols }, (_, c) => ({ wch: sh.widths && sh.widths[c] ? sh.widths[c] : Math.min(80, Math.max(8, ...sh.rows.map((r) => widthOf(r[c]) + 2))) }));
    ws["!autofilter"] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, sh.rows.length - 1), c: cols - 1 } }) };
    X.utils.book_append_sheet(wb, ws, String(sh.name).replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  }
  if (getLang() === "ar") wb.Workbook = { Views: [{ RTL: true }] };
  const raw = X.write(wb, { bookType: "xlsx", type: "array" });
  // the header row stays in view while scrolling: a frozen pane in each sheet (the library doesn't write one itself)
  const zip = await window.JSZip.loadAsync(raw);
  // two cell styles: 1 = centred, 2 = start-aligned (both vertically centred, never wrapped)
  const st = zip.file("xl/styles.xml");
  let styled = false;
  if (st) {
    let sx = await st.async("string");
    const m = /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/.exec(sx);
    if (m && m[1] === "1") {
      sx = sx.replace(m[0], `<cellXfs count="3">${m[2]}<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs>`);
      zip.file("xl/styles.xml", sx); styled = true;
    }
  }
  const colNo = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  for (const name of Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
    let xml = await zip.file(name).async("string");
    const sh = sheets[Number(/sheet(\d+)\.xml$/.exec(name)[1]) - 1] || {};
    if (styled) xml = xml.replace(/<c r="([A-Z]+)(\d+)"(?![^>]*\ss=)/g, (all, col) => `${all} s="${(sh.center || []).includes(colNo(col)) ? 1 : 2}"`);
    const pane = '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>';
    xml = /<sheetView\b[^>]*\/>/.test(xml) ? xml.replace(/<sheetView\b([^>]*)\/>/, `<sheetView$1>${pane}</sheetView>`)
      : /<sheetView\b[^>]*>/.test(xml) ? xml.replace(/(<sheetView\b[^>]*>)/, `$1${pane}`)
      : xml.replace(/(<sheetFormatPr|<cols|<sheetData)/, `<sheetViews><sheetView workbookViewId="0"${getLang() === "ar" ? ' rightToLeft="1"' : ""}>${pane}</sheetView></sheetViews>$1`);
    zip.file(name, xml);
  }
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  saveBlob(blob, file);
  return blob;
}
