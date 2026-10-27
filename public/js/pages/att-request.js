// Fingerprint correction (policy §5): the arrival and/or leaving time the machine missed, with the reason — the manager verifies,
// HR confirms. External work task (§10): when, where and why — approved by the manager, counted as work time.
import { api } from "../api.js";
import { t } from "../i18n.js";
import { h, field, toast, errText, showFieldError, backLink, todayIso, clockText } from "../ui.js";

const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** The working day after a date (Friday and Saturday are rest days). */
const nextWorkDay = (iso) => { let d = addDays(iso, 1); while ([5, 6].includes(new Date(d + "T00:00:00Z").getUTCDay())) d = addDays(d, 1); return d; };

export async function render(el, _p, { me, opts, query }) {
  const kind = opts.kind; // correction | mission
  if (!me.employee) { el.append(h("div", { class: "empty" }, t("no_profile"))); return; }
  const today = todayIso();
  const sheet = await api.get(`/api/attendance/employee/${me.employee.id}?month=${(query.get("date") || today).slice(0, 7)}`);
  const pre = /^\d{4}-\d{2}-\d{2}$/.test(query.get("date") || "") ? query.get("date") : kind === "correction" ? addDays(today, -1) : today;
  const dayOf = (iso) => sheet.days.find((x) => x.date === iso);
  const date = h("input", { type: "date", name: "date", value: pre, max: kind === "correction" ? today : null });
  const t1 = h("input", { type: "time", name: "time" }), t2 = h("input", { type: "time", name: "end_time" });
  const place = h("input", { name: "place", maxlength: 200 });
  const reason = h("textarea", { name: "reason", rows: 3, maxlength: 1000, required: true });
  const info = h("div", { class: "note", "aria-live": "polite" });
  const submit = h("button", { class: "btn primary", type: "submit" }, t("submit_request"));

  function fill() {
    const d = dayOf(date.value);
    const sh = d ? d.shift : { start: 540, end: 1080 };
    if (kind === "mission") {
      if (!t1.value) t1.value = clockText(sh.start);
      if (!t2.value) t2.value = clockText(sh.end);
      info.replaceChildren(t("mission_hint"));
      return;
    }
    // what the machine recorded that day, so only the missing time needs typing
    const parts = [t("corr_hint")];
    if (d && d.status !== "no_data") parts.push(h("div", { style: { marginTop: "6px" } }, t("corr_machine", { a: clockText(d.in), b: clockText(d.out) })));
    if (d && d.correctionPending) parts.push(h("div", { class: "bad-text" }, t("corr_already")));
    // §5: by the end of the next working day
    if (date.value && today > nextWorkDay(date.value)) parts.push(h("div", { class: "bad-text" }, t("corr_late")));
    info.replaceChildren(...parts);
  }
  date.addEventListener("change", async () => {
    if (date.value && date.value.slice(0, 7) !== (sheet.month || "")) {
      try { Object.assign(sheet, await api.get(`/api/attendance/employee/${me.employee.id}?month=${date.value.slice(0, 7)}`)); } catch {}
    }
    fill();
  });

  const form = h("form", { class: "form", novalidate: true, onsubmit: async (ev) => {
    ev.preventDefault();
    if (!reason.value.trim()) { showFieldError(form, "reason", t("reason_required")); return; }
    const body = { type: kind, date: date.value, time: t1.value || null, end_time: t2.value || null, reason: reason.value.trim() };
    if (kind === "mission") body.place = place.value.trim();
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
    h("section", { class: "card" }, h("div", { class: "fields" },
      field(t("date"), date, { req: true }),
      field(t(kind === "mission" ? "mission_from" : "corr_in"), t1, { req: kind === "mission", hint: kind === "correction" ? t("corr_in_hint") : null }),
      field(t(kind === "mission" ? "mission_to" : "corr_out"), t2, { req: kind === "mission", hint: kind === "correction" ? t("corr_out_hint") : null }),
      kind === "mission" ? field(t("mission_place"), place, { full: true, req: true, hint: t("mission_place_hint") }) : null,
      field(t(kind === "mission" ? "mission_purpose" : "reason"), reason, { full: true, req: true }))),
    info,
    h("div", { class: "form-actions" }, h("a", { class: "btn", href: "#/attendance" }, t("cancel")), submit));
  el.append(backLink("#/attendance"), h("h1", null, t(kind === "mission" ? "new_mission" : "new_correction")), form);
  fill();
}
