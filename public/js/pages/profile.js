import { api } from "../api.js";
import { t, nm, getLang, tx, splitLangs, joinLangs } from "../i18n.js";
import { BANKS, bankName, ibanText, validIban } from "../banks.js";
import { GOVERNORATES, MUSCAT_GROUPS, wilayatName, areaName, isWilayat, isArea } from "../places.js";
import { countryName } from "../countries.js";
import { h, badge, avatar, dmy, dateTime, daysText, num, daysOf, empty, toast, errText, confirm, select, field, backLink, todayIso, isPermission, isAttendanceReq, durText, viewFile } from "../ui.js";
import { balanceHero, requestItem } from "./home.js";
import { render as rerender, refreshMe } from "../app.js";

const DOC_TYPES = ["civil_id", "passport", "visa", "resume", "certificate", "course", "contract", "medical", "consent", "other"]; // also the order the categories are listed in
// staff may add their own papers (a copy of their contract too); payout consents stay with HR (server enforces the same)
const SELF_DOC_TYPES = ["civil_id", "passport", "visa", "resume", "certificate", "course", "contract", "medical", "other"];
const DOC_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

async function uploadDoc(e, f, docType, expiry, canEditAll, replaces = null) {
  if (!f) return;
  const qs = new URLSearchParams({ kind: "doc", doc_type: docType, name: f.name || `${docType}.jpg` });
  if (expiry) qs.set("expiry", expiry);
  if (replaces) qs.set("replaces", replaces); // renewing: the old copy is archived
  const reading = EXPIRING.includes(docType) && (/^image\//.test(f.type) || f.type === "application/pdf");
  if (reading) toast(t("reading_card"));
  try {
    const r = await api.upload(`/api/employees/${e.id}/files?${qs}`, f);
    toast(r.read && r.read.expiry && !expiry ? t("expiry_read", { d: dmy(r.file.expiry) }) : t("saved"));
    if (r.read) await readDialog(e, r, docType, canEditAll);
    // an ID whose number couldn't be read: ask for it (HR verifies); the expiry typed there also goes on the document
    let typed = null;
    if (docType === "civil_id" && !(r.read && r.read.civil_id)) typed = await identityDialog(e, "id_not_read");
    if (typed && typed.civil_id_expiry && !r.file.expiry) { await api.put(`/api/files/${r.file.id}`, { expiry: typed.civil_id_expiry }).catch(() => {}); r.file.expiry = typed.civil_id_expiry; }
    // no expiry typed or read: ask for it, or there's nothing to remind about
    if (EXPIRING.includes(docType) && !r.file.expiry) await expiryDialog(r.file, true);
    rerender();
  } catch (er) { toast(errText(er), "bad"); }
}
/** Civil ID, passport and visa numbers and dates typed by hand (saved at once; HR verifies a person's own changes). */
async function identityDialog(e, why = null) {
  const cur = (await api.get(`/api/employees/${e.id}`)).employee; // the latest, after any update from a document
  const F = [["civil_id", { dir: "ltr", inputmode: "numeric", maxlength: 12 }], ["civil_id_expiry", { type: "date" }], ["passport_no", { dir: "ltr", maxlength: 20 }],
    ["passport_expiry", { type: "date" }], ["visa_expiry", { type: "date" }]];
  const inputs = Object.fromEntries(F.map(([k, a]) => [k, h("input", { name: k, value: cur[k] || "", ...a })]));
  let saved = null; // resolves with what was saved (null if cancelled)
  return new Promise((resolve) => {
    simpleDialog(t("sec_identity"), [why ? h("div", { class: "note", style: { gridColumn: "1/-1" } }, t(why)) : null, ...F.map(([k]) => field(t("f_" + k), inputs[k]))].filter(Boolean),
      async () => { const body = Object.fromEntries(F.map(([k]) => [k, inputs[k].value.trim() || null])); await api.put(`/api/employees/${e.id}/identity`, body); saved = body; },
      t("verify_note"), false, () => resolve(saved));
  });
}
/** Documents that expire and get reminders 30 days before. */
const EXPIRING = ["civil_id", "passport", "visa"];
/** Set or correct a document's expiry date (it drives the reminders). */
function expiryDialog(f, missing = false) {
  return new Promise((resolve) => {
    const input = h("input", { type: "date", value: f.expiry || "", required: true });
    const err = h("div", { class: "form-error" });
    const dlg = h("dialog", { class: "dialog" }, h("form", { class: "form", onsubmit: async (ev) => {
      ev.preventDefault();
      if (!input.value) { err.textContent = t("required"); return; }
      try { await api.put(`/api/files/${f.id}`, { expiry: input.value }); toast(t("saved")); dlg.close(); } catch (er) { err.textContent = errText(er); }
    } },
      h("h2", null, t("doc_expiry"), " · ", t("dt_" + (f.doc_type || "other"))),
      h("p", { class: "sub" }, t(missing ? "expiry_missing" : "expiry_hint")),
      field(t("doc_expiry"), input), err,
      h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t(missing ? "later" : "cancel")), h("button", { class: "btn primary", type: "submit" }, t("save")))));
    dlg.addEventListener("close", () => { dlg.remove(); resolve(); });
    document.body.append(dlg); dlg.showModal(); input.focus();
  });
}

