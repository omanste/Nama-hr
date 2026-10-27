import { api } from "../api.js";
import { t, nm, getLang, tx } from "../i18n.js";
import { countryName } from "../countries.js";
import { h, badge, avatar, dmy, dateTime, daysText, num, daysOf, empty, toast, errText, confirm, select, field, backLink, todayIso, isPermission, isAttendanceReq, durText } from "../ui.js";
import { balanceHero, requestItem } from "./home.js";
import { render as rerender } from "../app.js";

const DOC_TYPES = ["civil_id", "passport", "contract", "visa", "certificate", "medical", "consent", "other"];
// staff may add their own papers; contracts and payout consents stay with HR (server enforces the same)
const SELF_DOC_TYPES = ["civil_id", "passport", "visa", "certificate", "medical", "other"];
const DOC_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

async function uploadDoc(e, f, docType, expiry, canEditAll) {
  if (!f) return;
  const qs = new URLSearchParams({ kind: "doc", doc_type: docType, name: f.name || `${docType}.jpg` });
  if (expiry) qs.set("expiry", expiry);
  const reading = ["civil_id", "passport"].includes(docType) && /^image\//.test(f.type);
  if (reading) toast(t("reading_card"));
  try {
    const r = await api.upload(`/api/employees/${e.id}/files?${qs}`, f);
    toast(t("saved"));
    if (r.read) await readDialog(e, r, docType, canEditAll);
    rerender();
  } catch (er) { toast(errText(er), "bad"); }
}

