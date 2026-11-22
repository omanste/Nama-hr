// Which punches an attendance view counts: Online only · Fingerprint only · Combined. The same choice everywhere (the
// report, a person's month, the monthly PDF / Excel, My attendance), remembered on this device.
import { t } from "./i18n.js";
import { h, select } from "./ui.js";

export const SOURCES = ["online", "fingerprint", "combined"];
const KEY = "nama.attSource";
const norm = (v) => ({ online: "online", fingerprint: "fingerprint", machine: "fingerprint", combined: "combined", all: "combined" })[v] || null;
/** The source from the address (?source=…), else the last one chosen on this device, else Online only. */
export function currentSource(query) {
  const q = query && norm(query.get("source"));
  if (q) return q;
  try { return norm(localStorage.getItem(KEY)) || "online"; } catch { return "online"; }
}
export const rememberSource = (s) => { try { localStorage.setItem(KEY, s); } catch {} };
export const sourceLabel = (s) => t("src_" + (norm(s) || "combined"));
/** A punch's source as a small icon: 📱 online, 👆 fingerprint, ✍️ an approved correction. */
export const srcIcon = (s) => (s === "online" ? h("span", { class: "src-ico", title: t("src_icon_online"), "aria-label": t("src_icon_online") }, "📱")
  : s === "fingerprint" ? h("span", { class: "src-ico", title: t("src_icon_fingerprint"), "aria-label": t("src_icon_fingerprint") }, "👆")
    : s === "correction" ? h("span", { class: "src-ico", title: t("src_icon_correction"), "aria-label": t("src_icon_correction") }, "✍️") : null);
export const srcEmoji = (s) => ({ online: "📱", fingerprint: "👆", correction: "✍️" })[s] || "";
/** The three buttons (one pressed). */
export function sourceTabs(value, onPick) {
  return h("div", { class: "seg att-src", role: "group", "aria-label": t("src_label") }, SOURCES.map((k) =>
    h("button", { type: "button", "aria-pressed": String(value === k), onclick: () => { rememberSource(k); onPick(k); } }, t("src_" + k))));
}
/** The same choice as a dropdown (download windows and the PDF preview). */
export const sourceSelect = (value) => select("source", SOURCES.map((k) => [k, t("src_" + k)]), value, { "aria-label": t("src_label") });
/** "Source: Online only" with what it means, shown at the top of a view. */
export const sourceNote = (s) => h("p", { class: "src-now" }, h("b", null, t("src_now", { s: sourceLabel(s) })), " · ", t("src_note_" + (norm(s) || "combined")));
