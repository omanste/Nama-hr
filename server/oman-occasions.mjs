/* Oman's national occasions (fixed dates) and religious occasions (Hijri dates, converted with the Umm al-Qura calendar).
 * Religious dates are expected dates: Oman confirms them by moon sighting, so one may move by a day. Names: "English | عربي". */

export const NATIONAL = [
  ["01-11", "Accession Day of His Majesty Sultan Haitham | ذكرى تولي جلالة السلطان هيثم بن طارق مقاليد الحكم"],
  ["02-24", "Omani Teacher's Day | يوم المعلم العماني"],
  ["07-23", "Renaissance Day | يوم النهضة المباركة"],
  ["10-17", "Omani Women's Day | يوم المرأة العمانية"],
  ["10-26", "Omani Youth Day | يوم الشباب العماني"],
  ["11-18", "National Day | العيد الوطني"],
];
// [Hijri month, day, name]
export const RELIGIOUS = [
  [1, 1, "Islamic New Year (expected) | رأس السنة الهجرية (متوقع)"],
  [3, 12, "Prophet's Birthday (expected) | المولد النبوي الشريف (متوقع)"],
  [7, 27, "Isra and Mi'raj (expected) | الإسراء والمعراج (متوقع)"],
  [9, 1, "Start of Ramadan (expected) | بداية شهر رمضان (متوقع)"],
  [10, 1, "Eid al-Fitr (expected) | عيد الفطر (متوقع)"],
  [12, 9, "Day of Arafah (expected) | يوم عرفة (متوقع)"],
  [12, 10, "Eid al-Adha (expected) | عيد الأضحى (متوقع)"],
];

const hijri = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "numeric", timeZone: "UTC" });
/** Every national and religious occasion falling in a Gregorian year: [{kind, date, name}], by date. */
export function omanOccasions(year) {
  const out = NATIONAL.map(([md, name]) => ({ kind: "national", date: `${year}-${md}`, name }));
  for (let d = new Date(Date.UTC(year, 0, 1)); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
    const p = Object.fromEntries(hijri.formatToParts(d).map((x) => [x.type, x.value]));
    for (const [m, day, name] of RELIGIOUS) if (Number(p.month) === m && Number(p.day) === day) out.push({ kind: "religious", date: d.toISOString().slice(0, 10), name });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Official public holidays (days off), following Royal Decree 88/2022: [Hijri month, first day, last day, name].
// Eid al-Fitr runs 29 Ramadan – 3 Shawwal and Eid al-Adha 9–13 Dhu al-Hijjah; the government confirms the exact days each year.
const RELIGIOUS_HOLIDAYS = [
  [1, 1, 1, "Hijri New Year holiday (expected) | عطلة رأس السنة الهجرية (متوقعة)"],
  [3, 12, 12, "Prophet's Birthday holiday (expected) | عطلة المولد النبوي الشريف (متوقعة)"],
  [7, 27, 27, "Isra and Mi'raj holiday (expected) | عطلة الإسراء والمعراج (متوقعة)"],
  [9, 29, 30, "Eid al-Fitr holiday (expected) | عطلة عيد الفطر (متوقعة)"],
  [10, 1, 3, "Eid al-Fitr holiday (expected) | عطلة عيد الفطر (متوقعة)"],
  [12, 9, 13, "Eid al-Adha holiday (expected) | عطلة عيد الأضحى (متوقعة)"],
];
const FIXED_HOLIDAYS = [
  ["01-11", "Accession Day holiday | عطلة ذكرى تولي جلالة السلطان مقاليد الحكم"],
  ["11-18", "National Day holiday (expected) | عطلة العيد الوطني (متوقعة)"],
  ["11-19", "National Day holiday (expected) | عطلة العيد الوطني (متوقعة)"],
];
/** The expected official holidays in a Gregorian year: [{date, name}], by date. */
export function omanHolidays(year) {
  const out = FIXED_HOLIDAYS.map(([md, name]) => ({ date: `${year}-${md}`, name }));
  for (let d = new Date(Date.UTC(year, 0, 1)); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
    const p = Object.fromEntries(hijri.formatToParts(d).map((x) => [x.type, x.value]));
    for (const [m, a, b, name] of RELIGIOUS_HOLIDAYS) if (Number(p.month) === m && Number(p.day) >= a && Number(p.day) <= b) out.push({ date: d.toISOString().slice(0, 10), name });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
