// Write to management: suggestion, question, complaint, note — to my manager, HR or the CEO. Always with my name.
import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, field, toast, errText, showFieldError, backLink, empty } from "../ui.js";

export async function render(el, _p, { me, query }) {
  if (!me.employee) { el.append(empty(t("no_profile"))); return; }
  const { items: recipients, categories, missing = [] } = await api.get("/api/voice/recipients");
  // nobody set up yet: say exactly what Admin/HR still need to set
  if (!recipients.length) {
    el.append(backLink("#/voice"), h("h1", null, t("voice_new")),
      h("section", { class: "card" }, h("h2", null, t("voice_no_recipients")),
        h("ul", null, missing.map((k) => h("li", null, t("voice_missing_" + k)))),
        h("p", { class: "sub" }, t("voice_ask_admin"))));
    return;
  }
  let category = categories.includes(query.get("category")) ? query.get("category") : "suggestion";
  let to = recipients[0].kind;
  const catBox = h("div", { class: "seg", role: "group", "aria-label": t("kind") });
  const toBox = h("div", { class: "grid", role: "radiogroup", "aria-label": t("voice_to") });
  const subject = h("input", { name: "subject", maxlength: 150, required: true });
  const body = h("textarea", { name: "body", rows: 7, maxlength: 5000, required: true });
  const file = h("input", { type: "file", name: "file", accept: "application/pdf,image/png,image/jpeg,image/webp" });
  const hint = h("div", { class: "note", style: { marginTop: "10px" } });
  const submit = h("button", { class: "btn primary", type: "submit" }, t("voice_send"));
  const label = (r) => (r.kind === "hr" ? t("to_hr") : r.kind === "ceo" ? t("to_ceo") : t("to_manager")) + (r.kind !== "hr" && (r.name_ar || r.name_en) ? ` · ${nm(r)}` : "");
  function draw() {
    catBox.replaceChildren(...categories.map((c) => h("button", { type: "button", "aria-pressed": String(c === category), onclick: () => { category = c; draw(); } }, t("vc_" + c))));
    toBox.replaceChildren(...recipients.map((r) => h("label", { class: "read-row" }, h("input", { type: "radio", name: "to", value: r.kind, checked: r.kind === to, onchange: () => { to = r.kind; draw(); } }),
      h("div", { class: "grow" }, h("b", null, label(r)), h("div", { class: "sub" }, t("to_" + r.kind + "_hint"))))));
    hint.textContent = category === "complaint" && to === "manager" ? t("voice_complaint_hint") : t("voice_private");
    hint.className = category === "complaint" && to === "manager" ? "note bad" : "note";
  }
  const form = h("form", { class: "form", novalidate: true, onsubmit: async (ev) => {
    ev.preventDefault();
    if (!subject.value.trim()) { showFieldError(form, "subject", t("required")); return; }
    if (!body.value.trim()) { showFieldError(form, "body", t("required")); return; }
    submit.disabled = true;
    try {
      const r = await api.post("/api/voice", { category, to, subject: subject.value.trim(), body: body.value.trim() });
      const f = file.files[0];
      if (f) { try { await api.upload(`/api/voice/${r.message.id}/files?name=${encodeURIComponent(f.name)}`, f); } catch (er) { toast(errText(er), "bad"); } }
      toast(t("voice_sent_ok"));
      location.hash = `#/voice/${r.message.id}`;
    } catch (er) {
      submit.disabled = false;
      if (!(er.field && showFieldError(form, er.field, errText(er)))) toast(errText(er), "bad");
    }
  } },
    h("section", { class: "card" }, h("h2", null, t("kind")), catBox),
    h("section", { class: "card" }, h("h2", null, t("voice_to")), toBox, hint),
    h("section", { class: "card" }, h("div", { class: "fields" },
      field(t("voice_subject"), subject, { full: true, req: true }), field(t("voice_body"), body, { full: true, req: true }),
      field(t("attachment_optional"), file, { full: true })),
      h("p", { class: "sub", style: { margin: "8px 0 0" } }, t("voice_named", { name: nm(me.employee) }))),
    h("div", { class: "form-actions" }, h("a", { class: "btn", href: "#/voice" }, t("cancel")), submit));
  el.append(backLink("#/voice"), h("h1", null, t("voice_new")), form);
  draw();
}
