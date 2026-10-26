import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, badge, avatar, dmy, dateTime, daysText, num, daysOf, empty, toast, errText, confirm, select, field, backLink, todayIso } from "../ui.js";
import { balanceHero, requestItem } from "./home.js";
import { render as rerender } from "../app.js";

const DOC_TYPES = ["civil_id", "passport", "contract", "visa", "certificate", "medical", "other"];

export async function render(el, params, { me, can, opts }) {
  const id = opts.me ? me.employee?.id : params.id;
  if (!id) { el.append(empty(t("no_profile"))); return; }
  const p = await api.get(`/api/employees/${id}`);
  const e = p.employee, L = p.leave;
  const own = me.employee && me.employee.id === e.id;
  const facts = (pairs) => h("dl", { class: "facts" }, pairs.map(([k, v]) => h("div", null, h("dt", null, t(k)), h("dd", { dir: "auto" }, v || "—"))));

  const photo = can.edit()
    ? h("label", { class: "photo-edit", title: t("change_photo"), style: { cursor: "pointer" } }, avatar(e, 72),
        h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true, onchange: async (ev) => {
          const f = ev.target.files[0]; if (!f) return;
          try { await api.upload(`/api/employees/${e.id}/files?kind=photo&name=${encodeURIComponent(f.name)}`, f); toast(t("saved")); rerender(); } catch (er) { toast(errText(er), "bad"); }
        } }))
    : avatar(e, 72);

  el.append(
    opts.me ? null : backLink("#/staff"),
    h("div", { class: "profile-head" }, photo,
      h("div", { class: "grow" }, h("h1", null, nm(e)), h("div", { class: "sub" }, [e.emp_no, e.job_title, nm(p.department)].filter(Boolean).join(" · ")), h("div", { class: "row", style: { marginTop: "6px" } }, badge(e.status, "st_"))),
      h("div", { class: "row" },
        can.edit() ? h("a", { class: "btn", href: `#/staff/${e.id}/edit` }, t("edit")) : null,
        can.edit() ? h("button", { class: "btn", type: "button", onclick: () => adjustDialog(e) }, t("adjust_balance")) : null)),

    h("div", { class: "grid cols2" },
      h("div", { class: "grid" },
        balanceHero(L, { apply: own }),
        L.eligibleFrom && L.eligibleFrom > todayIso() ? h("div", { class: "note" }, t("eligible_from", { d: dmy(L.eligibleFrom) })) : null,
        !e.join_date ? h("div", { class: "note" }, t("no_join_date")) : null),
      h("section", { class: "card" }, h("h2", null, t("by_type")),
        h("dl", { class: "facts" }, Object.entries(L.byType).map(([k, v]) => h("div", null, h("dt", null, t("lt_" + k)), h("dd", { class: "num" }, k === "early" ? t("hours", { n: num(v / 60) }) : daysText(v))))),
        h("dl", { class: "facts", style: { marginTop: "14px" } },
          h("div", null, h("dt", null, t("f_join_date")), h("dd", null, dmy(e.join_date))),
          h("div", null, h("dt", null, t("probation_end")), h("dd", null, dmy(L.probationEnd)))))),

    h("section", { class: "card" }, h("h2", null, t("sec_requests")),
      p.requests.length ? h("div", { class: "list" }, p.requests.map((r) => requestItem(r))) : empty()),

    p.ledger ? h("section", { class: "card" }, h("h2", null, t("sec_ledger")),
      h("div", { class: "table-wrap" }, h("table", null,
        h("thead", null, h("tr", null, h("th", null, t("date")), h("th", null, t("action")), h("th", { class: "num" }, t("amount")), h("th", null, t("details")))),
        h("tbody", null, p.ledger.slice().reverse().map((l) => h("tr", null,
          h("td", { class: "num" }, dmy(l.effective_date)), h("td", null, t("lk_" + l.kind)),
          h("td", { class: "num", style: { color: l.minutes < 0 ? "var(--bad)" : "var(--ok)" } }, (l.minutes > 0 ? "+" : "") + num(daysOf(l.minutes))),
          h("td", { class: "muted" }, l.request_id ? h("a", { href: `#/leave/${l.request_id}` }, `#${l.request_id}`) : null, " ", l.kind === "adjustment" ? l.note : ""))))))) : null,

    h("div", { class: "grid cols2" },
      h("section", { class: "card" }, h("h2", null, t("sec_personal")), facts([
        ["f_name_ar", e.name_ar], ["f_name_en", e.name_en], ["f_emp_no", e.emp_no], ["f_nationality", e.nationality], ["f_dob", dmy(e.dob)],
        ["f_civil_id", e.civil_id], ["f_civil_id_expiry", dmy(e.civil_id_expiry)]])),
      h("section", { class: "card" }, h("h2", null, t("sec_contact")), facts([
        ["f_mobile", e.mobile && h("a", { href: `tel:${e.mobile}`, dir: "ltr" }, e.mobile)], ["f_email", e.email && h("a", { href: `mailto:${e.email}` }, e.email)], ["f_address", e.address],
        ["f_emergency_name", e.emergency_name], ["f_emergency_relation", e.emergency_relation], ["f_emergency_phone", e.emergency_phone && h("span", { dir: "ltr" }, e.emergency_phone)]])),
      h("section", { class: "card" }, h("h2", null, t("sec_job")), facts([
        ["f_department_id", nm(p.department)], ["f_job_title", e.job_title], ["f_manager_employee_id", nm(p.manager)], ["f_join_date", dmy(e.join_date)], ["f_status", t("st_" + e.status)]])),
      h("section", { class: "card" }, h("h2", null, t("sec_contract")), facts([["f_contract_type", e.contract_type], ["f_contract_end", dmy(e.contract_end)]]),
        p.login !== undefined ? h("div", { style: { marginTop: "14px" } }, h("h3", null, t("login_account")),
          p.login ? h("div", { class: "sub" }, `${p.login.username} · ${t("role_" + p.login.role)}${p.login.active ? "" : " · " + t("inactive")}`)
            : h("div", { class: "row" }, h("span", { class: "sub" }, t("no_login")), can.edit() ? h("button", { class: "btn small", type: "button", onclick: () => createLogin(e) }, t("create_login")) : null)) : null)),

    h("section", { class: "card" }, h("h2", null, t("sec_qualifications")), h("dl", { class: "facts" },
      ["education", "specialization", "experience", "languages", "certifications"].map((k) => h("div", null, h("dt", null, t("f_" + k)), h("dd", { dir: "auto" }, e[k] || "—"))),
      ["skills", "main_tasks"].map((k) => h("div", { style: { gridColumn: "1/-1" } }, h("dt", null, t("f_" + k)), h("dd", { dir: "auto", style: { whiteSpace: "pre-line" } }, e[k] || "—"))))),
    documents(p, e, can),
    h("section", { class: "card kpi-placeholder" }, h("h2", null, t("sec_kpi")), h("p", null, t("kpi_later"))));
}

