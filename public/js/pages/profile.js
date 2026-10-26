import { api } from "../api.js";
import { t, nm, getLang, tx } from "../i18n.js";
import { countryName } from "../countries.js";
import { h, badge, avatar, dmy, dateTime, daysText, num, daysOf, empty, toast, errText, confirm, select, field, backLink, todayIso } from "../ui.js";
import { balanceHero, requestItem } from "./home.js";
import { render as rerender } from "../app.js";

const DOC_TYPES = ["civil_id", "passport", "contract", "visa", "certificate", "medical", "consent", "other"];
// staff may add their own papers; contracts and payout consents stay with HR (server enforces the same)
const SELF_DOC_TYPES = ["civil_id", "passport", "visa", "certificate", "medical", "other"];
const DOC_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

async function uploadDoc(e, f, docType, expiry) {
  if (!f) return;
  const qs = new URLSearchParams({ kind: "doc", doc_type: docType, name: f.name || `${docType}.jpg` });
  if (expiry) qs.set("expiry", expiry);
  try { await api.upload(`/api/employees/${e.id}/files?${qs}`, f); toast(t("saved")); rerender(); } catch (er) { toast(errText(er), "bad"); }
}
/** Two buttons: open the phone camera (scan) or pick a file. */
function pickButtons(onFile, { scanLabel = t("scan_camera"), fileLabel = t("upload_file") } = {}) {
  const picker = (attrs) => h("input", { type: "file", hidden: true, ...attrs, onchange: (ev) => { const f = ev.target.files[0]; ev.target.value = ""; onFile(f); } });
  return h("div", { class: "row" },
    h("label", { class: "btn" }, "📷 ", scanLabel, picker({ accept: "image/*", capture: "environment" })),
    h("label", { class: "btn" }, "📎 ", fileLabel, picker({ accept: DOC_ACCEPT })));
}

export async function render(el, params, { me, can, opts }) {
  const id = opts.me ? me.employee?.id : params.id;
  if (!id) { el.append(empty(t("no_profile"))); return; }
  const p = await api.get(`/api/employees/${id}`);
  const e = p.employee, L = p.leave;
  const own = me.employee && me.employee.id === e.id;
  const mayUpload = can.edit() || own;
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
      h("div", { class: "grow" }, h("h1", null, nm(e)), h("div", { class: "sub" }, [e.emp_no, tx(e.job_title), nm(p.department)].filter(Boolean).join(" · ")), h("div", { class: "row", style: { marginTop: "6px" } }, badge(e.status, "st_"))),
      h("div", { class: "row" },
        can.edit() ? h("a", { class: "btn", href: `#/staff/${e.id}/edit` }, t("edit")) : null,
        can.edit() ? h("button", { class: "btn", type: "button", onclick: () => adjustDialog(e) }, t("adjust_balance")) : null,
        can.edit() ? h("button", { class: "btn", type: "button", onclick: () => encashDialog(e, p.files.filter((f) => f.doc_type === "consent")) }, t("encash")) : null)),

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
        ["f_name_ar", e.name_ar], ["f_name_en", e.name_en], ["f_emp_no", e.emp_no], ["f_gender", e.gender ? t("g_" + e.gender) : ""], ["f_nationality", countryName(e.nationality, getLang())], ["f_dob", dmy(e.dob)],
        ["f_civil_id", e.civil_id], ["f_civil_id_expiry", dmy(e.civil_id_expiry)]]), civilIdCard(p, e, mayUpload)),
      h("section", { class: "card" }, h("h2", null, t("sec_contact")), facts([
        ["f_mobile", e.mobile && h("a", { href: `tel:${e.mobile}`, dir: "ltr" }, e.mobile)], ["f_email", e.email && h("a", { href: `mailto:${e.email}` }, e.email)], ["f_address", e.address],
        ["f_emergency_name", e.emergency_name], ["f_emergency_relation", e.emergency_relation], ["f_emergency_phone", e.emergency_phone && h("span", { dir: "ltr" }, e.emergency_phone)]])),
      h("section", { class: "card" }, h("h2", null, t("sec_job")), facts([
        ["f_department_id", nm(p.department)], ["f_job_title", tx(e.job_title)], ["f_manager_employee_id", nm(p.manager)], ["f_join_date", dmy(e.join_date)], ["f_status", t("st_" + e.status)]])),
      h("section", { class: "card" }, h("h2", null, t("sec_contract")), facts([["f_contract_type", e.contract_type], ["f_contract_end", dmy(e.contract_end)]]),
        p.login !== undefined ? h("div", { style: { marginTop: "14px" } }, h("h3", null, t("login_account")),
          p.login ? h("div", { class: "sub" }, `${p.login.username} · ${t("role_" + p.login.role)}${p.login.active ? "" : " · " + t("inactive")}`)
            : h("div", { class: "row" }, h("span", { class: "sub" }, t("no_login")), can.edit() ? h("button", { class: "btn small", type: "button", onclick: () => createLogin(e) }, t("create_login")) : null)) : null)),

    h("section", { class: "card" }, h("h2", null, t("sec_qualifications")), h("dl", { class: "facts" },
      ["education", "specialization", "experience", "languages", "certifications"].map((k) => h("div", null, h("dt", null, t("f_" + k)), h("dd", { dir: "auto" }, tx(e[k]) || "—"))),
      ["skills", "main_tasks"].map((k) => h("div", { style: { gridColumn: "1/-1" } }, h("dt", null, t("f_" + k)), h("dd", { dir: "auto", style: { whiteSpace: "pre-line" } }, tx(e[k]) || "—"))))),
    documents(p, e, can, mayUpload),
    h("section", { class: "card kpi-placeholder" }, h("h2", null, t("sec_kpi")), h("p", null, t("kpi_later"))));
}

