/* Reads an ID card or passport photo on Nama's own server (Tesseract, no outside service).
 * Uses the machine-readable zone (the "<<<" lines) when it is visible — its check digits make it reliable —
 * and the printed English labels on the front of the Omani civil ID. Results are suggestions: a person confirms them. */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { nameParts, completeFamily, arKey } from "./names-ar.mjs";

const require = createRequire(import.meta.url);
const workers = {}; // one per language: "eng" (labels, "<<<" lines) and "ara" (the Arabic name on the front)
let queue = Promise.resolve();

function worker(lang = "eng") {
  if (!workers[lang]) {
    const { createWorker } = require("tesseract.js");
    const langPath = path.join(path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)), "4.0.0_best_int");
    workers[lang] = createWorker(lang, 1, { langPath, cachePath: path.join(process.env.DATA_DIR || os.tmpdir(), ".ocr"), gzip: true, logger: () => {}, errorHandler: (e) => console.error(`ID reader: ${e}`) })
      .catch((e) => { delete workers[lang]; throw e; });
  }
  return workers[lang];
}

const MRZ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";
/** OCR text of an image (jpeg/png/webp); mrz=true reads only the "<<<" alphabet. One image at a time, so a busy day can't exhaust the server. */
export function ocr(buffer, { mrz = false, lang = "eng", sparse = false } = {}) {
  const job = queue.then(async () => {
    const w = await worker(lang);
    await w.setParameters(mrz ? { tessedit_char_whitelist: MRZ_CHARS, tessedit_pageseg_mode: "6", debug_file: "/dev/null" } : { tessedit_char_whitelist: "", tessedit_pageseg_mode: sparse ? "11" : "3", debug_file: "/dev/null" });
    return (await w.recognize(buffer, { rotateAuto: true })).data.text || "";
  });
  queue = job.catch(() => {});
  return job;
}
export async function stopOcr() {
  for (const lang of Object.keys(workers)) { const w = await workers[lang].catch(() => null); delete workers[lang]; if (w) await w.terminate(); }
}

// ---------- machine-readable zone (ICAO 9303) ----------
const VAL = (c) => (c === "<" ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55);
const check = (s) => String([...s].reduce((sum, c, i) => sum + VAL(c) * [7, 3, 1][i % 3], 0) % 10);
const fixDigits = (s) => s.replace(/[OQD]/g, "0").replace(/[IL]/g, "1").replace(/Z/g, "2").replace(/S/g, "5").replace(/B/g, "8").replace(/G/g, "6");
function yymmdd(s, future) {
  if (!/^\d{6}$/.test(s)) return null;
  const yy = Number(s.slice(0, 2)), mm = s.slice(2, 4), dd = s.slice(4, 6);
  if (mm < "01" || mm > "12" || dd < "01" || dd > "31") return null;
  const now = new Date().getUTCFullYear() % 100;
  const year = future ? 2000 + yy : yy > now ? 1900 + yy : 2000 + yy;
  return `${year}-${mm}-${dd}`;
}
const letters = (s) => s.replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B");
const words = (s) => s.split("<").filter(Boolean).map((w) => w[0] + w.slice(1).toLowerCase()).join(" ");
const COUNTRY3 = { OMN: "OM", ARE: "AE", SAU: "SA", KWT: "KW", QAT: "QA", BHR: "BH", YEM: "YE", EGY: "EG", JOR: "JO", SYR: "SY", LBN: "LB", IRQ: "IQ", SDN: "SD",
  IND: "IN", PAK: "PK", BGD: "BD", LKA: "LK", NPL: "NP", PHL: "PH", IDN: "ID", GBR: "GB", USA: "US", TUR: "TR", IRN: "IR", KEN: "KE", UGA: "UG", ETH: "ET", MAR: "MA", TUN: "TN" };

