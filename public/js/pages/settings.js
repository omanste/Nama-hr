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
  const chair = select("chairman", people, settings.chairman_employee_id);
  const FINAL = ["unpaid", "annual", "hajj", "exam", "patient_care", "childcare", "comp_day"];
  const finalBoxes = FINAL.map((k) => [k, h("input", { type: "checkbox", checked: (settings.ceo_final_types || []).includes(k) })]);
  const types = h("textarea", { rows: 4 }); types.value = settings.contract_types.join("\n");
  const HALF = []; for (let m = 10 * 60; m <= 20 * 60; m += 30) HALF.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${m % 60 ? "30" : "00"}`);
  const START = []; for (let m = 6 * 60; m <= 12 * 60 + 30; m += 30) START.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${m % 60 ? "30" : "00"}`);
  // the two shifts of the attendance policy (§3); HR sets each person's shift on their profile
  const sh = {};
  for (const n of [1, 2, 3]) sh[n] = { start: select(`shift_${n}_start`, START.map((x) => [x, x]), settings[`shift_${n}_start`]), end: select(`shift_${n}_end`, HALF.map((x) => [x, x]), settings[`shift_${n}_end`]) };
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
    // top management: who the CEO and the Chairman are, and which leave needs the CEO's final approval
    h("section", { class: "card" }, h("h2", null, t("top_mgmt")), h("p", { class: "sub" }, t("top_mgmt_hint")),
      h("div", { class: "fields" }, field(t("role_ceo"), mgr, { hint: t("ceo_hint") }), field(t("role_chairman"), chair, { hint: t("chairman_hint") })),
      h("h3", null, t("ceo_final")), h("p", { class: "sub" }, t("ceo_final_hint")),
      h("div", { class: "row", style: { gap: "6px 16px" } }, finalBoxes.map(([k, box]) => h("label", { class: "row", style: { gap: "6px" } }, box, t("lt_" + k)))),
      h("div", { class: "row end", style: { marginTop: "12px" } }, h("button", { class: "btn primary", type: "button", onclick: () => save(() => api.put("/api/settings", {
        managers_approver_employee_id: mgr.value ? Number(mgr.value) : null, managers_approver_title: "ceo", chairman_employee_id: chair.value ? Number(chair.value) : null,
        ceo_final_types: finalBoxes.filter(([, x]) => x.checked).map(([k]) => k) })) }, t("save")))),
    h("section", { class: "card" }, h("h2", null, t("work_hours")),
      h("p", { class: "sub" }, t("work_hours_hint")),
      h("div", { class: "fields" },
        field(t("shift_1_start"), sh[1].start), field(t("shift_1_end"), sh[1].end), field(t("shift_2_start"), sh[2].start), field(t("shift_2_end"), sh[2].end),
        field(t("shift_3_start"), sh[3].start, { hint: t("shift_3_hint") }), field(t("shift_3_end"), sh[3].end),
        field(t("attendance_start"), attStart, { hint: t("attendance_start_hint") }),
        field(t("shift_self_select"), selfShift, { hint: t("shift_self_hint") }),
        field(t("ramadan_start"), rStart), field(t("ramadan_end"), rEnd), field(t("ramadan_hours"), rHours, { hint: t("ramadan_hours_hint") })),
      h("div", { class: "row end", style: { marginTop: "12px" } }, h("button", { class: "btn primary", type: "button", onclick: () => save(() => api.put("/api/settings", {
        shift_1_start: sh[1].start.value, shift_1_end: sh[1].end.value, shift_2_start: sh[2].start.value, shift_2_end: sh[2].end.value, shift_3_start: sh[3].start.value, shift_3_end: sh[3].end.value,
        ...(attStart.value ? { attendance_start: attStart.value } : {}), shift_self_select: selfShift.value === "1",
        ramadan_start: rStart.value || null, ramadan_end: rEnd.value || null, ramadan_hours: Number(rHours.value) })) }, t("save")))),
    sitesCard(settings, save),
    h("section", { class: "card" }, h("h2", null, t("official_holidays")),
      hol.el,
      h("div", { class: "row end", style: { marginTop: "12px" } }, h("span", { class: "sub" }, t("holidays_save_hint")), h("button", { class: "btn primary", type: "button", onclick: () => save(() => api.put("/api/settings", {
        official_holidays: hol.value(),
      })) }, t("save")))),
    h("section", { class: "card" }, h("h2", null, t("contract_types")),
      field(t("contract_types"), types, { hint: t("contract_types_hint") }),
      h("div", { class: "row end", style: { marginTop: "12px" } }, h("button", { class: "btn primary", type: "button", onclick: () => save(() => api.put("/api/settings", { contract_types: types.value.split("\n").map((x) => x.trim()).filter(Boolean) })) }, t("save")))),
    restoreCard());
}

