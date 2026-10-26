import { api } from "../api.js";
import { t } from "../i18n.js";
import { h, field, select, toast, errText, showFieldError, backLink, daysText, num, dmy, todayIso, empty } from "../ui.js";

const TYPES = ["annual", "early", "emergency", "bereavement", "sick", "comp_day"];
const DEDUCT = ["annual", "early"];
const RANGE = ["annual", "emergency", "bereavement", "sick"];
const TIMES = []; for (let m = 9 * 60 + 30; m <= 16 * 60 + 30; m += 30) TIMES.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);

const dayCount = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1 : 0);

export async function render(el, _p, { me, query }) {
  if (!me.employee) { el.append(empty(t("no_profile"))); return; }
  const prof = await api.get(`/api/employees/${me.employee.id}`);
  const L = prof.leave;
  const today = todayIso();
  const notYet = L.eligibleFrom && L.eligibleFrom > today;
  let type = TYPES.includes(query.get("type")) ? query.get("type") : notYet ? "sick" : "annual";

  const start = h("input", { type: "date", name: "start", value: today });
  const end = h("input", { type: "date", name: "end", value: today });
  const date = h("input", { type: "date", name: "date", value: today });
  const time = select("time", TIMES.map((x) => [x, x]), "15:00");
  const reason = h("textarea", { name: "reason", rows: 3 });
  const note = h("input", { type: "file", name: "note", accept: "application/pdf,image/png,image/jpeg,image/webp" });
  const calc = h("div", { class: "card", "aria-live": "polite" });
  const submit = h("button", { class: "btn primary", type: "submit" }, t("submit_request"));
  const typeBtns = h("div", { class: "seg", role: "group", "aria-label": t("leave_type") });
  const fieldsBox = h("div", { class: "fields" });

  function minutes() {
    if (type === "early") { const [hh, mm] = time.value.split(":").map(Number); return 17 * 60 - (hh * 60 + mm); }
    if (type === "comp_day") return 480;
    const d = dayCount(start.value, end.value);
    return d > 0 ? d * 480 : 0;
  }
  function update() {
    const m = minutes();
    const deduct = DEDUCT.includes(type);
    const firstDay = type === "early" ? date.value : start.value;
    const blocked = deduct && L.eligibleFrom && firstDay < L.eligibleFrom;
    const over = deduct && m > L.available;
    const bad = RANGE.includes(type) && (dayCount(start.value, end.value) < 1 || dayCount(start.value, end.value) > 60);
    calc.replaceChildren(...[
      h("dl", { class: "facts" },
        h("div", null, h("dt", null, t("this_request")), h("dd", { class: "num" }, bad ? "—" : type === "early" ? t("hours", { n: num(m / 60) }) : daysText(m))),
        deduct ? h("div", null, h("dt", null, t("bal_available")), h("dd", { class: "num" }, daysText(L.available))) : null,
        deduct ? h("div", null, h("dt", null, t("available_after")), h("dd", { class: "num", style: { color: over ? "var(--bad)" : null } }, daysText(L.available - m))) : null),
      !deduct ? h("p", { class: "sub", style: { margin: "10px 0 0" } }, type === "comp_day" ? t("lt_comp_note") : t("lt_record_note")) : null,
      over ? h("div", { class: "note bad", style: { marginTop: "10px" } }, t("exceeds_balance")) : null,
      blocked ? h("div", { class: "note bad", style: { marginTop: "10px" } }, t("not_eligible", { d: dmy(L.eligibleFrom) })) : null].filter(Boolean));
    submit.disabled = !!(over || blocked || bad);
  }
  function drawFields() {
    typeBtns.replaceChildren(...TYPES.map((x) => h("button", { type: "button", "aria-pressed": String(x === type), onclick: () => { type = x; drawFields(); } }, t("lt_" + x))));
    end.min = start.value;
    date.max = type === "comp_day" ? today : "";
    fieldsBox.replaceChildren(...[
      ...(RANGE.includes(type) ? [field(t("start_date"), start, { req: true }), field(t("end_date"), end, { req: true })] : []),
      ...(type === "early" ? [field(t("date"), date, { req: true }), field(t("leave_time"), time, { req: true })] : []),
      ...(type === "comp_day" ? [field(t("worked_date"), date, { req: true })] : []),
      field(t("reason_optional"), reason, { full: true }),
      type === "sick" ? field(t("medical_note"), note, { full: true }) : null].filter(Boolean));
    update();
  }
  for (const i of [start, end, date, time]) i.addEventListener("change", () => { if (i === start && end.value < start.value) end.value = start.value; end.min = start.value; update(); });

  const form = h("form", { class: "form", novalidate: true, onsubmit: async (ev) => {
    ev.preventDefault();
    const body = { type, reason: reason.value.trim() };
    if (RANGE.includes(type)) Object.assign(body, { start: start.value, end: end.value });
    else Object.assign(body, { date: date.value });
    if (type === "early") body.time = time.value;
    submit.disabled = true;
    try {
      const r = await api.post("/api/requests", body);
      const f = note.files[0];
      if (type === "sick" && f) { try { await api.upload(`/api/requests/${r.request.id}/files?name=${encodeURIComponent(f.name)}`, f); } catch (er) { toast(errText(er), "bad"); } }
      toast(t("request_sent"));
      location.hash = `#/leave/${r.request.id}`;
    } catch (er) {
      submit.disabled = false;
      if (!(er.field && showFieldError(form, er.field, errText(er)))) toast(errText(er), "bad");
    }
  } },
    h("section", { class: "card" }, h("h2", null, t("leave_type")), typeBtns),
    h("section", { class: "card" }, fieldsBox),
    calc,
    h("div", { class: "form-actions" }, h("a", { class: "btn", href: "#/leave" }, t("cancel")), submit));
  el.append(backLink("#/leave"), h("h1", null, t("new_request")), notYet ? h("div", { class: "note" }, t("eligible_from", { d: dmy(L.eligibleFrom) })) : null, form);
  drawFields();
}