function mrzLines(text) {
  return text.toUpperCase().split(/\r?\n/).map((l) => l.replace(/\s+/g, "").replace(/[«‹(\[{]/g, "<").replace(/[^A-Z0-9<]/g, "")).filter((l) => l.length >= 28 && /<</.test(l));
}

/** TD1 (ID cards, 3×30), TD3 (passports, 2×44) or a visa (MRV-A 2×44 / MRV-B 2×36, first letter V).
 * Fields only count when their check digit matches. */
export function parseMrz(text) {
  const L = mrzLines(text);
  const out = {};
  const td3 = L.findIndex((l, i) => /^[PV][A-Z<]/.test(l) && L[i + 1] && L[i + 1].length >= (l[0] === "V" ? 34 : 42));
  if (td3 >= 0) {
    const l1 = L[td3].padEnd(44, "<").slice(0, 44), l2 = L[td3 + 1].padEnd(44, "<").slice(0, 44);
    out.kind = l1[0] === "V" ? "visa" : "passport";
    const [sur, given = ""] = l1.slice(5).split("<<");
    out.name_en = words(`${given}<${sur}`);
    const no = l2.slice(0, 9);
    if (check(no) === fixDigits(l2[9])) out.passport_no = no.replace(/</g, "");
    out.nationality = COUNTRY3[letters(l2.slice(10, 13))] || undefined;
    const dob = fixDigits(l2.slice(13, 19)); if (check(dob) === fixDigits(l2[19])) out.dob = yymmdd(dob, false);
    out.gender = { M: "male", F: "female" }[l2[20]];
    const exp = fixDigits(l2.slice(21, 27)); if (check(exp) === fixDigits(l2[27])) out.expiry = yymmdd(exp, true);
    // Omani passports carry the civil number in the personal-number field (with its own check digit)
    if (out.kind === "passport") {
      const pn = fixDigits(l2.slice(28, 42));
      if (/^\d{7,9}<*$/.test(pn) && check(pn) === fixDigits(l2[42])) out.civil_id = pn.replace(/</g, "");
    }
    if (out.kind === "visa") { if (out.passport_no) out.visa_no = out.passport_no; delete out.passport_no; } // a visa's number isn't the passport's
    return clean(out);
  }
  const i = L.findIndex((l) => /^[IAC][A-Z<]/.test(l) && l.length >= 28);
  if (i >= 0 && L[i + 1]) {
    const l1 = L[i].padEnd(30, "<").slice(0, 30), l2 = L[i + 1].padEnd(30, "<").slice(0, 30), l3 = (L[i + 2] || "").padEnd(30, "<").slice(0, 30);
    out.kind = "id";
    const doc = l1.slice(5, 14);
    if (check(doc) === fixDigits(l1[14])) out.card_no = doc.replace(/</g, "");
    const opt = l1.slice(15).replace(/</g, ""); if (/^\d{7,9}$/.test(fixDigits(opt))) out.civil_id = fixDigits(opt);
    // Omani cards: the civil number IS the document number (all digits, check-digit verified) when the optional field is empty
    else if (letters(l1.slice(2, 5)) === "OMN" && out.card_no && /^\d{7,9}$/.test(out.card_no)) out.civil_id = out.card_no;
    const dob = fixDigits(l2.slice(0, 6)); if (check(dob) === fixDigits(l2[6])) out.dob = yymmdd(dob, false);
    out.gender = { M: "male", F: "female" }[l2[7]];
    const exp = fixDigits(l2.slice(8, 14)); if (check(exp) === fixDigits(l2[14])) out.expiry = yymmdd(exp, true);
    out.nationality = COUNTRY3[letters(l2.slice(15, 18))] || undefined;
    // the name: Omani cards write it in its usual order (given names, then the family name); others put the surname first
    if (l3.replace(/</g, "")) {
      if (letters(l1.slice(2, 5)) === "OMN") out.name_en = words(l3);
      else { const [sur, given = ""] = l3.split("<<"); out.name_en = words(`${given}<${sur}`); }
      // the line holds 30 letters: a long name fills it to the end and loses its last letters ("AL<JABR" for Al Jabri)
      const raw = L[i + 2] || ""; if (raw.length >= 30 && raw[29] !== "<") out.name_cut = true;
    }
  }
  return clean(out);
}

// ---------- printed front of the Omani civil ID ----------
const dmyIso = (s) => { const m = /(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/.exec(s); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null; };
function after(text, label) {
  const m = new RegExp(label + "[^\\n\\d]{0,25}([^\\n]*)", "i").exec(text);
  return m ? m[1] : "";
}
export function parseFront(text) {
  const out = {};
  const civil = /civil\s*(?:no|number|n0)\.?\s*[:\-]?\s*(\d[\d\s]{6,10}\d)/i.exec(text);
  if (civil) out.civil_id = civil[1].replace(/\s/g, "");
  out.expiry = dmyIso(after(text, "expiry\\s*date")) || dmyIso(after(text, "date\\s*of\\s*expiry")) || dmyIso(after(text, "valid\\s*(?:until|till|to)"))
    || dmyIso(after(text, "exp(?:iry|\\.)?\\s*(?:date)?")) || undefined;
  out.dob = dmyIso(after(text, "date\\s*of\\s*birth")) || dmyIso(after(text, "birth\\s*date")) || undefined;
  const sex = /\bsex\b[^\n]{0,6}\b([MF])\b/i.exec(text) || /\b(male|female)\b/i.exec(text);
  if (sex) out.gender = /^f/i.test(sex[1]) ? "female" : "male";
  if (/sultanate\s+of\s+oman/i.test(text) && /civil/i.test(text)) out.kind = "id";
  return clean(out);
}

// ---------- the Arabic name printed on the front ----------
const AR_WORD = /^[\u0621-\u064A]{2,}$/;
const NOT_NAME = /سلطنة|عمان|البطاقة|الشخصية|المدنية|شرطة|السلطانية|المديرية|جواز|السفر|الجنسية|تاريخ|الرقم|رقم|الميلاد|الانتهاء|الإصدار|الجنس|ذكر|أنثى/;
const LABEL = /(.*?)(?:^|\s|:)ال\s?[اإأآ]\s?س\s?م(?=\s|:|：|$)\s*[:：.\-]?\s*(.*)$/; // الاسم / الإسم / الأسم, as printed or as read
const nameWords = (x) => String(x || "").replace(/[^\u0621-\u064A\s]/g, " ").split(/\s+/).filter(Boolean);
const nameLike = (ws) => ws.length > 0 && ws.every((w) => AR_WORD.test(w)) && !ws.some((w) => NOT_NAME.test(w));
/** The Arabic name next to the "الاسم" label. A card's layout often makes the reader break the name over lines around the
 * label ("شيخة إسحاق عبدالله" / "الاسم الحوقاني"), so the pieces around it are joined in the likely ways and, when the
 * English name is known, the join that matches it (same number of parts, same first name) is taken. */
export function parseArabicName(text, nameEn = null) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.replace(/[\u064B-\u0652\u0640]/g, "").trim()).filter((l) => /[\u0621-\u064A]/.test(l)); // drop vowel marks, tatweel and junk lines
  const parts = nameEn ? nameParts(nameEn) : [];
  const first = parts[0] && parts[0].ar ? arKey(parts[0].ar) : null, last = parts.length && parts.at(-1).ar ? arKey(parts.at(-1).ar) : null;
  let best = null;
  const consider = (ws, base) => {
    if (ws.length < 2 || ws.length > 7 || !nameLike(ws)) return;
    let score = base;
    if (parts.length) score += (ws.length === parts.length ? 3 : 0) + (first && arKey(ws[0]) === first ? 3 : 0) + (last && arKey(ws.at(-1)) === last ? 1 : 0);
    if (!best || score > best.score) best = { ws, score };
  };
  for (let i = 0; i < lines.length; i++) {
    const m = LABEL.exec(lines[i]);
    if (!m) continue;
    const after = nameWords(m[2]), before = nameWords(m[1]);
    const prev = i > 0 && nameLike(nameWords(lines[i - 1])) ? nameWords(lines[i - 1]) : [];
    const next = []; // the name-like lines that follow, up to the next label
    for (let k = i + 1; k < Math.min(lines.length, i + 4); k++) { const ws = nameWords(lines[k]); if (!nameLike(ws)) break; next.push(ws); }
    // on its own line with the label first: the plainest reading, preferred when nothing else decides
    consider(after, 2); consider(before, 1);
    for (let k = 1; k <= next.length; k++) { const n = next.slice(0, k).flat(); consider([...after, ...n], k === 1 && !after.length ? 2 : 0); }
    if (prev.length) { consider([...prev, ...after], 0); consider([...prev, ...before, ...after], 0); }
  }
  if (!best) return undefined;
  if (parts.length && best.score < 3) return undefined; // with the English name to check against, a join that doesn't match it isn't trusted
  return best.ws.join(" ");
}

function clean(o) { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === "") delete o[k]; return o; }
const ok = (d) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));

