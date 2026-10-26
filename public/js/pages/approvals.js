import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, when, amountText, daysText, pageHead, empty, select, field, dmy, toast, errText, todayIso } from "../ui.js";
import { render as rerender } from "../app.js";
import { decide } from "./request.js";

// leaves that need a supporting document before approval (Art. 47, 84)
const PROOF = new Set(["sick", "bereavement", "marriage", "paternity", "maternity", "hajj", "exam", "patient_care"]);

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
  const [{ items }, cover] = await Promise.all([api.get("/api/requests?scope=approvals"), api.get("/api/cover")]);
  el.append(pageHead(t("nav_approvals")),
    items.length ? h("div", { class: "grid cols2" }, items.map((r) => h("article", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, h("a", { href: `#/leave/${r.id}` }, nm(r))),
        h("div", { class: "row" }, PROOF.has(r.type) && !r.file_count ? h("span", { class: "badge b-rejected" }, t("proof_missing")) : null, h("span", { class: "badge b-pending" }, t("lt_" + r.type)))),
      h("dl", { class: "facts" },
        h("div", null, h("dt", null, t("date")), h("dd", null, when(r))),
        h("div", null, h("dt", null, t("amount")), h("dd", null, amountText(r))),
        r.type === "annual" ? h("div", null, h("dt", null, t("current_balance")), h("dd", null, daysText(r.balance))) : null,
        r.reason ? h("div", { style: { gridColumn: "1/-1" } }, h("dt", null, t("reason")), h("dd", null, r.reason)) : null),
      h("div", { class: "row", style: { marginTop: "14px" } },
        h("button", { class: "btn ok", type: "button", onclick: async () => { if (await decide(r.id, "approve")) rerender(); } }, t("approve")),
        h("button", { class: "btn danger", type: "button", onclick: async () => { if (await decide(r.id, "reject")) rerender(); } }, t("reject")))))) : empty(t("no_approvals")),
    coverSection(cover, me));
}
