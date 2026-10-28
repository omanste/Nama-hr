// Profile updates to verify (HR, Admin): what each person changed in their own profile — before and after — to confirm or undo.
import { api } from "../api.js";
import { t, nm, getLang, tx } from "../i18n.js";
import { countryName } from "../countries.js";
import { h, select, pageHead, empty, dmy, dateTime, toast, errText, confirm, avatar } from "../ui.js";
import { render as rerender, refreshMe } from "../app.js";
import { bankName, ibanText } from "../banks.js";
import { wilayatName, areaName } from "../places.js";

const SOURCE_KEYS = { contact: "sec_contact", qualifications: "sec_qualifications", bank: "sec_bank", id: "pc_src_id", photo: "pc_src_photo" };
const DATES = ["dob", "civil_id_expiry"];
function show(k, v) {
  if (v === null || v === undefined || v === "") return h("span", { class: "muted" }, "—");
  if (k === "photo_file_id") return h("img", { src: `/api/files/${v}`, alt: "", class: "pc-photo" });
  if (DATES.includes(k)) return dmy(v);
  if (k === "gender") return t("g_" + v);
  if (k === "nationality") return countryName(v, getLang());
  if (k === "bank_name") return bankName(v);
  if (k === "perm_wilayat") return wilayatName(v);
  if (k === "current_area") return areaName(v);
  if (k === "bank_iban") return h("span", { dir: "ltr" }, ibanText(v));
  return h("span", { dir: "auto", style: { whiteSpace: "pre-line" } }, tx(String(v)));
}

export async function render(el, _p, { me, query }) {
  if (!["hr", "admin"].includes(me.user.role)) throw { status: 403 };
  const status = query.get("status") || "pending";
  const { items } = await api.get(`/api/profile-changes?status=${status}`);
  const sel = select("status", [["pending", t("pcs_pending")], ["confirmed", t("pcs_confirmed")], ["reverted", t("pcs_reverted")], ["all", t("all")]], status, { "aria-label": t("status") });
  sel.addEventListener("change", () => { location.hash = `#/profile-changes?status=${sel.value}`; });
  const act = (c, action) => async () => {
    let note = "";
    if (action === "revert") { note = await confirm(t("pc_undo_q"), { input: t("pc_undo_reason"), required: true, okText: t("pc_undo"), danger: true }); if (note === null) return; }
    try { await api.post(`/api/profile-changes/${c.id}/${action}`, { note }); toast(t("saved")); await refreshMe(); rerender(); } catch (e) { toast(errText(e), "bad"); }
  };
  const mine = (c) => me.employee && me.employee.id === c.employee_id;
  el.append(pageHead(t("nav_profile_changes")),
    h("p", { class: "sub" }, t("pc_intro")),
    h("div", { class: "toolbar" }, sel),
    items.length ? h("div", { class: "grid" }, items.map((c) => h("section", { class: "card" },
      h("div", { class: "card-head" },
        h("a", { class: "row", href: `#/staff/${c.employee_id}`, style: { textDecoration: "none", color: "inherit", gap: "10px" } }, avatar(c, 36), h("div", null, h("b", null, nm(c)), h("div", { class: "muted" }, c.emp_no))),
        h("span", { class: `badge ${c.status === "pending" ? "b-pending" : c.status === "confirmed" ? "b-approved" : "b-rejected"}` }, t("pcs_" + c.status))),
      h("p", { class: "sub", style: { margin: "6px 0 10px" } }, t(SOURCE_KEYS[c.source] || c.source), " · ", dateTime(c.created_at),
        c.decided_at ? ` · ${t("pcs_" + c.status)} ${dateTime(c.decided_at)}${c.decided_username ? ` (${c.decided_username})` : ""}` : "", c.note ? ` — ${c.note}` : ""),
      h("div", { class: "table-wrap keep-table" }, h("table", null,
        h("thead", null, h("tr", null, h("th", null, t("pc_field")), h("th", null, t("pc_before")), h("th", null, t("pc_after")))),
        h("tbody", null, Object.entries(c.changes).map(([k, [a, b]]) => h("tr", null, h("td", null, t("f_" + k)), h("td", { class: "pc-old" }, show(k, a)), h("td", { class: "pc-new" }, show(k, b))))))),
      c.status === "pending" ? (mine(c) ? h("p", { class: "sub" }, t("pc_not_own")) : h("div", { class: "row end", style: { marginTop: "10px" } },
        h("button", { class: "btn", type: "button", onclick: act(c, "revert") }, "↩ ", t("pc_undo")),
        h("button", { class: "btn ok", type: "button", onclick: act(c, "confirm") }, "✓ ", t("pc_confirm")))) : null))) : empty(t("pc_none")));
}