/** The name printed in full on the card (the "<<<" line may cut it): a line of plain words that starts with the same letters. */
export function fullPrintedName(text, short) {
  const key = (x) => String(x).toUpperCase().replace(/[^A-Z]/g, "");
  const k = key(short); if (k.length < 6) return null;
  let best = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (line.includes("<")) continue;
    const ws = line.replace(/^\s*(?:full\s*)?name\s*[:\-.]?\s*/i, "").replace(/[^A-Za-z' -]/g, " ").split(/\s+/).filter(Boolean);
    const cand = ws.join(" ");
    if (ws.length >= 2 && ws.length <= 8 && key(cand).startsWith(k) && key(cand).length > k.length && (!best || cand.length > best.length)) best = cand;
  }
  return best ? best.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a, b) => a + b.toUpperCase()) : null; // "'abdallah Al-hoqani" → "'Abdallah Al-Hoqani"
}
/** The Arabic name: after "الاسم", or else the line whose words match the English name spelled in Arabic. */
export function arabicNameFrom(text, nameEn) {
  const labelled = parseArabicName(text, nameEn);
  if (labelled) return labelled;
  const parts = nameParts(nameEn); if (parts.length < 2 || !parts[0].ar) return undefined;
  const first = arKey(parts[0].ar), last = parts.at(-1).ar ? arKey(parts.at(-1).ar) : null; // the family name may not be in the list
  for (const line of String(text || "").split(/\r?\n/)) {
    const ws = line.replace(/[\u064B-\u0652\u0640]/g, "").replace(/[^\u0621-\u064A\s]/g, " ").split(/\s+/).filter(Boolean);
    if (ws.length >= 2 && ws.length <= 7 && arKey(ws[0]) === first && (!last || arKey(ws.at(-1)) === last) && !ws.some((w) => NOT_NAME.test(w))) return ws.join(" ");
  }
  return undefined;
}

