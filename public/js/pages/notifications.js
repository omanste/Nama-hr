import { api } from "../api.js";
import { t, getLang } from "../i18n.js";
import { h, pageHead, dateTime, empty, toast, errText } from "../ui.js";
import { pushState, enablePush, disablePush, isIos } from "../push.js";
import { render as rerender } from "../app.js";

/** Pop-ups on this device: on / off, with what to do on an iPhone or when the browser blocked them. */
export async function deviceCard() {
  const box = h("section", { class: "card push-card" });
  const draw = async (state) => {
    state = state || (await pushState().catch(() => "unsupported"));
    const btn = (label, fn, cls = "btn") => h("button", { class: cls, type: "button", onclick: async (ev) => {
      ev.currentTarget.disabled = true;
      try { const s2 = await fn(); if (s2 === "on") { toast(t("push_on_ok")); api.post("/api/push/test", {}).catch(() => {}); } draw(s2); } catch (e) { toast(errText(e), "bad"); draw(); }
    } }, label);
    box.replaceChildren(...[h("div", { class: "card-head" }, h("h2", null, "🔔 ", t("push_title")), state === "on" ? h("span", { class: "badge b-approved" }, t("push_state_on")) : null),
      h("p", { class: "sub" }, t({ on: "push_on_hint", off: "push_off_hint", blocked: "push_blocked", ios_home: "push_ios_home", unsupported: "push_unsupported" }[state] || "push_unsupported")),
      state === "off" ? btn(t("push_enable"), enablePush, "btn primary") : state === "on" ? h("div", { class: "row" }, btn(t("push_test"), async () => { await api.post("/api/push/test", {}); toast(t("push_test_sent")); return "on"; }), btn(t("push_disable"), disablePush)) : null,
      state === "ios_home" || (isIos() && state === "off") ? h("p", { class: "sub" }, t("push_ios_note")) : null].filter(Boolean));
  };
  draw();
  return box;
}

export async function render(el) {
  const { items, unread } = await api.get("/api/notifications");
  const ar = getLang() === "ar";
  el.append(await deviceCard());
  el.append(pageHead(t("nav_notifications"), unread ? h("button", { class: "btn small", type: "button", onclick: async () => { await api.post("/api/notifications/read", { all: true }); rerender(); } }, t("mark_all_read")) : null),
    items.length ? h("div", { class: "list" }, items.map((n) => h("a", { class: "item", href: n.link || "#/", style: { borderInlineStart: n.read_at ? null : "3px solid var(--gold)" },
      onclick: () => { if (!n.read_at) api.post("/api/notifications/read", { ids: [n.id] }).catch(() => {}); } },
      h("div", { class: "grow" }, h("div", { class: "title" }, ar ? n.title_ar : n.title_en), h("div", { class: "meta" }, ar ? n.body_ar : n.body_en), h("div", { class: "meta" }, dateTime(n.created_at))))))
      : empty(t("no_notifications")));
}