/** What the reader found on the card, next to what the profile has now; the person ticks what to update. */
function readDialog(e, r, docType, canEditAll) {
  const found = r.read || {}, cur = r.current || {}, verified = new Set(found.verified || []);
  const show = (k, v) => (v === null || v === undefined || v === "" ? "—" : k === "dob" || k === "expiry" ? dmy(v) : k === "gender" ? t("g_" + v) : k === "nationality" ? countryName(v, getLang()) : String(v));
  const FIELDS = [["civil_id", "f_civil_id", "civil_id"], ["expiry", docType === "civil_id" ? "f_civil_id_expiry" : "doc_expiry", docType === "civil_id" ? "civil_id_expiry" : null],
    ["dob", "f_dob", "dob"], ["gender", "f_gender", "gender"], ["nationality", "f_nationality", "nationality"], ["name_en", "f_name_en", "name_en"]];
  const rows = FIELDS.filter(([k]) => found[k] !== undefined).map(([k, label, col]) => {
    const now = col ? cur[col] : found[k];
    const same = col && String(now ?? "") === String(found[k]);
    const locked = !col || (k === "name_en" && !canEditAll && cur.name_en); // passport expiry is saved on the copy itself
    const box = h("input", { type: "checkbox", name: k, checked: !same && !locked, disabled: same || locked });
    return { k, box, row: h("label", { class: "read-row" }, box,
      h("div", { class: "grow" }, h("div", { class: "sub" }, t(label)),
        h("div", null, h("b", { dir: "auto" }, show(k, found[k])), verified.has(k) ? h("span", { class: "badge b-approved", style: { marginInlineStart: "8px" } }, "✓ ", t("read_verified")) : h("span", { class: "badge b-pending", style: { marginInlineStart: "8px" } }, t("read_check"))),
        col ? h("div", { class: "sub" }, t("read_now"), ": ", show(k, now), same ? ` · ${t("read_same")}` : "") : h("div", { class: "sub" }, t("read_saved_on_copy")))) };
  });
  if (!rows.length) { toast(t("read_nothing")); return Promise.resolve(); }
  return new Promise((resolve) => {
    const err = h("div", { class: "form-error" });
    const dlg = h("dialog", { class: "dialog" }, h("form", { class: "form", onsubmit: async (ev) => {
      ev.preventDefault();
      const fields = rows.filter((x) => x.box.checked).map((x) => x.k);
      if (!fields.length) { dlg.close(); return; }
      try { await api.post(`/api/files/${r.file.id}/apply`, { fields }); toast(t("saved")); dlg.close(); } catch (er) { err.textContent = errText(er); }
    } },
      h("h2", null, t("read_title")), h("p", { class: "sub" }, t("read_intro")),
      h("div", { class: "list" }, rows.map((x) => x.row)), err,
      h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t("read_skip")), h("button", { class: "btn primary", type: "submit" }, t("read_apply")))));
    dlg.addEventListener("close", () => { dlg.remove(); resolve(); });
    document.body.append(dlg); dlg.showModal();
  });
}
const expiryBadge = (iso) => {
  if (!iso) return null;
  const days = Math.round((Date.parse(iso) - Date.parse(todayIso())) / 864e5);
  return days <= 0 ? h("span", { class: "badge b-rejected" }, t("doc_expired")) : days <= 30 ? h("span", { class: "badge b-pending" }, t("in_days", { n: days })) : null;
};
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

  // photo: HR for anyone, staff for themselves — from the phone camera (front camera for a selfie) or a file
  const setPhoto = async (f) => {
    if (!f) return;
    try { await api.upload(`/api/employees/${e.id}/files?kind=photo&name=${encodeURIComponent(f.name || "photo.jpg")}`, f); toast(t("saved")); rerender(); } catch (er) { toast(errText(er), "bad"); }
  };
  const photoPicker = (attrs) => h("input", { type: "file", hidden: true, accept: "image/png,image/jpeg,image/webp", ...attrs, onchange: (ev) => { const f = ev.target.files[0]; ev.target.value = ""; setPhoto(f); } });
  const photo = mayUpload
    ? h("div", { class: "photo-box" }, avatar(e, 72),
        h("div", { class: "row photo-actions" },
          h("label", { class: "btn small", title: t("photo_camera") }, "📷 ", t("photo_camera"), photoPicker({ accept: "image/*", capture: "user" })),
          h("label", { class: "btn small", title: t("photo_upload") }, "🖼️ ", t("photo_upload"), photoPicker({}))))
    : avatar(e, 72);

  el.append(
    opts.me ? null : backLink("#/staff"),
    h("div", { class: "profile-head" }, photo,
      h("div", { class: "grow" }, h("h1", null, nm(e)), h("div", { class: "sub" }, [e.emp_no, tx(e.job_title), nm(p.department)].filter(Boolean).join(" · ")), h("div", { class: "row", style: { marginTop: "6px" } }, badge(e.status, "st_"))),
      h("div", { class: "row" },
        can.edit() ? h("a", { class: "btn", href: `#/staff/${e.id}/edit` }, t("edit")) : null,
        can.edit() ? h("button", { class: "btn", type: "button", onclick: () => adjustDialog(e) }, t("adjust_balance")) : null,
        can.edit() ? h("button", { class: "btn", type: "button", onclick: () => encashDialog(e, p.files.filter((f) => f.doc_type === "consent")) }, t("encash")) : null,
        // disable (keeps history) / enable; Admin may delete a mistaken record with no history
        // reset password (creates the login first if there isn't one); HR can't reset Admin, CEO or HR logins
        can.edit() && !own && (can.admin() || !p.login || ["staff", "manager", "accounts"].includes(p.login.role))
          ? h("button", { class: "btn", type: "button", onclick: () => (p.login ? resetPassword(e, p.login) : createLogin(e)) }, "🔑 ", t("reset_password")) : null,
        can.edit() && !own ? h("button", { class: e.status === "disabled" ? "btn" : "btn danger", type: "button", onclick: () => setDisabled(e, e.status !== "disabled") }, t(e.status === "disabled" ? "staff_enable" : "staff_disable")) : null,
        can.admin() && !own ? h("button", { class: "btn danger", type: "button", onclick: () => deleteStaff(e) }, t("staff_delete")) : null)),
    e.status === "disabled" ? h("div", { class: "note bad" }, t("disabled_note")) : null,
    attendanceCard(e),

    // my own leave, permissions and requests live on the home page; HR still sees them on a colleague's profile
    opts.me ? null : leaveSections(p, { own }),

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
        ["f_civil_id", e.civil_id], ["f_civil_id_expiry", e.civil_id_expiry ? h("span", null, dmy(e.civil_id_expiry), " ", expiryBadge(e.civil_id_expiry)) : null]]), civilIdCard(p, e, mayUpload, can)),
      h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", null, t("sec_contact")),
          mayUpload ? h("button", { class: "btn small", type: "button", onclick: () => contactDialog(e) }, t("edit")) : null), facts([
        ["f_mobile", e.mobile && h("a", { href: `tel:${e.mobile}`, dir: "ltr" }, e.mobile)], ["f_email", e.email && h("a", { href: `mailto:${e.email}` }, e.email)], ["f_address", e.address],
        ["f_emergency_name", e.emergency_name], ["f_emergency_relation", e.emergency_relation], ["f_emergency_phone", e.emergency_phone && h("span", { dir: "ltr" }, e.emergency_phone)]])),
      h("section", { class: "card" }, h("h2", null, t("sec_job")), facts([
        ["f_department_id", nm(p.department)], ["f_job_title", tx(e.job_title)], ["f_manager_employee_id", nm(p.manager)], ["f_join_date", dmy(e.join_date)], ["f_status", t("st_" + e.status)],
        ["f_shift", h("span", null, t(e.shift === 1 ? "shift_1_full" : "shift_2_full"), " ", p.shiftSelf ? h("button", { class: "btn small", type: "button", onclick: () => shiftDialog(e) }, t("shift_change")) : null)]])),
      h("section", { class: "card", style: { gridColumn: "1 / -1" } }, h("h2", null, t("sec_contract")), facts([
        ["f_join_date", dmy(e.join_date)], ["service_length", serviceLength(e.join_date)], ["probation_end", dmy(p.leave.probationEnd)],
        ["f_contract_type", e.contract_type], ["f_contract_end", e.contract_end ? h("span", null, dmy(e.contract_end), " ", expiryBadge(e.contract_end)) : null]]),
        p.login !== undefined ? h("div", { style: { marginTop: "14px" } }, h("h3", null, t("login_account")),
          p.login ? h("div", { class: "row", style: { justifyContent: "space-between" } },
              h("span", { class: "sub" }, `${p.login.username} · ${t("role_" + p.login.role)}${p.login.active ? "" : " · " + t("inactive")}`),
              (can.admin() || (can.edit() && ["staff", "manager", "accounts"].includes(p.login.role))) && p.login.id !== me.user.id
                ? h("button", { class: "btn small", type: "button", onclick: () => resetPassword(e, p.login) }, "🔑 ", t("reset_password")) : null)
            : h("div", { class: "row" }, h("span", { class: "sub" }, t("no_login")), can.edit() ? h("button", { class: "btn small", type: "button", onclick: () => createLogin(e) }, "🔑 ", t("reset_password")) : null)) : null)),

    h("section", { class: "card" }, h("h2", null, t("sec_qualifications")), h("dl", { class: "facts" },
      ["education", "specialization", "experience", "languages", "certifications"].map((k) => h("div", null, h("dt", null, t("f_" + k)), h("dd", { dir: "auto" }, tx(e[k]) || "—"))),
      ["skills", "main_tasks"].map((k) => h("div", { style: { gridColumn: "1/-1" } }, h("dt", null, t("f_" + k)), h("dd", { dir: "auto", style: { whiteSpace: "pre-line" } }, tx(e[k]) || "—"))))),
    documents(p, e, can, mayUpload),
    h("section", { class: "card kpi-placeholder" }, h("h2", null, t("sec_kpi")), h("p", null, t("kpi_later"))));
}