/** Read a photo; returns {found:{…}, text} — found keys: civil_id, dob, gender, nationality, name_en, name_ar, expiry, passport_no, kind, verified[].
 * arabic=true also reads the Arabic text for the name (an ID card or passport; a second, slower pass). */
export async function readDocument(buffer, { arabic = false } = {}) {
  const text = await ocr(buffer);
  let mrz = parseMrz(text);
  // no usable "<<<" lines on the first pass: read again with only the letters those lines use
  if (!mrz.dob && !mrz.expiry) { const t2 = await ocr(buffer, { mrz: true }); const m2 = parseMrz(t2); if (Object.keys(m2).length > Object.keys(mrz).length) mrz = m2; }
  const front = parseFront(text);
  fixName(mrz, text);
  if (arabic) {
    try {
      // the front of the card: the usual reading, then — if the name wasn't found — one that looks for scattered text (card layouts)
      let ar = arabicNameFrom(await ocr(buffer, { lang: "ara" }), mrz.name_en);
      if (!ar) ar = arabicNameFrom(await ocr(buffer, { lang: "ara", sparse: true }), mrz.name_en);
      if (ar) front.name_ar = ar;
    } catch (e) { console.error(`ID reader (Arabic): ${e.message}`); }
  }
  const found = { ...front, ...mrz }; // MRZ wins: it is check-digit verified
  // which values the card's own check digits confirm (the rest need a closer look)
  found.verified = Object.keys(mrz).filter((k) => k !== "kind");
  for (const k of ["dob", "expiry"]) if (!ok(found[k])) delete found[k];
  return { found, text };
}

/** A name the "<<<" line cut short: the full one printed on the card, or the one known family name it starts. */
function fixName(mrz, text) {
  if (!mrz.name_en) return;
  const full = fullPrintedName(text, mrz.name_en);
  if (full) mrz.name_en = full;
  else if (mrz.name_cut) {
    const ws = mrz.name_en.split(" "), done = completeFamily(ws.at(-1));
    if (done) mrz.name_en = [...ws.slice(0, -1), done[0].toUpperCase() + done.slice(1)].join(" ");
  }
  delete mrz.name_cut;
}

const run = promisify(execFile);
/** Read a PDF scan (poppler's pdftotext / pdftoppm, when installed): first its text layer — phone scans usually carry one,
 * with the "<<<" lines — then, if that gave no dates, its first pages as pictures. Returns like readDocument, or null. */
export async function readPdf(buffer, readImage = readDocument, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nama-pdf-"));
  try {
    const file = path.join(dir, "doc.pdf");
    fs.writeFileSync(file, buffer);
    let text = "";
    try { text = (await run("pdftotext", ["-f", "1", "-l", "3", file, "-"], { timeout: 20000, maxBuffer: 4 << 20 })).stdout; }
    catch (e) { if (e.code === "ENOENT") return null; } // no poppler on this server: nothing to read with
    const mrz = parseMrz(text), front = parseFront(text);
    fixName(mrz, text);
    const ar = arabicNameFrom(text, mrz.name_en); if (ar) front.name_ar = ar;
    if (mrz.expiry || mrz.dob || front.expiry) {
      const found = { ...front, ...mrz };
      found.verified = Object.keys(mrz).filter((k) => k !== "kind");
      return { found, text };
    }
    // a scan without a text layer: read its pages as pictures
    try { await run("pdftoppm", ["-png", "-r", "200", "-f", "1", "-l", "2", file, path.join(dir, "p")], { timeout: 60000 }); } catch { return { found: {}, text }; }
    let best = { found: {}, text }, nameAr;
    for (const img of fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort()) {
      const r = await readImage(fs.readFileSync(path.join(dir, img)), opts);
      nameAr ||= r.found.name_ar; // the front (Arabic name) and the back ("<<<" lines) may be different pages
      if (Object.keys(r.found).length > Object.keys(best.found).length) best = r;
      if (r.found.expiry && (nameAr || !opts.arabic)) break;
    }
    if (nameAr && !best.found.name_ar) best = { ...best, found: { ...best.found, name_ar: nameAr } };
    return best;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
