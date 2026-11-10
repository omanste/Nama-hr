// Online check-in / check-out: the card on the home page and the steps behind its button — the privacy notice (once),
// the location, a photo taken live with the camera, and (outside every work site) a reason. The server keeps the time.
import { api } from "./api.js";
import { t, nm, getLang } from "./i18n.js";
import { h, toast, errText, viewFile } from "./ui.js";
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
    c.outside ? h("span", { class: "bad-text" }, t("ci_outside")) : h("span", null, "📍 ", siteName(c.site)),
    c.approval ? h("span", { class: `badge ${c.approval === "approved" ? "b-approved" : c.approval === "rejected" ? "b-rejected" : "b-pending"}`, title: c.decision_note || "", style: { marginInlineStart: "6px" } }, t("ci_appr_" + c.approval)) : null);
  const next = st.next;
  const mainBtn = h("button", { class: `btn ${next === "in" ? "primary" : "gold"} ci-btn`, type: "button", onclick: (ev) => start(next, st, ev.currentTarget) },
    next === "in" ? "⏱ " : "🏁 ", t(next === "in" ? "ci_check_in" : "ci_check_out"));
  // 30 minutes after the shift and still checked in: check out now, or say why you're staying (the manager reviews it)
  const stayBtn = st.after_hours && !st.staying ? h("button", { class: "btn ci-btn", type: "button", onclick: () => stay() }, "🕘 ", t("ci_still_working")) : null;
  const card = h("section", { class: `card checkin-card ${next === "out" ? "is-in" : ""}` },
    h("div", { class: "card-head" }, h("h2", null, t("ci_title")), last ? h("span", { class: `badge ${last.kind === "in" ? "b-approved" : ""}` }, t(last.kind === "in" ? "ci_state_in" : "ci_state_out")) : null),
    // yesterday (or the last working day) without a check-out: no hours count until a correction is approved
    st.missed ? h("div", { class: "note warn ci-missed" }, t("ci_missed", { d: dmyShort(st.missed.date) }), " ",
      h("a", { class: "btn small", href: `#/attendance/correction?date=${st.missed.date}` }, t("att_ask_correction"))) : null,
    st.items.length ? h("div", { class: "ci-lines" }, st.items.map(line)) : h("p", { class: "sub" }, t("ci_none_today")),
    !st.sites ? h("p", { class: "sub" }, t("ci_no_sites")) : null,
    st.after_hours ? h("p", { class: "note" }, st.staying ? [t("ci_staying"), st.staying.reason ? ` — “${st.staying.reason}”` : ""] : t("ci_after_hours", { t: st.shift_end })) : null,
    mainBtn, stayBtn);
  // opened from a reminder's buttons ("check out now" / "I'm still working")
  const want = new URLSearchParams(location.hash.split("?")[1] || "").get("ci");
  if (want && (want === "out" ? next === "out" : stayBtn)) {
    // used once: take it out of the address so a re-render doesn't open another window
    try { history.replaceState(null, "", location.href.replace(/([?&])ci=[^&]*&?/, "$1").replace(/[?&]$/, "")); } catch { /* old browser */ }
    setTimeout(() => (want === "out" ? start("out", st, mainBtn) : stay()), 300);
  }
  return card;
}
const dmyShort = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** "I'm still working": a reason (required); the extra time goes to the manager once you check out. */
async function stay() {
  const why = await reasonDialog(null, { title: t("ci_stay_title"), hint: t("ci_stay_hint") });
  if (!why) return;
  try { await api.post("/api/attendance/checkin/stay", { reason: why }); toast(t("ci_stay_saved")); rerender(); }
  catch (e) { toast(errText(e), "bad"); }
}

let running = false; // one check-in at a time, however often the card is redrawn or the button tapped
async function start(kind, st, btn) {
  if (running) return;
  running = true;
  btn.disabled = true;
  try {
    if (!st.consent) { if (!(await notice())) return; await api.post("/api/attendance/checkin/consent", {}); st.consent = true; }
    toast(t("ci_locating"));
    const pos = await locate();
    // before the photo: does this place need a reason (outside the work sites), or leaving after hours?
    let reason = "", extraReason = "";
    try {
      const c = await api.get(`/api/attendance/checkin/check?${new URLSearchParams({ kind, lat: pos.coords.latitude, lng: pos.coords.longitude })}`);
      if (!c.inside) { reason = await reasonDialog(c); if (!reason) return; }
      if (c.after_hours) { extraReason = await reasonDialog(null, { title: t("ci_extra_title"), hint: t("ci_extra_hint", { t: c.shift_end }) }); if (!extraReason) return; }
    } catch (e) { if (e.status && e.status !== 404) throw e; } // an older server: it asks after the photo instead
    const photo = await camera();
    if (!photo) return;
    await send(kind, pos, photo, reason, extraReason);
  } catch (e) { toast(e.status || e.error ? errText(e) : (e.message && !/load failed|failed to fetch|network/i.test(e.message) ? e.message : t("ci_conn_lost")), "bad"); }
  finally { btn.disabled = false; running = false; }
}