/** What the reader found on the new document. Empty profile fields are filled at once with values the document's own check
 * digits confirm; a value that would replace something different (or wasn't confirmed) is asked about — old → new, ticked. */
async function readDialog(e, r, docType, canEditAll) {
  const found = r.read || {}, cur = r.current || {}, verified = new Set(found.verified || []);
  const show = (k, v) => (v === null || v === undefined || v === "" ? "—" : k === "dob" || k === "expiry" ? dmy(v) : k === "gender" ? t("g_" + v) : k === "nationality" ? countryName(v, getLang()) : String(v));
  // the expiry goes to the matching profile date (civil ID, passport or visa)
  const expCol = { civil_id: "civil_id_expiry", passport: "passport_expiry", visa: "visa_expiry" }[docType] || null;
  const FIELDS = [["civil_id", "f_civil_id", "civil_id"], ["passport_no", "f_passport_no", docType === "passport" ? "passport_no" : null],
    ["expiry", expCol ? "f_" + expCol : "doc_expiry", expCol],
    ["dob", "f_dob", "dob"], ["gender", "f_gender", "gender"], ["nationality", "f_nationality", "nationality"], ["name_en", "f_name_en", "name_en"], ["name_ar", "f_name_ar", "name_ar"]];
  // every value read that differs from the profile: before → after, ticked; untick what the scanner got wrong
  const ask = FIELDS.filter(([k, , col]) => found[k] !== undefined && col)
    .map(([k, label, col]) => ({ k, label, col, now: cur[col], same: String(cur[col] ?? "") === String(found[k]) }))
    .filter((x) => !x.same);
  const filled = r.applied || [];
  if (filled.length) await refreshMe(); // the name at the top (and on the sign-in list) follows the profile
  if (!ask.length) { toast(filled.length ? t("read_filled", { n: filled.length }) : t("read_nothing_new")); return; }
  const rows = ask.map((x) => {
    const box = h("input", { type: "checkbox", name: x.k, checked: true });
    return { k: x.k, box, row: h("label", { class: "read-row" }, box,
      h("div", { class: "grow" }, h("div", { class: "sub" }, t(x.label)),
        h("div", { class: "read-before-after" }, h("span", { class: "muted" }, t("pc_before"), ": "), h("span", { class: x.now ? "pc-old-inline" : "muted", dir: "auto" }, show(x.k, x.now)),
          h("br"), h("span", { class: "muted" }, t("pc_after"), ": "), h("b", { dir: "auto" }, show(x.k, found[x.k])),
          verified.has(x.k) ? h("span", { class: "badge b-approved", style: { marginInlineStart: "8px" } }, "✓ ", t("read_verified")) : h("span", { class: "badge b-pending", style: { marginInlineStart: "8px" } }, t("read_check"))))) };
  });
  return new Promise((resolve) => {
    const err = h("div", { class: "form-error" });
    const dlg = h("dialog", { class: "dialog" }, h("form", { class: "form", onsubmit: async (ev) => {
      ev.preventDefault();
      const fields = rows.filter((x) => x.box.checked).map((x) => x.k);
      if (!fields.length) { dlg.close(); return; }
      try { await api.post(`/api/files/${r.file.id}/apply`, { fields }); toast(t("read_filled", { n: fields.length })); await refreshMe(); dlg.close(); } catch (er) { err.textContent = errText(er); }
    } },
      h("h2", null, t("read_update_title")),
      filled.length ? h("div", { class: "note" }, t("read_filled", { n: filled.length })) : null,
      h("p", { class: "sub" }, t("read_update_intro")),
      rows.length > 1 ? h("div", { class: "row", style: { gap: "8px" } },
        h("button", { class: "btn small", type: "button", onclick: () => rows.forEach((x) => { x.box.checked = true; }) }, t("select_all")),
        h("button", { class: "btn small", type: "button", onclick: () => rows.forEach((x) => { x.box.checked = false; }) }, t("select_none"))) : null,
      h("div", { class: "list" }, rows.map((x) => x.row)), err,
      h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t("read_keep")), h("button", { class: "btn primary", type: "submit" }, t("read_apply")))));
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
    h("label", { class: "btn scan-btn" }, "📷 ", scanLabel, picker({ accept: "image/*", capture: "environment" })),
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
  // the photo opens full size (with Download) when there is one
  const face = e.photo_file_id
    ? h("button", { class: "avatar-zoom", type: "button", title: t("photo_view"), "aria-label": t("photo_view"),
        onclick: () => viewFile({ id: e.photo_file_id, name: `${e.emp_no || "photo"} · ${nm(e)}`, mime: "image/jpeg" }) }, avatar(e, 72))
    : avatar(e, 72);
  const photo = mayUpload
    ? h("div", { class: "photo-box" }, face,
        h("div", { class: "row photo-actions" },
          h("label", { class: "btn small", title: t("photo_camera") }, "📷 ", t("photo_camera"), photoPicker({ accept: "image/*", capture: "user" })),
          h("label", { class: "btn small", title: t("photo_upload") }, "🖼️ ", t("photo_upload"), photoPicker({}))))
    : face;

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
        can.admin() && !own ? h("button", { class: "btn danger", type: "button", onclick: () => deleteStaff(e) }, t("staff_delete")) : null,
        // my own profile: change my password (current password needed)
        own ? h("a", { class: "btn", href: "#/password?back=me" }, "🔑 ", t("change_password")) : null)),
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
      h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", null, t("sec_personal")), badgeIfPending(p, "identity"),
          mayUpload ? h("button", { class: "btn small", type: "button", onclick: () => identityDialog(e) }, t("edit_id_details")) : null), facts([
        ["f_name_ar", e.name_ar], ["f_name_en", e.name_en], ["f_emp_no", e.emp_no], ["f_gender", e.gender ? t("g_" + e.gender) : ""], ["f_nationality", countryName(e.nationality, getLang())], ["f_dob", dmy(e.dob)],
        ["f_civil_id", e.civil_id], ["f_civil_id_expiry", e.civil_id_expiry ? h("span", null, dmy(e.civil_id_expiry), " ", expiryBadge(e.civil_id_expiry)) : null],
        ["f_passport_no", e.passport_no && h("span", { dir: "ltr" }, e.passport_no)], ["f_passport_expiry", e.passport_expiry ? h("span", null, dmy(e.passport_expiry), " ", expiryBadge(e.passport_expiry)) : null],
        ["f_visa_expiry", e.visa_expiry ? h("span", null, dmy(e.visa_expiry), " ", expiryBadge(e.visa_expiry)) : null]])),
      h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", null, t("sec_contact")), badgeIfPending(p, "contact"),
          mayUpload ? h("button", { class: "btn small", type: "button", onclick: () => contactDialog(e) }, t("edit")) : null),
        facts([
          ["f_mobile", e.mobile && h("a", { href: `tel:${e.mobile}`, dir: "ltr" }, e.mobile)], ["f_personal_phone", e.personal_phone && h("a", { href: `tel:${e.personal_phone}`, dir: "ltr" }, e.personal_phone)],
          ["f_email", e.email && h("a", { href: `mailto:${e.email}` }, e.email)], ["f_personal_email", e.personal_email && h("a", { href: `mailto:${e.personal_email}`, dir: "ltr" }, e.personal_email)]]),
        h("div", { class: "sub-box" }, h("h3", null, t("sec_address")), facts([
          ["f_perm_wilayat", wilayatName(e.perm_wilayat)], ["f_current_area", areaName(e.current_area)], ["f_address", e.address]])),
        h("div", { class: "sub-box" }, h("h3", null, t("sec_emergency")), facts([
          ["emergency_person", e.emergency_name], ["f_emergency_relation", e.emergency_relation], ["f_emergency_phone", e.emergency_phone && h("a", { href: `tel:${e.emergency_phone}`, dir: "ltr" }, e.emergency_phone)]]))),
      h("section", { class: "card" }, h("h2", null, t("sec_job")), facts([
        ["f_department_id", nm(p.department)], ["f_job_title", tx(e.job_title)], ["f_manager_employee_id", nm(p.manager)], ["f_join_date", dmy(e.join_date)], ["f_status", t("st_" + e.status)],
        ["f_shift", h("span", null, t(`shift_${[1, 2, 3].includes(e.shift) ? e.shift : 2}_full`), " ", p.shiftSelf ? h("button", { class: "btn small", type: "button", onclick: () => shiftDialog(e) }, t("shift_change")) : null)]])),
      h("section", { class: "card", style: { gridColumn: "1 / -1" } }, h("h2", null, t("sec_contract")), facts([
        ["f_join_date", dmy(e.join_date)], ["probation_end", dmy(p.leave.probationEnd)], ["service_length", serviceLength(e.join_date)],
        ["f_contract_type", tx(e.contract_type)], ["f_contract_end", e.contract_end ? h("span", null, dmy(e.contract_end), " ", expiryBadge(e.contract_end)) : null]]),
        // the login account (and resetting its password) is managed from someone else's profile or Users — not shown in "My profile"
        p.login !== undefined && !own && !opts.me ? h("div", { style: { marginTop: "14px" } }, h("h3", null, t("login_account")),
          p.login ? h("div", { class: "row", style: { justifyContent: "space-between" } },
              h("span", { class: "sub" }, `${p.login.username} · ${t("role_" + p.login.role)}${p.login.active ? "" : " · " + t("inactive")}`),
              (can.admin() || (can.edit() && ["staff", "manager", "accounts"].includes(p.login.role))) && p.login.id !== me.user.id
                ? h("button", { class: "btn small", type: "button", onclick: () => resetPassword(e, p.login) }, "🔑 ", t("reset_password")) : null)
            : h("div", { class: "row" }, h("span", { class: "sub" }, t("no_login")), can.edit() ? h("button", { class: "btn small", type: "button", onclick: () => createLogin(e) }, "🔑 ", t("reset_password")) : null)) : null)),

    pendingNote(p, own, can),
    p.seesBank ? bankCard(p, e, mayUpload) : null,
    h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", null, t("sec_qualifications")), badgeIfPending(p, "qualifications"),
      mayUpload ? h("button", { class: "btn small", type: "button", onclick: () => qualDialog(e) }, t("edit")) : null), h("dl", { class: "facts" },
      ["education", "specialization", "experience", "languages", "certifications"].map((k) => h("div", null, h("dt", null, t("f_" + k), oneLangTag(e[k])), h("dd", { dir: "auto" }, tx(e[k]) || "—"))),
      ["skills", "main_tasks"].map((k) => h("div", { style: { gridColumn: "1/-1" } }, h("dt", null, t("f_" + k), oneLangTag(e[k])), h("dd", { dir: "auto", style: { whiteSpace: "pre-line" } }, tx(e[k]) || "—"))))),
    documents(p, e, can, mayUpload, setPhoto),
    can.edit() && !own ? signIns(e) : null,
    h("section", { class: "card kpi-placeholder" }, h("h2", null, t("sec_kpi")), h("p", null, t("kpi_later"))));
}

