import { api } from "../api.js";
import { t, nm, tx } from "../i18n.js";
import { leaveSections } from "./profile.js";
import { h, num, daysOf, daysText, dmy, badge, when, amountText, empty, todayIso, avatar, pager } from "../ui.js";

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

  // tiles: tap one to list its records right below (50 a page)
  const panel = h("div");
  const person = (e, meta, href = `#/staff/${e.id}`, extra = null) => h("a", { class: "item", href }, avatar(e, 36), h("div", { class: "grow" }, h("div", { class: "title" }, nm(e)), h("div", { class: "meta" }, meta)), extra);
  const lists = {};
  let current = null;
  function open(key) {
    current = current === key ? null : key;
    for (const b of el.querySelectorAll(".tile[data-key]")) b.setAttribute("aria-pressed", String(b.dataset.key === current));
    if (!current) { panel.replaceChildren(); return; }
    const L = lists[current];
    panel.replaceChildren(h("section", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, L.title, " ", h("span", { class: "badge" }, num(L.items.length))), L.href ? h("a", { href: L.href }, t("view_all")) : null),
      pager(L.items, L.row)));
  }
  const tileBtn = (key, n, label, cls = "") => h("button", { class: `card tile ${cls}`, type: "button", "data-key": key, "aria-pressed": "false", onclick: () => open(key) }, h("div", { class: "n" }, num(n)), h("div", { class: "l" }, label));
  const reqRow = (r) => requestItem(r, true);
  if (can.viewAll()) {
    jobs.push(Promise.all([api.get("/api/employees"), api.get("/api/requests?scope=all&status=pending"), api.get("/api/expiring"),
      can.approve() ? api.get("/api/requests?scope=approvals") : Promise.resolve({ items: [] }), api.get("/api/cap-reviews?status=pending")]).then(([emps, pend, exp, appr, caps]) => {
      const active = emps.items.filter((e) => e.status === "active" || e.status === "on_leave");
      const noJoin = active.filter((e) => !e.join_date);
      const under30 = active.filter((e) => e.under_30_in_2y);
      Object.assign(lists, {
        approvals: { title: t("pending_approvals"), items: appr.items, row: reqRow, href: "#/approvals" },
        staff: { title: t("staff_count"), items: active, row: (e) => person(e, [e.emp_no, tx(e.job_title)].filter(Boolean).join(" · "), `#/staff/${e.id}`, h("span", { class: "num" }, daysText(e.remaining))), href: "#/staff" },
        pending: { title: t("all_pending"), items: pend.items, row: reqRow, href: "#/requests?status=pending" },
        expiring: { title: t("ids_expiring"), items: exp.items, row: (x) => person(x.employee, [t("dt_" + x.what), dmy(x.expiry)].join(" · "), `#/staff/${x.employee.id}`,
          h("span", { class: `badge ${x.days <= 0 ? "b-rejected" : "b-pending"}` }, x.days <= 0 ? t("doc_expired") : t("in_days", { n: num(x.days) }))) },
        nojoin: { title: t("missing_join"), items: noJoin, row: (e) => person(e, t("no_join_date"), `#/staff/${e.id}/edit`) },
        caps: { title: t("pending_reviews"), items: caps.items, row: (c) => person({ id: c.employee_id, ...c }, `${t("excess")}: ${daysText(c.excess)}`, "#/cap-reviews"), href: "#/cap-reviews" },
        under30: { title: t("under_30_title"), items: under30, row: (e) => person(e, t("under_30_title")) },
      });
      const tilesBox = h("div", { class: "grid tiles home-tiles" },
        can.approve() ? tileBtn("approvals", appr.items.length, t("pending_approvals"), appr.items.length ? "warn" : "") : null,
        tileBtn("staff", active.length, t("staff_count")),
        tileBtn("pending", pend.items.length, t("all_pending"), pend.items.length ? "warn" : ""),
        tileBtn("expiring", exp.items.length, t("ids_expiring"), exp.items.length ? "alert" : "good"),
        tileBtn("nojoin", noJoin.length, t("missing_join"), noJoin.length ? "warn" : "good"),
        tileBtn("caps", caps.items.length, t("pending_reviews"), caps.items.length ? "warn" : "good"),
        tileBtn("under30", under30.length, t("under_30_title"), under30.length ? "warn" : "good"));
      return h("div", { class: "grid" }, tilesBox, h("p", { class: "sub", style: { margin: 0 } }, t("tiles_hint")), panel);
    }));
  } else if (can.approve()) {
    jobs.push(api.get("/api/requests?scope=approvals").then((appr) => {
      lists.approvals = { title: t("pending_approvals"), items: appr.items, row: reqRow, href: "#/approvals" };
      return h("div", { class: "grid" }, h("div", { class: "grid tiles home-tiles" }, tileBtn("approvals", appr.items.length, t("pending_approvals"), appr.items.length ? "warn" : "")), panel);
    }));
  }
  for (const node of await Promise.all(jobs)) el.append(node);
}
