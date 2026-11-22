// One phone field for every phone number in the portal: the country (flag, code, a searchable list of every country in
// English and Arabic — Oman first, then the GCC and the countries most staff come from) and the number (digits only,
// left to right). Any <input type="tel"> becomes one by itself. The form gets the full number (+96899123456): a hidden
// input under the field's name for forms read with FormData, and the visible box's .value for code that reads it.
import { dialList, flag, parsePhone, splitPhone, lengthOf } from "./dialcodes.js";
import { t, getLang } from "./i18n.js";

let LIST = null;
const list = () => (LIST ||= dialList());
const norm = (v) => String(v || "").toLowerCase().replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").trim();
const D = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

export function enhancePhone(inp) {
  if (inp.dataset.phone || inp.type !== "tel") return;
  inp.dataset.phone = "1";
  const name = inp.getAttribute("name");
  const wrap = document.createElement("span"); wrap.className = "phone-w"; wrap.dir = "ltr";
  const btn = document.createElement("button"); btn.type = "button"; btn.className = "phone-cc";
  btn.setAttribute("aria-label", t("phone_country"));
  const hidden = document.createElement("input"); hidden.type = "hidden"; if (name) hidden.name = name;
  const msg = document.createElement("div"); msg.className = "phone-err"; msg.setAttribute("aria-live", "polite");
  inp.parentNode.insertBefore(wrap, inp); wrap.append(btn, inp, hidden); wrap.after(msg);
  // the box keeps its name (code that looks for it still finds it); the hidden full number comes after it, so FormData's
  // last value — the one Object.fromEntries keeps — is the full number
  inp.dir = "ltr"; inp.inputMode = "numeric"; inp.autocomplete = "tel-national";
  let code = "968";
  const show = () => { const e = list().find((x) => x.code === code); btn.textContent = `${e ? flag(e.iso) : "🌐"} +${code}`; btn.title = e ? `${e.en} · ${e.ar}` : ""; };
  const full = () => { const d = D.get.call(inp).replace(/\D/g, ""); if (!d) return ""; const p = parsePhone(d, code); return p.e164 || `+${code}${d}`; };
  const check = () => {
    const d = D.get.call(inp).replace(/\D/g, "");
    const p = d ? parsePhone(d, code) : { empty: true };
    const [min, max] = lengthOf(code);
    const m = p.error ? (code === "968" ? t("phone_om_8") : t("phone_len", { n: min === max ? min : `${min}–${max}`, c: code })) : "";
    inp.setCustomValidity(m); msg.textContent = m; wrap.classList.toggle("bad", !!m);
    hidden.value = d ? full() : "";
  };
  // a full number put in (by code, or pasted): the country follows it
  const put = (v) => {
    const s = String(v ?? "").trim();
    const sp = splitPhone(s.replace(/[^\d+]/g, "").replace(/^00/, "+"));
    if (sp) { code = sp.code; D.set.call(inp, sp.number); }
    else { const p = parsePhone(s, code); if (p.e164) { code = p.code; D.set.call(inp, p.number); } else D.set.call(inp, s.replace(/[^\d]/g, "")); }
    show(); check();
  };
  Object.defineProperty(inp, "value", { configurable: true, get: () => (D.get.call(inp).trim() ? full() : ""), set: put });
  inp.addEventListener("paste", (e) => { const txt = (e.clipboardData || window.clipboardData).getData("text"); if (/^\s*(\+|00)/.test(txt) || txt.replace(/\D/g, "").length > lengthOf(code)[1]) { e.preventDefault(); put(txt); } });
  inp.addEventListener("input", () => { const raw = D.get.call(inp), d = raw.replace(/[^\d]/g, ""); if (raw !== d) D.set.call(inp, d); check(); });
  btn.addEventListener("click", (e) => { e.preventDefault(); if (!inp.disabled && !inp.readOnly) pick(btn, code, (c) => { code = c; show(); check(); inp.focus(); }); });
  put(D.get.call(inp) || inp.getAttribute("value") || "");
}

/** The country list: a search box (name in English or Arabic, or the code: 91 / +91 / 0091) and the countries. */
function pick(btn, current, done) {
  document.querySelectorAll(".phone-pop").forEach((x) => x.remove());
  const pop = document.createElement("div"); pop.className = "phone-pop"; pop.dir = "ltr";
  const q = document.createElement("input"); q.type = "search"; q.placeholder = t("phone_search"); q.setAttribute("aria-label", t("phone_search"));
  const box = document.createElement("div"); box.className = "phone-list"; box.setAttribute("role", "listbox");
  pop.append(q, box); (btn.closest("dialog[open]") || document.body).append(pop); // inside an open dialog: the page behind it can't be clicked
  const r = btn.getBoundingClientRect(), w = Math.min(340, innerWidth - 16);
  pop.style.width = `${w}px`; pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  if (innerHeight - r.bottom < 300 && r.top > innerHeight - r.bottom) pop.style.bottom = `${innerHeight - r.top + 4}px`; else pop.style.top = `${r.bottom + 4}px`;
  let shown = [];
  const draw = () => {
    const s = q.value.trim(), d = s.replace(/\D/g, "").replace(/^00/, ""), n = norm(s.replace(/[\d+]/g, ""));
    shown = list().filter((x) => !s || (d && x.code.startsWith(d)) || (n && (norm(x.en).includes(n) || norm(x.ar).includes(n))));
    if (d) shown.sort((a, b) => (a.code === d ? 0 : 1) - (b.code === d ? 0 : 1) || a.code.length - b.code.length);
    box.replaceChildren(...(shown.length ? shown.map((x) => {
      const b = document.createElement("button"); b.type = "button"; b.className = `phone-opt${x.code === current ? " on" : ""}`; b.setAttribute("role", "option");
      b.innerHTML = `<span class="f">${flag(x.iso)}</span><b>+${x.code}</b><span class="n"></span>`;
      b.querySelector(".n").textContent = getLang() === "ar" ? `${x.ar} · ${x.en}` : `${x.en} · ${x.ar}`;
      b.onclick = (e) => { e.preventDefault(); close(); done(x.code); };
      return b;
    }) : [Object.assign(document.createElement("div"), { className: "sub", textContent: t("phone_none") })]));
  };
  const out = (e) => { if (!pop.contains(e.target) && e.target !== btn) close(); };
  const close = () => { pop.remove(); document.removeEventListener("mousedown", out, true); };
  q.oninput = draw;
  q.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); if (shown[0]) { close(); done(shown[0].code); } } else if (e.key === "Escape") { close(); btn.focus(); } };
  draw();
  const on = box.querySelector(".on"); if (on) on.scrollIntoView({ block: "nearest" });
  setTimeout(() => { document.addEventListener("mousedown", out, true); q.focus(); }, 0);
}

/** Every phone field on the page, now and later. */
export function watchPhones(root = document.body) {
  root.querySelectorAll('input[type="tel"]').forEach(enhancePhone);
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches('input[type="tel"]')) enhancePhone(n); n.querySelectorAll && n.querySelectorAll('input[type="tel"]').forEach(enhancePhone); } })
    .observe(root, { childList: true, subtree: true });
}
/** A saved number shown left to right with its code: "+968 9912 3456". */
export function phoneText(v) {
  const sp = splitPhone(v); if (!sp) return String(v || "");
  return `+${sp.code} ${sp.number.replace(/(\d{4})(?=\d)/g, "$1 ")}`;
}
