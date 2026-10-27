// App shell: session, layout (header, sidebar / bottom bar), hash router.
import { api } from "./api.js";
import { t, setLang, getLang, nm, has } from "./i18n.js";
import { h, clear, errText, empty } from "./ui.js";

const ROUTES = [
  ["/login", "login", { bare: true }],
  ["/password", "password", { bare: true }],
  ["/", "home"],
  ["/me", "profile", { me: true }],
  ["/staff", "staff"],
  ["/staff/new", "profile-edit"],
  ["/staff/:id", "profile"],
  ["/staff/:id/edit", "profile-edit"],
  ["/leave", "requests", { scope: "mine", kind: "leave" }],
  ["/requests", "requests", { scope: "all" }],
  ["/team", "requests", { scope: "team" }],
  ["/leave/new", "request-new"],
  ["/permissions", "requests", { scope: "mine", kind: "permission" }],
  ["/permissions/new", "permission-new"],
  ["/reports", "reports"],
  ["/voice", "voice"],
  ["/voice/new", "voice-new"],
  ["/voice/:id", "voice-item"],
  ["/leave/:id", "request"],
  ["/approvals", "approvals"],
  ["/notifications", "notifications"],
  ["/import", "import"],
  ["/settings", "settings"],
  ["/users", "users"],
  ["/audit", "audit"],
  ["/cap-reviews", "cap-reviews"],
  ["/calendar", "calendar"],
  ["/attendance", "attendance"],
  ["/attendance/correction", "att-request", { kind: "correction" }],
  ["/attendance/mission", "att-request", { kind: "mission" }],
  ["/attendance/report", "att-report"],
  ["/attendance/upload", "att-upload"],
  ["/menu", "menu"],
].map(([pattern, page, opts = {}]) => {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
  return { re, keys, page, opts };
});

const VIEW_ALL = ["hr", "accounts", "ceo", "admin"];
export const state = { me: null };
export const can = {
  viewAll: () => VIEW_ALL.includes(state.me?.user.role),
  edit: () => ["hr", "admin"].includes(state.me?.user.role),
  admin: () => state.me?.user.role === "admin",
  approve: () => state.me && (state.me.isApprover || ["ceo", "admin"].includes(state.me.user.role) || state.me.pendingApprovals > 0),
  staffList: () => can.viewAll() || !!state.me?.isApprover,
};

function navItems() {
  const me = state.me;
  const items = [["#/", "nav_home", "home"]];
  if (me.employee) items.push(["#/leave", "nav_leave", "leave"], ["#/permissions", "nav_permissions", "clock"], ["#/me", "nav_me", "user"], ["#/attendance", "nav_attendance", "finger"]);
  if (can.approve()) items.push(["#/approvals", "nav_approvals", "check", me.pendingApprovals]);
  if (me.employee || ["hr", "ceo", "admin"].includes(me.user.role)) items.push(["#/voice", "nav_voice", "chat", me.voiceInbox]);
  if (can.staffList()) items.push(["#/staff", "nav_staff", "people"]);
  items.push(["#/calendar", "nav_calendar", "leave"]); // everyone: holidays, occasions, birthdays and their own leave
  if (me.isApprover && !can.viewAll()) items.push(["#/team", "team_requests", "list"]);
  if (can.viewAll()) items.push(["#/requests", "nav_requests", "list"]);
  if (can.viewAll() || me.isApprover) items.push(["#/reports", "nav_reports", "chart"]);
  if (["hr", "admin", "ceo", "accounts"].includes(me.user.role) || me.isApprover) items.push(["#/attendance/report", "nav_att_report", "chart", me.pendingHr]);
  if (can.edit()) items.push(["#/cap-reviews", "nav_cap_reviews", "clock", me.pendingCapReviews], ["#/import", "nav_import", "upload"]);
  if (can.admin()) items.push(["#/settings", "nav_settings", "gear"], ["#/users", "nav_users", "key"]);
  if (can.viewAll()) items.push(["#/audit", "nav_audit", "clock"]);
  return items;
}
export const menuItems = navItems;

