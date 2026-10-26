import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, num, daysOf, dmy, badge, when, amountText, empty, todayIso } from "../ui.js";

export const balanceHero = (leave, { apply = true } = {}) => h("section", { class: "card hero", "aria-label": t("bal_available") },
  h("div", { class: "lbl" }, t("bal_available")),
  h("div", { class: "big" }, num(daysOf(leave.available)), h("small", null, t("days", { n: "" }).trim())),
  h("div", { class: "lbl" }, t("leave_year", { d: dmy(leave.yearStart) })),
  h("div", { class: "facts" },
    fact("bal_remaining", leave.remaining), fact("bal_entitlement", leave.entitlement), fact("bal_carried", leave.carried),
    fact("bal_used", leave.used), fact("bal_pending", leave.pending), leave.extra ? fact("bal_extra", leave.extra) : null,
    leave.adjustments ? fact("bal_adjustments", leave.adjustments) : null),
  apply ? h("a", { class: "btn gold", href: "#/leave/new" }, t("apply_leave")) : null);
const fact = (key, min) => h("div", null, h("b", null, num(daysOf(min))), h("span", null, t(key)));

export const requestItem = (r, showName = false) => h("a", { class: "item", href: `#/leave/${r.id}` },
  h("div", { class: "grow" },
    h("div", { class: "title" }, showName ? `${nm(r)} · ` : "", t("lt_" + r.type)),
    h("div", { class: "meta" }, when(r), " · ", amountText(r))),
  badge(r.status));

const tile = (n, label, href, cls = "") => h(href ? "a" : "div", { class: `card tile ${cls}`, href }, h("div", { class: "n" }, n), h("div", { class: "l" }, label));

export async function render(el, _p, { me, can }) {
  el.append(h("h1", null, t("hello", { name: nm(me.employee) || me.user.username })));
  const jobs = [];
  if (me.employee) jobs.push(api.get(`/api/employees/${me.employee.id}`).then((p) => {
    const notYet = p.leave.eligibleFrom && p.leave.eligibleFrom > todayIso();
    return h("div", { class: "grid cols2" },
      h("div", { class: "grid" }, balanceHero(p.leave), notYet ? h("div", { class: "note" }, t("eligible_from", { d: dmy(p.leave.eligibleFrom) })) : null),
      h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", null, t("recent_requests")), h("a", { href: "#/leave" }, t("view_all"))),
        p.requests.length ? h("div", { class: "list" }, p.requests.slice(0, 4).map((r) => requestItem(r))) : empty()));
  }));
  else jobs.push(Promise.resolve(h("div", { class: "note" }, t("no_profile"))));

  const tiles = [];
  if (can.approve()) tiles.push(tile(num(me.pendingApprovals), t("pending_approvals"), "#/approvals", me.pendingApprovals ? "warn" : ""));
  if (can.viewAll()) {
    jobs.push(Promise.all([api.get("/api/employees"), api.get("/api/requests?scope=all&status=pending")]).then(([emps, pend]) => {
      const soon = new Date(Date.parse(todayIso()) + 30 * 864e5).toISOString().slice(0, 10);
      const active = emps.items.filter((e) => e.status === "active" || e.status === "on_leave");
      const expiring = active.filter((e) => e.civil_id_expiry && e.civil_id_expiry <= soon);
      const noJoin = active.filter((e) => !e.join_date);
      return h("div", { class: "grid" },
        h("div", { class: "grid tiles" }, tiles,
          tile(num(active.length), t("staff_count"), "#/staff"),
          tile(num(pend.items.length), t("all_pending"), "#/requests?status=pending", pend.items.length ? "warn" : ""),
          tile(num(expiring.length), t("ids_expiring"), null, expiring.length ? "alert" : "good"),
          tile(num(noJoin.length), t("missing_join"), null, noJoin.length ? "warn" : "good")),
        expiring.length || noJoin.length ? h("section", { class: "card" }, h("h2", null, t("needs_attention")),
          h("div", { class: "list" },
            expiring.map((e) => h("a", { class: "item", href: `#/staff/${e.id}` }, h("div", { class: "grow" }, h("div", { class: "title" }, nm(e)), h("div", { class: "meta" }, t("f_civil_id_expiry"), ": ", dmy(e.civil_id_expiry))))),
            noJoin.map((e) => h("a", { class: "item", href: `#/staff/${e.id}/edit` }, h("div", { class: "grow" }, h("div", { class: "title" }, nm(e)), h("div", { class: "meta" }, t("no_join_date"))))))) : null);
    }));
  } else if (tiles.length) jobs.push(Promise.resolve(h("div", { class: "grid tiles" }, tiles)));
  for (const node of await Promise.all(jobs)) el.append(node);
}
