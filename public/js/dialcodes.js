// Every country's international dialling code (ITU-T E.164), bundled — no outside service. Names come from Intl in
// Arabic or English. Shared by the browser and the server. Countries that share a code (+1, +7, +44, …) are one entry:
// the first country's flag, all of their names.
// Order of the list: Oman, the GCC, the countries most Nama staff and clients come from, then the rest A–Z.
export const DIAL = {
  AF: "93", AL: "355", DZ: "213", AS: "1684", AD: "376", AO: "244", AI: "1264", AG: "1268", AR: "54", AM: "374", AW: "297", AU: "61", AT: "43", AZ: "994",
  BS: "1242", BH: "973", BD: "880", BB: "1246", BY: "375", BE: "32", BZ: "501", BJ: "229", BM: "1441", BT: "975", BO: "591", BQ: "599", BA: "387", BW: "267", BR: "55",
  IO: "246", VG: "1284", BN: "673", BG: "359", BF: "226", BI: "257", KH: "855", CM: "237", CA: "1", CV: "238", KY: "1345", CF: "236", TD: "235", CL: "56", CN: "86",
  CO: "57", KM: "269", CG: "242", CD: "243", CK: "682", CR: "506", CI: "225", HR: "385", CU: "53", CW: "599", CY: "357", CZ: "420", DK: "45", DJ: "253", DM: "1767",
  DO: "1809", EC: "593", EG: "20", SV: "503", GQ: "240", ER: "291", EE: "372", SZ: "268", ET: "251", FK: "500", FO: "298", FJ: "679", FI: "358", FR: "33", GF: "594",
  PF: "689", GA: "241", GM: "220", GE: "995", DE: "49", GH: "233", GI: "350", GR: "30", GL: "299", GD: "1473", GP: "590", GU: "1671", GT: "502", GG: "44", GN: "224",
  GW: "245", GY: "592", HT: "509", HN: "504", HK: "852", HU: "36", IS: "354", IN: "91", ID: "62", IR: "98", IQ: "964", IE: "353", IM: "44", IL: "972", IT: "39",
  JM: "1876", JP: "81", JE: "44", JO: "962", KZ: "7", KE: "254", KI: "686", XK: "383", KW: "965", KG: "996", LA: "856", LV: "371", LB: "961", LS: "266", LR: "231",
  LY: "218", LI: "423", LT: "370", LU: "352", MO: "853", MG: "261", MW: "265", MY: "60", MV: "960", ML: "223", MT: "356", MH: "692", MQ: "596", MR: "222", MU: "230",
  YT: "262", MX: "52", FM: "691", MD: "373", MC: "377", MN: "976", ME: "382", MS: "1664", MA: "212", MZ: "258", MM: "95", NA: "264", NR: "674", NP: "977", NL: "31",
  NC: "687", NZ: "64", NI: "505", NE: "227", NG: "234", NU: "683", NF: "672", KP: "850", MK: "389", MP: "1670", NO: "47", OM: "968", PK: "92", PW: "680", PS: "970",
  PA: "507", PG: "675", PY: "595", PE: "51", PH: "63", PL: "48", PT: "351", PR: "1787", QA: "974", RE: "262", RO: "40", RU: "7", RW: "250", BL: "590", SH: "290",
  KN: "1869", LC: "1758", MF: "590", PM: "508", VC: "1784", WS: "685", SM: "378", ST: "239", SA: "966", SN: "221", RS: "381", SC: "248", SL: "232", SG: "65",
  SX: "1721", SK: "421", SI: "386", SB: "677", SO: "252", ZA: "27", KR: "82", SS: "211", ES: "34", LK: "94", SD: "249", SR: "597", SE: "46", CH: "41", SY: "963",
  TW: "886", TJ: "992", TZ: "255", TH: "66", TL: "670", TG: "228", TK: "690", TO: "676", TT: "1868", TN: "216", TR: "90", TM: "993", TC: "1649", TV: "688", UG: "256",
  UA: "380", AE: "971", GB: "44", US: "1", UY: "598", VI: "1340", UZ: "998", VU: "678", VA: "379", VE: "58", VN: "84", WF: "681", EH: "212", YE: "967", ZM: "260", ZW: "263",
  SJ: "47", AX: "358", CX: "61", CC: "61",
};
export const TOP = ["OM"], GCC = ["AE", "SA", "QA", "KW", "BH"];
export const COMMON = ["IN", "PK", "BD", "EG", "PH", "LK", "NP", "JO", "SD", "YE", "SY", "TN"];
// the one country shown for a shared code (the others are named with it)
const MAIN = { 1: "US", 7: "RU", 44: "GB", 47: "NO", 61: "AU", 212: "MA", 262: "RE", 358: "FI", 590: "GP", 599: "CW" };

