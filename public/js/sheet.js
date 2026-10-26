// Read an uploaded spreadsheet. CSV is decoded as UTF-8 and kept as plain text, so the server
// reads dates as day/month (not US month/day), keeps leading zeros and Arabic stays intact.
export function parseWorkbook(XLSX, bytes, filename) {
  if (/\.(csv|txt)$/i.test(filename || "")) {
    const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
    return XLSX.read(text, { type: "string", raw: true });
  }
  return XLSX.read(bytes, { type: "array", cellDates: false });
}
