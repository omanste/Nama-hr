// Places for addresses: the wilayats of Oman by governorate (permanent address) and areas of Muscat (current address).
// Stored by English name, shown in the user's language; a place not on the list is kept as typed.
import { getLang } from "./i18n.js";

export const GOVERNORATES = [
  ["Muscat", "مسقط", [["Muscat", "مسقط"], ["Muttrah", "مطرح"], ["Bawshar", "بوشر"], ["As Seeb", "السيب"], ["Al Amerat", "العامرات"], ["Qurayyat", "قريات"]]],
  ["Dhofar", "ظفار", [["Salalah", "صلالة"], ["Taqah", "طاقة"], ["Mirbat", "مرباط"], ["Rakhyut", "رخيوت"], ["Thumrait", "ثمريت"], ["Dhalkut", "ضلكوت"], ["Al Mazyunah", "المزيونة"], ["Muqshin", "مقشن"], ["Shalim and Al Hallaniyat Islands", "شليم وجزر الحلانيات"], ["Sadah", "سدح"]]],
  ["Musandam", "مسندم", [["Khasab", "خصب"], ["Bukha", "بخا"], ["Daba", "دبا"], ["Madha", "مدحاء"]]],
  ["Al Buraimi", "البريمي", [["Al Buraimi", "البريمي"], ["Mahdah", "محضة"], ["As Sunaynah", "السنينة"]]],
  ["Ad Dakhiliyah", "الداخلية", [["Nizwa", "نزوى"], ["Bahla", "بهلاء"], ["Manah", "منح"], ["Al Hamra", "الحمراء"], ["Adam", "أدم"], ["Izki", "إزكي"], ["Samail", "سمائل"], ["Bidbid", "بدبد"], ["Al Jabal Al Akhdar", "الجبل الأخضر"]]],
  ["Al Batinah North", "شمال الباطنة", [["Sohar", "صحار"], ["Shinas", "شناص"], ["Liwa", "لوى"], ["Saham", "صحم"], ["Al Khaburah", "الخابورة"], ["As Suwayq", "السويق"]]],
  ["Al Batinah South", "جنوب الباطنة", [["Ar Rustaq", "الرستاق"], ["Al Awabi", "العوابي"], ["Nakhal", "نخل"], ["Wadi Al Maawil", "وادي المعاول"], ["Barka", "بركاء"], ["Al Musannah", "المصنعة"]]],
  ["Ash Sharqiyah North", "شمال الشرقية", [["Ibra", "إبراء"], ["Al Mudhaibi", "المضيبي"], ["Bidiyah", "بدية"], ["Wadi Bani Khalid", "وادي بني خالد"], ["Dima Wa At Taiyyin", "دماء والطائيين"], ["Al Qabil", "القابل"]]],
  ["Ash Sharqiyah South", "جنوب الشرقية", [["Sur", "صور"], ["Al Kamil Wal Wafi", "الكامل والوافي"], ["Jaalan Bani Bu Hassan", "جعلان بني بو حسن"], ["Jaalan Bani Bu Ali", "جعلان بني بو علي"], ["Masirah", "مصيرة"]]],
  ["Ad Dhahirah", "الظاهرة", [["Ibri", "عبري"], ["Yanqul", "ينقل"], ["Dhank", "ضنك"]]],
  ["Al Wusta", "الوسطى", [["Haima", "هيماء"], ["Duqm", "الدقم"], ["Mahout", "محوت"], ["Al Jazer", "الجازر"]]],
];

// Areas of Muscat Governorate, grouped by wilayat
export const MUSCAT_GROUPS = [
  ["Muscat", "مسقط", [["Old Muscat", "مسقط القديمة"], ["Al Bustan", "البستان"], ["Sidab", "سداب"], ["Qantab", "قنتب"], ["Al Jissah", "الجصة"], ["Yiti", "يتي"],
    ["Al Khairan", "الخيران"], ["Haramel", "حرامل"], ["Al Sifah", "السيفة"]]],
  ["Muttrah", "مطرح", [["Muttrah", "مطرح"], ["Ruwi", "روي"], ["Al Wadi Al Kabir", "الوادي الكبير"], ["Darsait", "دارسيت"], ["Al Hamriyah", "الحمرية"],
    ["Al Wattayah", "الوطية"], ["Al Qurum", "القرم"], ["Mina Al Fahal", "ميناء الفحل"], ["Riyam", "ريام"], ["Kalbouh", "كلبوه"], ["Central Business District (CBD)", "منطقة الأعمال المركزية"]]],
  ["Bawshar", "بوشر", [["Al Khuwair", "الخوير"], ["Al Ghubrah", "الغبرة"], ["Al Azaiba", "العذيبة"], ["Bawshar", "بوشر"], ["Bousher Heights", "مرتفعات بوشر"],
    ["Al Ansab", "الأنصب"], ["Ghala", "غلا"], ["Madinat Al Sultan Qaboos", "مدينة السلطان قابوس"], ["Shatti Al Qurum", "شاطئ القرم"], ["Al Sarooj", "السروج"],
    ["Misfah", "المسفاة"], ["Muscat Hills", "تلال مسقط"]]],
  ["As Seeb", "السيب", [["Seeb", "السيب"], ["Al Seeb Souq", "سوق السيب"], ["Al Mawaleh", "الموالح"], ["Al Khoudh", "الخوض"], ["Al Hail", "الحيل"],
    ["Al Maabilah", "المعبيلة"], ["Al Mouj", "الموج"], ["Airport Heights", "مرتفعات المطار"], ["Al Rusayl", "الرسيل"], ["Halban", "حلبان"],
    ["Al Jifnain", "الجفنين"], ["Sur Al Hadid", "سور الحديد"], ["Wadi Al Lawami", "وادي اللوامي"], ["Al Khoudh Old", "الخوض القديمة"], ["Madinat Al Hail", "مدينة الحيل"]]],
  ["Al Amerat", "العامرات", [["Al Amerat", "العامرات"], ["Al Mahaj", "المحج"], ["Wadi Adai", "وادي عدي"], ["Madinat Al Nahdha", "مدينة النهضة"], ["Al Hajir", "الحاجر"]]],
  ["Qurayyat", "قريات", [["Qurayyat", "قريات"], ["Fins", "فنس"], ["Bimmah", "بمة"], ["Hayl Al Ghaf", "حيل الغاف"], ["Dhabab", "ضباب"]]],
];
export const MUSCAT_AREAS = MUSCAT_GROUPS.flatMap(([, , list]) => list);


const ALL_WILAYATS = GOVERNORATES.flatMap(([gEn, gAr, ws]) => ws.map(([en, ar]) => [en, ar, gEn, gAr]));
const ar = () => getLang() === "ar";
/** "Nizwa — Ad Dakhiliyah" in the current language. */
export const wilayatName = (en) => { const w = ALL_WILAYATS.find((x) => x[0] === en); return w ? (ar() ? `${w[1]} — ${w[3]}` : `${w[0]} — ${w[2]}`) : en || ""; };
export const areaName = (en) => { const a = MUSCAT_AREAS.find((x) => x[0] === en); return a ? (ar() ? a[1] : a[0]) : en || ""; };
export const isWilayat = (en) => ALL_WILAYATS.some((x) => x[0] === en);
export const isArea = (en) => MUSCAT_AREAS.some((x) => x[0] === en);
