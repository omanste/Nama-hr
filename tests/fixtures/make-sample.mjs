// Builds tests/fixtures/leave-sample.xlsx: made-up names, same layout as Nama's leave record sheet
// (2-row merged header, Arabic names only, no employee ID, gaps, and an extra-days table below a blank row).
// Run: node tests/fixtures/make-sample.mjs
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { exports: {}, console, Buffer, Uint8Array, ArrayBuffer, Date };
vm.runInNewContext(fs.readFileSync(path.join(here, "../../public/vendor/xlsx.full.min.js"), "utf8"), sandbox);
const XLSX = sandbox.exports;

const d = (s) => new Date(s + "T00:00:00Z");
const rows = [
  ["#", "إسم الموظف", "تاريخ تعيين الموظف ", "الرصيد المتبقي حتى  نهاية 2025", "رصيد 2026", "أيام إضافية", " الرصيد  الحالي", null, 2026, null, null, null, null, "إجمالي الرصيد  المتبقى حتى تاريخ سبتمبر 2026"],
  [null, null, null, null, null, null, null, null, "سنوية", "إضطرارية", "إجازة عزاء", "مرضية", "اجمالي سنوي 2026 ", null],
  [1, "موظف أول", d("2020-11-01"), 90, 30, 0, 120, null, 14, 0, 0, 0, 14, 106],
  [2, "موظف ثاني", d("2022-04-01"), 23, 30, 0, 53, null, 0, 0, 0, 0, 0, 53],
  [3, "موظف ثالث", d("2020-09-15"), 44, 30, 0, 74, null, 0, 0, 0, 0, 0, 74],
  [4, "موظف رابع", null, null, 30, 0, 30, null, 0, 0, 0, 0, 0, 30],
  [5, "موظف خامس", null, null, null, 0, null, null, 0, 0, 0, 0, 0, null],
  [6, "موظف سادس", d("2025-06-01"), 15, 30, 0, 45, null, 0, 0, 0, 0, 0, 45],
  [7, "موظف سابع", d("2025-04-01"), 20, 30, null, 50, null, 29, 0, 0, 0, 0, 21],
  [8, "مدير المبيعات", d("2022-03-01"), 18, 38, 13, 69, null, 34, 0, 0, 0, 34, 35],
  [],
  [null, "إسم الموظف", "التاريخ", "#"],
  ["الأيام الإضافية", "مدير المبيعات", d("2026-02-28"), 1],
  [null, null, d("2026-03-07"), 2],
];
const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
ws["!merges"] = ["A1:A2", "B1:B2", "C1:C2", "D1:D2", "E1:E2", "F1:F2", "G1:G2", "I1:M1", "N1:N2", "A13:A14", "B13:B14"].map((r) => XLSX.utils.decode_range(r));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "2026");
const out = path.join(here, "leave-sample.xlsx");
fs.writeFileSync(out, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
console.log("wrote", out);