/** Civil ID copy: front/back scans or a PDF, shown as thumbnails right under the ID number. */
function civilIdCard(p, e, mayUpload) {
  const ids = p.files.filter((f) => f.kind === "doc" && f.doc_type === "civil_id");
  return h("div", { style: { marginTop: "14px" } },
    h("h3", null, t("civil_id_copy")),
    ids.length ? h("div", { class: "id-thumbs" }, ids.map((f) => h("a", { href: `/api/files/${f.id}`, target: "_blank", rel: "noopener", title: f.name },
      f.mime.startsWith("image/") ? h("img", { src: `/api/files/${f.id}`, alt: t("dt_civil_id"), loading: "lazy" }) : h("span", { class: "pdf" }, "PDF")))) : h("p", { class: "sub" }, t("civil_id_missing")),
    mayUpload ? h("div", { style: { marginTop: "8px" } }, pickButtons((f) => uploadDoc(e, f, "civil_id", e.civil_id_expiry))) : null);
}

function documents(p, e, can, mayUpload) {
  const docs = p.files.filter((f) => f.kind === "doc");
  const types = can.edit() ? DOC_TYPES : SELF_DOC_TYPES;
  const type = select("doc_type", types.map((d) => [d, t("dt_" + d)]), "passport");
  const expiry = h("input", { type: "date", name: "expiry" });
  const upload = mayUpload ? h("div", { class: "fields", style: { marginTop: "14px" } },
    field(t("doc_type"), type), field(t("doc_expiry"), expiry),
    h("div", { class: "field", style: { alignSelf: "end" } }, pickButtons((f) => uploadDoc(e, f, type.value, expiry.value)))) : null;
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

function encashDialog(e, consents) {
  const daysIn = h("input", { type: "number", min: "0.5", step: "0.5", required: true, inputmode: "decimal" });
  const consent = select("consent", consents.map((f) => [f.id, `${f.name} · ${dateTime(f.uploaded_at)}`]), consents[0] && consents[0].id);
  const err = h("div", { class: "form-error" });
  const dlg = h("dialog", { class: "dialog" }, h("form", { class: "form", onsubmit: async (ev) => {
    ev.preventDefault();
    try { await api.post(`/api/employees/${e.id}/encash`, { days: Number(daysIn.value), consent_file_id: consent.value ? Number(consent.value) : null }); dlg.close(); toast(t("saved")); rerender(); }
    catch (er) { err.textContent = errText(er); }
  } },
    h("h2", null, t("encash"), " · ", nm(e)),
    h("p", { class: "sub" }, t("encash_note")),
    consents.length ? h("div", { class: "fields" }, field(t("encash_days"), daysIn), field(t("consent_doc"), consent)) : h("div", { class: "note bad" }, t("err_consent_required")),
    err,
    h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t("cancel")), consents.length ? h("button", { class: "btn primary", type: "submit" }, t("save")) : null)));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}
