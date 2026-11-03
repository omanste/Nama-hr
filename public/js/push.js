// Pop-up notifications on this device (Web Push): turn on / off, and the state for the switch.
import { api } from "./api.js";
import { getLang, t } from "./i18n.js";
import { h, toast } from "./ui.js";

const b64 = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

/** "on" · "off" · "blocked" (the browser refused) · "ios_home" (iPhone: add to the Home Screen first) · "unsupported" */
export async function pushState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return isIos() && !standalone() ? "ios_home" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg && (await reg.pushManager.getSubscription());
  return sub && Notification.permission === "granted" ? "on" : "off";
}

export async function enablePush() {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "blocked" : "off";
  const { publicKey } = await api.get("/api/push/key");
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) });
  await api.post("/api/push/subscribe", { ...sub.toJSON(), lang: getLang() });
  return "on";
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) { await api.post("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  return "off";
}

/** Keep this device's registration current (e.g. after the language changes); quietly, on start. */
export async function refreshPush() {
  try { if ((await pushState()) === "on") { const reg = await navigator.serviceWorker.getRegistration("/"); const sub = await reg.pushManager.getSubscription(); await api.post("/api/push/subscribe", { ...sub.toJSON(), lang: getLang() }); } } catch {}
}

/* Asked once the person is signed in: a window offering to turn notifications on for this device, so staff and
 * managers hear about tasks and approvals even with the portal closed. Not shown again on this device for 3 days
 * after "later" (or when already on / refused / not possible). The browser's own permission question can only come
 * from a tap, so the window's button asks it. */
const LATER_KEY = "nama.push.later";
const later = () => { try { return Number(localStorage.getItem(LATER_KEY) || 0) > Date.now(); } catch { return false; } };
const snooze = (days) => { try { localStorage.setItem(LATER_KEY, String(Date.now() + days * 864e5)); } catch {} };
let asked = false;
export async function maybeAskForPush() {
  if (asked || later() || document.querySelector("dialog[open]")) return;
  asked = true;
  const state = await pushState().catch(() => "unsupported");
  if (state !== "off" && state !== "ios_home") return;
  const dlg = h("dialog", { class: "dialog push-ask" });
  const close = (days) => { if (days) snooze(days); dlg.close(); };
  const enable = h("button", { class: "btn primary", type: "button", onclick: async () => {
    enable.disabled = true;
    try {
      const r = await enablePush();
      if (r === "on") { toast(t("push_on_ok")); api.post("/api/push/test", {}).catch(() => {}); close(0); }
      else { close(r === "blocked" ? 30 : 3); if (r === "blocked") toast(t("push_blocked"), "bad"); }
    } catch (e) { close(3); toast(e.message || t("error"), "bad"); }
  } }, "🔔 ", t("push_enable"));
  dlg.append(h("div", { class: "form" },
    h("div", { class: "push-ask-icon", "aria-hidden": "true" }, "🔔"),
    h("h2", null, t("push_ask_title")),
    h("p", { class: "sub" }, t(state === "ios_home" ? "push_ios_home" : "push_ask_text")),
    h("div", { class: "row end" },
      h("button", { class: "btn", type: "button", onclick: () => close(3) }, t("push_later")),
      state === "off" ? enable : h("button", { class: "btn primary", type: "button", onclick: () => close(7) }, t("push_got_it")))));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}
