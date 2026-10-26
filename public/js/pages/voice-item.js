// One Staff Voice conversation: the message, replies, attachments and status.
import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, toast, errText, backLink, dateTime, select, confirm } from "../ui.js";
import { render as rerender, refreshMe } from "../app.js";
import { voiceBadge } from "./voice.js";

export async function render(el, params, { me }) {
  const d = await api.get(`/api/voice/${params.id}`);
  const m = d.message;
  if (d.isRecipient) refreshMe(); // opening it may have cleared the "new" badge
  const bubble = (who, mine, text, at) => h("div", { class: `bubble${mine ? " mine" : ""}` },
    h("div", { class: "bwho" }, who, " · ", h("span", { class: "muted" }, dateTime(at))), h("div", { dir: "auto", style: { whiteSpace: "pre-line" } }, text));
  const sender = nm(m) || m.emp_no;
  const toText = m.to_kind === "hr" ? t("to_hr") : m.to_kind === "ceo" ? t("to_ceo") : t("to_manager");
  const reply = h("textarea", { rows: 3, maxlength: 5000, "aria-label": t("voice_reply") });
  const err = h("div", { class: "form-error" });
  const statusSel = d.isRecipient ? select("status", [["in_review", t("vs_in_review")], ["answered", t("vs_answered")], ["closed", t("vs_closed")]], m.status === "new" ? "in_review" : m.status) : null;
  const setStatus = async (s) => { try { await api.post(`/api/voice/${m.id}/status`, { status: s }); toast(t("saved")); rerender(); } catch (er) { toast(errText(er), "bad"); } };

  // Admin only: hide (then only Admin sees it) or delete for good
  const adminBar = me.user.role === "admin" ? h("div", { class: "row end" },
    h("button", { class: "btn", type: "button", onclick: async () => {
      if (!(await confirm(t(m.hidden ? "voice_unhide_q" : "voice_hide_q"), { okText: t(m.hidden ? "voice_unhide" : "voice_hide") }))) return;
      try { await api.post(`/api/voice/${m.id}/hide`, { hidden: !m.hidden }); toast(t("saved")); rerender(); } catch (er) { toast(errText(er), "bad"); }
    } }, t(m.hidden ? "voice_unhide" : "voice_hide")),
    h("button", { class: "btn danger", type: "button", onclick: async () => {
      if (!(await confirm(t("voice_delete_q"), { danger: true, okText: t("delete") }))) return;
      try { await api.del(`/api/voice/${m.id}`); toast(t("staff_deleted")); location.hash = "#/voice?box=inbox"; } catch (er) { toast(errText(er), "bad"); }
    } }, t("delete"))) : null;
  el.append(backLink("#/voice" + (m.user_id === me.user.id ? "" : "?box=inbox")),
    h("div", { class: "page-head" }, h("h1", { dir: "auto" }, m.subject), h("div", { class: "row" }, m.hidden ? h("span", { class: "badge b-rejected" }, t("voice_hidden")) : null, voiceBadge(m.status))),
    m.hidden ? h("div", { class: "note bad" }, t("voice_hidden_note")) : null,
    adminBar,
    h("p", { class: "sub" }, t("vc_" + m.category), " · ", t("voice_from"), ": ", sender, " · ", t("voice_to"), ": ", toText,
      m.to_kind !== "hr" && (m.to_name_ar || m.to_name_en) ? ` (${nm({ name_ar: m.to_name_ar, name_en: m.to_name_en })})` : ""),
    h("section", { class: "card thread" },
      bubble(sender, m.user_id === me.user.id, m.body, m.created_at),
      d.files.length ? h("div", { class: "row", style: { flexWrap: "wrap" } }, d.files.map((f) => h("a", { class: "btn small", href: `/api/files/${f.id}`, target: "_blank", rel: "noopener" }, "📎 ", f.name))) : null,
      d.replies.map((r) => bubble(nm(r) || r.username, r.user_id === me.user.id, r.body, r.created_at))),
    d.canReply ? h("form", { class: "card form", onsubmit: async (ev) => {
      ev.preventDefault();
      if (!reply.value.trim()) { err.textContent = t("required"); return; }
      try { await api.post(`/api/voice/${m.id}/reply`, { body: reply.value.trim() }); toast(t("saved")); rerender(); } catch (er) { err.textContent = errText(er); }
    } }, h("label", null, t("voice_reply")), reply, err,
      h("div", { class: "row end" }, h("button", { class: "btn primary", type: "submit" }, t("send")))) : h("div", { class: "note" }, t("voice_closed_note")),
    statusSel ? h("section", { class: "card" }, h("div", { class: "row", style: { flexWrap: "wrap" } }, h("span", null, t("status")), statusSel,
      h("button", { class: "btn", type: "button", onclick: () => setStatus(statusSel.value) }, t("save")))) : null,
    !d.isRecipient && m.user_id === me.user.id && m.status !== "closed" ? h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => setStatus("closed") }, t("voice_close"))) : null,
    !d.isRecipient && m.user_id === me.user.id && m.status === "closed" ? h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => setStatus("in_review") }, t("voice_reopen"))) : null);
}