function documents(p, e, can) {
  const docs = p.files.filter((f) => f.kind === "doc");
  const type = select("doc_type", DOC_TYPES.map((d) => [d, t("dt_" + d)]), "civil_id");
  const expiry = h("input", { type: "date", name: "expiry" });
  const file = h("input", { type: "file", name: "file", accept: "application/pdf,image/png,image/jpeg,image/webp", required: true });
  const upload = can.edit() ? h("form", { class: "fields", style: { marginTop: "14px" }, onsubmit: async (ev) => {
    ev.preventDefault();
    const f = file.files[0]; if (!f) return;
    const qs = new URLSearchParams({ kind: "doc", doc_type: type.value, name: f.name });
    if (expiry.value) qs.set("expiry", expiry.value);
    try { await api.upload(`/api/employees/${e.id}/files?${qs}`, f); toast(t("saved")); rerender(); } catch (er) { toast(errText(er), "bad"); }
  } }, field(t("doc_type"), type), field(t("doc_expiry"), expiry), field(t("upload_document"), file), h("div", { class: "field", style: { alignSelf: "end" } }, h("button", { class: "btn primary", type: "submit" }, t("upload_document")))) : null;
  return h("section", { class: "card" }, h("h2", null, t("sec_documents")),
    docs.length ? h("div", { class: "list" }, docs.map((f) => h("div", { class: "item" },
      h("div", { class: "grow" }, h("div", { class: "title" }, h("a", { href: `/api/files/${f.id}`, target: "_blank", rel: "noopener" }, f.name)),
        h("div", { class: "meta" }, t("dt_" + (f.doc_type || "other")), f.expiry ? ` · ${t("doc_expiry")}: ${dmy(f.expiry)}` : "", ` · ${dateTime(f.uploaded_at)}`)),
      h("a", { class: "btn small", href: `/api/files/${f.id}?download=1` }, t("download")),
      can.edit() ? h("button", { class: "btn small danger", type: "button", onclick: async () => {
        if (!(await confirm(t("delete_file_q"), { danger: true, okText: t("delete") }))) return;
        try { await api.del(`/api/files/${f.id}`); rerender(); } catch (er) { toast(errText(er), "bad"); }
      } }, t("delete")) : null))) : h("div", { class: "empty" }, t("no_results")),
    upload);
}

