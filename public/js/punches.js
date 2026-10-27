// Reads a fingerprint machine export (rows of cells, header row first) into punches {no, name, at: "YYYY-MM-DD HH:MM"}.
// Used by the upload page (after SheetJS reads the file) and by the server to check what it receives.
// Dates are day/month/year (the machine's Oman setting); "Date/Time" in one column, or "Date" and "Time" in two.

const norm = (v) => String(v ?? "").toLowerCase().replace(/[\s._-]+/g, " ").trim();
const isNo = (c) => /^(no|ac no|enroll no|user id|id|emp no|badge|رقم|الرقم)$/.test(c);
const isName = (c) => /^(name|user name|الاسم|اسم)$/.test(c);
const isDateTime = (c) => /^(date\/time|date time|datetime|time stamp|timestamp|التاريخ\/الوقت|التاريخ و الوقت)$/.test(c);
const isDate = (c) => /^(date|التاريخ)$/.test(c);
const isTime = (c) => /^(time|الوقت)$/.test(c);

const pad = (n) => String(n).padStart(2, "0");
function fromSerial(x) { // Excel day number (days since 1899-12-30), local wall time
  const ms = Math.round((x - 25569) * 86400000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function clock(s) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm|ص|م)?$/i.exec(String(s).trim());
  if (!m) return null;
  let h = +m[1];
  const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" || ap === "م") { if (h < 12) h += 12; } else if ((ap === "am" || ap === "ص") && h === 12) h = 0;
  return h < 24 && +m[2] < 60 ? `${pad(h)}:${m[2]}` : null;
}
function day(s) {
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}
function valid(y, mo, d) {
  const x = new Date(Date.UTC(y, mo - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === mo - 1 && x.getUTCDate() === d && y >= 2000 && y <= 2100 ? `${y}-${pad(mo)}-${pad(d)}` : null;
}
/** One cell (or a date cell plus a time cell) → "YYYY-MM-DD HH:MM", or null. */
export function readStamp(v, t) {
  if (typeof v === "number" && t === undefined) return v > 20000 && v < 80000 ? fromSerial(v) : null;
  if (v instanceof Date) return isNaN(v) ? null : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}`;
  if (t !== undefined) {
    const d = typeof v === "number" ? fromSerial(v).slice(0, 10) : day(String(v).trim());
    const c = typeof t === "number" ? fromSerial(25569 + (t % 1)).slice(11) : clock(t);
    return d && c ? `${d} ${c}` : null;
  }
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  const i = s.indexOf(" ");
  if (i < 0) return null;
  const d = day(s.slice(0, i)), c = clock(s.slice(i + 1));
  return d && c ? `${d} ${c}` : null;
}

/** rows: array of arrays. Returns {punches, skipped, error} — error when the columns can't be found. */
export function readPunches(rows) {
  let hi = -1, col = {};
  for (let i = 0; i < Math.min(rows.length, 15) && hi < 0; i++) {
    const c = (rows[i] || []).map(norm), find = (f) => c.findIndex(f);
    const no = find(isNo), dt = find(isDateTime), d = find(isDate), t = find(isTime);
    if (no >= 0 && (dt >= 0 || (d >= 0 && t >= 0))) { hi = i; col = { no, name: find(isName), dt, d, t }; }
  }
  if (hi < 0) return { punches: [], skipped: 0, error: "columns" };
  const punches = [];
  let skipped = 0;
  for (const r of rows.slice(hi + 1)) {
    if (!r || r.every((x) => String(x ?? "").trim() === "")) continue;
    const no = String(r[col.no] ?? "").trim().replace(/\.0+$/, "");
    const at = col.dt >= 0 ? readStamp(r[col.dt]) : readStamp(r[col.d], r[col.t]);
    if (!/^[A-Za-z0-9-]{1,20}$/.test(no) || !at) { skipped++; continue; }
    punches.push({ no, name: col.name >= 0 ? String(r[col.name] ?? "").trim().slice(0, 100) : "", at });
  }
  return { punches, skipped, error: null };
}
