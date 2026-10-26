// Nationality is stored as an ISO 3166 country code ("OM"); names come from the browser/Node in Arabic or English.
// Shared by the browser and the server (server imports this file directly).
export const COUNTRIES = ("OM AE SA KW QA BH YE EG JO SY LB IQ PS SD LY TN DZ MA MR SO DJ KM IN PK BD LK NP PH ID MY AF IR TR " +
  "GB US CA AU NZ IE FR DE IT ES PT NL BE CH AT SE NO DK FI PL CZ SK HU RO BG GR CY MT HR SI RS BA ME MK AL XK UA BY RU MD " +
  "LT LV EE IS LU LI MC AD SM VA GE AM AZ KZ UZ TM KG TJ MN CN JP KR KP TW HK MO VN TH KH LA MM SG BN TL BT MV " +
  "NG GH KE ET ER TZ UG RW BI ZA ZW ZM MW MZ AO NA BW LS SZ MG MU SC CM CF TD NE ML BF SN GM GN GW SL LR CI TG BJ CV ST GQ GA CG CD SS " +
  "MX GT BZ SV HN NI CR PA CU JM HT DO BS BB TT GD LC VC DM AG KN BR AR CL PE CO VE EC BO PY UY GY SR FJ PG SB VU WS TO KI TV NR PW FM MH").split(" ");

const GULF = ["OM", "AE", "SA", "KW", "QA", "BH"];
const display = {};
export function countryName(code, lang = "en") {
  if (!code) return "";
  if (!/^[A-Z]{2}$/.test(code)) return code; // older free-text value
  try { display[lang] ||= new Intl.DisplayNames([lang === "ar" ? "ar" : "en"], { type: "region" }); return display[lang].of(code) || code; } catch { return code; }
}
/** [code, name] pairs: Gulf first, then the rest A–Z in the given language. */
export function countryOptions(lang = "en") {
  const coll = new Intl.Collator(lang === "ar" ? "ar" : "en");
  const rest = COUNTRIES.filter((c) => !GULF.includes(c)).map((c) => [c, countryName(c, lang)]).sort((a, b) => coll.compare(a[1], b[1]));
  return [...GULF.map((c) => [c, countryName(c, lang)]), ...rest];
}

// common ways nationality is written in staff sheets
const DEMONYMS = { omani: "OM", "عماني": "OM", "عمانية": "OM", emirati: "AE", saudi: "SA", kuwaiti: "KW", qatari: "QA", bahraini: "BH", yemeni: "YE",
  egyptian: "EG", "مصري": "EG", jordanian: "JO", "أردني": "JO", syrian: "SY", "سوري": "SY", lebanese: "LB", iraqi: "IQ", palestinian: "PS", sudanese: "SD", "سوداني": "SD",
  moroccan: "MA", tunisian: "TN", indian: "IN", "هندي": "IN", pakistani: "PK", "باكستاني": "PK", bangladeshi: "BD", "بنغالي": "BD", "sri lankan": "LK", nepali: "NP", nepalese: "NP",
  filipino: "PH", filipina: "PH", "فلبيني": "PH", indonesian: "ID", british: "GB", american: "US", canadian: "CA", australian: "AU", french: "FR", german: "DE",
  turkish: "TR", iranian: "IR", kenyan: "KE", ugandan: "UG", ethiopian: "ET", nigerian: "NG", "south african": "ZA" };
/** Free text ("Omani", "عمان", "India", "IN") → country code; unknown text is returned unchanged. */
export function toCountryCode(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (/^[A-Za-z]{2}$/.test(v) && COUNTRIES.includes(v.toUpperCase())) return v.toUpperCase();
  const k = v.toLowerCase().replace(/\s+/g, " ");
  if (DEMONYMS[k]) return DEMONYMS[k];
  for (const lang of ["en", "ar"]) for (const c of COUNTRIES) if (countryName(c, lang).toLowerCase() === k) return c;
  return v;
}
export const isOmani = (nat) => nat === "OM" || /oman|عمان|عماني/i.test(String(nat || ""));