/** Civil ID copy: front/back scans or a PDF, shown as thumbnails right under the ID number. */
function civilIdCard(p, e, mayUpload, can) {
  const ids = p.files.filter((f) => f.kind === "doc" && f.doc_type === "civil_id");
  return h("div", { style: { marginTop: "14px" } },
    h("h3", null, t("civil_id_copy")),
    ids.length ? h("div", { class: "id-thumbs" }, ids.map((f) => h("a", { href: `/api/files/${f.id}`, target: "_blank", rel: "noopener", title: f.name },
      f.mime.startsWith("image/") ? h("img", { src: `/api/files/${f.id}`, alt: t("dt_civil_id"), loading: "lazy" }) : h("span", { class: "pdf" }, "PDF")))) : h("p", { class: "sub" }, t("civil_id_missing")),
    mayUpload ? h("div", { style: { marginTop: "8px" } }, pickButtons((f) => uploadDoc(e, f, "civil_id", null, can.edit())), h("p", { class: "sub", style: { margin: "6px 0 0" } }, t("scan_tip"))) : null);
}

function documents(p, e, can, mayUpload) {
  const docs = p.files.filter((f) => f.kind === "doc");
  const types = can.edit() ? DOC_TYPES : SELF_DOC_TYPES;
  const type = select("doc_type", types.map((d) => [d, t("dt_" + d)]), "passport");
  const expiry = h("input", { type: "date", name: "expiry" });
  const upload = mayUpload ? h("div", { class: "fields", style: { marginTop: "14px" } },
    field(t("doc_type"), type), field(t("doc_expiry"), expiry),
    h("div", { class: "field", style: { alignSelf: "end" } }, pickButtons((f) => uploadDoc(e, f, type.value, expiry.value, can.edit())))) : null;
  return h("section", { class: "card" }, h("h2", null, t("sec_documents")),
    docs.length ? h("div", { class: "list" }, docs.map((f) => h("div", { class: "item" },
      h("div", { class: "grow" }, h("div", { class: "title" }, h("a", { href: `/api/files/${f.id}`, target: "_blank", rel: "noopener" }, f.name)),
        h("div", { class: "meta" }, t("dt_" + (f.doc_type || "other")), f.expiry ? ` · ${t("doc_expiry")}: ${dmy(f.expiry)}` : "", ` · ${dateTime(f.uploaded_at)} `, expiryBadge(f.expiry))),
      h("a", { class: "btn small", href: `/api/files/${f.id}?download=1` }, t("download")),
      can.edit() ? h("button", { class: "btn small danger", type: "button", onclick: async () => {
        if (!(await confirm(t("delete_file_q"), { danger: true, okText: t("delete") }))) return;
        try { await api.del(`/api/files/${f.id}`); rerender(); } catch (er) { toast(errText(er), "bad"); }
      } }, t("delete")) : null))) : h("div", { class: "empty" }, t("no_results")),
    upload);
}

