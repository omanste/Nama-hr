// Small DOM helpers shared by every page.
import { t, getLang, has } from "./i18n.js";

/** h("div", {class:"x", onclick: fn}, "text", child, [more]) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "value" && "value" in el) el.value = v;
    else if (k === "checked" || k === "disabled" || k === "selected" || k === "required" || k === "multiple") el[k] = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const clear = (el) => { el.replaceChildren(); return el; };

const LATIN = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
export const num = (n) => LATIN.format(n);
/** ISO date → DD/MM/YYYY */
export const dmy = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");
export const dateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return new Intl.DateTimeFormat(getLang() === "ar" ? "ar-OM-u-nu-latn" : "en-GB", { timeZone: "Asia/Muscat", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
};
export const daysOf = (min) => Math.round((min / 480) * 100) / 100;
export const daysText = (min) => t("days", { n: num(daysOf(min)) });
/** Early leave reads better in hours. */
/** Permissions: short absences inside a working day, counted in hours. */
export const PERMISSIONS = ["early", "late", "break"];
export const isPermission = (type) => PERMISSIONS.includes(type);
/** Attendance requests: a fingerprint correction and an external work task (one day, with times). */
export const ATTENDANCE_REQS = ["correction", "mission"];
export const isAttendanceReq = (type) => ATTENDANCE_REQS.includes(type);
export const amountText = (r) => (r.type === "correction" ? "—" : isPermission(r.type) || r.type === "mission" ? t("hours", { n: num(r.minutes / 60) }) : daysText(r.minutes));
const permWhen = (r) => r.type === "late" ? t("arrive_at", { t: r.early_time }) : r.type === "break" || r.type === "mission" ? `${r.early_time}–${r.end_time}`
  : r.type === "correction" ? [r.early_time ? t("corr_in_at", { t: r.early_time }) : null, r.end_time ? t("corr_out_at", { t: r.end_time }) : null].filter(Boolean).join(" · ")
  : t("leave_at", { t: r.early_time });
export const when = (r) => (isPermission(r.type) || isAttendanceReq(r.type) ? `${dmy(r.start_date)} · ${permWhen(r)}` : r.start_date === r.end_date ? dmy(r.start_date) : `${dmy(r.start_date)} – ${dmy(r.end_date)}`);
/** Minutes after midnight → "HH:MM"; a duration in minutes → "1:05". */
export const clockText = (m) => (m === null || m === undefined ? "—" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
export const durText = (m) => (m ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` : "—");

export const badge = (status, prefix = "rs_") => h("span", { class: `badge b-${status}` }, t(prefix + status));

let toastTimer;
export function toast(msg, kind = "ok") {
  let el = document.getElementById("toast");
  if (!el) { el = h("div", { id: "toast", role: "status", "aria-live": "polite" }); document.body.append(el); }
  el.className = `toast show ${kind}`;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}
/** Localised text for an API error: by error code when we have one, else the server's message. */
export const errText = (e) => {
  if (!e) return t("error");
  if (e.status === 0) return t("offline");
  if (e.error && has("err_" + e.error)) {
    const extra = /\(([^)]*\d[^)]*)\)/.exec(e.message || "");
    return t("err_" + e.error) + (extra && e.error !== "invalid" ? ` (${extra[1]})` : "");
  }
  return e.message || t("error");
};

/** Small confirmation dialog. With {input:"label"} it returns the typed text, else true; null when cancelled. */
export function confirm(message, { input = null, required = false, okText = t("confirm"), danger = false } = {}) {
  return new Promise((resolve) => {
    const field = input ? h("textarea", { rows: 3, "aria-label": input, placeholder: input }) : null;
    const err = h("div", { class: "field-err" });
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    const ok = h("button", { class: `btn ${danger ? "danger" : "primary"}`, type: "submit" }, okText);
    const dlg = h("dialog", { class: "dialog" },
      h("form", { method: "dialog", onsubmit: (e) => {
        e.preventDefault();
        if (field && required && !field.value.trim()) { err.textContent = t("required"); field.focus(); return; }
        done(field ? field.value.trim() : true);
      } },
        h("p", { class: "dialog-msg" }, message), field, err,
        h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => done(null) }, t("cancel")), ok)));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); done(null); });
    document.body.append(dlg);
    dlg.showModal();
    (field || ok).focus();
  });
}

/** A labelled form field. control is an input/select/textarea element. */
export function field(label, control, { hint, full, req } = {}) {
  const id = control.id || (control.id = "f" + Math.random().toString(36).slice(2, 8));
  return h("div", { class: `field${full ? " full" : ""}`, "data-field": control.name || "" },
    h("label", { for: id }, label, req ? h("span", { class: "req", "aria-hidden": "true" }, " *") : null),
    control, hint ? h("div", { class: "hint" }, hint) : null, h("div", { class: "field-err" }));
}
export function showFieldError(form, name, message) {
  form.querySelectorAll(".field-err").forEach((e) => (e.textContent = ""));
  const f = form.querySelector(`[data-field="${name}"] .field-err`);
  if (f) { f.textContent = message; f.parentElement.querySelector("input,select,textarea")?.focus(); return true; }
  return false;
}

export function select(name, options, value, attrs = {}) {
  return h("select", { name, ...attrs }, options.map(([v, label]) => h("option", { value: v, selected: String(v) === String(value ?? "") }, label)));
}

export const pageHead = (title, ...actions) => h("div", { class: "page-head" }, h("h1", null, title), h("div", { class: "row" }, actions));
export const backLink = (href) => h("a", { class: "back", href }, h("span", { "aria-hidden": "true" }, getLang() === "ar" ? "→ " : "← "), t("back"));
export const empty = (text = t("no_results")) => h("div", { class: "empty" }, text);
export const avatar = (emp, size = 40) => emp && emp.photo_file_id
  ? h("img", { class: "avatar", src: `/api/files/${emp.photo_file_id}`, alt: "", width: size, height: size, style: { width: size + "px", height: size + "px" } })
  : h("span", { class: "avatar ph", style: { width: size + "px", height: size + "px", fontSize: Math.round(size / 2.4) + "px" }, "aria-hidden": "true" }, ((emp && (getLang() === "en" ? emp.name_en || emp.name_ar : emp.name_ar || emp.name_en)) || "؟").trim().charAt(0).toUpperCase());
/** Today's date in Muscat as YYYY-MM-DD. */
export const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** A list shown 50 at a time, with page numbers underneath when there are more. */
export function pager(items, renderItem, perPage = 50) {
  const box = h("div");
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  function show(n) {
    const list = items.slice((n - 1) * perPage, n * perPage);
    const nums = [];
    for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - n) <= 2) nums.push(i); else if (nums[nums.length - 1] !== "…") nums.push("…");
    box.replaceChildren(
      list.length ? h("div", { class: "list" }, list.map(renderItem)) : empty(),
      pages > 1 ? h("nav", { class: "pager", "aria-label": t("pages") },
        h("button", { class: "btn small", type: "button", disabled: n === 1, onclick: () => show(n - 1) }, getLang() === "ar" ? "→" : "←"),
        nums.map((i) => i === "…" ? h("span", { class: "muted" }, "…") : h("button", { class: "btn small", type: "button", "aria-current": i === n ? "page" : null, onclick: () => show(i) }, String(i))),
        h("button", { class: "btn small", type: "button", disabled: n === pages, onclick: () => show(n + 1) }, getLang() === "ar" ? "←" : "→"),
        h("span", { class: "sub" }, t("showing_of", { a: (n - 1) * perPage + 1, b: Math.min(n * perPage, items.length), n: items.length }))) : null);
  }
  show(1);
  return box;
}

/** Show a document in a pop-up: a picture as it is; a PDF as page pictures (Previous / Next), or the browser's own viewer
 * when the server can't draw pages. f = {id, name, mime}. */
export async function viewFile(f) {
  const body = h("div", { class: "viewer-body" });
  const pager = h("div", { class: "row viewer-pager" });
  const dlg = h("dialog", { class: "dialog viewer" },
    h("div", { class: "viewer-head" }, h("b", { class: "viewer-name", dir: "auto" }, f.name || t("document")),
      h("button", { class: "btn small", type: "button", "aria-label": t("close"), onclick: () => dlg.close() }, "✕")),
    body, pager,
    h("div", { class: "row end" },
      h("a", { class: "btn", href: `/api/files/${f.id}`, target: "_blank", rel: "noopener" }, t("open_new_tab")),
      h("a", { class: "btn", href: `/api/files/${f.id}?download=1` }, t("download")),
      h("button", { class: "btn primary", type: "button", onclick: () => dlg.close() }, t("close"))));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
  if (/^image\//.test(f.mime || "")) { body.append(h("img", { src: `/api/files/${f.id}`, alt: f.name || "" })); return; }
  if (f.mime !== "application/pdf") { body.append(h("p", { class: "sub" }, t("view_not_possible"))); return; }
  body.append(h("p", { class: "sub" }, t("loading")));
  let pages = 0;
  try { pages = (await (await fetch(`/api/files/${f.id}/pages`, { credentials: "same-origin" })).json()).pages || 0; } catch {}
  if (!pages) { body.replaceChildren(h("iframe", { src: `/api/files/${f.id}`, title: f.name || "PDF" })); return; }
  let n = 1;
  const show = () => {
    body.replaceChildren(h("img", { src: `/api/files/${f.id}/page/${n}`, alt: `${f.name || ""} · ${n}` }));
    pager.replaceChildren(...(pages > 1 ? [
      h("button", { class: "btn small", type: "button", disabled: n === 1, onclick: () => { n--; show(); } }, getLang() === "ar" ? "→" : "←", " ", t("previous")),
      h("span", { class: "sub" }, t("page_of", { n, total: pages })),
      h("button", { class: "btn small", type: "button", disabled: n === pages, onclick: () => { n++; show(); } }, t("next"), " ", getLang() === "ar" ? "←" : "→")] : []));
  };
  show();
}
