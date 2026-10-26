import { api } from "../api.js";
import { t, getLang } from "../i18n.js";
import { h, pageHead, dateTime, empty } from "../ui.js";
import { render as rerender } from "../app.js";

export async function render(el) {
  const { items, unread } = await api.get("/api/notifications");
  const ar = getLang() === "ar";
  el.append(pageHead(t("nav_notifications"), unread ? h("button", { class: "btn small", type: "button", onclick: async () => { await api.post("/api/notifications/read", { all: true }); rerender(); } }, t("mark_all_read")) : null),
    items.length ? h("div", { class: "list" }, items.map((n) => h("a", { class: "item", href: n.link || "#/", style: { borderInlineStart: n.read_at ? null : "3px solid var(--gold)" },
      onclick: () => { if (!n.read_at) api.post("/api/notifications/read", { ids: [n.id] }).catch(() => {}); } },
      h("div", { class: "grow" }, h("div", { class: "title" }, ar ? n.title_ar : n.title_en), h("div", { class: "meta" }, ar ? n.body_ar : n.body_en), h("div", { class: "meta" }, dateTime(n.created_at))))))
      : empty(t("no_notifications")));
}