async function send(kind, pos, photo, reason, extraReason = "") {
  const qs = new URLSearchParams({ kind, lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy || 0), device: deviceId(), name: `checkin-${kind}.jpg` });
  if (reason) qs.set("reason", reason);
  if (extraReason) qs.set("extra_reason", extraReason);
  try {
    const r = await api.upload(`/api/attendance/checkin?${qs}`, photo);
    toast(r.checkin.site ? `${t(kind === "in" ? "ci_done_in" : "ci_done_out", { time: r.checkin.at.slice(11, 16) })} · ${siteName(r.checkin.site)}` : t("ci_outside_needs_ok"));
    if (r.extra) setTimeout(() => toast(t("ci_extra_sent")), 2500);
    rerender();
  } catch (e) {
    // outside every work site: ask why, then send again with the same photo and location
    if (e.outside) {
      const why = await reasonDialog(e);
      if (why) return send(kind, pos, photo, why, extraReason);
      return;
    }
    // leaving well after the shift: why (the extra time goes to the manager, then HR)
    if (e.after_hours) {
      const why = await reasonDialog(null, { title: t("ci_extra_title"), hint: t("ci_extra_hint", { t: e.shift_end }) });
      if (why) return send(kind, pos, photo, reason, why);
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

/** Shrink a photo to 640 px wide as a JPEG (like the live camera's), from an image file. */
function shrinkImage(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const w = Math.min(640, img.naturalWidth || 640), hgt = Math.round(w * ((img.naturalHeight || 480) / (img.naturalWidth || 640)));
      const c = document.createElement("canvas"); c.width = w; c.height = hgt;
      c.getContext("2d").drawImage(img, 0, 0, w, hgt); URL.revokeObjectURL(url);
      c.toBlob((b) => resolve(b || file), "image/jpeg", 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

/** A photo taken live with the camera (front camera on phones); never a file from the gallery. Resolves with a JPEG blob, or null.
 * If the live picture stays black (some phones inside a pop-up), the phone's own camera app opens instead (capture="user"). */
function camera() {
  return new Promise(async (resolve, reject) => {
    let finished = false;
    const finish = (v) => { if (finished) return; finished = true; resolve(v); };
    // the phone's own camera app: a fallback that works where the live view doesn't
    const native = h("input", { type: "file", accept: "image/*", capture: "user", hidden: true, onchange: async (ev) => {
      const f = ev.target.files[0]; ev.target.value = "";
      if (!f) return;
      const b = await shrinkImage(f); stop(); close(); finish(b);
    } });
    const nativeBtn = h("label", { class: "btn" }, "📷 ", t("ci_phone_camera"), native);
    const hint = h("p", { class: "sub" }, t("ci_photo_hint"));
    const video = h("video", { class: "ci-video" });
    video.muted = true; video.playsInline = true; video.autoplay = true; video.setAttribute("playsinline", ""); video.setAttribute("muted", "");
    const takeBtn = h("button", { class: "btn primary", type: "button", disabled: true, onclick: () => take() }, "📸 ", t("ci_take"));
    const status = h("p", { class: "sub ci-cam-status" }, t("ci_cam_starting"));
    let stream = null;
    const stop = () => { if (stream) stream.getTracks().forEach((tr) => tr.stop()); stream = null; };
    const dlg = h("dialog", { class: "dialog" }, h("div", { class: "form" },
      h("h2", null, t("ci_photo_title")), hint, video, status,
      h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => close() }, t("cancel")), takeBtn)));
    const close = () => { if (dlg.open) dlg.close(); };
    // one close (Cancel, Esc, the back gesture) ends it: the camera light goes off and nothing else opens
    dlg.addEventListener("close", () => { stop(); dlg.remove(); finish(null); });
    const showFallback = (msg) => {
      status.replaceChildren(h("span", { class: "bad-text" }, msg), " ");
      if (!status.contains(nativeBtn)) status.append(h("div", { class: "row", style: { marginTop: "8px" } }, nativeBtn));
    };
    document.body.append(dlg); dlg.showModal();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { video.hidden = true; showFallback(t("ci_no_live_camera")); return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 } }, audio: false }); }
    catch (e) {
      if (e && e.name === "NotAllowedError") { close(); return reject(new Error(t("ci_camera_denied"))); }
      video.hidden = true; showFallback(t("ci_no_live_camera")); return;
    }
    if (finished) { stop(); return; } // closed while the camera was starting
    video.srcObject = stream;
    const live = () => video.videoWidth > 0 && video.readyState >= 2;
    const ready = () => { if (!live()) return; takeBtn.disabled = false; status.replaceChildren(); };
    const play = () => { const p = video.play(); if (p && p.catch) p.catch(() => {}); };
    video.addEventListener("loadedmetadata", play); video.addEventListener("playing", ready); video.addEventListener("loadeddata", ready);
    video.addEventListener("click", play); // some iPhones need a touch to start the picture
    play();
    setTimeout(() => { if (!finished && !live()) { video.hidden = true; showFallback(t("ci_cam_black")); } }, 4000);
    const take = () => {
      if (!live()) return;
      const w = Math.min(640, video.videoWidth), hgt = Math.round(w * (video.videoHeight / video.videoWidth));
      const c = document.createElement("canvas"); c.width = w; c.height = hgt;
      c.getContext("2d").drawImage(video, 0, 0, w, hgt);
      c.toBlob((b) => { stop(); finish(b); close(); }, "image/jpeg", 0.82);
    };
  });
}

