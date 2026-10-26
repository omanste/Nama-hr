import { t } from "../i18n.js";
import { h } from "../ui.js";
import { menuItems, icon, signOut } from "../app.js";

export async function render(el) {
  el.append(h("h1", null, t("nav_more")),
    h("div", { class: "list" }, menuItems().map(([href, key, ic, count]) => h("a", { class: "item", href }, icon(ic), h("span", { class: "grow" }, t(key)), count ? h("span", { class: "badge b-pending" }, count) : null)),
      h("a", { class: "item", href: "#/password" }, icon("key"), h("span", { class: "grow" }, t("change_password"))),
      h("button", { class: "item", type: "button", onclick: signOut, style: { width: "100%", font: "inherit", cursor: "pointer" } }, icon("user"), h("span", { class: "grow", style: { textAlign: "start" } }, t("sign_out")))));
}