/** How many digits a number has after the country code: [min, max]. Oman 8; the countries we know well; else 6–15. */
export const LENGTH = { 968: [8, 8], 971: [8, 9], 966: [8, 9], 974: [8, 8], 965: [8, 8], 973: [8, 8], 91: [10, 10], 92: [9, 10], 880: [9, 10], 20: [9, 10],
  63: [9, 10], 94: [9, 9], 977: [8, 10], 962: [8, 9], 249: [9, 9], 967: [8, 9], 963: [8, 9], 216: [8, 8] };
export const lengthOf = (code) => LENGTH[code] || [6, 15];

let names = {};
const nameOf = (iso, lang) => {
  try { names[lang] ||= new Intl.DisplayNames([lang], { type: "region" }); return names[lang].of(iso) || iso; } catch { return iso; }
};
export const flag = (iso) => String.fromCodePoint(...[...iso].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));

/** The list: [{code, iso, isos, en, ar}] in the order above; countries sharing a code are one entry. */
export function dialList() {
  const byCode = new Map();
  for (const [iso, code] of Object.entries(DIAL)) { if (!byCode.has(code)) byCode.set(code, []); byCode.get(code).push(iso); }
  const entry = (code) => {
    const isos = byCode.get(code), main = MAIN[code] && isos.includes(MAIN[code]) ? MAIN[code] : isos[0];
    const order = [main, ...isos.filter((x) => x !== main)];
    return { code, iso: main, isos: order, en: order.map((i) => nameOf(i, "en")).join(" / "), ar: order.map((i) => nameOf(i, "ar")).join(" / ") };
  };
  const first = [...TOP, ...GCC, ...COMMON].map((i) => DIAL[i]);
  const rest = [...byCode.keys()].filter((c) => !first.includes(c)).map(entry).sort((a, b) => a.en.localeCompare(b.en, "en"));
  return [...first.map(entry), ...rest];
}
export const CODES = new Set(Object.values(DIAL));

/** A phone number as the user typed or pasted it → { e164: "+96899123456", code: "968", number: "99123456" } or { error }.
 * Accepts +968…, 00968…, 968 then 8 digits, a local 8-digit Omani number (the default code), spaces, dashes, Arabic digits,
 * a leading 0 after the code. `code` is the country picked next to the field (Oman when none). */
export function parsePhone(value, code = "968") {
  let s = String(value ?? "").trim().replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
  if (!s) return { empty: true };
  if (/[^\d\s+\-().]/.test(s)) return { error: "letters" };
  let d = s.replace(/[^\d+]/g, "");
  let c = String(code || "968").replace(/\D/g, "");
  if (d.startsWith("+") || d.startsWith("00")) {
    const x = d.replace(/^\+|^00/, "");
    let found = null;
    for (let k = 4; k >= 1; k--) if (CODES.has(x.slice(0, k)) && x.length > k) { found = x.slice(0, k); break; }
    if (!found) return { error: "code" };
    c = found; d = x.slice(found.length);
  } else if (c && d.startsWith(c) && d.length > c.length + 5 && d.length - c.length >= lengthOf(c)[0] && d.length > lengthOf(c)[1]) d = d.slice(c.length); // pasted with the code, no +
  if (c !== "39") d = d.replace(/^0+/, ""); // a leading 0 after the code (not Italy, where it is part of the number)
  const [min, max] = lengthOf(c);
  if (d.length < min || d.length > max) return { error: "length", code: c, number: d, min, max };
  return { e164: `+${c}${d}`, code: c, number: d };
}
/** "+96899123456" → { code: "968", number: "99123456" } (or null when it isn't a full number). */
export function splitPhone(e164) {
  const m = /^\+(\d{6,18})$/.exec(String(e164 || "").trim());
  if (!m) return null;
  for (let k = 4; k >= 1; k--) if (CODES.has(m[1].slice(0, k))) return { code: m[1].slice(0, k), number: m[1].slice(k) };
  return null;
}
/** The last 8 digits, to match an older record saved without the code. */
export const last8 = (v) => String(v || "").replace(/\D/g, "").slice(-8);
