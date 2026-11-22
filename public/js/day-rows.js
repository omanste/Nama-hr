// A month of attendance, one line per day (a person's month and My attendance): Date | Check-in | Expected check-out |
// Check-out | Hours | Late | Left early | After hours | Status | Note. Each time is followed by small icons only —
// 📱/👆 where it came from (Combined), 📍 the place (name, inside / outside, distance in a tooltip), 📷 the photo and 🗺️
// the map (both in a small pop-up), ⚠️ when the check-in was flagged. Phones get a compact card per day.
import { t, getLang, tx } from "./i18n.js";
import { h, clockText, durText, dmy, viewFile } from "./ui.js";
import { flagLabel } from "./checkin.js";
import { srcIcon } from "./att-source.js";

const loc = () => (getLang() === "ar" ? "ar-OM-u-nu-latn" : "en-GB");
export const weekday = (iso) => new Intl.DateTimeFormat(loc(), { weekday: "short", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));
export const STATUS_CLASS = { present: "b-approved", missing: "b-pending", absent: "b-rejected", pending: "b-pending", leave: "b-on_leave", mission: "b-on_leave", holiday: "b-on_leave", rest: "", rest_worked: "", holiday_worked: "", no_data: "", today: "", on_duty: "b-approved" };
/** Days with nothing to time: one short row with the status only. */
export const QUIET = ["rest", "holiday", "no_data", "today", "leave", "mission"];
export const statusOf = (x) => (x.status === "leave" ? t("lt_" + x.leave) : x.status === "missing" ? t(x.missing === "in" ? "as_missing_in" : "as_missing_out") : t("as_" + x.status));
const siteName = (c) => { const s = c.site || { name_ar: c.site_ar, name_en: c.site_en }; return (getLang() === "en" ? s.name_en || s.name_ar : s.name_ar || s.name_en) || ""; };

/** The small map window: the place on a map, and a link to open it in Google Maps. */
export function mapPopup(c) {
  const url = `https://maps.google.com/maps?q=${c.lat},${c.lng}&z=16&output=embed`;
  const dlg = h("dialog", { class: "dialog map-pop" },
    h("div", { class: "viewer-head" }, h("b", null, "🗺️ ", c.time || ""), h("button", { class: "btn small", type: "button", "aria-label": t("close"), onclick: () => dlg.close() }, "✕")),
    h("iframe", { src: url, title: t("ci_map"), loading: "lazy", referrerpolicy: "no-referrer", class: "map-frame" }),
    h("p", { class: "sub" }, c.accuracy ? `±${c.accuracy} m · ` : "", h("a", { href: `https://maps.google.com/?q=${c.lat},${c.lng}`, target: "_blank", rel: "noopener" }, t("ci_map"))));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}

/** The icons after a time: source, 📍 (tooltip), 📷, 🗺️, ⚠️. `src` is fingerprint / online / correction. */
function icons(c, src, combined) {
  const out = [];
  if (combined) out.push(srcIcon(src));
  if (!c) return out;
  const km = ((c.flags || []).find((f) => f.code === "outside") || {}).km;
  const away = c.distance ? `${c.distance} m` : km !== null && km !== undefined ? `${km} km` : "";
  const where = c.outside ? `${t("ol_outside")}${away ? ` · ${away}` : ""}${c.reason ? ` — ${c.reason}` : ""}` : `${siteName(c)}${siteName(c) ? " · " : ""}${t("ol_inside")}`;
  const tip = (b, text) => { b.title = text; b.setAttribute("aria-label", text); return b; };
  if (c.lat !== null && c.lat !== undefined || c.outside || c.site_ar || c.site_en) out.push(tip(h("button", { type: "button", class: `ico${c.outside ? " bad" : ""}`, onclick: (e) => { e.currentTarget.classList.toggle("tip-on"); } }, "📍", h("span", { class: "tip" }, where)), where));
  if (c.photo_file_id) out.push(tip(h("button", { type: "button", class: "ico", onclick: () => viewFile({ id: c.photo_file_id, name: `${t("ci_photo")} · ${c.time || ""}`, mime: "image/jpeg" }) }, "📷"), t("ci_photo")));
  if (c.lat !== null && c.lat !== undefined) out.push(tip(h("button", { type: "button", class: "ico", onclick: () => mapPopup(c) }, "🗺️"), t("ci_map")));
  if (c.flags && c.flags.length) out.push(tip(h("span", { class: "ico warn" }, "⚠️"), c.flags.map(flagLabel).join(" · ") + (c.flag_status ? ` (${t("ci_flag_" + c.flag_status)})` : "")));
  if (c.approval && c.approval !== "approved") out.push(tip(h("span", { class: "ico warn" }, c.approval === "pending" ? "⏳" : "✖"), t("ci_appr_" + c.approval)));
  return out;
}
/** The online check-in behind a shown time (or this kind's own, when it is waiting / refused). */
function checkinAt(x, kind, min) {
  const cis = (x.checkins || []).filter((c) => c.kind === kind);
  const c = kind === "in" ? cis[0] : cis[cis.length - 1];
  const counts = (k) => k.approval !== "pending" && k.approval !== "rejected";
  if (min !== null && min !== undefined) return cis.find((k) => k.time === clockText(min) && counts(k)) || null;
  return c && c.approval && c.approval !== "approved" ? c : null;
}

