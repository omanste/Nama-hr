// Profile updates to verify (HR, Admin): what each person changed in their own profile — before and after — to confirm or undo.
import { api } from "../api.js";
import { t, nm, getLang, tx } from "../i18n.js";
import { countryName } from "../countries.js";
import { h, select, pageHead, empty, dmy, dateTime, toast, errText, confirm, avatar } from "../ui.js";
import { render as rerender, refreshMe } from "../app.js";
import { bankName, ibanText } from "../banks.js";
import { wilayatName, areaName } from "../places.js";

const SOURCE_KEYS = { identity: "sec_identity", contact: "sec_contact", qualifications: "sec_qualifications", bank: "sec_bank", id: "pc_src_id", photo: "pc_src_photo" };
const DATES = ["dob", "civil_id_expiry", "passport_expiry", "visa_expiry"];
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

/** Update every profile from its uploaded ID card and passport: start it, watch it run, read the result. */
async function rereadCard() {
  const box = h("section", { class: "card" });
  let timer = null;
  const DOC = { civil_id: "dt_civil_id", passport: "dt_passport" };
  const draw = (b) => {
    const start = h("button", { class: "btn primary", type: "button", disabled: !!(b && b.running), onclick: async () => {
      if (!(await confirm(t("rr_confirm"), { okText: t("rr_start") }))) return;
      try { await api.post("/api/profiles/reread-ids", {}); poll(); } catch (e) { toast(errText(e), "bad"); }
    } }, "🪪 ", t("rr_start"));
    const parts = [h("div", { class: "card-head" }, h("h2", null, t("rr_title")), start), h("p", { class: "sub" }, t("rr_hint"))];
    if (b && b.running) parts.push(h("div", { class: "note" }, t("rr_running", { d: b.done, n: b.total || "…" }), h("progress", { max: b.total || 1, value: b.done, style: { width: "100%", marginTop: "8px" } })));
    if (b && !b.running) {
      const docs = b.results.flatMap((r) => r.docs.map((d) => ({ r, d })));
      const upd = docs.filter((x) => x.d.status === "updated"), same = docs.filter((x) => x.d.status === "same"), bad = docs.filter((x) => x.d.status === "not_read");
      parts.push(h("div", { class: "note" }, h("b", null, t("rr_done_at", { at: dateTime(b.finished_at), by: b.by })), " · ",
        t("rr_summary", { u: new Set(upd.map((x) => x.r.id)).size, s: same.length, x: bad.length, n: b.noId.length })),
        b.error ? h("div", { class: "note bad" }, b.error) : null);
      const who = (r) => h("a", { href: `#/staff/${r.id}` }, nm(r) || r.emp_no, h("span", { class: "muted" }, ` · ${r.emp_no}`));
      if (upd.length) parts.push(h("h3", null, t("rr_updated")), h("div", { class: "table-wrap" }, h("table", null,
        h("thead", null, h("tr", null, h("th", null, t("employee")), h("th", null, t("doc_type")), h("th", null, t("rr_changes")))),
        // one row per person and document; on a phone each becomes a card
        h("tbody", null, upd.map(({ r, d }) => h("tr", null,
          h("td", { "data-label": t("employee") }, who(r)), h("td", { "data-label": t("doc_type") }, t(DOC[d.doc_type])),
          h("td", { "data-label": t("rr_changes") }, h("div", { class: "rr-changes" }, Object.entries(d.changes).map(([k, [a, v]]) => h("div", null,
            h("span", { class: "muted" }, t("f_" + k), ": "), h("span", { class: "pc-old-inline" }, show(k, a)), getLang() === "ar" ? " ← " : " → ", h("b", null, show(k, v))))))))))));
      if (bad.length) parts.push(h("h3", null, t("rr_not_read")), h("p", { class: "sub" }, t("rr_not_read_hint")),
        h("ul", null, bad.map(({ r, d }) => h("li", null, who(r), " — ", t(DOC[d.doc_type]), " (", h("span", { dir: "auto" }, d.name), ")"))));
      if (b.noId.length) parts.push(h("h3", null, t("rr_no_id")), h("p", { class: "sub" }, b.noId.map((p) => nm(p) || p.emp_no).join("، ")));
    }
    box.replaceChildren(...parts.filter(Boolean));
  };
  const poll = async () => {
    clearTimeout(timer);
    if (!box.isConnected && timer) return; // left the page
    const { batch } = await api.get("/api/profiles/reread-ids").catch(() => ({ batch: null }));
    draw(batch);
    if (batch && batch.running) timer = setTimeout(poll, 2000);
  };
  const { batch } = await api.get("/api/profiles/reread-ids");
  draw(batch);
  if (batch && batch.running) timer = setTimeout(poll, 2000);
  return box;
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
  // delete: the entry leaves the list, the profile stays as it is now (to put old values back, use Undo)
  const del = (c) => async () => {
    if (!(await confirm(t("pc_delete_q"), { okText: t("delete"), danger: true }))) return;
    try { await api.del(`/api/profile-changes/${c.id}`); toast(t("saved")); await refreshMe(); rerender(); } catch (e) { toast(errText(e), "bad"); }
  };
  el.append(pageHead(t("nav_profile_changes")),
    h("p", { class: "sub" }, t("pc_intro")),
    await rereadCard(),
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
      mine(c) ? (c.status === "pending" ? h("p", { class: "sub" }, t("pc_not_own")) : null) : h("div", { class: "row end", style: { marginTop: "10px" } },
        h("button", { class: "btn danger", type: "button", onclick: del(c) }, "🗑 ", t("delete")),
        c.status === "pending" ? h("button", { class: "btn", type: "button", onclick: act(c, "revert") }, "↩ ", t("pc_undo")) : null,
        c.status === "pending" ? h("button", { class: "btn ok", type: "button", onclick: act(c, "confirm") }, "✓ ", t("pc_confirm")) : null)))) : empty(t("pc_none")));
}