/** Outside every work site: why (shown to the manager). */
function reasonDialog(info, { title = t("ci_outside_title"), hint = t("ci_outside_hint") } = {}) {
  return new Promise((resolve) => {
    const box = h("textarea", { rows: 3, maxlength: 300, required: true, dir: "auto" });
    const near = info && info.nearest ? t("ci_nearest", { name: siteName(info.nearest), km: (info.distance / 1000).toFixed(1) }) : "";
    const dlg = h("dialog", { class: "dialog" }, h("form", { class: "form", onsubmit: (e) => { e.preventDefault(); if (!box.value.trim()) return; const v = box.value.trim(); dlg.close(); resolve(v); } },
      h("h2", null, title), h("p", { class: "sub" }, hint, near ? ` ${near}` : ""), box,
      h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t("cancel")),
        h("button", { class: "btn primary", type: "submit" }, t("send")))));
    dlg.addEventListener("close", () => { dlg.remove(); resolve(null); });
    document.body.append(dlg); dlg.showModal(); box.focus();
  });
}

/** One online check-in, compact: 📍 place (or "outside the work sites" with the reason and the manager's decision), then
 * 📷 the photo and 🗺 the map. Takes a day's check-in (site_ar/site_en) or a log entry (site: {name_ar, name_en}). */
export function checkinPlace(c, { reason = true } = {}) {
  if (!c) return null;
  const site = c.site || { name_ar: c.site_ar, name_en: c.site_en };
  return h("span", { class: "ci-place" },
    c.outside ? h("span", { class: "bad-text", title: c.reason || "" }, t("ci_outside"), reason && c.reason ? ` — ${c.reason}` : "")
      : h("span", null, "📍 ", getLang() === "en" ? site.name_en || site.name_ar || "" : site.name_ar || site.name_en || ""),
    c.approval ? h("span", { class: `badge ${c.approval === "approved" ? "b-approved" : c.approval === "rejected" ? "b-rejected" : "b-pending"}`, title: c.decision_note || "" }, t("ci_appr_" + c.approval)) : null,
    c.photo_file_id ? h("button", { class: "linkish ci-ico", type: "button", title: t("ci_photo"), "aria-label": t("ci_photo"), onclick: () => viewFile({ id: c.photo_file_id, name: `${t("ci_photo")} · ${c.time || ""}`, mime: "image/jpeg" }) }, "📷") : null,
    c.lat !== null && c.lat !== undefined ? h("a", { class: "ci-ico", href: `https://maps.google.com/?q=${c.lat},${c.lng}`, target: "_blank", rel: "noopener", title: t("ci_map") + (c.accuracy ? ` (±${c.accuracy} m)` : ""), "aria-label": t("ci_map") }, "🗺") : null);
}
