// Banks in Oman (Central Bank of Oman licensed) — stored by English name, shown in the user's language.
import { getLang } from "./i18n.js";

export const BANKS = [
  ["Bank Muscat", "بنك مسقط"], ["National Bank of Oman", "البنك الوطني العماني"], ["Sohar International", "صحار الدولي"],
  ["Bank Dhofar", "بنك ظفار"], ["Oman Arab Bank", "البنك العربي العماني"], ["Ahli Bank", "البنك الأهلي"],
  ["Bank Nizwa", "بنك نزوى"], ["Alizz Islamic Bank", "بنك العز الإسلامي"], ["HSBC Oman", "إتش إس بي سي عُمان"],
  ["Oman Housing Bank", "بنك الإسكان العماني"], ["Development Bank", "بنك التنمية"], ["Standard Chartered", "ستاندرد تشارترد"],
  ["First Abu Dhabi Bank", "بنك أبوظبي الأول"], ["Qatar National Bank", "بنك قطر الوطني"], ["Habib Bank", "حبيب بنك"],
  ["State Bank of India", "بنك الدولة الهندي"], ["Bank of Baroda", "بنك بارودا"], ["National Bank of Pakistan", "بنك باكستان الوطني"],
  ["Bank Melli Iran", "بنك ملي إيران"], ["Bank Saderat Iran", "بنك صادرات إيران"],
];
/** Name in the current language (a name not on the list is shown as typed). */
export const bankName = (en) => { const b = BANKS.find(([e]) => e === en); return b ? (getLang() === "ar" ? b[1] : b[0]) : en || ""; };
/** Oman IBAN (OM + 2 check digits + 3-digit bank code + 16 characters), checked with mod 97 — same rule as the server. */
export function validIban(raw) {
  const s = String(raw || "").replace(/\s/g, "").toUpperCase();
  if (!/^OM\d{2}\d{3}[0-9A-Z]{16}$/.test(s)) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let m = 0; for (const d of r) m = (m * 10 + Number(d)) % 97;
  return m === 1;
}
/** OM38 0181 2345 6789 0123 456 */
export const ibanText = (s) => (s ? s.replace(/(.{4})/g, "$1 ").trim() : "");