/** A small tag when a bilingual field was written in the other language only (so the English page shows Arabic, or the reverse). */
function oneLangTag(v) {
  const shown = tx(v); if (!shown) return null;
  const other = getLang() === "en" ? /[\u0621-\u064A]/.test(shown) : !/[\u0621-\u064A]/.test(shown) && /[A-Za-z]{2}/.test(shown);
  return other ? h("span", { class: "badge one-lang", title: t("one_lang_hint") }, t(getLang() === "en" ? "only_ar" : "only_en")) : null;
}

/** A person's recent sign-ins (HR/Admin): time, device, network address and where — loaded when opened. */
function signIns(e) {
  const list = h("div", { class: "list" });
  let loaded = false;
  const box = h("details", { class: "card signins" }, h("summary", null, h("h2", { style: { display: "inline" } }, t("signins_title"))), list);
  box.addEventListener("toggle", async () => {
    if (!box.open || loaded) return; loaded = true;
    try {
      const { items } = await api.get(`/api/employees/${e.id}/logins`);
      const device = (ua) => (/iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : "—");
      list.replaceChildren(...(items.length ? items.map((x) => h("div", { class: "item" }, h("div", { class: "grow" },
        h("div", { class: "title" }, dateTime(x.at)), h("div", { class: "meta" }, device(x.user_agent || ""), " · ", h("span", { dir: "ltr" }, x.ip || "—"))),
        x.lat !== null ? h("a", { class: "btn small", href: `https://maps.google.com/?q=${x.lat},${x.lng}`, target: "_blank", rel: "noopener", title: x.accuracy_m ? `±${x.accuracy_m} m` : "" }, "🗺 ", t("ci_map"))
          : h("span", { class: "muted" }, t("signins_no_loc")))) : [h("p", { class: "sub" }, t("signins_none"))]));
    } catch (er) { list.replaceChildren(h("p", { class: "sub" }, errText(er))); }
  });
  return box;
}
/** Documents that can be renewed, and when: expired, or expiring within 30 days. */
const RENEWABLE = ["civil_id", "passport", "visa"];
function renewButton(e, f, can, mayUpload) {
  if (!RENEWABLE.includes(f.doc_type) || !f.expiry) return null;
  if (!(can.edit() || (mayUpload && SELF_DOC_TYPES.includes(f.doc_type)))) return null;
  const days = Math.round((Date.parse(f.expiry) - Date.parse(todayIso())) / 864e5);
  if (days > 30) return null;
  // the new copy is a file (a clear scan or PDF reads better than a phone photo); it replaces this one and updates Personal
  return h("label", { class: `btn small ${days < 0 ? "warn" : ""}`, title: t("renew_hint") }, "🔄 ", t("renew"),
    h("input", { type: "file", hidden: true, accept: DOC_ACCEPT, onchange: async (ev) => {
      const nf = ev.target.files[0]; ev.target.value = "";
      if (nf && (await confirm(t("renew_q", { what: t("dt_" + f.doc_type) }), { okText: t("renew") }))) await uploadDoc(e, nf, f.doc_type, "", can.edit(), f.id);
    } }));
}
/** Earlier copies of a renewed document — HR and Admin only (the server sends them to nobody else). */
function archivedList(fs) {
  if (!fs.length) return null;
  return h("details", { class: "doc-archive" }, h("summary", null, t("doc_archive"), " ", h("span", { class: "badge" }, fs.length)),
    h("div", { class: "list" }, fs.map((f) => h("div", { class: "item doc-item archived" },
      h("div", { class: "grow" }, h("div", { class: "title" }, h("a", { href: `/api/files/${f.id}`, target: "_blank", rel: "noopener", onclick: (ev) => { ev.preventDefault(); viewFile(f); } }, f.name)),
        h("div", { class: "meta" }, h("span", { class: "badge" }, t("doc_archived")), " ", f.expiry ? `${t("doc_expiry")}: ${dmy(f.expiry)} · ` : "", t("doc_replaced_on", { d: dateTime(f.archived_at) }))),
      h("div", { class: "row doc-actions" },
        h("button", { class: "btn small", type: "button", onclick: () => viewFile(f) }, "👁 ", t("view")),
        h("a", { class: "btn small", href: `/api/files/${f.id}?download=1` }, t("download")))))));
}

