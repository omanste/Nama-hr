// Staff Voice: my messages (sent) and, for managers / HR / the CEO, the messages sent to them (inbox).
import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, clear, select, pageHead, empty, dateTime } from "../ui.js";

const CATS = ["suggestion", "question", "complaint", "note", "other"];
const STATUSES = ["new", "in_review", "answered", "closed"];
export const voiceBadge = (s) => h("span", { class: `badge v-${s}` }, t("vs_" + s));
const recipientText = (m) => (m.to_kind === "hr" ? t("to_hr") : m.to_kind === "ceo" ? t("to_ceo") : t("to_manager")) + (m.to_kind !== "hr" && (m.to_name_ar || m.to_name_en) ? ` · ${nm({ name_ar: m.to_name_ar, name_en: m.to_name_en })}` : "");

export async function render(el, _p, { me, query }) {
  // inbox only for people who receive messages (or Admin, who can read all)
  const receives = ["hr", "ceo", "admin"].includes(me.user.role) || me.isApprover || (me.voiceInbox || 0) > 0;
  let box = query.get("box") === "inbox" && receives ? "inbox" : receives && !me.employee ? "inbox" : "sent";
  const status = select("status", [["", `${t("status")}: ${t("all")}`], ...STATUSES.map((s) => [s, t("vs_" + s)])], "");
  const cat = select("category", [["", `${t("kind")}: ${t("all")}`], ...CATS.map((c) => [c, t("vc_" + c)])], "");
  const tabs = h("div", { class: "seg", role: "tablist" });
  const out = h("div");
  async function load() {
    tabs.replaceChildren(...(receives ? [["sent", "voice_sent"], ["inbox", "voice_inbox"]] : [["sent", "voice_sent"]]).map(([k, label]) =>
      h("button", { type: "button", role: "tab", "aria-pressed": String(k === box), onclick: () => { box = k; load(); } }, t(label), k === "inbox" && me.voiceInbox ? ` (${me.voiceInbox})` : "")));
    const qs = new URLSearchParams({ box });
    if (status.value) qs.set("status", status.value);
    if (cat.value) qs.set("category", cat.value);
    const { items } = await api.get(`/api/voice?${qs}`);
    clear(out).append(items.length ? h("div", { class: "list" }, items.map((m) => h("a", { class: "item", href: `#/voice/${m.id}` },
      h("div", { class: "grow" },
        h("div", { class: "title" }, m.subject),
        h("div", { class: "meta" }, t("vc_" + m.category), " · ", box === "inbox" ? nm(m) : recipientText(m), " · ", dateTime(m.updated_at), m.replies ? ` · ${t("replies_n", { n: m.replies })}` : "")),
      m.hidden ? h("span", { class: "badge b-rejected" }, t("voice_hidden")) : null, voiceBadge(m.status)))) : empty(box === "inbox" ? t("voice_inbox_empty") : t("voice_sent_empty")));
  }
  status.addEventListener("change", load); cat.addEventListener("change", load);
  el.append(pageHead(t("nav_voice"), me.employee ? h("a", { class: "btn primary", href: "#/voice/new" }, t("voice_new")) : null),
    h("p", { class: "sub" }, t("voice_intro")),
    h("div", { class: "toolbar" }, tabs), h("div", { class: "toolbar" }, cat, status), out);
  await load();
}
