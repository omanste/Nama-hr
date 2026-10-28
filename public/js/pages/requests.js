import { api } from "../api.js";
import { t, getLang } from "../i18n.js";
import { h, clear, select, pageHead, empty, num, daysText, todayIso, PERMISSIONS } from "../ui.js";
import { requestItem } from "./home.js";
import { isOmani } from "../countries.js";

const STATUSES = ["pending", "approved", "rejected", "cancelled"];
const TITLES = { mine: "my_requests", all: "all_requests", team: "team_requests" };
const pad = (n) => String(n).padStart(2, "0");
const monthName = (m) => new Intl.DateTimeFormat(getLang() === "ar" ? "ar-OM-u-nu-latn" : "en-GB", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, m - 1, 1)));

// every leave type, in the order staff think of them (permissions have their own page)
const LEAVE_TYPES = ["annual", "emergency", "sick", "bereavement", "marriage", "paternity", "maternity", "hajj", "exam", "patient_care", "childcare", "unpaid", "comp_day"];
/** Leave types that can apply to this person (by gender and nationality), as on the request form. */
const leaveTypesFor = (emp) => LEAVE_TYPES.filter((k) => !(emp && emp.gender === "male" && ["maternity", "childcare"].includes(k))
  && !(emp && emp.gender === "female" && k === "paternity") && !(["exam", "patient_care"].includes(k) && emp && emp.nationality && !isOmani(emp.nationality)));

/** Summary of the shown period: times and days/hours of every type (approved requests only). */
function summary(items, perm, emp) {
  const done = items.filter((r) => r.status === "approved");
  const order = perm ? PERMISSIONS : leaveTypesFor(emp);
  const amount = (m) => (perm ? t("hours", { n: num(m / 60) }) : daysText(m));
  const total = done.reduce((a, r) => a + r.minutes, 0);
  const pending = items.filter((r) => r.status === "pending").length;
  return h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, t(perm ? "sec_permissions" : "leave_taken")),
      perm ? h("span", { class: "badge" }, t("perm_policy_badge")) : null),
    h("dl", { class: "facts" },
      order.map((k) => { const rs = done.filter((r) => r.type === k); return h("div", null, h("dt", null, t("lt_" + k)), h("dd", { class: "num" }, perm ? t("times_hours", { n: num(rs.length), h: num(rs.reduce((a, r) => a + r.minutes, 0) / 60) }) : `${t("times_n", { n: num(rs.length) })} · ${amount(rs.reduce((a, r) => a + r.minutes, 0))}`)); }),
      h("div", null, h("dt", null, h("b", null, t("total"))), h("dd", { class: "num" }, h("b", null, `${t("times_n", { n: num(done.length) })} · ${amount(total)}`)))),
    h("p", { class: "sub", style: { margin: "10px 0 0" } }, t("approved_only"), pending ? ` · ${t("pending_n", { n: num(pending) })}` : ""));
}

export async function render(el, _p, { opts, query, me }) {
  const scope = opts.scope, mine = scope === "mine", perm = opts.kind === "permission";
  const status = select("status", [["", `${t("status")}: ${t("all")}`], ...STATUSES.map((s) => [s, t("rs_" + s)])], query.get("status") || "");
  // my own pages are split (leave / permissions); team and all pages can filter by kind
  const kindSel = opts.kind ? null : select("kind", [["", `${t("kind")}: ${t("all")}`], ["leave", t("kind_leave")], ["permission", t("kind_permission")], ["attendance", t("kind_attendance")]], query.get("kind") || "");
  // period: a year, and optionally a month (permissions open on this month, everything else on this year)
  const now = todayIso(), thisYear = Number(now.slice(0, 4));
  const years = []; for (let y = thisYear + 1; y >= thisYear - 5; y--) years.push(y);
  const yearSel = select("year", [["", `${t("year")}: ${t("all")}`], ...years.map((y) => [y, String(y)])], query.get("year") || (mine ? thisYear : ""));
  const monthSel = select("month", [["", `${t("month")}: ${t("all")}`], ...Array.from({ length: 12 }, (_, i) => [i + 1, monthName(i + 1)])], query.get("month") || (mine && perm ? Number(now.slice(5, 7)) : ""));
  const head = h("div"), out = h("div");
  const load = async () => {
    monthSel.disabled = !yearSel.value;
    const qs = new URLSearchParams({ scope });
    if (status.value) qs.set("status", status.value);
    const kind = opts.kind || (kindSel && kindSel.value);
    if (kind) qs.set("kind", kind);
    if (yearSel.value) {
      const y = yearSel.value, m = monthSel.value;
      qs.set("from", m ? `${y}-${pad(m)}-01` : `${y}-01-01`);
      qs.set("to", m ? `${y}-${pad(m)}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}` : `${y}-12-31`);
    }
    const { items } = await api.get(`/api/requests?${qs}`);
    if (mine && opts.kind) clear(head).append(summary(items, perm, me.employee));
    clear(out).append(items.length ? h("div", { class: "list" }, items.map((r) => requestItem(r, !mine))) : empty());
  };
  for (const s of [status, yearSel, monthSel, kindSel]) if (s) s.addEventListener("change", load);
  el.append(pageHead(t(perm ? "my_permissions" : opts.kind === "leave" && mine ? "my_leave" : TITLES[scope]),
      mine && me.employee && perm ? h("a", { class: "btn", href: "#/attendance/mission?from=permissions" }, t("lt_mission")) : null,
      mine && me.employee ? h("a", { class: "btn primary", href: perm ? "#/permissions/new" : "#/leave/new" }, t(perm ? "apply_permission" : "new_request")) : null),
    h("div", { class: "toolbar" }, yearSel, monthSel), head,
    h("h2", { style: { margin: "18px 0 8px" } }, t("history")),
    h("div", { class: "toolbar" }, kindSel, status), out);
  await load();
}