function documents(p, e, can, mayUpload, setPhoto) {
  const docs = p.files.filter((f) => f.kind === "doc");
  const types = can.edit() ? DOC_TYPES : SELF_DOC_TYPES;
  // the civil ID copy lives here (not under Personal): start on it until one is uploaded
  const type = select("doc_type", types.map((d) => [d, t("dt_" + d)]), docs.some((f) => f.doc_type === "civil_id") ? "passport" : "civil_id");
  const expiry = h("input", { type: "date", name: "expiry" });
  const picks = pickButtons((f) => uploadDoc(e, f, type.value, expiry.value, can.edit()));
  // an ID or passport is uploaded as a file (a clear scan or PDF reads better than a phone photo)
  const scan = picks.querySelector(".scan-btn");
  const onType = () => { scan.hidden = ["civil_id", "passport"].includes(type.value); };
  type.addEventListener("change", onType); onType();
  const upload = mayUpload ? h("div", { class: "fields", style: { marginTop: "14px" } },
    field(t("doc_type"), type), field(t("doc_expiry"), expiry),
    h("div", { class: "field", style: { alignSelf: "end" } }, picks)) : null;
  return h("section", { class: "card" }, h("h2", null, t("sec_documents")),
    // one group per document type (category), in the order of the type list
    docs.length ? h("div", { class: "doc-groups" }, [...DOC_TYPES].map((k) => [k, docs.filter((f) => (DOC_TYPES.includes(f.doc_type) ? f.doc_type : "other") === k)]).filter(([, fs]) => fs.length).map(([k, fs]) =>
      h("div", { class: "doc-group" }, h("h3", null, t("dt_" + k), h("span", { class: "badge" }, fs.filter((f) => !f.archived_at).length)),
    h("div", { class: "list" }, fs.filter((f) => !f.archived_at).map((f) => h("div", { class: "item doc-item" },
      h("div", { class: "grow" }, h("div", { class: "title" }, h("a", { href: `/api/files/${f.id}`, target: "_blank", rel: "noopener", onclick: (ev) => { ev.preventDefault(); viewFile(f); } }, f.name)),
        h("div", { class: "meta" }, f.expiry ? `${t("doc_expiry")}: ${dmy(f.expiry)} · ` : "", `${dateTime(f.uploaded_at)} `, expiryBadge(f.expiry))),
      // actions on their own line under the name, so a phone never gets wider than the screen
      h("div", { class: "row doc-actions" },
        h("button", { class: "btn small primary", type: "button", onclick: () => viewFile(f) }, "👁 ", t("view")),
        mayUpload && ["civil_id", "passport"].includes(f.doc_type) && f.mime.startsWith("image/") ? h("button", { class: "btn small", type: "button", onclick: () => cropDialog(e, f.id) }, "👤 ", t("photo_use")) : null,
        (can.edit() || (mayUpload && SELF_DOC_TYPES.includes(f.doc_type || "other"))) && (f.expiry || EXPIRING.includes(f.doc_type))
          ? h("button", { class: "btn small", type: "button", onclick: async () => { await expiryDialog(f); rerender(); } }, "📅 ", t(f.expiry ? "expiry_change" : "expiry_add")) : null,
        h("a", { class: "btn small", href: `/api/files/${f.id}?download=1` }, t("download")),
        renewButton(e, f, can, mayUpload),
        can.edit() ? h("button", { class: "btn small danger", type: "button", onclick: async () => {
          if (!(await confirm(t("delete_file_q"), { danger: true, okText: t("delete") }))) return;
          try { await api.del(`/api/files/${f.id}`); rerender(); } catch (er) { toast(errText(er), "bad"); }
        } }, t("delete")) : null)))),
    archivedList(fs.filter((f) => f.archived_at))))) : h("div", { class: "empty" }, t("no_results")),
    upload,
    mayUpload ? h("div", { style: { marginTop: "14px" } }, h("h3", null, t("photo_personal")),
      h("div", { class: "row" },
        h("label", { class: "btn" }, "🖼️ ", t("photo_upload"), h("input", { type: "file", hidden: true, accept: "image/png,image/jpeg,image/webp", onchange: (ev) => { const f = ev.target.files[0]; ev.target.value = ""; setPhoto(f); } })))) : null);
}

