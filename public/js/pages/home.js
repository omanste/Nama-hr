import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { leaveSections } from "./profile.js";
import { h, num, daysOf, dmy, badge, when, amountText, empty, todayIso } from "../ui.js";

export const balanceHero = (leave, { apply = true } = {}) => h("section", { class: "card hero", "aria-label": t("bal_available") },
  h("div", { class: "lbl" }, t("bal_available")),
  h("div", { class: "big" }, num(daysOf(leave.available)), h("small", null, t("days", { n: "" }).trim())),
  h("div", { class: "lbl" }, t("leave_year", { d: dmy(leave.yearStart) })),
  h("div", { class: "facts" },
    fact("bal_remaining", leave.remaining), fact("bal_entitlement", leave.entitlement), fact("bal_carried", leave.carried),
    fact("bal_used", leave.used), fact("bal_pending", leave.pending), leave.extra ? fact("bal_extra", leave.extra) : null,
    leave.adjustments ? fact("bal_adjustments", leave.adjustments) : null,
    leave.encashed ? fact("bal_encashed", leave.encashed) : null),
  apply ? h("div", { class: "row hero-actions" }, h("a", { class: "btn gold", href: "#/leave/new" }, t("apply_leave")), h("a", { class: "btn ghost-light", href: "#/permissions/new" }, t("apply_permission"))) : null);
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
  // colleagues' birthdays in the next 5 days (never your own) — so the team can prepare a surprise
  jobs.push(api.get("/api/birthdays/upcoming").then(({ items }) => {
    if (!items.length) return null;
    const today = todayIso();
    const left = (d) => Math.round((Date.parse(d) - Date.parse(today)) / 864e5);
    return h("a", { class: "card bday", href: "#/calendar", style: { display: "block", textDecoration: "none", color: "inherit" } },
      h("h2", null, t("birthdays_soon")),
      h("div", { class: "list" }, items.map((b) => h("div", null, "🎂 ", h("b", null, nm(b)), " · ", dmy(b.date).slice(0, 5), " · ",
        left(b.date) === 0 ? t("today") : left(b.date) === 1 ? t("tomorrow") : t("in_n_days", { n: num(left(b.date)) })))));
  }).catch(() => null));
  // my leave balance, leave by type, permissions and request history
  if (me.employee) jobs.push(api.get(`/api/employees/${me.employee.id}`).then((p) => h("div", { class: "grid" }, leaveSections(p, { own: true, limit: 10 }))));
  else jobs.push(Promise.resolve(h("div", { class: "note" }, t("no_profile"))));

  const tiles = [];
  if (can.approve()) tiles.push(tile(num(me.pendingApprovals), t("pending_approvals"), "#/approvals", me.pendingApprovals ? "warn" : ""));
  if (can.viewAll()) {
    jobs.push(Promise.all([api.get("/api/employees"), api.get("/api/requests?scope=all&status=pending"), api.get("/api/expiring")]).then(([emps, pend, exp]) => {
      const active = emps.items.filter((e) => e.status === "active" || e.status === "on_leave");
      const expiring = exp.items;
      const noJoin = active.filter((e) => !e.join_date);
      const under30 = active.filter((e) => e.under_30_in_2y);
      return h("div", { class: "grid" },
        h("div", { class: "grid tiles" }, tiles,
          tile(num(active.length), t("staff_count"), "#/staff"),
          tile(num(pend.items.length), t("all_pending"), "#/requests?status=pending", pend.items.length ? "warn" : ""),
          tile(num(expiring.length), t("ids_expiring"), null, expiring.length ? "alert" : "good"),
          tile(num(noJoin.length), t("missing_join"), null, noJoin.length ? "warn" : "good"),
          tile(num(me.pendingCapReviews || 0), t("pending_reviews"), "#/cap-reviews", me.pendingCapReviews ? "warn" : "good"),
          tile(num(under30.length), t("under_30_title"), null, under30.length ? "warn" : "good")),
        expiring.length || noJoin.length || under30.length ? h("section", { class: "card" }, h("h2", null, t("needs_attention")),
          h("div", { class: "list" },
            expiring.map((x) => h("a", { class: "item", href: `#/staff/${x.employee.id}` }, h("div", { class: "grow" }, h("div", { class: "title" }, nm(x.employee)), h("div", { class: "meta" }, t("dt_" + x.what), " · ", dmy(x.expiry))),
              h("span", { class: `badge ${x.days <= 0 ? "b-rejected" : "b-pending"}` }, x.days <= 0 ? t("doc_expired") : t("in_days", { n: num(x.days) })))),
            noJoin.map((e) => h("a", { class: "item", href: `#/staff/${e.id}/edit` }, h("div", { class: "grow" }, h("div", { class: "title" }, nm(e)), h("div", { class: "meta" }, t("no_join_date"))))),
            under30.map((e) => h("a", { class: "item", href: `#/staff/${e.id}` }, h("div", { class: "grow" }, h("div", { class: "title" }, nm(e)), h("div", { class: "meta" }, t("under_30_title"))))))) : null);
    }));
  } else if (tiles.length) jobs.push(Promise.resolve(h("div", { class: "grid tiles" }, tiles)));
  for (const node of await Promise.all(jobs)) el.append(node);
}