async function createLogin(e) {
  try {
    const r = await api.post(`/api/employees/${e.id}/login`, {});
    await showTempPassword(r.user.username, r.tempPassword);
    rerender();
  } catch (er) { toast(errText(er), "bad"); }
}

export function showTempPassword(username, pw) {
  return new Promise((resolve) => {
    const dlg = h("dialog", { class: "dialog" }, h("form", { method: "dialog" },
      h("h2", null, t("temp_password_title")),
      h("p", { class: "sub" }, t("temp_password_note")),
      h("div", { class: "card", dir: "ltr", style: { fontFamily: "monospace", fontSize: "18px", textAlign: "center", userSelect: "all" } }, `${username}  ·  ${pw}`),
      h("div", { class: "row end" }, h("button", { class: "btn primary", type: "submit" }, t("close")))));
    dlg.addEventListener("close", () => { dlg.remove(); resolve(); });
    document.body.append(dlg); dlg.showModal();
  });
}

function adjustDialog(e) {
  const sign = select("sign", [["1", t("adjust_add")], ["-1", t("adjust_deduct")]], "1");
  const unit = select("unit", [["480", t("adjust_unit_days")], ["60", t("adjust_unit_hours")]], "480");
  const amount = h("input", { type: "number", min: "0.5", step: "0.5", required: true, inputmode: "decimal" });
  const note = h("textarea", { required: true, rows: 2 });
  const err = h("div", { class: "form-error" });
  const dlg = h("dialog", { class: "dialog" }, h("form", { class: "form", onsubmit: async (ev) => {
    ev.preventDefault();
    const minutes = Math.round(Number(amount.value) * Number(unit.value)) * Number(sign.value);
    if (!minutes || !note.value.trim()) { err.textContent = t("required"); return; }
    try { await api.post(`/api/employees/${e.id}/adjust`, { minutes, note: note.value.trim() }); dlg.close(); toast(t("saved")); rerender(); }
    catch (er) { err.textContent = errText(er); }
  } },
    h("h2", null, t("adjust_balance"), " · ", nm(e)),
    h("div", { class: "fields" }, field(t("action"), sign), field(t("adjust_amount"), amount), field(t("adjust_unit_days") + " / " + t("adjust_unit_hours"), unit)),
    field(t("adjust_reason"), note, { full: true }), err,
    h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t("cancel")), h("button", { class: "btn primary", type: "submit" }, t("save")))));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal(); amount.focus();
}
