import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, clear, select, pageHead, badge, avatar, daysText, empty, dmy } from "../ui.js";

const STATUSES = ["active", "on_leave", "resigned", "terminated"];

export async function render(el, _p, { can, query }) {
  const depts = (await api.get("/api/departments")).items;
  const q = h("input", { type: "search", placeholder: t("search"), "aria-label": t("search"), value: query.get("q") || "" });
  const dept = select("dept", [["", `${t("filter_dept")}: ${t("all")}`], ...depts.map((d) => [d.id, nm(d)])], query.get("dept") || "");
  const status = select("status", [["", `${t("filter_status")}: ${t("all")}`], ...STATUSES.map((s) => [s, t("st_" + s)])], query.get("status") ?? "active");
  const out = h("div");
  let timer;
  const load = async () => {
    const qs = new URLSearchParams();
    if (q.value.trim()) qs.set("q", q.value.trim());
    if (dept.value) qs.set("dept", dept.value);
    if (status.value) qs.set("status", status.value);
    const { items } = await api.get(`/api/employees?${qs}`);
    const deptName = (id) => nm(depts.find((d) => d.id === id)) || "—";
    clear(out).append(!items.length ? empty() : matchMedia("(min-width: 900px)").matches
      ? h("div", { class: "table-wrap" }, h("table", null,
          h("thead", null, h("tr", null, [t("f_emp_no"), t("employee"), t("f_department"), t("f_job_title"), t("f_join_date"), t("bal_remaining"), t("f_status")].map((x, i) => h("th", { class: i === 5 ? "num" : null }, x)))),
          h("tbody", null, items.map((e) => h("tr", null,
            h("td", { class: "num" }, e.emp_no),
            h("td", null, h("a", { href: `#/staff/${e.id}`, class: "row", style: { flexWrap: "nowrap" } }, avatar(e, 28), nm(e))),
            h("td", null, deptName(e.department_id)), h("td", null, e.job_title || "—"), h("td", { class: "num" }, dmy(e.join_date)),
            h("td", { class: "num" }, daysText(e.remaining)), h("td", null, badge(e.status, "st_")))))))
      : h("div", { class: "list" }, items.map((e) => h("a", { class: "item", href: `#/staff/${e.id}` }, avatar(e, 44),
          h("div", { class: "grow" }, h("div", { class: "title" }, nm(e)), h("div", { class: "meta" }, [e.emp_no, deptName(e.department_id), e.job_title].filter(Boolean).join(" · "))),
          h("div", { style: { textAlign: "end" } }, h("div", { class: "num" }, daysText(e.remaining)), e.status !== "active" ? badge(e.status, "st_") : null)))));
  };
  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  dept.addEventListener("change", load); status.addEventListener("change", load);
  el.append(pageHead(t("staff_title"), can.edit() ? h("a", { class: "btn primary", href: "#/staff/new" }, t("add_employee")) : null),
    h("div", { class: "toolbar" }, q, dept, status), out);
  await load();
}
