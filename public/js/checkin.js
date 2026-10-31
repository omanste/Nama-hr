// Online check-in / check-out: the card on the home page and the steps behind its button — the privacy notice (once),
// the location, a photo taken live with the camera, and (outside every work site) a reason. The server keeps the time.
import { api } from "./api.js";
import { t, nm, getLang } from "./i18n.js";
import { h, toast, errText } from "./ui.js";
import { render as rerender } from "./app.js";

const DEVICE_KEY = "nama.device";
/** A random id for this browser (Phase 2 will ask HR to approve new devices). */
function deviceId() {
  try { let id = localStorage.getItem(DEVICE_KEY); if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, id); } return id; } catch { return ""; }
}
const siteName = (s) => (s ? (getLang() === "en" ? s.name_en || s.name_ar : s.name_ar || s.name_en) : "");

/** The home page card, or nothing when online check-in isn't on for this person. */
export async function checkinCard() {
  let st;
  try { st = await api.get("/api/attendance/checkin/today"); } catch { return null; }
  if (!st.enabled) return null;
  const last = st.items[st.items.length - 1];
  const line = (c) => h("div", { class: "ci-line" }, h("b", null, t(c.kind === "in" ? "ci_in_at" : "ci_out_at", { time: c.at.slice(11, 16) })), " · ",
    c.outside ? h("span", { class: "bad-text" }, t("ci_outside")) : h("span", null, "📍 ", siteName(c.site)));
  const next = st.next;
  return h("section", { class: `card checkin-card ${next === "out" ? "is-in" : ""}` },
    h("div", { class: "card-head" }, h("h2", null, t("ci_title")), last ? h("span", { class: `badge ${last.kind === "in" ? "b-approved" : ""}` }, t(last.kind === "in" ? "ci_state_in" : "ci_state_out")) : null),
    st.items.length ? h("div", { class: "ci-lines" }, st.items.map(line)) : h("p", { class: "sub" }, t("ci_none_today")),
    !st.sites ? h("p", { class: "sub" }, t("ci_no_sites")) : null,
    h("button", { class: `btn ${next === "in" ? "primary" : "gold"} ci-btn`, type: "button", onclick: (ev) => start(next, st, ev.currentTarget) },
      next === "in" ? "⏱ " : "🏁 ", t(next === "in" ? "ci_check_in" : "ci_check_out")));
}

async function start(kind, st, btn) {
  btn.disabled = true;
  try {
    if (!st.consent) { if (!(await notice())) return; await api.post("/api/attendance/checkin/consent", {}); st.consent = true; }
    toast(t("ci_locating"));
    const pos = await locate();
    const photo = await camera();
    if (!photo) return;
    await send(kind, pos, photo, "");
  } catch (e) { toast(e.message && !e.status ? e.message : errText(e), "bad"); }
  finally { btn.disabled = false; }
}

async function send(kind, pos, photo, reason) {
  const qs = new URLSearchParams({ kind, lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy || 0), device: deviceId(), name: `checkin-${kind}.jpg` });
  if (reason) qs.set("reason", reason);
  try {
    const r = await api.upload(`/api/attendance/checkin?${qs}`, photo);
    toast(t(kind === "in" ? "ci_done_in" : "ci_done_out", { time: r.checkin.at.slice(11, 16) }) + (r.checkin.site ? ` · ${siteName(r.checkin.site)}` : ` · ${t("ci_outside")}`));
    rerender();
  } catch (e) {
    // outside every work site: ask why, then send again with the same photo and location
    if (e.outside) {
      const why = await reasonDialog(e);
      if (why) return send(kind, pos, photo, why);
      return;
    }
    throw e;
  }
}

/** One-time notice (Oman's Personal Data Protection Law): what is recorded, why, who sees it, how long it's kept. */
function notice() {
  return new Promise((resolve) => {
    const dlg = h("dialog", { class: "dialog" }, h("form", { class: "form", onsubmit: (e) => { e.preventDefault(); resolve(true); dlg.close(); } },
      h("h2", null, t("ci_notice_title")),
      h("ul", { class: "ci-notice" }, ["ci_notice_1", "ci_notice_2", "ci_notice_3", "ci_notice_4"].map((k) => h("li", null, t(k)))),
      h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => { resolve(false); dlg.close(); } }, t("cancel")),
        h("button", { class: "btn primary", type: "submit" }, t("ci_notice_ok")))));
    dlg.addEventListener("close", () => { dlg.remove(); resolve(false); });
    document.body.append(dlg); dlg.showModal();
  });
}

/** The device's location (high accuracy); a clear message when it's refused or unavailable. */
function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error(t("ci_no_geo")));
    navigator.geolocation.getCurrentPosition(resolve, (e) => reject(new Error(t(e.code === 1 ? "ci_geo_denied" : "ci_geo_failed"))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}

/** A photo taken live with the camera (front camera on phones); never a file from the gallery. Resolves with a JPEG blob, or null. */
function camera() {
  return new Promise(async (resolve, reject) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return reject(new Error(t("ci_no_camera")));
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 } }, audio: false }); }
    catch (e) { return reject(new Error(t(e && e.name === "NotAllowedError" ? "ci_camera_denied" : "ci_no_camera"))); }
    const video = h("video", { autoplay: true, playsinline: true, muted: true, class: "ci-video" });
    video.srcObject = stream;
    let done = false;
    const stop = () => stream.getTracks().forEach((tr) => tr.stop());
    const take = () => {
      const w = Math.min(640, video.videoWidth || 640), hgt = Math.round(w * ((video.videoHeight || 480) / (video.videoWidth || 640)));
      const c = document.createElement("canvas"); c.width = w; c.height = hgt;
      c.getContext("2d").drawImage(video, 0, 0, w, hgt);
      c.toBlob((b) => { done = true; stop(); dlg.close(); resolve(b); }, "image/jpeg", 0.82);
    };
    const dlg = h("dialog", { class: "dialog" }, h("div", { class: "form" },
      h("h2", null, t("ci_photo_title")), h("p", { class: "sub" }, t("ci_photo_hint")), video,
      h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t("cancel")),
        h("button", { class: "btn primary", type: "button", onclick: take }, "📸 ", t("ci_take")))));
    dlg.addEventListener("close", () => { dlg.remove(); if (!done) { stop(); resolve(null); } });
    document.body.append(dlg); dlg.showModal();
  });
}

/** Outside every work site: why (shown to the manager). */
function reasonDialog(info) {
  return new Promise((resolve) => {
    const box = h("textarea", { rows: 3, maxlength: 300, required: true, dir: "auto" });
    const near = info.nearest ? t("ci_nearest", { name: siteName(info.nearest), km: (info.distance / 1000).toFixed(1) }) : "";
    const dlg = h("dialog", { class: "dialog" }, h("form", { class: "form", onsubmit: (e) => { e.preventDefault(); if (!box.value.trim()) return; const v = box.value.trim(); dlg.close(); resolve(v); } },
      h("h2", null, t("ci_outside_title")), h("p", { class: "sub" }, t("ci_outside_hint"), near ? ` ${near}` : ""), box,
      h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t("cancel")),
        h("button", { class: "btn primary", type: "submit" }, t("send")))));
    dlg.addEventListener("close", () => { dlg.remove(); resolve(null); });
    document.body.append(dlg); dlg.showModal(); box.focus();
  });
}
