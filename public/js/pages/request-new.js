// New request: annual, early leave, sick, and the statutory special leaves of Oman's Labour Law (Art. 78–84).
import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, field, select, toast, errText, showFieldError, backLink, daysText, num, dmy, todayIso, empty } from "../ui.js";

// mirrors server/leave.mjs TYPES (the server enforces every limit; this only guides the form)
const RULES = {
  annual: { range: true, deduct: true }, early: { hours: true }, sick: { range: true, proof: true }, emergency: { range: true, deduct: true },
  bereavement: { range: true, proof: true, relation: "list" }, marriage: { range: true, proof: true, max: 3 },
  paternity: { range: true, proof: true, max: 7, gender: "male", event: true }, maternity: { range: true, proof: true, max: 98, gender: "female", event: true },
  hajj: { range: true, proof: true, max: 15 }, exam: { range: true, proof: true, max: 15, omani: true },
  patient_care: { range: true, proof: true, max: 15, omani: true, relation: "text" },
  childcare: { range: true, gender: "female", unpaid: true }, unpaid: { range: true, unpaid: true }, comp_day: {},
};
const GROUPS = [["grp_main", ["annual", "early", "sick", "emergency", "comp_day"]], ["grp_special", ["bereavement", "marriage", "paternity", "maternity", "hajj", "exam", "patient_care"]], ["grp_unpaid", ["childcare", "unpaid"]]];
const BEREAVEMENT = { wife: 10, son: 10, daughter: 10, father: 3, mother: 3, grandfather: 3, grandmother: 3, brother: 3, sister: 3, uncle: 2, aunt: 2, husband_muslim: 130, husband_other: 14 };
const isOmani = (n) => /oman|عمان|عماني/i.test(String(n || ""));
const hm = (s) => { const [a, b] = String(s).split(":").map(Number); return a * 60 + b; };
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const dayCount = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1 : 0);