/** Load a full backup (e.g. from the test portal into production). Replaces everything; typed confirmation required. */
function restoreCard() {
  const file = h("input", { type: "file", accept: ".db" });
  const word = h("input", { dir: "ltr", autocomplete: "off", placeholder: "RESTORE" });
  const out = h("div", { "aria-live": "polite" });
  const btn = h("button", { class: "btn danger", type: "button", onclick: async () => {
    const f = file.files[0];
    if (!f) { toast(t("restore_pick"), "bad"); return; }
    if (word.value.trim() !== "RESTORE") { toast(t("restore_type"), "bad"); word.focus(); return; }
    btn.disabled = true; out.replaceChildren(h("p", { class: "sub" }, t("loading")));
    try {
      const r = await api.upload("/api/admin/restore", f, { "x-confirm": "RESTORE" });
      out.replaceChildren(h("div", { class: "note" }, t("restore_done", { staff: r.counts.employees || 0, files: r.counts.uploads || 0 })));
      setTimeout(() => { location.hash = "#/login"; location.reload(); }, 2500);
    } catch (e) { btn.disabled = false; out.replaceChildren(h("div", { class: "note bad" }, errText(e))); }
  } }, t("restore_btn"));
  return h("section", { class: "card" }, h("h2", null, t("restore_title")),
    h("p", { class: "sub" }, t("backup_hint")),
    h("div", { class: "note bad" }, t("restore_warn")),
    h("div", { class: "fields", style: { marginTop: "12px" } }, field(t("restore_file"), file), field(t("restore_type"), word)),
    h("div", { class: "row end", style: { marginTop: "12px" } }, btn), out);
}

/** Work sites for online check-in (a point and a radius) and the late grace. */
function sitesCard(settings, save) {
  const rows = h("div", { class: "sites" });
  const grace = h("input", { type: "number", min: 0, max: 60, step: 1, value: settings.late_grace_min ?? 15, style: { maxWidth: "120px" } });
  const row = (s = {}) => {
    const inp = (k, attrs) => h("input", { name: k, value: s[k] ?? "", ...attrs });
    const f = { name_ar: inp("name_ar", { dir: "rtl" }), name_en: inp("name_en", { dir: "ltr" }), lat: inp("lat", { inputmode: "decimal", dir: "ltr" }),
      lng: inp("lng", { inputmode: "decimal", dir: "ltr" }), radius_m: inp("radius_m", { type: "number", min: 30, max: 2000, step: 10, value: s.radius_m ?? 150 }) };
    const box = h("div", { class: "site-row card" },
      h("div", { class: "fields" }, field(t("site_name_ar"), f.name_ar), field(t("site_name_en"), f.name_en), field(t("site_lat"), f.lat), field(t("site_lng"), f.lng), field(t("site_radius"), f.radius_m)),
      h("div", { class: "row", style: { gap: "8px", marginTop: "8px" } },
        h("button", { class: "btn small", type: "button", onclick: () => navigator.geolocation ? navigator.geolocation.getCurrentPosition(
          (p) => { f.lat.value = p.coords.latitude.toFixed(6); f.lng.value = p.coords.longitude.toFixed(6); toast(`±${Math.round(p.coords.accuracy)} m`); },
          () => toast(t("ci_geo_denied"), "bad"), { enableHighAccuracy: true, timeout: 15000 }) : toast(t("ci_no_geo"), "bad") }, t("site_here")),
        h("button", { class: "btn small", type: "button", onclick: () => f.lat.value && f.lng.value && window.open(`https://maps.google.com/?q=${f.lat.value},${f.lng.value}`, "_blank", "noopener") }, "🗺 ", t("site_map")),
        h("button", { class: "btn small danger", type: "button", onclick: () => box.remove() }, t("delete"))));
    box.read = () => ({ id: s.id, name_ar: f.name_ar.value, name_en: f.name_en.value, lat: f.lat.value, lng: f.lng.value, radius_m: Number(f.radius_m.value) });
    return box;
  };
  for (const s of settings.att_sites || []) rows.append(row(s));
  return h("section", { class: "card" }, h("h2", null, t("att_sites")), h("p", { class: "sub" }, t("att_sites_hint")), rows,
    h("div", { class: "row", style: { marginTop: "10px" } }, h("button", { class: "btn", type: "button", onclick: () => rows.append(row()) }, "+ ", t("site_add"))),
    h("div", { class: "fields", style: { marginTop: "14px" } }, field(t("late_grace"), grace, { hint: t("att_policy_note", { n: grace.value }) })),
    h("div", { class: "row end", style: { marginTop: "12px" } }, h("button", { class: "btn primary", type: "button", onclick: () => save(() => api.put("/api/settings", {
      att_sites: [...rows.children].map((r) => r.read()), late_grace_min: Number(grace.value) })) }, t("save"))));
}