const SOURCE_KEYS = { identity: "sec_identity", contact: "sec_contact", qualifications: "sec_qualifications", bank: "sec_bank", id: "pc_src_id", photo: "pc_src_photo" };
const pendingOf = (p, source) => (p.pendingChanges || []).filter((c) => c.source === source);
const badgeIfPending = (p, source) => (pendingOf(p, source).length ? h("span", { class: "badge b-pending" }, t("not_verified_yet")) : null);
/** What changed and still waits for HR — the person sees it; HR gets a link to review. */
function pendingNote(p, own, can) {
  const list = p.pendingChanges || [];
  if (!list.length) return null;
  const what = [...new Set(list.map((c) => t(SOURCE_KEYS[c.source] || c.source)))].join(getLang() === "ar" ? "، " : ", ");
  return h("div", { class: "note" }, own ? t("pc_mine_pending", { what }) : t("pc_hr_pending", { what }),
    !own && can.edit() ? h("a", { class: "btn small", href: "#/profile-changes", style: { marginInlineStart: "10px" } }, t("pc_review")) : null);
}

/** Bank details for salary transfer: the person, HR, Admin and Accounts see them. */
function bankCard(p, e, mayUpload) {
  return h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", null, t("sec_bank")), badgeIfPending(p, "bank"),
      mayUpload ? h("button", { class: "btn small", type: "button", onclick: () => bankDialog(e) }, t("edit")) : null),
    h("dl", { class: "facts" },
      h("div", null, h("dt", null, t("f_bank_name")), h("dd", null, bankName(e.bank_name) || "—")),
      h("div", null, h("dt", null, t("f_bank_account")), h("dd", { dir: "ltr", class: "num" }, e.bank_account || "—")),
      h("div", { style: { gridColumn: "1/-1" } }, h("dt", null, t("f_bank_iban")), h("dd", { dir: "ltr", class: "num" }, ibanText(e.bank_iban) || "—"))),
    h("p", { class: "sub", style: { margin: "8px 0 0" } }, t("bank_private")));
}
function bankDialog(e) {
  const known = BANKS.some(([en]) => en === e.bank_name);
  const bank = select("bank_name", [["", "—"], ...BANKS.map(([en]) => [en, bankName(en)]), ["__other", t("bank_other")]], known ? e.bank_name : e.bank_name ? "__other" : "");
  const other = h("input", { name: "bank_other", value: known ? "" : e.bank_name || "", maxlength: 100 });
  const otherField = field(t("bank_other_name"), other);
  const showOther = () => { otherField.hidden = bank.value !== "__other"; };
  bank.addEventListener("change", showOther); showOther();
  const acct = h("input", { name: "bank_account", value: e.bank_account || "", dir: "ltr", inputmode: "numeric", autocomplete: "off" });
  const iban = h("input", { name: "bank_iban", value: ibanText(e.bank_iban), dir: "ltr", autocomplete: "off", placeholder: "OM00 0000 0000 0000 0000 000", style: { textTransform: "uppercase" } });
  return simpleDialog(t("sec_bank"), [field(t("f_bank_name"), bank, { full: true }), otherField, field(t("f_bank_account"), acct), field(t("f_bank_iban"), iban, { hint: t("iban_hint") })],
    () => {
      if (acct.value.trim() && !/^\d{6,20}$/.test(acct.value.replace(/[\s-]/g, ""))) throw { message: t("acct_bad") };
      if (iban.value.trim() && !validIban(iban.value)) throw { message: t("iban_bad") };
      return api.put(`/api/employees/${e.id}/bank`, { bank_name: bank.value === "__other" ? other.value.trim() : bank.value || null, bank_account: acct.value || null, bank_iban: iban.value || null });
    }, t("verify_note"));
}
const QUAL = ["education", "specialization", "experience", "languages", "certifications", "skills", "main_tasks"];
/** Qualifications in Arabic and English (stored together as "English | عربي"). */
function qualDialog(e) {
  const boxes = QUAL.map((k) => {
    const v = splitLangs(e[k]), long = ["skills", "main_tasks", "experience"].includes(k);
    const box = (lang) => { const c = long ? h("textarea", { rows: 3, maxlength: 2000, dir: lang === "ar" ? "rtl" : "ltr" }) : h("input", { maxlength: 300, dir: lang === "ar" ? "rtl" : "ltr" }); c.value = v[lang] || ""; return c; };
    return { k, ar: box("ar"), en: box("en") };
  });
  const rows = boxes.map(({ k, ar, en }) => h("div", { class: "field full bilingual" }, h("label", null, t("f_" + k)),
    h("div", { class: "pair" }, h("div", null, h("span", { class: "lang-tag" }, "عربي"), ar), h("div", null, h("span", { class: "lang-tag" }, "English"), en))));
  return simpleDialog(t("sec_qualifications"), rows,
    () => api.put(`/api/employees/${e.id}/qualifications`, Object.fromEntries(boxes.map(({ k, ar, en }) => [k, joinLangs(ar.value, en.value)]))), t("verify_note"), true);
}
/** A dialog with fields and Save/Cancel; save() returns a promise. */
function simpleDialog(title, fields, save, note, wide = false, onClose = null) {
  const err = h("div", { class: "form-error" });
  const dlg = h("dialog", { class: wide ? "dialog wide" : "dialog" }, h("form", { class: "form", novalidate: true, onsubmit: async (ev) => {
    ev.preventDefault();
    try { await save(); dlg.close(); toast(t("saved")); rerender(); } catch (er) { err.textContent = er.field ? `${t("f_" + er.field)}: ${errText(er)}` : errText(er); }
  } },
    h("h2", null, title), h("div", { class: "fields" }, fields), note ? h("p", { class: "sub" }, note) : null, err,
    h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t("cancel")), h("button", { class: "btn primary", type: "submit" }, t("save")))));
  dlg.addEventListener("close", () => { dlg.remove(); if (onClose) onClose(); });
  document.body.append(dlg); dlg.showModal();
}

