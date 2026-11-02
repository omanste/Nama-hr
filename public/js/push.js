// Pop-up notifications on this device (Web Push): turn on / off, and the state for the switch.
import { api } from "./api.js";
import { getLang } from "./i18n.js";

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