// no login yet: "Reset password" creates the staff login and shows its temporary password
async function createLogin(e) {
  try {
    const r = await api.post(`/api/employees/${e.id}/login`, {});
    await resetPassword(e, r.user, { created: true }); // then set the password the same way
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

const hrs = (m) => t("hours", { n: num(m / 60) });
/** This month's attendance (filled when it loads; hidden when this login may not see it). */
function attendanceCard(e) {
  const box = h("section", { class: "card", hidden: true });
  api.get(`/api/attendance/employee/${e.id}`).then((d) => {
    const s = d.summary;
    if (!d.linked.length && !s.workDays) return;
    const f = (k, v) => h("div", null, h("dt", null, t(k)), h("dd", { class: "num" }, v));
    box.append(h("div", { class: "card-head" }, h("h2", null, t("att_this_month")), h("a", { class: "btn small", href: `#/attendance?${d.own ? "" : `emp=${e.id}&`}m=${d.month}` }, t("att_open_sheet"))),
      h("dl", { class: "facts" },
        f("att_compliance", s.compliance === null ? "—" : `${num(s.compliance)}%`), f("att_on_time_days", `${num(s.onTime)} / ${num(s.workDays)}`),
        f("att_late", `${num(s.late)} · ${durText(s.lateMin)}`), f("att_early", `${num(s.early)} · ${durText(s.earlyMin)}`),
        f("att_missing", num(s.missing)), f("att_absent", num(s.absent))));
    box.hidden = false;
  }).catch(() => {});
  return box;
}
/** Times and hours of early leave, late arrival and personal breaks — this month and this year. */
function permissionCard(P) {
  if (!P) return null;
  const col = (title, S) => h("div", null, h("h3", null, title),
    h("dl", { class: "facts" }, ["early", "late", "break"].map((k) => h("div", null, h("dt", null, t("lt_" + k)), h("dd", { class: "num" }, t("times_hours", { n: num(S[k].count), h: num(S[k].minutes / 60) })))),
      h("div", null, h("dt", null, h("b", null, t("total"))), h("dd", { class: "num" }, h("b", null, t("times_hours", { n: num(S.total.count), h: num(S.total.minutes / 60) })))),
      S.deducted ? h("div", null, h("dt", null, t("from_annual")), h("dd", { class: "num" }, hrs(S.deducted))) : null,
      S.classes && S.classes.unclassified ? h("div", null, h("dt", null, t("att_awaiting_hr")), h("dd", { class: "num" }, hrs(S.classes.unclassified))) : null));
  return h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", null, t("sec_permissions")), h("span", { class: "badge" }, t("perm_policy_badge"))),
    h("div", { class: "grid cols2" }, col(t("this_month"), P.month), col(t("this_year"), P.year)));
}
/** Small summary at the top of "My permissions". */
export async function permissionSummaryCard(empId) {
  const p = await api.get(`/api/employees/${empId}`);
  return permissionCard(p.permissions);
}

/** The person picks their own shift (while the company allows it and HR hasn't fixed it). */
function shiftDialog(e) {
  let pick = e.shift === 1 ? 1 : 2;
  const opt = (n) => h("label", { class: "item", style: { cursor: "pointer" } },
    h("input", { type: "radio", name: "shift", value: n, checked: pick === n, style: { width: "22px", height: "22px", minHeight: "0" }, onchange: () => { pick = n; } }),
    h("div", { class: "grow" }, h("div", { class: "title" }, t(`shift_${n}_full`))));
  const err = h("div", { class: "form-error" });
  const dlg = h("dialog", { class: "dialog" }, h("form", { class: "form", onsubmit: async (ev) => {
    ev.preventDefault();
    try { await api.put(`/api/employees/${e.id}/shift`, { shift: pick }); dlg.close(); toast(t("saved")); rerender(); } catch (er) { err.textContent = errText(er); }
  } },
    h("h2", null, t("shift_choose")), h("p", { class: "sub" }, t("shift_choose_hint")),
    h("div", { class: "list" }, opt(1), opt(2)), err,
    h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t("cancel")), h("button", { class: "btn primary", type: "submit" }, t("save")))));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}

