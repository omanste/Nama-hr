import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, field, select, toast, errText, pageHead } from "../ui.js";
import { render as rerender } from "../app.js";
import { holidayEditor } from "../holidays.js";

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
  const START = []; for (let m = 6 * 60; m <= 12 * 60 + 30; m += 30) START.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${m % 60 ? "30" : "00"}`);
  // the two shifts of the attendance policy (§3); HR sets each person's shift on their profile
  const sh = {};
  for (const n of [1, 2]) sh[n] = { start: select(`shift_${n}_start`, START.map((x) => [x, x]), settings[`shift_${n}_start`]), end: select(`shift_${n}_end`, HALF.map((x) => [x, x]), settings[`shift_${n}_end`]) };
  const attStart = h("input", { type: "date", value: settings.attendance_start || "" });
  const selfShift = select("shift_self_select", [["1", t("shift_self_on")], ["0", t("shift_self_off")]], settings.shift_self_select === false ? "0" : "1");
  const rStart = h("input", { type: "date", value: settings.ramadan_start || "" });
  const rEnd = h("input", { type: "date", value: settings.ramadan_end || "" });
  const rHours = select("ramadan_hours", [[5, "5"], [5.5, "5.5"], [6, "6"], [6.5, "6.5"], [7, "7"]], settings.ramadan_hours);
  const hol = holidayEditor(settings.official_holidays || []);

  el.append(pageHead(t("nav_settings"), h("a", { class: "btn", href: "/api/admin/backup" }, t("backup_download"))),
    h("section", { class: "card" }, h("h2", null, t("departments")),
      h("div", { class: "table-wrap" }, h("table", null,
        h("thead", null, h("tr", null, [t("dept_name_ar"), t("dept_name_en"), t("dept_approver"), t("nav_staff"), t("active"), ""].map((x) => h("th", null, x)))),
        h("tbody", null, depts.items.map(deptRow),
          h("tr", null, h("td", null, newAr), h("td", null, newEn), h("td", { colspan: 3 }), h("td", null, h("button", { class: "btn small", type: "button", onclick: () => save(() => api.post("/api/departments", { name_ar: newAr.value, name_en: newEn.value })) }, t("add_department")))))))),
    h("section", { class: "card" }, h("h2", null, t("managers_approver")),
      h("div", { class: "fields" }, field(t("managers_approver"), mgr), field(t("managers_approver_title"), title)),
      h("div", { class: "row end", style: { marginTop: "12px" } }, h("button", { class: "btn primary", type: "button", onclick: () => save(() => api.put("/api/settings", { managers_approver_employee_id: mgr.value ? Number(mgr.value) : null, managers_approver_title: title.value })) }, t("save")))),
    h("section", { class: "card" }, h("h2", null, t("work_hours")),
      h("p", { class: "sub" }, t("work_hours_hint")),
      h("div", { class: "fields" },
        field(t("shift_1_start"), sh[1].start), field(t("shift_1_end"), sh[1].end), field(t("shift_2_start"), sh[2].start), field(t("shift_2_end"), sh[2].end),
        field(t("attendance_start"), attStart, { hint: t("attendance_start_hint") }),
        field(t("shift_self_select"), selfShift, { hint: t("shift_self_hint") }),
        field(t("ramadan_start"), rStart), field(t("ramadan_end"), rEnd), field(t("ramadan_hours"), rHours, { hint: t("ramadan_hours_hint") })),
      h("div", { class: "row end", style: { marginTop: "12px" } }, h("button", { class: "btn primary", type: "button", onclick: () => save(() => api.put("/api/settings", {
        shift_1_start: sh[1].start.value, shift_1_end: sh[1].end.value, shift_2_start: sh[2].start.value, shift_2_end: sh[2].end.value,
        ...(attStart.value ? { attendance_start: attStart.value } : {}), shift_self_select: selfShift.value === "1",
        ramadan_start: rStart.value || null, ramadan_end: rEnd.value || null, ramadan_hours: Number(rHours.value) })) }, t("save")))),
    h("section", { class: "card" }, h("h2", null, t("official_holidays")),
      hol.el,
      h("div", { class: "row end", style: { marginTop: "12px" } }, h("span", { class: "sub" }, t("holidays_save_hint")), h("button", { class: "btn primary", type: "button", onclick: () => save(() => api.put("/api/settings", {
        official_holidays: hol.value(),
      })) }, t("save")))),
    h("section", { class: "card" }, h("h2", null, t("contract_types")),
      field(t("contract_types"), types, { hint: t("contract_types_hint") }),
      h("div", { class: "row end", style: { marginTop: "12px" } }, h("button", { class: "btn primary", type: "button", onclick: () => save(() => api.put("/api/settings", { contract_types: types.value.split("\n").map((x) => x.trim()).filter(Boolean) })) }, t("save")))));
}
