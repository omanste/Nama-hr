// Online check-in / check-out: the card on the home page and the steps behind its button — the privacy notice (once),
// the location, a photo taken live with the camera, and (outside every work site) a reason. The server keeps the time.
import { api } from "./api.js";
import { t, nm, getLang } from "./i18n.js";
import { h, toast, errText, viewFile, confirm } from "./ui.js";
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
  setOutState(st);
  const last = st.items[st.items.length - 1];
  const line = (c) => h("div", { class: "ci-line" }, h("b", null, t(c.kind === "in" ? "ci_in_at" : "ci_out_at", { time: c.at.slice(11, 16) })), " · ",
    checkinPlace(c, { reason: false }));
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
    // flexible hours: before arriving, the on-time window; once arrived, today's own check-out time with a live countdown
    st.flex && !st.items.length ? h("p", { class: "sub" }, t("ci_flex_window", { a: st.flex.from, b: st.flex.to, n: st.flex.hours })) : null,
    st.expected_out && next === "out" ? h("div", { class: "ci-outtime" }, "🏁 ", h("b", null, t("ci_out_time_today", { t: st.expected_out })), " · ", h("span", { class: "ci-countdown" }, leftText())) : null,
    !st.sites ? h("p", { class: "sub" }, t("ci_no_sites")) : null,
    st.after_hours ? h("p", { class: "note" }, st.staying ? [t("ci_staying"), st.staying.reason ? ` — “${st.staying.reason}”` : ""] : t("ci_after_hours", { t: st.shift_end })) : null,
    mainBtn, stayBtn, breakBox(st, next),
    h("a", { class: "btn small ci-mine", href: "#/attendance" }, "📊 ", t("nav_attendance")));
  // opened from a reminder's buttons ("check out now" / "I'm still working")
  const want = new URLSearchParams(location.hash.split("?")[1] || "").get("ci");
  if (want && (want === "out" ? next === "out" : stayBtn)) {
    // used once: take it out of the address so a re-render doesn't open another window
    try { history.replaceState(null, "", location.href.replace(/([?&])ci=[^&]*&?/, "$1").replace(/[?&]$/, "")); } catch { /* old browser */ }
    setTimeout(() => (want === "out" ? start("out", st, mainBtn) : stay()), 300);
  }
  return card;
}
/** Personal break (approved by the manager first): ask for one; once approved start it; "Back to work" records how long. */
function breakBox(st, next) {
  const b = st.personal_break;
  const go = (step) => async (ev) => {
    ev.currentTarget.disabled = true;
    try { await api.post(`/api/attendance/break/${step}`, {}); toast(t(step === "start" ? "brk_started" : "brk_back")); rerender(); }
    catch (e) { toast(errText(e), "bad"); ev.currentTarget.disabled = false; }
  };
  if (!b) return next === "out" ? h("a", { class: "btn small ci-break", href: "#/permissions/new?type=break" }, "☕ ", t("brk_ask")) : null;
  if (b.status === "pending") return h("p", { class: "note ci-break" }, "☕ ", t("brk_waiting", { from: b.from, to: b.to }));
  if (b.ended) return h("p", { class: "sub ci-break" }, "☕ ", t("brk_done", { from: b.started, to: b.ended, m: b.minutes }));
  if (b.started) return h("div", { class: "ci-break" }, h("p", { class: "note" }, "☕ ", t("brk_on", { from: b.started })), h("button", { class: "btn primary ci-btn", type: "button", onclick: go("end") }, "↩ ", t("brk_back_btn")));
  return next === "out" ? h("button", { class: "btn ci-btn ci-break", type: "button", onclick: go("start") }, "☕ ", t("brk_start", { from: b.from, to: b.to })) : null;
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
  // what this person is asked for (Admin's switches, or their own), in this order: location (required), Face ID,
  // a photo only when Face ID fails (or is off) — two more tries — else the punch is saved Unverified
  const V = st.verify || { photo: true, faceid: true, location: true };
  try {
    if (!st.consent) { if (!(await notice())) return; await api.post("/api/attendance/checkin/consent", {}); st.consent = true; }
    let pos = null;
    if (V.location) {
      toast(t("ci_locating"));
      try { pos = await locate(); } catch (e) { toast(`${e.message} ${t("ci_loc_required")}`, "bad", 9000); return; }
    }
    // before Face ID / the photo: outside the work sites (why), leaving early (sure?), after hours (why)?
    let reason = "", extraReason = "";
    try {
      const q = { kind, ...(pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : {}) };
      const c = await api.get(`/api/attendance/checkin/check?${new URLSearchParams(q)}`);
      if (pos && !c.inside) { reason = await reasonDialog(c); if (!reason) return; }
      if (kind === "out" && c.early && !(await confirm(t("ci_early_q", { t: c.shift_end }), { okText: t("ci_early_go") }))) return;
      if (c.after_hours) { extraReason = await reasonDialog(null, { title: t("ci_extra_title"), hint: t("ci_extra_hint", { t: c.shift_end }) }); if (!extraReason) return; }
    } catch (e) { if (e.status && e.status !== 404) throw e; } // an older server: it asks after the photo instead
    const faceOk = V.faceid ? await faceId() : false;
    let photo = null, bad = false;
    if (!faceOk && V.photo) {
      if (V.faceid) toast(t("ci_faceid_photo_next"), "ok", 4500);
      const r = await photoStep();
      if (!r) return; // closed: nothing is saved
      photo = r.photo; bad = !!r.bad;
    }
    await send(kind, pos, photo, reason, extraReason, bad);
  } catch (e) { toast(e.status || e.error ? errText(e) : (e.message && !/load failed|failed to fetch|network/i.test(e.message) ? e.message : t("ci_conn_lost")), "bad"); }
  finally { btn.disabled = false; running = false; }
}
/** The photo, with two more tries ("face the camera in good light"); then { photo, bad: true } (saved Unverified), or
 * null when the window was closed (nothing saved). A try fails on a refused camera, no picture, an almost-black one,
 * or — where the browser can tell — no face in it. */