function contactDialog(e) {
  const F = ["mobile", "address", "emergency_name", "emergency_relation", "emergency_phone"];
  const inputs = Object.fromEntries(F.map((k) => [k, h("input", { name: k, value: e[k] || "", ...(k.endsWith("phone") || k === "mobile" ? { type: "tel", dir: "ltr", inputmode: "tel" } : {}) })]));
  const err = h("div", { class: "form-error" });
  const dlg = h("dialog", { class: "dialog" }, h("form", { class: "form", onsubmit: async (ev) => {
    ev.preventDefault();
    try { await api.put(`/api/employees/${e.id}/contact`, Object.fromEntries(F.map((k) => [k, inputs[k].value]))); dlg.close(); toast(t("saved")); rerender(); }
    catch (er) { err.textContent = errText(er); }
  } },
    h("h2", null, t("sec_contact")),
    h("div", { class: "fields" }, F.map((k) => field(t("f_" + k), inputs[k], { full: k === "address" }))),
    h("p", { class: "sub" }, t("email_by_hr")), err,
    h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t("cancel")), h("button", { class: "btn primary", type: "submit" }, t("save")))));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}

/** Leave balance, leave by type, permissions and request history — used on the home page and on a colleague's profile. */
export function leaveSections(p, { own = false, limit = 0 } = {}) {
  const e = p.employee, L = p.leave;
  const reqs = limit ? p.requests.slice(0, limit) : p.requests;
  return [
    h("div", { class: "grid cols2" },
      h("div", { class: "grid" },
        balanceHero(L, { apply: own }),
        L.eligibleFrom && L.eligibleFrom > todayIso() ? h("div", { class: "note" }, t("eligible_from", { d: dmy(L.eligibleFrom) })) : null,
        !e.join_date ? h("div", { class: "note" }, t("no_join_date")) : null),
      h("section", { class: "card" }, h("h2", null, t(own ? "my_leave" : "by_type")),
        h("dl", { class: "facts" }, Object.entries(L.byType).map(([k, v]) => h("div", null, h("dt", null, t("lt_" + k)), h("dd", { class: "num" }, isPermission(k) ? t("hours", { n: num(v / 60) }) : daysText(v))))))),

    permissionCard(p.permissions),
    h("section", { class: "card" }, h("h2", null, t("sec_requests")),
      p.requests.length ? h("div", { class: "list" }, p.requests.filter((r) => !isAttendanceReq(r.type)).map((r) => requestItem(r))) : empty())];
}