const ICONS = {
  home: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z", leave: "M7 3v3M17 3v3M4 8h16M5 5h14v16H5z", user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0",
  check: "M4 12l5 5L20 6", people: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 10a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01", upload: "M12 16V4m0 0-5 5m5-5 5 5M4 20h16", gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8-3 2-1-2-4-2 .5-1.5-1L16 4h-4l-.5 2.5-1.5 1L8 7 6 11l2 1-.1 1.5L6 15l2 4 2-.5 1.5 1L12 22h4l.5-2.5 1.5-1 2 .5 2-4-2-1z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  finger: "M12 11v4a6 6 0 0 1-1 3.5M8.5 21A9 9 0 0 0 9 13v-2a3 3 0 0 1 6 0v1M15.5 20a14 14 0 0 0 .5-4M5 17.5A8 8 0 0 0 6 13v-2a6 6 0 0 1 11-3.3M19 16v-3a6 6 0 0 0-.4-2",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12zM8 11h8M8 14h5",
  key: "M15 7a4 4 0 1 1-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0 1 15 7z", clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", bell: "M6 17V11a6 6 0 1 1 12 0v6l2 2H4zM10 21h4", more: "M5 12h.01M12 12h.01M19 12h.01",
};
export const icon = (name, size = 20) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", size); svg.setAttribute("height", size); svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.8"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", ICONS[name] || ""); svg.append(p);
  return svg;
};

export async function loadMe() {
  state.me = await api.get("/api/me");
  if (state.me.user.lang && state.me.user.lang !== getLang()) setLang(state.me.user.lang);
  return state.me;
}

let unread = 0;
async function pollNotifications() {
  if (!state.me || state.me.user.mustChange) return;
  try {
    const n = await api.get("/api/notifications");
    unread = n.unread;
    const b = document.querySelector(".bell .count");
    if (b) { b.textContent = unread > 9 ? "9+" : unread; b.hidden = !unread; }
  } catch {}
}
setInterval(pollNotifications, 60000);

function header() {
  const me = state.me;
  return h("header", { class: "top" },
    h("div", { class: "topbar" },
      h("a", { class: "mark", href: "#/", "aria-label": t("company") },
        h("img", { src: "/logo-wordmark.png", alt: t("company"), height: 36 }),
        h("span", { class: "app" }, t("app_name"))),
      me.env === "dev" || me.env === "test" ? h("span", { class: "dev" }, t("dev_badge")) : null,
      h("span", { class: "spacer" }),
      h("a", { class: "hbtn bell", href: "#/notifications", "aria-label": t("nav_notifications") }, icon("bell"), h("span", { class: "count", hidden: !unread }, unread)),
      themeButton("hbtn"),
      h("button", { class: "hbtn", type: "button", onclick: toggleLang, lang: getLang() === "ar" ? "en" : "ar" }, t("lang_toggle")),
      h("div", { class: "who" },
        h("span", { class: "who-name" }, nm(me.employee) || me.user.username, h("span", { class: "role" }, t("role_" + me.user.role))),
        h("button", { class: "hbtn", type: "button", onclick: signOut }, t("sign_out")))));
}

function sidebar(path) {
  return h("nav", { class: "side", "aria-label": "main" },
    navItems().map(([href, key, ic, count]) => h("a", { href, "aria-current": isCurrent(href, path) ? "page" : null }, icon(ic), h("span", null, t(key)), count ? h("span", { class: "pill" }, count) : null)));
}
function bottomBar(path) {
  const items = navItems();
  const primary = items.slice(0, 4);
  return h("nav", { class: "bottom", "aria-label": "main" },
    primary.map(([href, key, ic, count]) => h("a", { href, "aria-current": isCurrent(href, path) ? "page" : null, "aria-label": t(key) }, h("span", { class: "ic" }, icon(ic, 22), count ? h("span", { class: "dot" }, count) : null), h("span", null, t(has(key + "_short") ? key + "_short" : key)))),
    h("a", { href: "#/menu", "aria-current": path === "/menu" ? "page" : null }, h("span", { class: "ic" }, icon("more", 22)), h("span", null, t("nav_more"))));
}
const matches = (href, path) => { const p = href.slice(1); return p === "/" ? path === "/" : path === p || path.startsWith(p + "/"); };
// the most specific menu entry wins (My attendance vs Attendance reports)
const isCurrent = (href, path) => matches(href, path) && !navItems().some(([o]) => o.length > href.length && matches(o, path));