export async function render(el, _p, { me, query }) {
  if (!me.employee) { el.append(empty(t("no_profile"))); return; }
  const [prof, settings, cover] = await Promise.all([api.get(`/api/employees/${me.employee.id}`), api.get("/api/settings"), api.get("/api/cover")]);
  // approvers name a deputy for their own annual or emergency leave (company policy)
  const deputySel = cover.candidates && (me.isApprover || me.user.role === "ceo" || settings.managers_approver_employee_id === me.employee.id)
    ? select("deputy_user_id", [["", "—"], ...cover.candidates.map((u) => [u.id, nm(u) || u.username])], "") : null;
  const L = prof.leave, emp = prof.employee;
  const today = todayIso();
  const notYet = L.eligibleFrom && L.eligibleFrom > today;
  const allowed = (k) => { const R = RULES[k]; return !(R.gender && emp.gender && emp.gender !== R.gender) && !(R.omani && !isOmani(emp.nationality)); };
  let type = RULES[query.get("type")] && allowed(query.get("type")) ? query.get("type") : notYet ? "sick" : "annual";

  const start = h("input", { type: "date", name: "start", value: today });
  const end = h("input", { type: "date", name: "end", value: today });
  const date = h("input", { type: "date", name: "date", value: today });
  const time = select("time", [], "");
  const relList = select("relation", Object.keys(BEREAVEMENT).filter((r) => !(emp.gender === "male" && r.startsWith("husband")) && !(emp.gender === "female" && r === "wife")).map((r) => [r, `${t("rel_" + r)} · ${t("days", { n: BEREAVEMENT[r] })}`]), "father");
  const relText = h("input", { name: "relation" });
  const compChoice = select("comp_choice", [["leave", t("comp_leave")], ["pay", t("comp_pay")]], "leave");
  const holidays = new Set((settings.official_holidays || []).map((x) => x.date));
  const workDays = (a, b) => { let n = 0; for (let d = new Date(a + "T00:00:00Z"); d.toISOString().slice(0, 10) <= b; d.setUTCDate(d.getUTCDate() + 1)) if (!holidays.has(d.toISOString().slice(0, 10))) n++; return n; };
  const birth = h("input", { type: "date", name: "event_date" });
  const reason = h("textarea", { name: "reason", rows: 3 });
  const proofFile = h("input", { type: "file", name: "proof", accept: "application/pdf,image/png,image/jpeg,image/webp" });
  const calc = h("div", { class: "card", "aria-live": "polite" });
  const submit = h("button", { class: "btn primary", type: "submit" }, t("submit_request"));
  const typeBox = h("div", { class: "grid" });
  const fieldsBox = h("div", { class: "fields" });

  // early leave: 09:30 up to 30 minutes before the end of the day (17:00, or the Ramadan end time)
  const dayEnd = (d) => (settings.ramadan_start && settings.ramadan_end && d >= settings.ramadan_start && d <= settings.ramadan_end ? hm(settings.ramadan_day_end) : hm(settings.work_day_end || "17:00"));
  function fillTimes() {
    const endM = dayEnd(date.value), prev = time.value;
    time.replaceChildren(...Array.from({ length: Math.max(0, (endM - 30 - 570) / 30 + 1) }, (_, i) => clock(570 + i * 30)).map((x) => h("option", { value: x, selected: x === prev }, x)));
    if (!time.value && time.options.length) time.value = time.options[Math.max(0, time.options.length - 4)].value;
  }
  function minutes() {
    if (type === "early") return dayEnd(date.value) - hm(time.value || "00:00");
    if (type === "comp_day") return 480;
    const d = dayCount(start.value, end.value);
    if (d > 0 && RULES[type].deduct) return workDays(start.value, end.value) * 480;
    return d > 0 ? d * 480 : 0;
  }
  function update() {
    const R = RULES[type], m = minutes(), d = dayCount(start.value, end.value);
    const max = R.relation === "list" ? BEREAVEMENT[relList.value] : R.max;
    const over = R.deduct && m > L.available;
    const blocked = R.deduct && L.eligibleFrom && start.value < L.eligibleFrom;
    const bad = R.range && (d < 1 || (max && d > max));
    calc.replaceChildren(...[
      h("dl", { class: "facts" },
        h("div", null, h("dt", null, t("this_request")), h("dd", { class: "num" }, R.hours ? t("hours", { n: num(m / 60) }) : daysText(m))),
        R.deduct ? h("div", null, h("dt", null, t("bal_available")), h("dd", { class: "num" }, daysText(L.available))) : null,
        R.deduct ? h("div", null, h("dt", null, t("available_after")), h("dd", { class: "num", style: { color: over ? "var(--bad)" : null } }, daysText(L.available - m))) : null,
        max ? h("div", null, h("dt", null, t("max_allowed")), h("dd", { class: "num" }, t("up_to", { n: t("days", { n: max }) }))) : null),
      h("p", { class: "sub", style: { margin: "10px 0 0" } }, t("rule_" + type, { n: num(settings.early_free_hours_month ?? 4) }), R.unpaid ? ` · ${t("unpaid_note")}` : ""),
      R.deduct && d > 0 && workDays(start.value, end.value) < d ? h("p", { class: "sub", style: { margin: "4px 0 0" } }, t("holidays_excluded")) : null,
      R.proof ? h("p", { class: "sub", style: { margin: "4px 0 0" } }, t("proof_needed")) : null,
      over ? h("div", { class: "note bad", style: { marginTop: "10px" } }, t("exceeds_balance")) : null,
      blocked ? h("div", { class: "note bad", style: { marginTop: "10px" } }, t("not_eligible", { d: dmy(L.eligibleFrom) })) : null,
      bad && d > 0 ? h("div", { class: "note bad", style: { marginTop: "10px" } }, t("err_too_long")) : null].filter(Boolean));
    submit.disabled = !!(over || blocked || bad);
  }
  function draw() {
    const R = RULES[type];
    typeBox.replaceChildren(...GROUPS.map(([g, keys]) => h("div", null, h("div", { class: "sub", style: { marginBottom: "6px" } }, t(g)),
      h("div", { class: "seg", role: "group", "aria-label": t(g) }, keys.filter(allowed).map((k) => h("button", { type: "button", "aria-pressed": String(k === type), onclick: () => { type = k; draw(); } }, t("lt_" + k)))))));
    end.min = start.value;
    date.max = type === "comp_day" ? today : "";
    if (type === "early") fillTimes();
    fieldsBox.replaceChildren(...[
      ...(R.range ? [field(t("start_date"), start, { req: true }), field(t("end_date"), end, { req: true })] : []),
      ...(R.hours ? [field(t("date"), date, { req: true }), field(t("leave_time"), time, { req: true })] : []),
      ...(type === "comp_day" ? [field(t("worked_date"), date, { req: true }), field(t("comp_choice"), compChoice, { req: true })] : []),
      R.relation === "list" ? field(t("relation"), relList, { req: true }) : null,
      R.relation === "text" ? field(t("patient_relation"), relText, { req: true }) : null,
      R.event ? field(t("birth_date"), birth, { req: true }) : null,
      deputySel && R.deduct && type !== "early" ? field(t("deputy"), deputySel, { req: true, hint: t("cover_hint") }) : null,
      field(t("reason_optional"), reason, { full: true }),
      R.proof ? field(type === "sick" ? t("medical_note") : t("proof"), proofFile, { full: true }) : null].filter(Boolean));
    update();
  }
  for (const i of [start, end, date, time, relList, birth]) i.addEventListener("change", () => {
    if (i === start && end.value < start.value) end.value = start.value;
    if (i === date && type === "early") fillTimes();
    end.min = start.value; update();
  });

  const form = h("form", { class: "form", novalidate: true, onsubmit: async (ev) => {
    ev.preventDefault();
    const R = RULES[type];
    const body = { type, reason: reason.value.trim() };
    if (R.range) Object.assign(body, { start: start.value, end: end.value }); else body.date = date.value;
    if (R.hours) body.time = time.value;
    if (R.relation === "list") body.relation = relList.value;
    if (R.relation === "text") body.relation = relText.value.trim();
    if (R.event) body.event_date = birth.value;
    if (type === "comp_day") body.comp_choice = compChoice.value;
    if (deputySel && R.deduct) body.deputy_user_id = Number(deputySel.value) || null;
    submit.disabled = true;
    try {
      const r = await api.post("/api/requests", body);
      const f = proofFile.files[0];
      if (R.proof && f) { try { await api.upload(`/api/requests/${r.request.id}/files?name=${encodeURIComponent(f.name)}`, f); } catch (er) { toast(errText(er), "bad"); } }
      toast(t("request_sent"));
      location.hash = `#/leave/${r.request.id}`;
    } catch (er) {
      submit.disabled = false;
      if (!(er.field && showFieldError(form, er.field, errText(er)))) toast(errText(er), "bad");
    }
  } },
    h("section", { class: "card" }, h("h2", null, t("leave_type")), typeBox),
    h("section", { class: "card" }, fieldsBox),
    calc,
    h("div", { class: "form-actions" }, h("a", { class: "btn", href: "#/leave" }, t("cancel")), submit));
  el.append(backLink("#/leave"), h("h1", null, t("new_request")), notYet ? h("div", { class: "note" }, t("eligible_from", { d: dmy(L.eligibleFrom) })) : null, form);
  draw();
}