/** Take the profile photo from an ID or passport scan: move and size the square over the face, then save (or keep the current photo). */
function cropDialog(e, fileId) {
  const img = h("img", { src: `/api/files/${fileId}`, alt: "", draggable: "false", style: { display: "block", width: "100%", userSelect: "none" } });
  const box = h("div", { class: "crop-box" });
  const stage = h("div", { class: "crop-stage" }, img, box);
  const size = h("input", { type: "range", min: 10, max: 90, value: 30, "aria-label": t("photo_size") });
  let x = 4, y = 18; // % of the image's width/height
  const place = () => {
    const W = img.clientWidth, H = img.clientHeight, s = (Number(size.value) / 100) * W;
    x = Math.max(0, Math.min(x, 100 - (s / W) * 100)); y = Math.max(0, Math.min(y, 100 - (s / H) * 100));
    Object.assign(box.style, { left: `${x}%`, top: `${y}%`, width: `${s}px`, height: `${s}px` });
  };
  let drag = null;
  box.addEventListener("pointerdown", (ev) => { drag = { px: ev.clientX, py: ev.clientY, x, y }; box.setPointerCapture(ev.pointerId); ev.preventDefault(); });
  box.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    x = drag.x + ((ev.clientX - drag.px) / img.clientWidth) * 100; y = drag.y + ((ev.clientY - drag.py) / img.clientHeight) * 100; place();
  });
  box.addEventListener("pointerup", () => { drag = null; });
  size.addEventListener("input", place);
  img.addEventListener("load", place);
  const err = h("div", { class: "form-error" });
  const dlg = h("dialog", { class: "dialog wide" }, h("form", { class: "form", onsubmit: async (ev) => {
    ev.preventDefault();
    const k = img.naturalWidth / img.clientWidth, s = box.offsetWidth * k;
    const c = document.createElement("canvas"); c.width = c.height = 400;
    c.getContext("2d").drawImage(img, (x / 100) * img.naturalWidth, (y / 100) * img.naturalHeight, s, s, 0, 0, 400, 400);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
    try { await api.upload(`/api/employees/${e.id}/files?kind=photo&name=photo-from-id.jpg`, blob); dlg.close(); toast(t("saved")); rerender(); }
    catch (er) { err.textContent = errText(er); }
  } },
    h("h2", null, t("photo_from_id")), h("p", { class: "sub" }, t("photo_crop_hint")),
    stage, field(t("photo_size"), size), err,
    h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t("photo_keep")), h("button", { class: "btn primary", type: "submit" }, t("photo_use")))));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
  if (img.complete) place();
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