async function photoStep() {
  let last = null;
  for (let i = 0; i < 3; i++) {
    let b = null, why = "";
    try { b = await camera(); } catch (e) { why = e.message || t("ci_camera_denied"); }
    if (b && !b.dark && !b.noFace) return { photo: b };
    if (b) last = b;
    if (!why) why = t(!b ? "ci_no_photo_taken" : b.dark ? "ci_photo_dark" : "ci_photo_noface");
    if (i === 2) { toast(`${why} — ${t("ci_saved_unverified_soon")}`, "bad", 6000); break; }
    const again = await choiceDialog("📷 " + t("ci_photo_retry_title"), `${why} ${t("ci_photo_hint_light")} ${t("ci_tries_left", { n: 2 - i })}`,
      [[false, t("ci_unverified_go")], [true, t("ci_retry"), "primary"]]);
    if (again === null) return null;
    if (!again) break;
  }
  return { photo: last, bad: true };
}

async function send(kind, pos, photo, reason, extraReason = "", bad = false) {
  const qs = new URLSearchParams({ kind, ...(pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy || 0) } : {}), device: deviceId(), name: `checkin-${kind}.jpg` });
  if (bad) qs.set("photo_bad", "1"); // not a usable photo: the server saves the punch Unverified
  if (reason) qs.set("reason", reason);
  if (extraReason) qs.set("extra_reason", extraReason);
  // a dropped connection while sending: two more tries with the same photo
  const upload = async () => { for (let i = 0; ; i++) { try { return await api.upload(`/api/attendance/checkin?${qs}`, photo || new Blob([], { type: "image/jpeg" })); } catch (e) { if (i >= 2 || (e && (e.status || e.error))) throw e; await new Promise((r) => setTimeout(r, 1500)); } } };
  try {
    const r = await upload();
    const done = r.checkin.site ? `${t(kind === "in" ? "ci_done_in" : "ci_done_out", { time: r.checkin.at.slice(11, 16) })} · ${siteName(r.checkin.site)}` : t("ci_outside_needs_ok");
    // flexible hours: say when the day ends for them (in 08:45 → "Your check-out time today: 16:45")
    const fl = (r.checkin.flags || []).map((f) => f.code);
    if (fl.length) setTimeout(() => toast(`⚠️ ${t(fl.includes("unverified") ? "ci_saved_unverified" : "ci_flagged_sent")}`, "ok", 6000), 3000);
    toast(kind === "in" && r.expected_out ? `${done} · ${t("ci_out_time_today", { t: r.expected_out })}` : done, "ok", kind === "in" && r.expected_out ? 9000 : undefined);
    if (r.extra) setTimeout(() => toast(t("ci_extra_sent")), 2500);
    rerender();
  } catch (e) {
    // outside every work site: ask why, then send again with the same photo and location
    if (e.outside) {
      const why = await reasonDialog(e);
      if (why) return send(kind, pos, photo, why, extraReason, bad);
      return;
    }
    // leaving well after the shift: why (the extra time goes to the manager, then HR)
    if (e.after_hours) {
      const why = await reasonDialog(null, { title: t("ci_extra_title"), hint: t("ci_extra_hint", { t: e.shift_end }) });
      if (why) return send(kind, pos, photo, reason, why, bad);
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

// ---------- Face ID / fingerprint (WebAuthn): the phone checks its owner; the portal keeps only a public key ----------
const fromB64u = (s) => { const b = atob(String(s).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)).buffer; };
const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const credJSON = (c) => {
  const r = c.response, out = { id: c.id, rawId: toB64u(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults ? c.getClientExtensionResults() : {}, authenticatorAttachment: c.authenticatorAttachment || undefined, response: { clientDataJSON: toB64u(r.clientDataJSON) } };
  if (r.attestationObject) { out.response.attestationObject = toB64u(r.attestationObject); out.response.transports = r.getTransports ? r.getTransports() : []; }
  if (r.authenticatorData) { out.response.authenticatorData = toB64u(r.authenticatorData); out.response.signature = toB64u(r.signature); out.response.userHandle = r.userHandle ? toB64u(r.userHandle) : undefined; }
  return out;
};
/** Can this browser do passkeys at all? (The "is Face ID available" pre-check is not used to block: some iPhones answer "no"
 * although Face ID works, so the phone's own prompt is tried and its answer is what counts.) */
export const faceIdSupported = async () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
/** A message for an error from the phone's prompt, with its code so a report can be traced. */
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const faceIdError = (e, { registering = false } = {}) => {
  const code = (e && e.name) || "";
  // an iPhone refuses to save the key when no password app is on (Settings › General › AutoFill & Passwords)
  if (registering && isIOS() && code === "NotAllowedError") return `${t("ci_faceid_ios_setup")} (${code})`;
  if (code === "NotSupportedError" || code === "SecurityError") return `${t("ci_faceid_unsupported")} (${code})`;
  return `${e && (e.status || e.error) ? errText(e) : t("ci_faceid_failed")}${code && !(e && e.error) ? ` (${code})` : ""}`;
};

/** iPhone (Safari) shows Face ID only when it starts straight from a tap: the options are fetched first, then a button whose
 * tap opens the phone's prompt. Resolves with the prompt's answer; rejects with NotAllowedError when the window is closed. */
function tapThen(title, text, label, start) {
  return new Promise((resolve, reject) => {
    let started = false;
    const go = h("button", { class: "btn primary", type: "button", onclick: () => {
      started = true; dlg.close();
      try { Promise.resolve(start()).then(resolve, reject); } catch (e) { reject(e); } // called inside the tap
    } }, label);
    const dlg = h("dialog", { class: "dialog" }, h("div", { class: "form" }, h("h2", null, "🔐 ", title), h("p", { class: "sub" }, text),
      h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t("cancel")), go)));
    dlg.addEventListener("close", () => { dlg.remove(); if (!started) reject(Object.assign(new Error(t("ci_faceid_cancelled")), { name: "AbortError" })); });
    document.body.append(dlg); dlg.showModal(); go.focus();
  });
}
/** Register this phone: the phone asks for Face ID / fingerprint once and keeps a key for this portal. */
export async function registerPhone({ intro = false } = {}) {
  const o = await api.post("/api/webauthn/register/options", {});
  const pk = { ...o, challenge: fromB64u(o.challenge), user: { ...o.user, id: fromB64u(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: fromB64u(c.id) })) };
  const c = await tapThen(t("ci_faceid_title"), t(intro ? "ci_faceid_intro" : "ci_faceid_register_hint"), t("ci_faceid_register"), () => navigator.credentials.create({ publicKey: pk }));
  if (!c) throw new Error(t("ci_faceid_cancelled"));
  return api.post("/api/webauthn/register/verify", credJSON(c));
}
async function verifyPhone() {
  const o = await api.post("/api/webauthn/verify/options", {});
  const pk = { ...o, challenge: fromB64u(o.challenge), allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: fromB64u(c.id) })) };
  const c = await tapThen(t("ci_faceid_title"), t("ci_faceid_verify_hint"), t("ci_faceid_verify"), () => navigator.credentials.get({ publicKey: pk }));
  if (!c) throw new Error(t("ci_faceid_cancelled"));
  return api.post("/api/webauthn/verify", credJSON(c));
}
/** Before the photo: true to go on, false to stop (a message is shown). Optional mode tries it only on a registered phone. */
async function faceId() {
  let st;
  try { st = await api.get("/api/webauthn/status"); } catch { return true; } // an older server: no Face ID step
  if (!st.needed) return true; // off for this person (Admin's switch or their own setting)
  const must = true;
  if (!(await faceIdSupported())) { if (must) { toast(t("ci_faceid_unsupported"), "bad"); return false; } return true; }
  try {
    if (!st.devices) {
      try { await registerPhone({ intro: true }); } catch (e) { if (e && e.name === "AbortError") return false; toast(faceIdError(e, { registering: true }), "bad"); return false; }
      toast(t("ci_faceid_registered"));
      return true;
    }
    await verifyPhone();
    return true;
  } catch (e) {
    if (e && e.name === "AbortError") return false; // closed our window: nothing to say
    if (!must) return true;
    // a new phone (the key is on the old one), or the person cancelled: register this phone, or try again later
    if (e && (e.name === "NotAllowedError" || e.name === "InvalidStateError" || e.error === "unknown_device")) {
      const choice = await faceIdRetry();
      if (choice === "register") { try { await registerPhone(); toast(t("ci_faceid_registered")); return true; } catch (e2) { toast(faceIdError(e2, { registering: true }), "bad"); return false; } }
      if (choice === "retry") return faceId();
      return false;
    }
    toast(faceIdError(e), "bad");
    return false;
  }
}
const choiceDialog = (title, text, buttons) => new Promise((resolve) => {
  const dlg = h("dialog", { class: "dialog" }, h("div", { class: "form" }, h("h2", null, title), h("p", { class: "sub" }, text),
    h("div", { class: "row end" }, buttons.map(([v, label, cls]) => h("button", { class: `btn ${cls || ""}`, type: "button", onclick: () => { resolve(v); dlg.close(); } }, label)))));
  dlg.addEventListener("close", () => { dlg.remove(); resolve(null); });
  document.body.append(dlg); dlg.showModal();
});
const faceIdRetry = () => choiceDialog("🔐 " + t("ci_faceid_title"), t("ci_faceid_retry_text"), [[null, t("cancel")], ["register", t("ci_faceid_register_this")], ["retry", t("ci_faceid_retry"), "primary"]]);