/** Time since joining, e.g. "1 year and 6 months" (whole months, as of today). */
function serviceLength(join) {
  if (!join) return null;
  const [y1, m1, d1] = join.split("-").map(Number), [y2, m2, d2] = todayIso().split("-").map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (months < 0) return t("not_started");
  const years = Math.floor(months / 12); months %= 12;
  // Arabic counts: 1 · 2 (dual) · 3–10 (plural) · 11+ (singular)
  const form = (n, unit) => t(n === 1 ? `one_${unit}` : n === 2 ? `two_${unit}s` : n <= 10 ? `n_${unit}s` : `n_${unit}s_11`, { n: num(n) });
  const parts = [years ? form(years, "year") : null, months ? form(months, "month") : null].filter(Boolean);
  return parts.length ? parts.join(t("and_sep")) : t("less_than_month");
}

async function setDisabled(e, disable) {
  if (!(await confirm(t(disable ? "staff_disable_q" : "staff_enable_q", { name: nm(e) }), { danger: disable, okText: t(disable ? "staff_disable" : "staff_enable") }))) return;
  try { await api.post(`/api/employees/${e.id}/${disable ? "disable" : "enable"}`); toast(t("saved")); rerender(); } catch (er) { toast(errText(er), "bad"); }
}
async function deleteStaff(e) {
  if (!(await confirm(t("staff_delete_q", { name: nm(e) }), { danger: true, okText: t("staff_delete") }))) return;
  try { await api.del(`/api/employees/${e.id}`); toast(t("staff_deleted")); location.hash = "#/staff"; } catch (er) { toast(errText(er), "bad"); }
}

/** Reset: type the password yourself, or let the portal make one up; optionally ask for a change at next sign-in. */
function resetPassword(e, login, { created = null } = {}) {
  return new Promise((resolve) => {
    const mode = { v: "type" };
    const pw = h("input", { type: "password", autocomplete: "new-password", minlength: 8, dir: "ltr", name: "password" });
    const pw2 = h("input", { type: "password", autocomplete: "new-password", minlength: 8, dir: "ltr", name: "password2" });
    const show = h("input", { type: "checkbox", style: { width: "20px", height: "20px", minHeight: "0" }, onchange: () => { pw.type = pw2.type = show.checked ? "text" : "password"; } });
    const must = h("input", { type: "checkbox", checked: true, style: { width: "20px", height: "20px", minHeight: "0" } });
    const typeBox = h("div", { class: "fields" }, field(t("new_password"), pw), field(t("confirm_password"), pw2),
      h("label", { class: "row full" }, show, t("show_password")));
    const radio = (v, label) => h("label", { class: "read-row" }, h("input", { type: "radio", name: "pwmode", value: v, checked: mode.v === v, onchange: () => { mode.v = v; typeBox.hidden = v !== "type"; } }), h("div", { class: "grow" }, h("b", null, t(label))));
    const err = h("div", { class: "form-error" });
    const dlg = h("dialog", { class: "dialog" }, h("form", { class: "form", onsubmit: async (ev) => {
      ev.preventDefault(); err.textContent = "";
      const body = { must_change: must.checked };
      if (mode.v === "type") {
        if (pw.value.length < 8) { err.textContent = t("err_weak_password"); return; }
        if (pw.value !== pw2.value) { err.textContent = t("passwords_differ"); return; }
        body.password = pw.value;
      }
      try {
        const r = await api.post(`/api/users/${login.id}/reset`, body);
        dlg.close();
        if (r.tempPassword) await showTempPassword(login.username, r.tempPassword);
        else toast(t("password_set", { user: login.username }));
      } catch (er) { err.textContent = errText(er); }
    } },
      h("h2", null, t("reset_password"), " · ", nm(e)),
      h("p", { class: "sub" }, t("username"), ": ", h("b", { dir: "ltr" }, login.username), created ? ` · ${t("login_created")}` : ""),
      h("div", { class: "grid" }, radio("type", "pw_type_own"), radio("auto", "pw_generate")),
      typeBox,
      h("label", { class: "row" }, must, t("must_change_next")),
      h("p", { class: "sub" }, t("reset_signs_out")), err,
      h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t("cancel")), h("button", { class: "btn primary", type: "submit" }, t("save")))));
    dlg.addEventListener("close", () => { dlg.remove(); resolve(); });
    document.body.append(dlg); dlg.showModal(); pw.focus();
  });
}
