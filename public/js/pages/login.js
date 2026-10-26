import { api } from "../api.js";
import { t, setLang, getLang } from "../i18n.js";
import { h } from "../ui.js";
import { loadMe, state } from "../app.js";

export async function render(el) {
  state.me = null;
  const err = h("div", { class: "form-error", role: "alert" });
  const user = h("input", { name: "username", autocomplete: "username", required: true, autocapitalize: "none", spellcheck: "false", dir: "ltr" });
  const pass = h("input", { name: "password", type: "password", autocomplete: "current-password", required: true, dir: "ltr" });
  const btn = h("button", { class: "btn primary block", type: "submit" }, t("sign_in"));
  const form = h("form", { class: "form", onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = ""; btn.disabled = true; btn.textContent = t("signing_in");
    try {
      const r = await api.post("/api/login", { username: user.value.trim(), password: pass.value });
      await loadMe();
      location.hash = r.mustChange ? "#/password" : "#/";
    } catch (e2) {
      err.textContent = e2.error === "locked" ? t("locked") : e2.status === 401 ? t("bad_credentials") : e2.status === 0 ? t("offline") : e2.message || t("error");
      btn.disabled = false; btn.textContent = t("sign_in"); pass.select();
    }
  } },
    h("div", { class: "field" }, h("label", { for: "u" }, t("username")), Object.assign(user, { id: "u" })),
    h("div", { class: "field" }, h("label", { for: "p" }, t("password")), Object.assign(pass, { id: "p" })),
    err, btn);
  el.append(h("div", { class: "login-wrap" }, h("div", { class: "login-card" },
    h("div", { class: "brand" }, h("img", { src: "/logo-wordmark.png", alt: t("company") }), h("div", null, t("app_name"))),
    h("div", { class: "card" }, h("h1", { style: { marginBottom: "14px" } }, t("sign_in")), form),
    h("button", { class: "btn small lang", type: "button", onclick: () => { setLang(getLang() === "ar" ? "en" : "ar"); dispatchEvent(new HashChangeEvent("hashchange")); } }, t("lang_toggle")))));
  setTimeout(() => user.focus(), 0);
}