/** Is the picture almost black (a camera that showed nothing)? Average brightness of a small copy. */
function isDark(canvas) {
  try {
    const c = document.createElement("canvas"); c.width = 32; c.height = 24;
    const g = c.getContext("2d"); g.drawImage(canvas, 0, 0, 32, 24);
    const d = g.getImageData(0, 0, 32, 24).data; let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return sum / (d.length / 4) < 18;
  } catch { return false; }
}
/** No face in the picture? Only where the browser can tell (FaceDetector); elsewhere false (never blocks). */
async function noFace(canvas) {
  if (!("FaceDetector" in window)) return false;
  try { return (await new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 }).detect(canvas)).length === 0; } catch { return false; }
}
/** Shrink a photo to 640 px wide as a JPEG (like the live camera's), from an image file. */
function shrinkImage(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const w = Math.min(640, img.naturalWidth || 640), hgt = Math.round(w * ((img.naturalHeight || 480) / (img.naturalWidth || 640)));
      const c = document.createElement("canvas"); c.width = w; c.height = hgt;
      c.getContext("2d").drawImage(img, 0, 0, w, hgt); URL.revokeObjectURL(url);
      const dark = isDark(c);
      noFace(c).then((nf) => c.toBlob((b) => { const out = b || file; if (dark) out.dark = true; if (nf) out.noFace = true; resolve(out); }, "image/jpeg", 0.82));
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
      const dark = isDark(c);
      noFace(c).then((nf) => c.toBlob((b) => { if (b && dark) b.dark = true; if (b && nf) b.noFace = true; stop(); finish(b); close(); }, "image/jpeg", 0.82));
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
  const ch = c.checks, flags = c.flags || [];
  const used = ch ? h("span", { class: "ci-checks", title: t("ci_checks_used") }, ch.photo ? h("span", { title: t("ci_chk_photo") }, "📷") : null, ch.faceid || c.verified ? h("span", { title: t("ci_chk_faceid") }, "🔐") : null, ch.location ? h("span", { title: t("ci_chk_location") }, "📍") : null) : null;
  const unv = flags.some((f) => f.code === "unverified");
  const flagged = flags.length ? h("span", { class: "ci-flag", title: c.flag_note || "" }, "⚠️ ", unv ? h("span", { class: "badge b-rejected ci-unv" }, t("ci_unverified")) : null,
    flags.filter((f) => f.code !== "unverified").map(flagLabel).join(getLang() === "ar" ? "، " : ", "),
    h("span", { class: `badge ${c.flag_status === "accepted" ? "b-approved" : c.flag_status === "rejected" ? "b-rejected" : "b-pending"}` }, t("ci_flag_" + (c.flag_status || "open"))),
    c.flag_note ? h("span", { class: "muted" }, ` “${c.flag_note}”`) : null) : null;
  return h("span", { class: "ci-place" }, used, flagged,
    ch && !ch.location && !c.outside ? null : c.outside ? h("span", { class: "bad-text", title: c.reason || "" }, t("ci_outside"), reason && c.reason ? ` — ${c.reason}` : "")
      : h("span", null, "📍 ", getLang() === "en" ? site.name_en || site.name_ar || "" : site.name_ar || site.name_en || ""),
    c.approval && !flags.length ? h("span", { class: `badge ${c.approval === "approved" ? "b-approved" : c.approval === "rejected" ? "b-rejected" : "b-pending"}`, title: c.decision_note || "" }, t("ci_appr_" + c.approval)) : null,
    c.photo_file_id ? h("button", { class: "linkish ci-ico", type: "button", title: t("ci_photo"), "aria-label": t("ci_photo"), onclick: () => viewFile({ id: c.photo_file_id, name: `${t("ci_photo")} · ${c.time || ""}`, mime: "image/jpeg" }) }, "📷") : null,
    c.lat !== null && c.lat !== undefined ? h("a", { class: "ci-ico", href: `https://maps.google.com/?q=${c.lat},${c.lng}`, target: "_blank", rel: "noopener", title: t("ci_map") + (c.accuracy ? ` (±${c.accuracy} m)` : ""), "aria-label": t("ci_map") }, "🗺") : null);
}

