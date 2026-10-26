// Balances over the 60-day cap: HR decides to keep (leave not taken because of work needs) or forfeit — Art. 78.
import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, pageHead, daysText, dmy, dateTime, confirm, toast, errText, empty, select } from "../ui.js";
import { render as rerender, refreshMe } from "../app.js";

export async function render(el, _p, { can, query }) {
  if (!can.viewAll()) throw { status: 403 };
  const status = select("status", ["pending", "kept", "forfeited"].map((s) => [s, t("rv_" + s)]), query.get("status") || "pending");
  status.addEventListener("change", () => { location.hash = `#/cap-reviews?status=${status.value}`; });
  const { items } = await api.get(`/api/cap-reviews?status=${status.value}`);
  const decide = (r, decision) => async () => {
    const reason = await confirm(`${decision === "keep" ? t("keep_work") : t("forfeit")} · ${nm(r)} · ${daysText(r.excess)}`, { input: t("decision_reason"), required: true, danger: decision === "forfeit", okText: decision === "keep" ? t("keep_work") : t("forfeit") });
    if (reason === null) return;
    try { await api.post(`/api/cap-reviews/${r.id}`, { decision, reason }); toast(t("saved")); await refreshMe(); rerender(); } catch (e) { toast(errText(e), "bad"); }
  };
  el.append(pageHead(t("cap_reviews_title")), h("div", { class: "note" }, t("cap_reviews_note")), h("div", { class: "toolbar" }, status),
    items.length ? h("div", { class: "grid cols2" }, items.map((r) => h("article", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, h("a", { href: `#/staff/${r.employee_id}` }, nm(r))), h("span", { class: `badge b-${r.status === "pending" ? "pending" : r.status === "kept" ? "approved" : "cancelled"}` }, t("rv_" + r.status))),
      h("dl", { class: "facts" },
        h("div", null, h("dt", null, t("excess")), h("dd", { class: "num" }, daysText(r.excess))),
        h("div", null, h("dt", null, t("bal_remaining")), h("dd", { class: "num" }, daysText(r.balance))),
        h("div", null, h("dt", null, t("leave_year", { d: dmy(r.year_start) })), h("dd", null, r.emp_no)),
        r.reason ? h("div", { style: { gridColumn: "1/-1" } }, h("dt", null, t("reason")), h("dd", null, r.reason, " · ", dateTime(r.decided_at))) : null),
      r.status === "pending" && can.edit() ? h("div", { class: "row", style: { marginTop: "14px" } },
        h("button", { class: "btn ok", type: "button", onclick: decide(r, "keep") }, t("keep_work")),
        h("button", { class: "btn danger", type: "button", onclick: decide(r, "forfeit") }, t("forfeit"))) : null))) : empty());
}