/** Sun / moon button: switches light and dark (kept on this device). */
export function themeButton(cls) {
  const dark = () => window.hrTheme && window.hrTheme.current() === "dark";
  const label = () => t(dark() ? "theme_light" : "theme_dark");
  const b = h("button", { class: cls, type: "button", "aria-label": label(), title: label(), onclick: () => {
    window.hrTheme && window.hrTheme.toggle();
    b.textContent = dark() ? "☀️" : "🌙"; b.setAttribute("aria-label", label()); b.title = label();
  } }, dark() ? "☀️" : "🌙");
  return b;
}

async function toggleLang() {
  const next = getLang() === "ar" ? "en" : "ar";
  setLang(next);
  if (state.me) { state.me.user.lang = next; api.put("/api/me/lang", { lang: next }).catch(() => {}); }
  render();
}
export async function signOut() {
  try { await api.post("/api/logout"); } catch {}
  state.me = null;
  location.hash = "#/login";
}

function match(path) {
  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (m) return { ...r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

let renderSeq = 0;
export async function render() {
  const seq = ++renderSeq;
  const root = document.getElementById("app");
  const path = (location.hash.replace(/^#/, "") || "/").split("?")[0];
  const route = match(path);
  if (!state.me && path !== "/login") {
    try { await loadMe(); } catch (e) { if (e.status === 401) { location.hash = "#/login"; return; } if (e.error !== "must_change_password") { root.replaceChildren(h("div", { class: "empty" }, errText(e))); return; } }
  }
  if (state.me && state.me.user.mustChange && path !== "/password" && path !== "/login") { location.hash = "#/password"; return; }
  if (!route) { location.hash = "#/"; return; }
  const main = h("main", { id: "main", tabindex: "-1" }, h("div", { class: "loading" }, t("loading")));
  if (route.opts.bare || !state.me) root.replaceChildren(h("div", { class: "bare" }, main));
  else root.replaceChildren(header(), h("div", { class: "shell" }, sidebar(path), main), bottomBar(path));
  document.title = `${t("app_name")} · ${t("company")}`;
  try {
    const mod = await import(`./pages/${route.page}.js`);
    if (seq !== renderSeq) return;
    const view = h("div", { class: "view" });
    // pages pass optional sections as null; never render them as text
    view.append = (...xs) => Element.prototype.append.apply(view, xs.flat().filter((x) => x !== null && x !== undefined && x !== false));
    await mod.render(view, route.params, { me: state.me, can, opts: route.opts, query: new URLSearchParams(location.hash.split("?")[1] || "") });
    if (seq !== renderSeq) return;
    clear(main).append(view);
    if (!route.opts.bare) main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (e) {
    if (seq !== renderSeq) return;
    console.error(e);
    clear(main).append(e && e.status === 403 ? empty(t("forbidden")) : e && e.status === 404 ? empty(t("not_found")) : empty(errText(e)));
  }
  pollNotifications();
}

// phones: tables turn into stacked cards, so every cell needs its column name as a label
function labelTables(root) {
  for (const table of root.querySelectorAll(".table-wrap:not(.keep-table) table")) {
    const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    for (const tr of table.querySelectorAll("tbody tr")) [...tr.children].forEach((td, i) => { if (heads[i] && !td.hasAttribute("data-label")) td.setAttribute("data-label", heads[i]); });
  }
}
new MutationObserver(() => labelTables(document.getElementById("app"))).observe(document.getElementById("app"), { childList: true, subtree: true });
// phone ⇄ tablet/desktop (rotation, split screen): pages that pick a layout in code redraw
matchMedia("(min-width: 900px)").addEventListener("change", () => render());

/** Refresh the cached /api/me (e.g. after approvals change the badge) and redraw. */
export async function refreshMe() { try { await loadMe(); } catch {} }

let initialLang = "ar";
try { initialLang = localStorage.getItem("hr_lang") || "ar"; } catch {}
setLang(initialLang);
window.addEventListener("hashchange", render);
render();
