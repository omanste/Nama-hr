// New permission: early leave, late arrival or a personal break during working hours. A reason is required; the manager decides.
import { api } from "../api.js";
import { t } from "../i18n.js";
import { h, field, select, toast, errText, showFieldError, backLink, num, dmy, todayIso, empty, PERMISSIONS } from "../ui.js";

const hm = (s) => { const [a, b] = String(s).split(":").map(Number); return a * 60 + b; };
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const steps = (from, to) => { const out = []; for (let m = from; m <= to; m += 30) out.push(clock(m)); return out; };
const hours = (m) => t("hours", { n: num(m / 60) });

export async function render(el, _p, { me, query }) {
  if (!me.employee) { el.append(empty(t("no_profile"))); return; }
  const [prof, settings] = await Promise.all([api.get(`/api/employees/${me.employee.id}`), api.get("/api/settings")]);
  const shiftNo = [1, 2, 3].includes(prof.employee.shift) ? prof.employee.shift : 2;
  let type = PERMISSIONS.includes(query.get("type")) ? query.get("type") : "early";
  const today = todayIso();
  const holidays = new Set((settings.official_holidays || []).map((x) => x.date));

  const date = h("input", { type: "date", name: "date", value: today });
  const t1 = select("time", [], ""), t2 = select("end_time", [], "");
  const reason = h("textarea", { name: "reason", rows: 3, required: true, maxlength: 1000 });
  const calc = h("div", { class: "card", "aria-live": "polite" });
  const submit = h("button", { class: "btn primary", type: "submit" }, t("submit_request"));
  const typeBox = h("div", { class: "seg", role: "group", "aria-label": t("permission_type") });
  const fieldsBox = h("div", { class: "fields" });

  // the person's own shift (policy §3); in Ramadan the day is shorter
  const ramadan = (d) => settings.ramadan_start && settings.ramadan_end && d >= settings.ramadan_start && d <= settings.ramadan_end;
  const dayStart = () => hm(settings[`shift_${shiftNo}_start`]);
  const dayEnd = (d) => (ramadan(d) ? dayStart() + (settings.ramadan_hours || 6) * 60 : hm(settings[`shift_${shiftNo}_end`]));
  const restDay = (d) => [5, 6].includes(new Date(d + "T00:00:00Z").getUTCDay());
  const fill = (sel, list, pick) => { const prev = sel.value; sel.replaceChildren(...list.map((x) => h("option", { value: x }, x))); sel.value = list.includes(prev) ? prev : pick(list); };
  function fillTimes() {
    const s = dayStart(), e = dayEnd(date.value);
    if (type === "early") fill(t1, steps(s + 30, e - 30), (l) => l[Math.max(0, l.length - 4)]);
    if (type === "late") fill(t1, steps(s + 30, e - 30), (l) => l[1] || l[0]);
    if (type === "break") {
      fill(t1, steps(s, e - 30), (l) => l.find((x) => x === "12:00") || l[0]);
      fill(t2, steps(hm(t1.value) + 30, e), (l) => l[1] || l[0]);
    }
  }
  function minutes() {
    if (type === "early") return dayEnd(date.value) - hm(t1.value);
    if (type === "late") return hm(t1.value) - dayStart();
    return hm(t2.value) - hm(t1.value);
  }
  function update() {
    const m = Math.max(0, minutes());
    const holiday = holidays.has(date.value), rest = restDay(date.value);
    calc.replaceChildren(...[
      h("dl", { class: "facts" },
        h("div", null, h("dt", null, t("this_request")), h("dd", { class: "num" }, hours(m))),
        h("div", null, h("dt", null, t("f_shift")), h("dd", { class: "num" }, `${t("shift_" + shiftNo)} · ${clock(dayStart())}–${clock(dayEnd(date.value))}`))),
      h("p", { class: "sub", style: { margin: "10px 0 0" } }, t("perm_rule_policy")),
      holiday ? h("div", { class: "note bad", style: { marginTop: "10px" } }, t("perm_holiday")) : null,
      rest ? h("div", { class: "note bad", style: { marginTop: "10px" } }, t("perm_rest_day")) : null].filter(Boolean));
    submit.disabled = !m || holiday || rest;
  }
  function draw() {
    typeBox.replaceChildren(...PERMISSIONS.map((k) => h("button", { type: "button", "aria-pressed": String(k === type), onclick: () => { type = k; draw(); } }, t("lt_" + k))));
    fillTimes();
    fieldsBox.replaceChildren(...[
      field(t("date"), date, { req: true }),
      field(t(type === "late" ? "arrival_time" : type === "break" ? "break_from" : "leave_time"), t1, { req: true }),
      type === "break" ? field(t("break_to"), t2, { req: true }) : null,
      field(t("reason"), reason, { full: true, req: true })].filter(Boolean));
    update();
  }
  date.addEventListener("change", () => { fillTimes(); update(); });
  t1.addEventListener("change", () => { if (type === "break") fillTimes(); update(); });
  t2.addEventListener("change", update);

  const form = h("form", { class: "form", novalidate: true, onsubmit: async (ev) => {
    ev.preventDefault();
    if (!reason.value.trim()) { showFieldError(form, "reason", t("reason_required")); return; }
    const body = { type, date: date.value, time: t1.value, reason: reason.value.trim() };
    if (type === "break") body.end_time = t2.value;
    submit.disabled = true;
    try {
      const r = await api.post("/api/requests", body);
      toast(t("request_sent"));
      location.hash = `#/leave/${r.request.id}`;
    } catch (er) {
      submit.disabled = false;
      if (!(er.field && showFieldError(form, er.field, errText(er)))) toast(errText(er), "bad");
    }
  } },
    h("section", { class: "card" }, h("h2", null, t("permission_type")), typeBox, h("p", { class: "sub", style: { margin: "10px 0 0" } }, t("perm_hint_" + type))),
    h("section", { class: "card" }, fieldsBox),
    calc,
    h("div", { class: "form-actions" }, h("a", { class: "btn", href: "#/permissions" }, t("cancel")), submit));
  el.append(backLink("#/permissions"), h("h1", null, t("apply_permission")), form);
  draw();
  // the hint under the type buttons follows the choice
  typeBox.addEventListener("click", () => { form.querySelector("section .sub").textContent = t("perm_hint_" + type); });
}