/** The day's chips: requests (external task, permissions, corrections), time away, the break taken, the holiday. */
function notes(x, { own, today }) {
  const chips = x.requests.filter((r) => r.type !== "comp_day").map((r) => h("a", { class: "chip", href: `#/leave/${r.id}` }, t("lt_" + r.type),
    r.type === "overtime" && r.minutes ? ` ${durText(r.minutes)}` : "", r.status === "pending" ? ` · ${t("rs_pending")}` : ""));
  if (x.holiday) chips.push(h("span", { class: "chip" }, tx(x.holiday)));
  if (x.away) chips.push(h("span", { class: "chip bad", title: t("att_away_unapproved", { d: durText(x.away) }) }, "⚠️ ", durText(x.away)));
  if (x.breakTaken) chips.push(h("span", { class: "chip", title: t("att_break_taken", { from: x.breakTaken.from, to: x.breakTaken.to || "…", d: durText(x.breakTaken.minutes || 0) }) }, "☕ ", durText(x.breakTaken.minutes || 0)));
  if (own && !x.info && x.date <= today && !x.correctionPending && (x.status === "missing" || x.status === "absent"))
    chips.push(h("a", { class: "chip act", href: `#/attendance/correction?date=${x.date}` }, t("att_ask_correction")));
  return chips;
}

/** The table (desktop and laptop) and the cards (phones); CSS shows one of them. */
export function dayRows(days, { source = "online", own = false, today }) {
  const combined = source === "combined";
  const time = (x, kind) => {
    const min = kind === "in" ? x.in : x.out, c = checkinAt(x, kind, min);
    const shown = min !== null && min !== undefined ? clockText(min) : c ? c.time : null;
    if (!shown) return null;
    return [h("b", { class: "tm" }, shown), ...icons(c, kind === "in" ? x.inSrc : x.outSrc, combined)];
  };
  const dash = (quiet) => (quiet ? "" : "—");
  const num = (v, cls, quiet) => (v ? h("span", { class: cls }, durText(v)) : dash(quiet));
  const list = days.filter((x) => x.status !== "no_data" || x.date <= today);
  const table = h("div", { class: "table-wrap dd-wrap" }, h("table", { class: "dd" },
    h("colgroup", null, [10, 15, 9, 15, 7, 7, 7, 7, 11, 12].map((w) => h("col", { style: `width:${w}%` }))),
    h("thead", null, h("tr", null, [t("date"), t("att_in"), t("att_expected_out"), t("att_out"), t("pdf_hours"), t("att_late"), t("att_early"), t("att_after"), t("status"), t("dd_note")]
      .map((k, i) => h("th", { class: i >= 1 && i <= 7 ? "c" : null }, k)))),
    h("tbody", null, list.map((x) => {
      const quiet = QUIET.includes(x.status);
      const inn = time(x, "in"), out = time(x, "out");
      return h("tr", { class: quiet ? "q" : null },
        h("td", { class: "dt" }, h("b", null, dmy(x.date).slice(0, 5)), " ", h("span", { class: "muted" }, weekday(x.date))),
        h("td", { class: "c tmc" }, inn || dash(quiet)),
        h("td", { class: "c" }, !quiet && x.expectedOut !== null && x.expectedOut !== undefined ? clockText(x.expectedOut) : ""),
        h("td", { class: "c tmc" }, out || dash(quiet)),
        h("td", { class: "c" }, x.worked || x.onSite ? durText(x.worked ?? x.onSite) : dash(quiet)),
        h("td", { class: "c" }, num(x.late, "bad-text", quiet)), h("td", { class: "c" }, num(x.early, "bad-text", quiet)), h("td", { class: "c" }, num(x.after, "good-text", quiet)),
        h("td", { class: "st" }, h("span", { class: `badge ${STATUS_CLASS[x.status] || ""}` }, statusOf(x))),
        h("td", { class: "nt" }, notes(x, { own, today })));
    }))));
  const cards = h("div", { class: "dd-cards" }, list.map((x) => {
    const quiet = QUIET.includes(x.status), inn = time(x, "in"), out = time(x, "out");
    return h("div", { class: `dd-card${quiet ? " q" : ""}` },
      h("div", { class: "dd-top" }, h("b", null, dmy(x.date).slice(0, 5)), h("span", { class: "muted" }, weekday(x.date)), h("span", { class: `badge ${STATUS_CLASS[x.status] || ""}` }, statusOf(x))),
      quiet ? null : h("div", { class: "dd-times" },
        h("span", null, h("small", null, t("att_in")), " ", inn || "—"), h("span", null, h("small", null, t("att_out")), " ", out || "—"),
        x.worked || x.onSite ? h("span", null, h("small", null, t("pdf_hours")), " ", durText(x.worked ?? x.onSite)) : null),
      !quiet && (x.late || x.early || x.after) ? h("div", { class: "dd-times" }, x.late ? h("span", { class: "bad-text" }, `${t("att_late")} ${durText(x.late)}`) : null,
        x.early ? h("span", { class: "bad-text" }, `${t("att_early")} ${durText(x.early)}`) : null, x.after ? h("span", { class: "good-text" }, `${t("att_after")} ${durText(x.after)}`) : null) : null,
      notes(x, { own, today }).length ? h("div", { class: "dd-notes" }, notes(x, { own, today })) : null);
  }));
  return h("div", { class: "dd-box" }, table, cards);
}
