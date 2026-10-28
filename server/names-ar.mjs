/* English → Arabic for names written on Omani ID cards and passports, used only when the Arabic name couldn't be read from
 * the card itself. Whole names only: every word has to be known, or nothing is returned (a guess is worse than a blank). */

// given names (and words used inside names)
const GIVEN = {
  mohammed: "محمد", mohamed: "محمد", muhammad: "محمد", mohammad: "محمد", muhammed: "محمد", ahmed: "أحمد", ahmad: "أحمد", mahmoud: "محمود", mahmood: "محمود",
  ali: "علي", omar: "عمر", umar: "عمر", othman: "عثمان", uthman: "عثمان", khalid: "خالد", khaled: "خالد", khalfan: "خلفان", khamis: "خميس", khamees: "خميس",
  salim: "سالم", saleem: "سليم", salem: "سالم", saleh: "صالح", salih: "صالح", said: "سعيد", saeed: "سعيد", saif: "سيف", sultan: "سلطان", suleiman: "سليمان",
  sulaiman: "سليمان", sulaiyam: "سليم", hamad: "حمد", hamed: "حامد", hamid: "حامد", hamood: "حمود", hamoud: "حمود", humaid: "حميد", hilal: "هلال", hamdan: "حمدان",
  hassan: "حسن", hasan: "حسن", hussain: "حسين", hussein: "حسين", husain: "حسين", ibrahim: "إبراهيم", ismail: "إسماعيل", issa: "عيسى", isa: "عيسى", musa: "موسى",
  yousuf: "يوسف", yousef: "يوسف", yusuf: "يوسف", younis: "يونس", yunus: "يونس", yaqoob: "يعقوب", yaqub: "يعقوب", yahya: "يحيى", zakariya: "زكريا", zakaria: "زكريا",
  nasser: "ناصر", nasir: "ناصر", naser: "ناصر", mubarak: "مبارك", masoud: "مسعود", masood: "مسعود", mansoor: "منصور", mansour: "منصور", marhoon: "مرهون",
  rashid: "راشد", rashed: "راشد", rasheed: "رشيد", talib: "طالب", tariq: "طارق", tarik: "طارق", haitham: "هيثم", hatim: "حاتم", hatem: "حاتم", badr: "بدر",
  badar: "بدر", bader: "بدر", faisal: "فيصل", fahad: "فهد", fahd: "فهد", majid: "ماجد", majed: "ماجد", mazin: "مازن", mazen: "مازن", marwan: "مروان",
  jamal: "جمال", jamil: "جميل", jameel: "جميل", jaber: "جابر", jabir: "جابر", juma: "جمعة", jumaa: "جمعة", jumah: "جمعة", kamal: "كمال", karim: "كريم", kareem: "كريم",
  abdullah: "عبدالله", abdulla: "عبدالله", abdallah: "عبدالله", abdulaziz: "عبدالعزيز", abdulrahman: "عبدالرحمن", abdulrahim: "عبدالرحيم", abdulkarim: "عبدالكريم",
  abdulhakim: "عبدالحكيم", abdulmajeed: "عبدالمجيد", abdulmajid: "عبدالمجيد", abdulwahab: "عبدالوهاب", abdulsalam: "عبدالسلام", abdulhamid: "عبدالحميد",
  abdulnasser: "عبدالناصر", abdulmalik: "عبدالملك", abdulkhaliq: "عبدالخالق", abdulghani: "عبدالغني", abdulqader: "عبدالقادر", abdulraheem: "عبدالرحيم",
  aziz: "عزيز", rahman: "رحمن", rahim: "رحيم", raheem: "رحيم", hakim: "حكيم", majeed: "مجيد", wahab: "وهاب", salam: "سلام", ghani: "غني", qader: "قادر",
  malik: "مالك", khaliq: "خالق", latif: "لطيف", lateef: "لطيف", jalil: "جليل", nabi: "نبي", amir: "أمير", ameer: "أمير",
  adil: "عادل", adel: "عادل", anwar: "أنور", ayman: "أيمن", aiman: "أيمن", amjad: "أمجد", ammar: "عمار", amer: "عامر", ayoub: "أيوب", azzan: "عزان",
  bashir: "بشير", basim: "باسم", bassam: "بسام", darwish: "درويش", dawood: "داود", dawud: "داود", fadhil: "فاضل", fadil: "فاضل", fahmi: "فهمي", fareed: "فريد",
  farid: "فريد", fawaz: "فواز", ghalib: "غالب", ghassan: "غسان", habib: "حبيب", hadi: "هادي", hafidh: "حافظ", hafiz: "حافظ", hamza: "حمزة", hamzah: "حمزة",
  harib: "حارب", harith: "حارث", hashim: "هاشم", hisham: "هشام", idris: "إدريس", ishaq: "إسحاق", jassim: "جاسم", jasim: "جاسم", kahlan: "كهلان", luqman: "لقمان",
  maher: "ماهر", mahir: "ماهر", malek: "مالك", moosa: "موسى", muadh: "معاذ", muath: "معاذ", mudhar: "مضر", muhanna: "مهنا", muneer: "منير", munir: "منير",
  murad: "مراد", mustafa: "مصطفى", mutasim: "معتصم", nabil: "نبيل", nabeel: "نبيل", naif: "نايف", nawaf: "نواف", nizar: "نزار", nooh: "نوح", nuh: "نوح",
  qais: "قيس", qasim: "قاسم", rabia: "ربيع", rabea: "ربيع", rami: "رامي", riyadh: "رياض", riyad: "رياض", saad: "سعد", sabri: "صبري", sami: "سامي", samir: "سمير",
  sameer: "سمير", shakir: "شاكر", sharif: "شريف", shihab: "شهاب", sufyan: "سفيان", taha: "طه", talal: "طلال", tamim: "تميم", thamer: "ثامر", thani: "ثاني",
  turki: "تركي", waleed: "وليد", walid: "وليد", waheed: "وحيد", yasir: "ياسر", yasser: "ياسر", yaser: "ياسر", zaher: "ظاهر", zahir: "ظاهر", zaid: "زيد", zayed: "زايد",
  zubair: "زبير", ziyad: "زياد", ziad: "زياد", nadhir: "نذير", obaid: "عبيد", ubaid: "عبيد", rashad: "رشاد", suhail: "سهيل", sohail: "سهيل", qahtan: "قحطان", mohsin: "محسن",
  muhsin: "محسن", hilmi: "حلمي", jawad: "جواد", sulayyim: "سليم", hamdoon: "حمدون", maktoom: "مكتوم", rubaya: "ربيع", nassar: "نصار", ghaith: "غيث",
  // women
  fatma: "فاطمة", fatima: "فاطمة", fatimah: "فاطمة", aisha: "عائشة", aysha: "عائشة", ayesha: "عائشة", maryam: "مريم", mariam: "مريم", khadija: "خديجة", khadeeja: "خديجة",
  zainab: "زينب", zeinab: "زينب", zaynab: "زينب", amna: "آمنة", aamna: "آمنة", amina: "أمينة", ameena: "أمينة", asma: "أسماء", asmaa: "أسماء", salma: "سلمى", sara: "سارة",
  sarah: "سارة", noor: "نور", nour: "نور", nora: "نورة", noura: "نورة", nura: "نورة", huda: "هدى", hoda: "هدى", hind: "هند", hanan: "حنان", hana: "هناء", hanaa: "هناء",
  laila: "ليلى", layla: "ليلى", leila: "ليلى", lamya: "لمياء", lamia: "لمياء", latifa: "لطيفة", lateefa: "لطيفة", muna: "منى", mona: "منى", maha: "مها", manal: "منال",
  marwa: "مروة", nawal: "نوال", nawras: "نورس", nibras: "نبراس", najla: "نجلاء", nada: "ندى", nadia: "نادية", nadiya: "نادية", rahma: "رحمة", rawan: "روان",
  razan: "رزان", reem: "ريم", rim: "ريم", rana: "رنا", ruqaya: "رقية", ruqaiya: "رقية", ruqayya: "رقية", safiya: "صفية", safia: "صفية", samira: "سميرة", sameera: "سميرة",
  shaikha: "شيخة", shaima: "شيماء", shaimaa: "شيماء", shamsa: "شمسة", suad: "سعاد", sumaya: "سمية", sumaiya: "سمية", thuraya: "ثريا", wafa: "وفاء", widad: "وداد",
  yusra: "يسرى", zahra: "زهراء", zahraa: "زهراء", zuwaina: "زوينة", zuwena: "زوينة", jawaher: "جواهر", jawahir: "جواهر", jokha: "جوخة", juhaina: "جهينة",
  azza: "عزة", afra: "عفراء", abeer: "عبير", abir: "عبير", ahlam: "أحلام", alia: "علياء", aliya: "علياء", amal: "أمل", arwa: "أروى", asila: "أصيلة", badriya: "بدرية",
  basma: "بسمة", bushra: "بشرى", dalal: "دلال", fakhriya: "فخرية", ghada: "غادة", hajar: "هاجر", halima: "حليمة", hamda: "حمدة", hessa: "حصة", hissa: "حصة",
  ibtisam: "ابتسام", iman: "إيمان", eman: "إيمان", intisar: "انتصار", khawla: "خولة", kholoud: "خلود", khulood: "خلود", lubna: "لبنى", maisa: "ميساء", maysa: "ميساء",
  mahra: "مهرة", maimuna: "ميمونة", moza: "موزة", mouza: "موزة", muneera: "منيرة", munira: "منيرة", nasra: "نصرة", nasreen: "نسرين", nisreen: "نسرين", noof: "نوف",
  nouf: "نوف", raya: "رية", rayya: "رية", rasha: "رشا", rawya: "راوية", rayan: "ريان", sabah: "صباح", sabra: "صبرة", saida: "سعيدة", saeeda: "سعيدة", salha: "صالحة",
  saliha: "صالحة", samya: "سامية", samia: "سامية", shamma: "شما", shatha: "شذى", tahira: "طاهرة", tahani: "تهاني", thuraiya: "ثريا", wadha: "وضحى", wardah: "وردة",
  warda: "وردة", yasmin: "ياسمين", yasmeen: "ياسمين", zuhoor: "زهور", zuhur: "زهور", ghaliya: "غالية", ghalia: "غالية", buthaina: "بثينة", hafsa: "حفصة", mahfoodha: "محفوظة",
  athari: "أثير", atheer: "أثير", jamila: "جميلة", jameela: "جميلة", nusaiba: "نسيبة", rauda: "روضة", rawda: "روضة", raudha: "روضة", shurooq: "شروق", sharifa: "شريفة",
  // joining words
  bin: "بن", ibn: "بن", bint: "بنت", binti: "بنت", abu: "أبو", umm: "أم",
};
// family and tribe names (without "Al"); "Al X" and a last word X become "الX"
const FAMILY = {
  jabri: "جابري", balushi: "بلوشي", busaidi: "بوسعيدي", hinai: "هنائي", harthi: "حارثي", hashmi: "هاشمي", hosni: "حوسني", habsi: "حبسي", hajri: "هاجري",
  hadhrami: "حضرمي", hamdani: "همداني", hakmani: "حكماني", hasani: "حسني", amri: "عامري", ameri: "عامري", abri: "عبري", alawi: "علوي", araimi: "عريمي", azri: "عزري",
  badi: "بادي", bahri: "بحري", battashi: "بطاشي", bulushi: "بلوشي", bustani: "بستاني", farsi: "فارسي", farisi: "فارسي", ghafri: "غافري", ghailani: "غيلاني",
  ghaithi: "غيثي", habsy: "حبسي", hadidi: "حديدي", haddabi: "هدابي", hajji: "حاجي", harrasi: "حراصي", hasni: "حسني", hatmi: "حاتمي", hilali: "هلالي", hinaai: "هنائي",
  jahwari: "جهوري", jardani: "جرداني", jassasi: "جساسي", jamali: "جمالي", junaibi: "جنيبي", kalbani: "كلباني", kalbanee: "كلباني", kathiri: "كثيري", kharusi: "خروصي",
  kharousi: "خروصي", khatri: "خاطري", khanbashi: "خنبشي", khusaibi: "خصيبي", khayari: "خياري", kindi: "كندي", lamki: "لمكي", lawati: "لواتي", maamari: "معمري",
  mamari: "معمري", maashani: "معشني", mahrouqi: "محروقي", mahruqi: "محروقي", maskari: "مسكري", mazrui: "مزروعي", mazroui: "مزروعي", mukhaini: "مخيني", mughairi: "مغيري",
  mughairy: "مغيري", muqbali: "مقبالي", mukhtar: "مختار", mandhari: "منذري", mandhri: "منذري", marhoobi: "مرهوبي", mashaikhi: "مشايخي", maawali: "معولي", mawali: "معولي",
  mawaali: "معولي", najjar: "نجار", nabhani: "نبهاني", naabi: "نعبي", nadabi: "ندابي", naamani: "نعماني", numani: "نعماني", nofli: "نوفلي", naufali: "نوفلي",
  qasmi: "قاسمي", qassabi: "قصابي", qurashi: "قرشي", rashdi: "راشدي", rawahi: "رواحي", riyami: "ريامي", rahbi: "رحبي", ruqaishi: "رقيشي", rumhi: "رمحي", rasbi: "راسبي",
  saadi: "سعدي", sadi: "سعدي", saidi: "سعيدي", salmi: "سالمي", sinani: "سناني", siyabi: "سيابي", shukaili: "شكيلي", shuaili: "شعيلي", shuhi: "شحي", shehhi: "شحي",
  shamsi: "شامسي", shibli: "شبلي", shidi: "شيدي", subhi: "صبحي", sulaimani: "سليماني", sulaimi: "سليمي", suleimani: "سليماني", tobi: "طوبي", toobi: "طوبي", taie: "طائي",
  tai: "طائي", wahaibi: "وهيبي", wahibi: "وهيبي", yahyai: "يحيائي", yaqoobi: "يعقوبي", yaarubi: "يعربي", zadjali: "زدجالي", zadjaly: "زدجالي", zaabi: "زعابي", zaidi: "زيدي",
  zakwani: "ذكواني", dhahli: "ذهلي", dhuhli: "ذهلي", dhahri: "ظاهري", dhaheri: "ظاهري", dhafri: "ظفري", ismaili: "إسماعيلي", ismaily: "إسماعيلي", ghassani: "غساني",
  hosany: "حوسني", kiyumi: "كيومي", kiyoomi: "كيومي", maqbali: "مقبالي", raisi: "رئيسي", raeesi: "رئيسي", sawafi: "صوافي", shanfari: "شنفري", shabibi: "شبيبي",
  hattali: "هطالي", mahrami: "محرمي", mashari: "مشاري", hadabi: "هدابي", fazari: "فزاري", ajmi: "عجمي", kaabi: "كعبي", maani: "معني", mani: "معني",
  hamdi: "حمدي", saqri: "صقري", rubaie: "ربيعي", rubai: "ربيعي", ansari: "أنصاري", ruzaiqi: "رزيقي", busafi: "بوصافي", nuaimi: "نعيمي", naimi: "نعيمي",
  jahdhami: "جهضمي", musalmi: "مسلمي", mushaifri: "مشيفري", mashrafi: "مشرفي", ghunaimi: "غنيمي", afifi: "عفيفي", ghabshi: "غبشي", ghanbouri: "غنبوري",
};
const word = (w) => w.toLowerCase().replace(/[^a-z]/g, "");
/** "Jawaher Salim Khalfan Al Jabri" → "جواهر سالم خلفان الجابري", or null if any word isn't known. */
export function toArabicName(en) {
  const ws = String(en || "").split(/[\s-]+/).map(word).filter(Boolean);
  if (ws.length < 2) return null;
  const out = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if ((w === "al" || w === "el") && ws[i + 1]) { // "Al Jabri" → الجابري, "Al Abri" → العبري
      const n = ws[++i], ar = FAMILY[n] || GIVEN[n];
      if (!ar) return null;
      out.push("ال" + ar); continue;
    }
    if ((w === "abdul" || w === "abd" || w === "abdel") && ws[i + 1]) { // "Abdul Aziz" → عبدالعزيز
      const ar = GIVEN[ws[++i]];
      if (!ar) return null;
      out.push("عبدال" + ar); continue;
    }
    if (w.startsWith("al") && FAMILY[w.slice(2)]) { out.push("ال" + FAMILY[w.slice(2)]); continue; } // "Aljabri"
    const g = GIVEN[w];
    if (g && !(i === ws.length - 1 && FAMILY[w] && i > 0)) { out.push(g); continue; }
    if (FAMILY[w] && i === ws.length - 1 && i > 0) { out.push("ال" + FAMILY[w]); continue; } // a family name written without "Al"
    return null;
  }
  return out.join(" ");
}
/** A family name the card cut short ("Jabr" from "JABRI", the "<<<" line is only 30 letters): the one family name it starts, if just one. */
export function completeFamily(part) {
  const p = word(part);
  if (p.length < 3 || FAMILY[p]) return null;
  const hits = Object.keys(FAMILY).filter((k) => k.startsWith(p));
  const uniq = [...new Set(hits.map((k) => FAMILY[k]))];
  return uniq.length === 1 ? hits.sort((a, b) => a.length - b.length)[0] : null;
}
/** Same name in Arabic, spelled a little differently (أ/إ/آ, ة/ه, ى/ي) — for comparing. */
export const arKey = (s) => String(s || "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
