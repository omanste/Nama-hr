import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, when, amountText, daysText, pageHead, empty } from "../ui.js";
import { render as rerender } from "../app.js";
import { decide } from "./request.js";

export async function render(el) {
  const { items } = await api.get("/api/requests?scope=approvals");
  el.append(pageHead(t("nav_approvals")),
    items.length ? h("div", { class: "grid cols2" }, items.map((r) => h("article", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, h("a", { href: `#/leave/${r.id}` }, nm(r))), h("span", { class: "badge b-pending" }, t("lt_" + r.type))),
      h("dl", { class: "facts" },
        h("div", null, h("dt", null, t("date")), h("dd", null, when(r))),
        h("div", null, h("dt", null, t("amount")), h("dd", null, amountText(r))),
        ["annual", "early"].includes(r.type) ? h("div", null, h("dt", null, t("current_balance")), h("dd", null, daysText(r.balance))) : null,
        r.reason ? h("div", { style: { gridColumn: "1/-1" } }, h("dt", null, t("reason")), h("dd", null, r.reason)) : null),
      h("div", { class: "row", style: { marginTop: "14px" } },
        h("button", { class: "btn ok", type: "button", onclick: async () => { if (await decide(r.id, "approve")) rerender(); } }, t("approve")),
        h("button", { class: "btn danger", type: "button", onclick: async () => { if (await decide(r.id, "reject")) rerender(); } }, t("reject")))))) : empty(t("no_approvals")));
}
