import { api } from "../api.js";
import { t } from "../i18n.js";
import { h, toast, errText } from "../ui.js";
import { loadMe, state } from "../app.js";

export async function render(el) {
  const forced = state.me && state.me.user.mustChange;
  const err = h("div", { class: "form-error", role: "alert" });
  const cur = h("input", { id: "pc", type: "password", autocomplete: "current-password", required: true, dir: "ltr" });
  const nw = h("input", { id: "pn", type: "password", autocomplete: "new-password", required: true, minlength: 8, dir: "ltr" });
  const cf = h("input", { id: "pf", type: "password", autocomplete: "new-password", required: true, minlength: 8, dir: "ltr" });
  const btn = h("button", { class: "btn primary block", type: "submit" }, t("save_password"));
  const form = h("form", { class: "form", onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = "";
    if (nw.value !== cf.value) { err.textContent = t("passwords_differ"); cf.focus(); return; }
    btn.disabled = true;
    try {
      await api.post("/api/me/password", { current: cur.value, next: nw.value });
      await loadMe();
      toast(t("password_saved"));
      location.hash = "#/";
    } catch (e2) { err.textContent = errText(e2); btn.disabled = false; }
  } },
    h("div", { class: "field" }, h("label", { for: "pc" }, t("current_password")), cur),
    h("div", { class: "field" }, h("label", { for: "pn" }, t("new_password")), nw),
    h("div", { class: "field" }, h("label", { for: "pf" }, t("confirm_password")), cf),
    err, btn,
    forced ? null : h("a", { class: "btn block", href: "#/" }, t("cancel")));
  el.append(h("div", { class: "login-wrap" }, h("div", { class: "login-card" },
    h("div", { class: "brand" }, h("img", { src: "/logo-wordmark.png", alt: t("company") })),
    h("div", { class: "card" }, h("h1", null, t("choose_password")), h("p", { class: "sub" }, t("choose_password_sub")), form))));
  setTimeout(() => cur.focus(), 0);
}
