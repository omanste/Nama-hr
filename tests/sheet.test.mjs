import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { parseWorkbook } from "../public/js/sheet.js";

const sandbox = { exports: {}, console, Buffer, Uint8Array, ArrayBuffer, Date };
vm.runInNewContext(fs.readFileSync(new URL("../public/vendor/xlsx.full.min.js", import.meta.url), "utf8"), sandbox);
const XLSX = sandbox.exports;

test("CSV keeps day/month dates, leading zeros and UTF-8 Arabic as text", () => {
  const csv = "الرقم,الاسم,تاريخ التعيين,الرصيد\n007,أمجد,05/03/2024,12\n";
  const wb = parseWorkbook(XLSX, new TextEncoder().encode(csv), "staff.csv");
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  assert.deepEqual([...rows[1]], ["007", "أمجد", "05/03/2024", "12"]); // copy: arrays from the vm sandbox have another prototype
  assert.equal(rows[0][1], "الاسم");
});

test("xlsx is still read with numbers and date serials", () => {
  const ws = XLSX.utils.aoa_to_sheet([["n", "d"], [5, new Date(Date.UTC(2024, 2, 5))]], { cellDates: true });
  const wb0 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb0, ws, "S");
  const bytes = XLSX.write(wb0, { type: "array", bookType: "xlsx" });
  const wb = parseWorkbook(XLSX, new Uint8Array(bytes), "x.xlsx");
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.S, { header: 1, raw: true });
  assert.equal(rows[1][0], 5);
  assert.equal(typeof rows[1][1], "number");
});
