import { api } from "../api.js";
import { t } from "../i18n.js";
import { h, clear, select, pageHead, empty } from "../ui.js";
import { requestItem } from "./home.js";

const STATUSES = ["pending", "approved", "rejected", "cancelled"];
const TITLES = { mine: "my_requests", all: "all_requests", team: "team_requests" };

export async function render(el, _p, { opts, query, me }) {
  const scope = opts.scope;
  const status = select("status", [["", `${t("status")}: ${t("all")}`], ...STATUSES.map((s) => [s, t("rs_" + s)])], query.get("status") || "");
  const out = h("div");
  const load = async () => {
    const qs = new URLSearchParams({ scope });
    if (status.value) qs.set("status", status.value);
    const { items } = await api.get(`/api/requests?${qs}`);
    clear(out).append(items.length ? h("div", { class: "list" }, items.map((r) => requestItem(r, scope !== "mine"))) : empty());
  };
  status.addEventListener("change", load);
  el.append(pageHead(t(TITLES[scope]), scope === "mine" && me.employee ? h("a", { class: "btn primary", href: "#/leave/new" }, t("new_request")) : null),
    h("div", { class: "toolbar" }, status), out);
  await load();
}
