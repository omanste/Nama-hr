import { api } from "../api.js";
import { t } from "../i18n.js";
import { h, clear, select, pageHead, empty } from "../ui.js";
import { requestItem } from "./home.js";
import { permissionSummaryCard } from "./profile.js";

const STATUSES = ["pending", "approved", "rejected", "cancelled"];
const TITLES = { mine: "my_requests", all: "all_requests", team: "team_requests" };

export async function render(el, _p, { opts, query, me }) {
  const scope = opts.scope;
  const status = select("status", [["", `${t("status")}: ${t("all")}`], ...STATUSES.map((s) => [s, t("rs_" + s)])], query.get("status") || "");
  const out = h("div");
  // my own pages are split (leave / permissions); team and all pages can filter
  const kindSel = opts.kind ? null : select("kind", [["", `${t("kind")}: ${t("all")}`], ["leave", t("kind_leave")], ["permission", t("kind_permission")]], query.get("kind") || "");
  const load = async () => {
    const qs = new URLSearchParams({ scope });
    if (status.value) qs.set("status", status.value);
    const kind = opts.kind || (kindSel && kindSel.value);
    if (kind) qs.set("kind", kind);
    const { items } = await api.get(`/api/requests?${qs}`);
    clear(out).append(items.length ? h("div", { class: "list" }, items.map((r) => requestItem(r, scope !== "mine"))) : empty());
  };
  status.addEventListener("change", load);
  if (kindSel) kindSel.addEventListener("change", load);
  const perm = opts.kind === "permission";
  el.append(pageHead(t(perm ? "my_permissions" : TITLES[scope]), scope === "mine" && me.employee ? h("a", { class: "btn primary", href: perm ? "#/permissions/new" : "#/leave/new" }, t(perm ? "apply_permission" : "new_request")) : null),
    perm && me.employee ? await permissionSummaryCard(me.employee.id) : null,
    h("div", { class: "toolbar" }, kindSel, status), out);
  await load();
}
