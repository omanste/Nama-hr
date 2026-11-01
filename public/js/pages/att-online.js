// Online check-in log: who checked in and out from the portal, when and where — one line per person per day (the first
// check-in and the last check-out), with the place, the manager's decision for outside the work sites, the photo and the map.
import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, clear, select, field, pageHead, empty, num, dmy, todayIso, errText, durText } from "../ui.js";
import { checkinPlace } from "../checkin.js";

const weekday = (iso) => new Intl.DateTimeFormat(document.documentElement.lang === "en" ? "en-GB" : "ar-OM", { weekday: "short", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));

export async function render(el, _p, { me, can, query }) {
  if (!["hr", "admin", "ceo", "chairman", "consultant", "accounts"].includes(me.user.role) && !me.isApprover && !me.hasTeam) throw { status: 403 };
  const today = todayIso();
  const [depts, people] = await Promise.all([can.viewAll() ? api.get("/api/departments").then((r) => r.items) : [], api.get("/api/attendance/people").then((r) => r.items).catch(() => [])]);
  const from = h("input", { type: "date", value: query.get("from") || today.slice(0, 8) + "01" }), to = h("input", { type: "date", value: query.get("to") || today });
  const dept = depts.length ? select("dept", [["", t("all")], ...depts.map((d) => [d.id, nm(d)])], query.get("dept") || "") : null;
  const emp = select("emp", [["", t("all")], ...people.map((p) => [p.id, `${nm(p)} · ${p.emp_no}`])], query.get("emp") || "");
  const csv = h("a", { class: "btn", href: "#" }, "⬇ ", t("download_excel"));
  const out = h("div");

  const cell = (c) => (c ? h("td", { class: "punch" }, h("b", null, c.time), h("div", { class: "punch-src" }, checkinPlace(c))) : h("td", { "data-label": "" }));
  async function load() {
    const qs = new URLSearchParams({ from: from.value, to: to.value });
    if (dept && dept.value) qs.set("dept", dept.value);
    if (emp.value) qs.set("emp", emp.value);
    csv.href = `/api/attendance/checkins?${qs}&format=csv`;
    let r;
    try { r = await api.get(`/api/attendance/checkins?${qs}`); } catch (e) { clear(out).append(empty(errText(e))); return; }
    const outside = r.rows.filter((x) => (x.in && x.in.outside) || (x.out && x.out.outside)).length;
    const waiting = r.rows.filter((x) => [x.in, x.out].some((c) => c && c.approval === "pending")).length;
    clear(out).append(
      h("div", { class: "grid tiles" },
        h("div", { class: "card tile" }, h("div", { class: "n" }, num(r.rows.length)), h("div", { class: "l" }, t("ol_days"))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, num(new Set(r.rows.map((x) => x.employee.id)).size)), h("div", { class: "l" }, t("ol_people"))),
        h("div", { class: `card tile ${outside ? "warn" : ""}` }, h("div", { class: "n" }, num(outside)), h("div", { class: "l" }, t("ci_outside"))),
        h("div", { class: `card tile ${waiting ? "warn" : ""}` }, h("div", { class: "n" }, num(waiting)), h("div", { class: "l" }, t("ci_appr_pending")))),
      h("section", { class: "card", style: { marginTop: "16px" } },
        h("p", { class: "sub" }, `${dmy(r.from)} – ${dmy(r.to)} · `, t("ol_note")),
        r.rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "ol-table" },
          h("thead", null, h("tr", null, [t("date"), t("employee"), t("att_in"), t("att_out"), t("att_on_site")].map((x, i) => h("th", { class: i === 4 ? "num" : null }, x)))),
          h("tbody", null, r.rows.map((x) => h("tr", null,
            h("td", null, h("b", null, dmy(x.date)), " ", h("span", { class: "muted" }, weekday(x.date))),
            h("td", null, h("a", { href: `#/attendance?emp=${x.employee.id}&m=${x.date.slice(0, 7)}` }, nm(x.employee)), h("div", { class: "muted" }, [x.employee.emp_no, nm({ name_ar: x.employee.dept_ar, name_en: x.employee.dept_en })].filter(Boolean).join(" · ")),
              x.count > 2 ? h("div", { class: "muted" }, t("ol_count", { n: num(x.count) })) : null),
            cell(x.in), cell(x.out),
            h("td", { class: "num" }, x.minutes !== null ? durText(x.minutes) : "—")))))) : empty(t("ol_none"))));
  }
  for (const c of [from, to, dept, emp].filter(Boolean)) c.addEventListener("change", load);
  el.append(pageHead(t("nav_att_online"), h("a", { class: "btn", href: "#/attendance/report" }, t("nav_att_report")), csv),
    h("section", { class: "card" }, h("div", { class: "fields" }, field(t("holiday_from"), from), field(t("holiday_to"), to), dept ? field(t("f_department"), dept) : null, field(t("employee"), emp))),
    out);
  await load();
}
