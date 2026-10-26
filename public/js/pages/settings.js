import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, field, select, toast, errText, pageHead } from "../ui.js";
import { render as rerender } from "../app.js";

export async function render(el, _p, { can }) {
  if (!can.admin()) throw { status: 403 };
  const [depts, emps, settings] = await Promise.all([api.get("/api/departments"), api.get("/api/employees?status=active"), api.get("/api/settings")]);
  const people = [["", t("no_approver")], ...emps.items.map((e) => [e.id, `${nm(e)} (${e.emp_no})`])];
  const save = async (fn) => { try { await fn(); toast(t("saved")); rerender(); } catch (e) { toast(errText(e), "bad"); } };

  const deptRow = (d) => {
    const ar = h("input", { value: d.name_ar, "aria-label": t("dept_name_ar") });
    const en = h("input", { value: d.name_en, dir: "ltr", "aria-label": t("dept_name_en") });
    const appr = select("approver", people, d.approver_employee_id, { "aria-label": t("dept_approver") });
    const active = h("input", { type: "checkbox", checked: !!d.active, "aria-label": t("active") });
    return h("tr", null, h("td", null, ar), h("td", null, en), h("td", null, appr), h("td", { class: "num" }, t("staff_n", { n: d.staff_count })),
      h("td", null, active), h("td", null, h("button", { class: "btn small primary", type: "button", onclick: () => save(() => api.put(`/api/departments/${d.id}`, { name_ar: ar.value, name_en: en.value, approver_employee_id: appr.value ? Number(appr.value) : null, active: active.checked })) }, t("save"))));
  };
  const newAr = h("input", { placeholder: t("dept_name_ar") }), newEn = h("input", { placeholder: t("dept_name_en"), dir: "ltr" });

  const mgr = select("managers", people, settings.managers_approver_employee_id);
  const title = select("title", [["ceo", t("title_ceo")], ["chairman", t("title_chairman")]], settings.managers_approver_title);
  const types = h("textarea", { rows: 4 }); types.value = settings.contract_types.join("\n");
  const HALF = []; for (let m = 10 * 60; m <= 20 * 60; m += 30) HALF.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${m % 60 ? "30" : "00"}`);
  const dayEnd = select("work_day_end", HALF.map((x) => [x, x]), settings.work_day_end);
  const rStart = h("input", { type: "date", value: settings.ramadan_start || "" });
  const rEnd = h("input", { type: "date", value: settings.ramadan_end || "" });
  const rDayEnd = select("ramadan_day_end", HALF.map((x) => [x, x]), settings.ramadan_day_end);

  el.append(pageHead(t("nav_settings"), h("a", { class: "btn", href: "/api/admin/backup" }, t("backup_download"))),
    h("section", { class: "card" }, h("h2", null, t("departments")),
      h("div", { class: "table-wrap" }, h("table", null,
        h("thead", null, h("tr", null, [t("dept_name_ar"), t("dept_name_en"), t("dept_approver"), t("nav_staff"), t("active"), ""].map((x) => h("th", null, x)))),
        h("tbody", null, depts.items.map(deptRow),
          h("tr", null, h("td", null, newAr), h("td", null, newEn), h("td", { colspan: 3 }), h("td", null, h("button", { class: "btn small", type: "button", onclick: () => save(() => api.post("/api/departments", { name_ar: newAr.value, name_en: newEn.value })) }, t("add_department")))))))),
    h("section", { class: "card" }, h("h2", null, t("managers_approver")),
      h("div", { class: "fields" }, field(t("managers_approver"), mgr), field(t("managers_approver_title"), title)),
      h("div", { class: "row end", style: { marginTop: "12px" } }, h("button", { class: "btn primary", type: "button", onclick: () => save(() => api.put("/api/settings", { managers_approver_employee_id: mgr.value ? Number(mgr.value) : null, managers_approver_title: title.value })) }, t("save")))),
    h("section", { class: "card" }, h("h2", null, t("ramadan")),
      h("p", { class: "sub" }, t("ramadan_hint")),
      h("div", { class: "fields" }, field(t("work_day_end"), dayEnd), field(t("ramadan_start"), rStart), field(t("ramadan_end"), rEnd), field(t("ramadan_day_end"), rDayEnd)),
      h("div", { class: "row end", style: { marginTop: "12px" } }, h("button", { class: "btn primary", type: "button", onclick: () => save(() => api.put("/api/settings", { work_day_end: dayEnd.value, ramadan_start: rStart.value || null, ramadan_end: rEnd.value || null, ramadan_day_end: rDayEnd.value })) }, t("save")))),
    h("section", { class: "card" }, h("h2", null, t("contract_types")),
      field(t("contract_types"), types, { hint: t("contract_types_hint") }),
      h("div", { class: "row end", style: { marginTop: "12px" } }, h("button", { class: "btn primary", type: "button", onclick: () => save(() => api.put("/api/settings", { contract_types: types.value.split("\n").map((x) => x.trim()).filter(Boolean) })) }, t("save")))));
}
