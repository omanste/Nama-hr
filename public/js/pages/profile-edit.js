import { api } from "../api.js";
import { t, nm, getLang, splitLangs, joinLangs } from "../i18n.js";
import { countryOptions, countryName } from "../countries.js";
import { h, field, select, toast, errText, showFieldError, backLink } from "../ui.js";

const STATUSES = ["active", "on_leave", "resigned", "terminated", "disabled"];

export async function render(el, params, { can }) {
  if (!can.edit()) throw { status: 403 };
  const isNew = !params.id;
  const [cur, depts, emps, settings] = await Promise.all([
    isNew ? null : api.get(`/api/employees/${params.id}`), api.get("/api/departments"), api.get("/api/employees"), api.get("/api/settings"),
  ]);
  const e = cur ? cur.employee : { status: "active" };
  const inp = (name, attrs = {}) => h("input", { name, value: e[name] ?? "", ...attrs });
  const date = (name) => inp(name, { type: "date" });
  // text that can be written in both languages: an Arabic box and an English box side by side
  const both = (k, { long = false } = {}) => {
    const v = splitLangs(e[k]);
    const box = (lang) => { const c = long ? h("textarea", { name: `${k}__${lang}`, rows: 3, maxlength: 2000, dir: lang === "ar" ? "rtl" : "ltr" }) : h("input", { name: `${k}__${lang}`, dir: lang === "ar" ? "rtl" : "ltr" }); c.value = v[lang]; return c; };
    return h("div", { class: "field full bilingual", "data-field": k }, h("label", null, t("f_" + k)),
      h("div", { class: "pair" }, h("div", null, h("span", { class: "lang-tag" }, "عربي"), box("ar")), h("div", null, h("span", { class: "lang-tag" }, "English"), box("en"))),
      h("div", { class: "field-err" }));
  };
  const contractTypes = [...new Set([...(settings.contract_types || []), ...(e.contract_type ? [e.contract_type] : [])])];
  const form = h("form", { class: "form", novalidate: true, onsubmit: (ev) => save(ev, form, isNew, e) },
    h("section", { class: "card" }, h("h2", null, t("sec_personal")), h("div", { class: "fields" },
      field(t("f_name_ar"), inp("name_ar", { dir: "rtl" }), { req: true }),
      field(t("f_name_en"), inp("name_en", { dir: "ltr" })),
      field(t("f_emp_no"), inp("emp_no", { dir: "ltr" }), { hint: isNew ? t("f_emp_no_hint") : null }),
      field(t("f_gender"), select("gender", [["", "—"], ["male", t("g_male")], ["female", t("g_female")]], e.gender)),
      field(t("f_nationality"), select("nationality", [["", "—"], ...(e.nationality && !/^[A-Z]{2}$/.test(e.nationality) ? [[e.nationality, countryName(e.nationality)]] : []), ...countryOptions(getLang())], e.nationality)),
      field(t("f_dob"), date("dob")),
      field(t("f_civil_id"), inp("civil_id", { dir: "ltr", inputmode: "numeric" })),
      field(t("f_civil_id_expiry"), date("civil_id_expiry")))),
    h("section", { class: "card" }, h("h2", null, t("sec_contact")), h("div", { class: "fields" },
      field(t("f_mobile"), inp("mobile", { type: "tel", dir: "ltr" })),
      field(t("f_email"), inp("email", { type: "email", dir: "ltr" })),
      field(t("f_address"), inp("address"), { full: true }),
      field(t("f_emergency_name"), inp("emergency_name")),
      field(t("f_emergency_relation"), inp("emergency_relation")),
      field(t("f_emergency_phone"), inp("emergency_phone", { type: "tel", dir: "ltr" })))),
    h("section", { class: "card" }, h("h2", null, t("sec_job")), h("div", { class: "fields" },
      field(t("f_department_id"), select("department_id", [["", "—"], ...depts.items.map((d) => [d.id, nm(d)])], e.department_id)),
      both("job_title"),
      field(t("f_manager_employee_id"), select("manager_employee_id", [["", "—"], ...emps.items.filter((x) => x.id !== e.id).map((x) => [x.id, `${nm(x)} (${x.emp_no})`])], e.manager_employee_id)),
      field(t("f_join_date"), date("join_date")),
      field(t("f_status"), select("status", STATUSES.map((s) => [s, t("st_" + s)]), e.status)),
      field(t("f_shift"), select("shift", [[2, t("shift_2_full")], [1, t("shift_1_full")]], e.shift || 2), { hint: t("f_shift_hint") }),
      field(t("f_shift_locked"), select("shift_locked", [[0, t("shift_by_staff")], [1, t("shift_by_hr")]], e.shift_locked ? 1 : 0), { hint: t("f_shift_locked_hint") }),
      isNew ? field(t("f_opening_days"), h("input", { name: "opening_days", type: "number", min: "0", step: "0.25", inputmode: "decimal" }), { hint: t("f_opening_hint") }) : null)),
    h("section", { class: "card" }, h("h2", null, t("sec_contract")), h("div", { class: "fields" },
      field(t("f_contract_type"), select("contract_type", [["", "—"], ...contractTypes.map((c) => [c, c])], e.contract_type)),
      field(t("f_contract_end"), date("contract_end")))),
    h("section", { class: "card" }, h("h2", null, t("sec_qualifications")), h("div", { class: "fields" },
      h("p", { class: "sub full", style: { margin: 0 } }, t("both_boxes_hint")),
      ["education", "specialization", "experience", "languages"].map((k) => both(k)),
      ["certifications", "skills", "main_tasks"].map((k) => both(k, { long: true })))),
    h("div", { class: "form-actions" },
      h("a", { class: "btn", href: isNew ? "#/staff" : `#/staff/${e.id}` }, t("cancel")),
      h("button", { class: "btn primary", type: "submit" }, t("save"))));
  el.append(backLink(isNew ? "#/staff" : `#/staff/${e.id}`), h("h1", null, isNew ? t("new_employee") : `${t("edit_employee")} · ${nm(e)}`), form);
}

async function save(ev, form, isNew, e) {
  ev.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  // two-language fields are stored as "English | عربي"
  for (const k of Object.keys(data)) if (k.endsWith("__ar")) { const f = k.slice(0, -4); data[f] = joinLangs(data[k], data[f + "__en"]); delete data[k]; delete data[f + "__en"]; }
  if (!data.name_ar.trim() && !data.name_en.trim()) { showFieldError(form, "name_ar", t("required")); return; }
  if (!isNew) delete data.opening_days;
  else if (data.opening_days === "") delete data.opening_days;
  for (const k of ["department_id", "manager_employee_id"]) data[k] = data[k] ? Number(data[k]) : null;
  const btn = form.querySelector("button[type=submit]"); btn.disabled = true;
  try {
    const r = isNew ? await api.post("/api/employees", data) : await api.put(`/api/employees/${e.id}`, data);
    toast(t("saved"));
    location.hash = `#/staff/${r.employee.id}`;
  } catch (er) {
    btn.disabled = false;
    if (!(er.field && showFieldError(form, er.field, errText(er)))) toast(errText(er), "bad");
  }
}
