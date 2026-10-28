import { api } from "../api.js";
import { t, nm, tx, getLang } from "../i18n.js";
import { h, clear, select, pageHead, badge, avatar, daysText, empty, dmy } from "../ui.js";

const STATUSES = ["active", "on_leave", "resigned", "terminated", "disabled"];
// sortable columns: the value each one sorts by
const COLS = [["emp_no", "f_emp_no"], ["name", "employee"], ["dept", "f_department"], ["job", "f_job_title"], ["join", "f_join_date"], ["remaining", "bal_remaining"], ["status", "f_status"]];
const SORT_KEY = "nama.staffSort";
const loadSort = () => { try { const v = JSON.parse(localStorage.getItem(SORT_KEY)); if (v && COLS.some(([k]) => k === v.key)) return v; } catch {} return { key: "emp_no", dir: 1 }; };
const saveSort = (v) => { try { localStorage.setItem(SORT_KEY, JSON.stringify(v)); } catch {} };

export async function render(el, _p, { can, query }) {
  const depts = (await api.get("/api/departments")).items;
  const q = h("input", { type: "search", placeholder: t("search"), "aria-label": t("search"), value: query.get("q") || "" });
  const dept = select("dept", [["", `${t("filter_dept")}: ${t("all")}`], ...depts.map((d) => [d.id, nm(d)])], query.get("dept") || "");
  const status = select("status", [["", `${t("filter_status")}: ${t("all")}`], ...STATUSES.map((s) => [s, t("st_" + s)])], query.get("status") ?? "active");
  const out = h("div");
  let timer, items = [], sort = loadSort();
  // phones show a list, not a table: the same choice as a menu
  const dirText = (k, d) => t(k === "join" ? (d > 0 ? "sort_old" : "sort_new") : k === "remaining" ? (d > 0 ? "sort_low" : "sort_high") : d > 0 ? "sort_asc" : "sort_desc");
  const sortSel = select("sort", COLS.flatMap(([k, label]) => [1, -1].map((d) => [`${k}:${d}`, `${t("sort_by")}: ${t(label)} ${dirText(k, d)}`])), `${sort.key}:${sort.dir}`, { "aria-label": t("sort_by") });
  sortSel.addEventListener("change", () => { const [key, dir] = sortSel.value.split(":"); setSort(key, Number(dir)); });
  const setSort = (key, dir) => { sort = { key, dir }; saveSort(sort); sortSel.value = `${key}:${dir}`; draw(); };
  const load = async () => {
    const qs = new URLSearchParams();
    if (q.value.trim()) qs.set("q", q.value.trim());
    if (dept.value) qs.set("dept", dept.value);
    if (status.value) qs.set("status", status.value);
    items = (await api.get(`/api/employees?${qs}`)).items;
    draw();
  };
  const deptName = (id) => nm(depts.find((d) => d.id === id)) || "—";
  const coll = () => new Intl.Collator(getLang() === "ar" ? "ar" : "en", { numeric: true, sensitivity: "base" }); // NAMA-2 before NAMA-10
  const value = (e, k) => ({ emp_no: e.emp_no, name: nm(e), dept: deptName(e.department_id), job: tx(e.job_title), join: e.join_date, remaining: e.remaining, status: t("st_" + e.status) })[k];
  function sorted() {
    const c = coll();
    return [...items].sort((a, b) => {
      const x = value(a, sort.key), y = value(b, sort.key);
      const blank = (v) => v === null || v === undefined || v === "" || v === "—";
      if (blank(x) || blank(y)) return blank(x) - blank(y); // empty values last, either way
      const r = typeof x === "number" && typeof y === "number" ? x - y : c.compare(String(x), String(y));
      return (r || c.compare(String(a.emp_no), String(b.emp_no))) * sort.dir;
    });
  }
  const head = ([k, label], i) => h("th", { class: i === 5 ? "num" : null, "aria-sort": sort.key === k ? (sort.dir > 0 ? "ascending" : "descending") : "none" },
    h("button", { class: "th-sort", type: "button", onclick: () => setSort(k, sort.key === k ? -sort.dir : 1) }, t(label), h("span", { class: "arrow", "aria-hidden": "true" }, sort.key === k ? (sort.dir > 0 ? "▲" : "▼") : "↕")));
  function draw() {
    const list = sorted();
    clear(out).append(!list.length ? empty() : matchMedia("(min-width: 900px)").matches
      ? h("div", { class: "table-wrap" }, h("table", null,
          h("thead", null, h("tr", null, COLS.map(head), can.edit() ? h("th", null, "") : null)),
          h("tbody", null, list.map((e) => h("tr", null,
            h("td", { class: "num" }, e.emp_no),
            h("td", null, h("a", { href: `#/staff/${e.id}`, class: "row", style: { flexWrap: "nowrap" } }, avatar(e, 28), nm(e))),
            h("td", null, deptName(e.department_id)), h("td", null, tx(e.job_title) || "—"), h("td", { class: "num" }, dmy(e.join_date)),
            h("td", { class: "num" }, daysText(e.remaining)), h("td", null, badge(e.status, "st_")),
            can.edit() ? h("td", null, h("a", { class: "btn small", href: `#/staff/${e.id}/edit` }, "✎ ", t("edit"))) : null)))))
      : h("div", { class: "list" }, list.map((e) => h("a", { class: "item", href: `#/staff/${e.id}` }, avatar(e, 44),
          h("div", { class: "grow" }, h("div", { class: "title" }, nm(e)), h("div", { class: "meta" }, [e.emp_no, deptName(e.department_id), tx(e.job_title)].filter(Boolean).join(" · "))),
          h("div", { style: { textAlign: "end" } }, h("div", { class: "num" }, daysText(e.remaining)), e.status !== "active" ? badge(e.status, "st_") : null)))));
  }
  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  dept.addEventListener("change", load); status.addEventListener("change", load);
  el.append(pageHead(t("staff_title"), can.edit() ? h("a", { class: "btn primary", href: "#/staff/new" }, t("add_employee")) : null),
    h("div", { class: "toolbar" }, q, dept, status, h("span", { class: "sort-mobile" }, sortSel)), out);
  await load();
}