/** A list with an "Other…" choice that shows a text box; value() gives the English name or what was typed. */
function placePicker(name, groups, current, known) {
  const sel = h("select", { name }, h("option", { value: "" }, "—"),
    groups.map(([label, items]) => label ? h("optgroup", { label }, items.map(([v, l]) => h("option", { value: v }, l))) : items.map(([v, l]) => h("option", { value: v }, l))),
    h("option", { value: "__other" }, t("place_other")));
  sel.value = current ? (known(current) ? current : "__other") : "";
  const other = h("input", { name: name + "_other", maxlength: 100, value: current && !known(current) ? current : "", placeholder: t("place_other_hint") });
  const show = () => { other.hidden = sel.value !== "__other"; };
  sel.addEventListener("change", () => { show(); if (!other.hidden) other.focus(); }); show();
  return { el: h("div", { class: "grid", style: { gap: "6px" } }, sel, other), sel, value: () => (sel.value === "__other" ? other.value.trim() : sel.value) || null };
}

function contactDialog(e) {
  const ar = getLang() === "ar";
  const inp = (k, attrs = {}) => h("input", { name: k, value: e[k] || "", ...attrs });
  const tel = { type: "tel", dir: "ltr", inputmode: "tel" };
  const inputs = {
    mobile: inp("mobile", tel), personal_phone: inp("personal_phone", tel), personal_email: inp("personal_email", { type: "email", dir: "ltr", autocomplete: "email" }),
    address: inp("address", { placeholder: t("address_hint") }), emergency_name: inp("emergency_name"), emergency_relation: inp("emergency_relation"), emergency_phone: inp("emergency_phone", tel),
  };
  const perm = placePicker("perm_wilayat", GOVERNORATES.map(([gEn, gAr, ws]) => [ar ? gAr : gEn, ws.map(([en, a]) => [en, ar ? a : en])]), e.perm_wilayat, isWilayat);
  const cur = placePicker("current_area", MUSCAT_GROUPS.map(([wEn, wAr, list]) => [ar ? wAr : wEn, list.map(([en, a]) => [en, ar ? a : en])]), e.current_area, isArea);
  const err = h("div", { class: "form-error" });
  const dlg = h("dialog", { class: "dialog wide" }, h("form", { class: "form", onsubmit: async (ev) => {
    ev.preventDefault();
    const body = { ...Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])), perm_wilayat: perm.value(), current_area: cur.value() };
    try { await api.put(`/api/employees/${e.id}/contact`, body); dlg.close(); toast(t("saved")); rerender(); }
    catch (er) { err.textContent = er.field ? `${t("f_" + er.field)}: ${errText(er)}` : errText(er); }
  } },
    h("h2", null, t("sec_contact")),
    h("div", { class: "fields" }, ["mobile", "personal_phone", "personal_email"].map((k) => field(t("f_" + k), inputs[k]))),
    h("h3", null, t("sec_address")),
    h("div", { class: "fields" }, field(t("f_perm_wilayat"), perm.el), field(t("f_current_area"), cur.el), field(t("f_address"), inputs.address, { full: true })),
    h("h3", null, t("sec_emergency")),
    h("div", { class: "fields" }, ["emergency_name", "emergency_relation", "emergency_phone"].map((k) => field(t(k === "emergency_name" ? "emergency_person" : "f_" + k), inputs[k]))),
    h("p", { class: "sub" }, t("email_by_hr"), " ", t("verify_note")), err,
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
        h("dl", { class: "facts" }, Object.entries(L.byType).filter(([k, v]) => k !== "emergency" || v).map(([k, v]) => h("div", null, h("dt", null, t("lt_" + k)), h("dd", { class: "num" }, isPermission(k) ? t("hours", { n: num(v / 60) }) : daysText(v))))))),

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
