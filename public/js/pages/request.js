import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, badge, when, amountText, dateTime, daysText, confirm, toast, errText, backLink, dmy, field } from "../ui.js";
import { render as rerender, refreshMe } from "../app.js";

export async function decide(id, action) {
  let comment = "";
  if (action === "reject") { comment = await confirm(t("reject"), { input: t("reject_reason"), required: true, okText: t("reject"), danger: true }); if (comment === null) return false; }
  else if (action === "approve") { comment = await confirm(t("approve_q"), { input: t("comment_optional"), okText: t("approve") }); if (comment === null) return false; }
  else { comment = await confirm(t("cancel_q"), { input: t("cancel_reason"), okText: t("cancel_request"), danger: true }); if (comment === null) return false; }
  try {
    await api.post(`/api/requests/${id}/${action}`, { comment });
    toast(t({ approve: "approved_ok", reject: "rejected_ok", cancel: "cancelled_ok" }[action]));
    await refreshMe();
    return true;
  } catch (er) { toast(errText(er), "bad"); return false; }
}

async function postpone(r) {
  const input = h("input", { type: "date", min: r.start_date, required: true });
  const comment = h("textarea", { rows: 2, placeholder: t("comment_optional") });
  const err = h("div", { class: "form-error" });
  const dlg = h("dialog", { class: "dialog" }, h("form", { class: "form", onsubmit: async (e) => {
    e.preventDefault();
    try { await api.post(`/api/requests/${r.id}/postpone`, { start: input.value, comment: comment.value.trim() }); dlg.close(); toast(t("postponed_ok")); await refreshMe(); rerender(); }
    catch (er) { err.textContent = errText(er); }
  } }, h("h2", null, t("postpone")), field(t("postpone_to"), input), comment, err,
    h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t("cancel")), h("button", { class: "btn primary", type: "submit" }, t("postpone")))));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal(); input.focus();
}

export async function render(el, params, { me, can }) {
  const d = await api.get(`/api/requests/${params.id}`);
  const r = d.request;
  const own = me.employee && me.employee.id === r.employee_id;
  const canCancel = (r.status === "pending" && (own || can.edit())) || (r.status === "approved" && (can.admin() || r.approver_user_id === me.user.id));
  const act = (action) => async () => { if (await decide(r.id, action)) rerender(); };
  const row = (k, v) => h("div", null, h("dt", null, t(k)), h("dd", null, v || "—"));
  el.append(
    backLink(own ? "#/leave" : d.canDecide ? "#/approvals" : "#/requests"),
    h("div", { class: "page-head" }, h("h1", null, t("lt_" + r.type)), badge(r.status)),
    h("section", { class: "card" }, h("dl", { class: "facts" },
      row("employee", can.staffList() ? h("a", { href: `#/staff/${r.employee_id}` }, nm(r)) : nm(r)),
      row("date", when(r)), row("amount", amountText(r)),
      ["annual", "emergency"].includes(r.type) ? row("current_balance", daysText(r.balance)) : null,
      r.type === "early" && d.deducted > 0 ? row("deducted_from_annual", t("hours", { n: d.deducted / 60 })) : null,
      r.type === "comp_day" ? row("comp_choice", t(r.comp_choice === "pay" ? "comp_pay" : "comp_leave")) : null,
      r.relation ? row(r.type === "patient_care" ? "patient_relation" : "relation", r.type === "bereavement" ? t("rel_" + r.relation) : r.relation) : null,
      r.event_date ? row(r.type === "bereavement" ? "death_date" : r.type === "childcare" ? "child_birth_date" : "birth_date", dmy(r.event_date)) : null,
      row("approver", d.approver ? `${nm(d.approver) || d.approver.username} · ${t("route_" + r.route_reason)}` : "—"),
      row("submitted_at", dateTime(r.created_at)),
      r.reason ? h("div", { style: { gridColumn: "1/-1" } }, h("dt", null, t("reason")), h("dd", null, r.reason)) : null),
      d.files.length ? h("div", { style: { marginTop: "14px" } }, h("h3", null, t("attachments")),
        d.files.map((f) => h("div", null, h("a", { href: `/api/files/${f.id}`, target: "_blank", rel: "noopener" }, f.name)))) : null,
      d.needsProof ? h("div", { class: "note", style: { marginTop: "14px" } }, t("proof_needed"),
        own || can.edit() ? h("label", { class: "btn small", style: { marginInlineStart: "10px", cursor: "pointer" } }, t("attach_proof"),
          h("input", { type: "file", hidden: true, accept: "application/pdf,image/png,image/jpeg,image/webp", onchange: async (ev) => {
            const f = ev.target.files[0]; if (!f) return;
            try { await api.upload(`/api/requests/${r.id}/files?name=${encodeURIComponent(f.name)}`, f); toast(t("saved")); rerender(); } catch (er) { toast(errText(er), "bad"); }
          } })) : null) : null,
      d.sickPay ? h("div", { style: { marginTop: "14px" } }, h("h3", null, t("sick_pay")),
        h("dl", { class: "facts" }, Object.entries(d.sickPay).filter(([, n]) => n).sort((a, b) => b[0] - a[0]).map(([p, n]) => h("div", null, h("dt", null, t("pay_pct", { p })), h("dd", { class: "num" }, t("days", { n })))))) : null),
    d.canDecide || canCancel ? h("div", { class: "row" },
      d.canDecide ? h("button", { class: "btn ok", type: "button", onclick: act("approve") }, t("approve")) : null,
      d.canDecide ? h("button", { class: "btn danger", type: "button", onclick: act("reject") }, t("reject")) : null,
      d.canPostpone ? h("button", { class: "btn", type: "button", onclick: () => postpone(r) }, t("postpone")) : null,
      canCancel ? h("button", { class: "btn", type: "button", onclick: act("cancel") }, t("cancel_request")) : null) : null,
    h("section", { class: "card" }, h("h2", null, t("history")),
      h("ol", { class: "timeline" }, d.events.map((e) => h("li", null, h("div", null,
        h("div", null, h("b", null, (e.actor_name && (nm({ name_ar: e.actor_name, name_en: e.actor_name_en }))) || e.actor_username || "—"), " · ", t("ev_" + e.action)),
        h("div", { class: "sub" }, dateTime(e.at)), e.comment ? h("div", null, e.comment) : null))))));
}
