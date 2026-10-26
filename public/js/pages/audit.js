import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, select, pageHead, dateTime, empty } from "../ui.js";

const ENTITIES = ["employee", "request", "user", "department", "settings", "import"];

export async function render(el, _p, { can, query }) {
  if (!can.viewAll()) throw { status: 403 };
  const entity = select("entity", [["", t("all")], ...ENTITIES.map((e) => [e, e])], query.get("entity") || "", { "aria-label": t("action") });
  const body = h("tbody");
  const more = h("button", { class: "btn", type: "button", hidden: true }, t("load_more"));
  let last = null;
  const summary = (a) => {
    try {
      const after = a.after ? JSON.parse(a.after) : null, before = a.before ? JSON.parse(a.before) : null;
      if (before && after && typeof before === "object") return Object.keys(after).filter((k) => !["updated_at", "created_at"].includes(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((k) => `${k}: ${before[k] ?? "—"} → ${after[k] ?? "—"}`).join(" · ");
      if (after && typeof after === "object") return Object.entries(after).filter(([k, v]) => v !== null && !["created_at", "updated_at"].includes(k)).slice(0, 6).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ");
    } catch {}
    return "";
  };
  async function load(reset) {
    if (reset) { body.replaceChildren(); last = null; }
    const qs = new URLSearchParams();
    if (entity.value) qs.set("entity", entity.value);
    if (last) qs.set("before", last);
    const r = await api.get(`/api/audit?${qs}`);
    if (reset && !r.items.length) body.append(h("tr", null, h("td", { colspan: 4 }, empty())));
    for (const a of r.items) body.append(h("tr", null, h("td", { class: "num" }, dateTime(a.at)),
      h("td", null, (a.actor_name && nm({ name_ar: a.actor_name, name_en: a.actor_name_en })) || a.actor_username || "—"),
      h("td", { dir: "ltr" }, a.action, a.entity_id ? ` #${a.entity_id}` : ""), h("td", { class: "muted", style: { maxWidth: "460px", overflowWrap: "anywhere" } }, summary(a))));
    last = r.items.length ? r.items[r.items.length - 1].id : last;
    more.hidden = !r.more;
  }
  entity.addEventListener("change", () => load(true));
  more.addEventListener("click", () => load(false));
  el.append(pageHead(t("audit_title")), h("div", { class: "toolbar" }, entity),
    h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, [t("at"), t("actor"), t("action"), t("details")].map((x) => h("th", null, x)))), body)), more);
  await load(true);
}
