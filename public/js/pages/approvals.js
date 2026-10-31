import { api } from "../api.js";
import { t, nm, getLang } from "../i18n.js";
import { h, when, amountText, daysText, pageHead, empty, select, field, dmy, toast, errText, todayIso, confirm, viewFile, avatar } from "../ui.js";
import { render as rerender } from "../app.js";
import { decide } from "./request.js";

// leaves that need a supporting document before approval (Art. 47, 84)
const PROOF = new Set(["sick", "bereavement", "marriage", "paternity", "maternity", "hajj", "exam", "patient_care"]);

/** Check-ins outside the work sites waiting for approval: who, when, why, the photo, the place; approve or reject. */
function outsideSection(list) {
  if (!list.length) return null;
  const act = (c, action) => async () => {
    let note = "";
    if (action === "reject") { note = await confirm(t("ci_reject_q"), { input: t("reject_reason"), required: true, okText: t("reject"), danger: true }); if (note === null) return; }
    try { await api.post(`/api/attendance/checkins/${c.id}/${action}`, { note }); toast(t("saved")); rerender(); } catch (e) { toast(errText(e), "bad"); }
  };
  const near = (c) => (c.nearest ? t("ci_nearest", { name: getLang() === "en" ? c.nearest.name_en || c.nearest.name_ar : c.nearest.name_ar || c.nearest.name_en, km: ((c.distance || 0) / 1000).toFixed(1) }) : "");
  return h("section", { class: "card" }, h("h2", null, t("ci_pending_title"), " ", h("span", { class: "badge b-pending" }, list.length)),
    h("p", { class: "sub" }, t("ci_pending_hint")),
    h("div", { class: "list" }, list.map((c) => h("div", { class: "item", style: { flexWrap: "wrap" } },
      avatar({ ...c, photo_file_id: c.emp_photo }, 36),
      h("div", { class: "grow" }, h("div", { class: "title" }, nm(c), h("span", { class: "muted" }, ` · ${c.emp_no}`)),
        h("div", { class: "meta" }, t(c.kind === "in" ? "ci_check_in" : "ci_check_out"), ` · ${dmy(c.at.slice(0, 10))} ${c.at.slice(11)}`, near(c) ? ` · ${near(c)}` : ""),
        h("div", { dir: "auto" }, "“", c.reason, "”")),
      h("div", { class: "row doc-actions" },
        c.photo_file_id ? h("button", { class: "btn small", type: "button", onclick: () => viewFile({ id: c.photo_file_id, name: `${nm(c)} · ${c.at}`, mime: "image/jpeg" }) }, "📷 ", t("ci_photo")) : null,
        c.lat !== null ? h("a", { class: "btn small", href: `https://maps.google.com/?q=${c.lat},${c.lng}`, target: "_blank", rel: "noopener" }, "🗺 ", t("ci_map")) : null,
        h("button", { class: "btn small danger", type: "button", onclick: act(c, "reject") }, t("reject")),
        h("button", { class: "btn small ok", type: "button", onclick: act(c, "approve") }, t("approve")))))));
}

function coverSection(cover, me) {
  const mine = cover.items.filter((c) => c.approver_user_id === me.user.id);
  const forOthers = cover.items.filter((c) => c.deputy_user_id === me.user.id);
  const notes = forOthers.map((c) => h("div", { class: "note", style: { marginBottom: "8px" } }, t("covering_for", { name: nm({ name_ar: c.approver_name_ar, name_en: c.approver_name_en }) || c.approver_username }), ` · ${dmy(c.start_date)} – ${dmy(c.end_date)}`));
  if (!cover.candidates) return notes.length ? h("section", { class: "card" }, notes) : null;
  const who = select("deputy", cover.candidates.map((u) => [u.id, nm(u) || u.username]), "");
  const start = h("input", { type: "date", value: todayIso() }), end = h("input", { type: "date", value: todayIso() });
  return h("section", { class: "card" }, h("h2", null, t("cover_title")), h("p", { class: "sub" }, t("cover_hint")),
    notes,
    mine.length ? h("div", { class: "list", style: { marginBottom: "12px" } }, mine.map((c) => h("div", { class: "item" },
      h("div", { class: "grow" }, h("div", { class: "title" }, nm({ name_ar: c.deputy_name_ar, name_en: c.deputy_name_en }) || c.deputy_username), h("div", { class: "meta" }, `${dmy(c.start_date)} – ${dmy(c.end_date)}`)),
      h("button", { class: "btn small danger", type: "button", onclick: async () => { try { await api.del(`/api/cover/${c.id}`); rerender(); } catch (e) { toast(errText(e), "bad"); } } }, t("delete"))))) : null,
    h("form", { class: "fields", onsubmit: async (e) => {
      e.preventDefault();
      try { await api.post("/api/cover", { deputy_user_id: Number(who.value), start: start.value, end: end.value }); toast(t("saved")); rerender(); } catch (er) { toast(errText(er), "bad"); }
    } }, field(t("deputy"), who), field(t("start_date"), start), field(t("end_date"), end),
      h("div", { class: "field", style: { alignSelf: "end" } }, h("button", { class: "btn primary", type: "submit" }, t("add_cover")))));
}

export async function render(el, _p, { me }) {
  const [{ items }, cover, outside] = await Promise.all([api.get("/api/requests?scope=approvals"), api.get("/api/cover"), api.get("/api/attendance/checkins/pending").catch(() => ({ items: [] }))]);
  el.append(pageHead(t("nav_approvals")),
    outsideSection(outside.items),
    items.length ? h("div", { class: "grid cols2" }, items.map((r) => h("article", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, h("a", { href: `#/leave/${r.id}` }, nm(r))),
        h("div", { class: "row" }, PROOF.has(r.type) && !r.file_count ? h("span", { class: "badge b-rejected" }, t("proof_missing")) : null,
          r.first_approved_by ? h("span", { class: "badge b-approved" }, "✓ ", t("first_approved")) : null, h("span", { class: "badge b-pending" }, t("lt_" + r.type)))),
      h("dl", { class: "facts" },
        h("div", null, h("dt", null, t("date")), h("dd", null, when(r))),
        h("div", null, h("dt", null, t("amount")), h("dd", null, amountText(r))),
        ["annual", "emergency"].includes(r.type) ? h("div", null, h("dt", null, t("current_balance")), h("dd", null, daysText(r.balance))) : null,
        r.reason ? h("div", { style: { gridColumn: "1/-1" } }, h("dt", null, t("reason")), h("dd", null, r.reason)) : null),
      h("div", { class: "row", style: { marginTop: "14px" } },
        h("button", { class: "btn ok", type: "button", onclick: async () => { if (await decide(r.id, "approve")) rerender(); } }, t("approve")),
        h("button", { class: "btn danger", type: "button", onclick: async () => { if (await decide(r.id, "reject")) rerender(); } }, t("reject")))))) : empty(t("no_approvals")),
    coverSection(cover, me));
}
