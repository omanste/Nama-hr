import { api } from "../api.js";
import { t, setLang, getLang, nm } from "../i18n.js";
import { h } from "../ui.js";
import { loadMe, state, themeButton } from "../app.js";

let preferUsername = false;

export async function render(el) {
  state.me = null;
  // dev version only: choose your name from the staff list instead of typing a username
  let opts = { devStaffList: false };
  try { opts = await api.get("/api/login-options"); } catch {}
  const coll = new Intl.Collator(getLang() === "ar" ? "ar" : "en");
  const people = (opts.people || []).map((p) => [p.id, nm(p) || p.emp_no]).sort((a, b) => coll.compare(a[1], b[1]));
  const who = h("select", { name: "employee_id", id: "who", required: true },
    h("option", { value: "" }, t("choose_your_name")), people.map(([id, name]) => h("option", { value: id }, name)));
  const useList = opts.devStaffList && people.length > 0 && !preferUsername;
  const err = h("div", { class: "form-error", role: "alert" });
  const user = h("input", { name: "username", autocomplete: "username", required: true, autocapitalize: "none", spellcheck: "false", dir: "ltr" });
  const pass = h("input", { name: "password", type: "password", autocomplete: "current-password", required: true, dir: "ltr" });
  const btn = h("button", { class: "btn primary block", type: "submit" }, t("sign_in"));
  const form = h("form", { class: "form", onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = ""; btn.disabled = true; btn.textContent = t("signing_in");
    try {
      if (useList && !who.value) { err.textContent = t("choose_your_name"); btn.disabled = false; btn.textContent = t("sign_in"); who.focus(); return; }
      const r = await api.post("/api/login", useList ? { employee_id: Number(who.value), password: pass.value } : { username: user.value.trim(), password: pass.value });
      // the location of this sign-in (asked of the browser; signing in never waits for it or depends on it)
      if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => api.post("/api/me/login-location", { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0) }).catch(() => {}),
        () => {}, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
      await loadMe();
      location.hash = r.mustChange ? "#/password" : "#/";
    } catch (e2) {
      err.textContent = e2.error === "locked" ? t("locked") : e2.status === 401 ? t("bad_credentials") : e2.status === 0 ? t("offline") : e2.message || t("error");
      btn.disabled = false; btn.textContent = t("sign_in"); pass.select();
    }
  } },
    useList ? h("div", { class: "field" }, h("label", { for: "who" }, t("staff_name")), who) : h("div", { class: "field" }, h("label", { for: "u" }, t("username")), Object.assign(user, { id: "u" })),
    h("div", { class: "field" }, h("label", { for: "p" }, t("password")), Object.assign(pass, { id: "p" })),
    err, btn,
    h("p", { class: "sub", style: { margin: "4px 0 0", fontSize: "12px" } }, t("login_loc_note")),
    opts.devStaffList ? h("button", { class: "linkish", type: "button", onclick: () => { preferUsername = useList; el.replaceChildren(); render(el); } }, t(useList ? "sign_in_username" : "sign_in_staff_list")) : null);
  el.append(h("div", { class: "login-wrap" }, h("div", { class: "login-card" },
    h("div", { class: "brand" }, h("img", { src: "/logo-wordmark.png", alt: t("company") }), h("div", null, t("app_name"))),
    h("div", { class: "card" }, h("h1", { style: { marginBottom: "14px" } }, t("sign_in")), form),
    h("div", { class: "row", style: { justifyContent: "center" } },
      h("button", { class: "btn small lang", type: "button", onclick: () => { setLang(getLang() === "ar" ? "en" : "ar"); dispatchEvent(new HashChangeEvent("hashchange")); } }, t("lang_toggle")),
      themeButton("btn small lang")))));
  setTimeout(() => (useList ? who : user).focus(), 0);
}