/** A flag's reason in words: "outside work site (1.2 km away)". */
export function flagLabel(f) {
  if (f.code === "away") return t("ci_fl_away", { min: f.min, from: f.from });
  return f.code === "outside" && f.km !== null && f.km !== undefined ? t("ci_fl_outside_km", { km: f.km }) : t("ci_fl_" + f.code);
}

/* ---- today's own check-out time (flexible hours): the home card and the header chip count down to it, all day ---- */
let outState = null; // { out: minutes, offset: server minus this device, in minutes }
const hmMin = (x) => { const [a, b] = String(x).split(":").map(Number); return a * 60 + b; };
const devMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
function setOutState(st) {
  outState = st && st.enabled && st.expected_out && st.next === "out" ? { out: hmMin(st.expected_out), label: st.expected_out, offset: st.now ? hmMin(st.now) - Math.floor(devMin()) : 0 } : null;
  tick();
}
/** "2:15 left" until the check-out time, or "time to check out". */
function leftText() {
  if (!outState) return "";
  const left = Math.ceil(outState.out - (devMin() + outState.offset));
  return left > 0 ? t("ci_left", { d: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` }) : t("ci_out_due");
}
function tick() {
  for (const el of document.querySelectorAll(".ci-countdown")) el.textContent = leftText();
  for (const el of document.querySelectorAll(".out-chip")) {
    el.hidden = !outState;
    if (outState) { el.querySelector(".oc-t").textContent = outState.label; el.querySelector(".oc-l").textContent = leftText(); el.title = t("ci_out_time_today", { t: outState.label }); }
  }
}
setInterval(tick, 20000);
let outFetched = 0;
/** The header chip "🏁 16:45 · 2:15 left" (hidden unless checked in today with a check-out time). */
export function outChip() {
  const el = h("a", { class: "hbtn out-chip", href: "#/", hidden: !outState, "aria-live": "off" }, "🏁 ", h("b", { class: "oc-t" }, outState ? outState.label : ""), h("span", { class: "oc-l" }, leftText()));
  if (Date.now() - outFetched > 5 * 60e3) { // refreshed every few minutes as pages change
    outFetched = Date.now();
    api.get("/api/attendance/checkin/today").then(setOutState).catch(() => {});
  } else setTimeout(tick, 0);
  return el;
}
