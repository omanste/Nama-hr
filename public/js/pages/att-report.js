// Attendance report (policy §18): by department without names for management; HR and managers also see their people.
// HR's queue (permissions to classify, fingerprint corrections to confirm) sits underneath.
import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, clear, select, field, pageHead, empty, num, dmy, todayIso, toast, errText, durText, when, amountText } from "../ui.js";

const pad = (n) => String(n).padStart(2, "0");
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function period(key) {
  const d = todayIso(), y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  if (key === "last_week") { const end = addDays(d, -new Date(d + "T00:00:00Z").getUTCDay() - 1); return [addDays(end, -6), end]; }
  if (key === "this_week") return [addDays(d, -new Date(d + "T00:00:00Z").getUTCDay()), d];
  if (key === "last_month") { const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1; return [`${ly}-${pad(lm)}-01`, `${ly}-${pad(lm)}-${lastDay(ly, lm)}`]; }
  return [`${y}-${pad(m)}-01`, d];
}
const pct = (x) => (x === null || x === undefined ? "—" : `${num(x)}%`);

export async function render(el, _p, { me, can, query }) {
  if (!["hr", "admin", "ceo", "accounts"].includes(me.user.role) && !me.isApprover) throw { status: 403 };
  const depts = can.viewAll() ? (await api.get("/api/departments")).items : [];
  const [f0, t0] = query.get("from") ? [query.get("from"), query.get("to")] : period("last_week");
  const from = h("input", { type: "date", value: f0 }), to = h("input", { type: "date", value: t0 });
  const quick = select("period", [["last_week", t("last_week")], ["this_week", t("this_week")], ["this_month", t("this_month")], ["last_month", t("last_month")], ["custom", t("custom_period")]], query.get("from") ? "custom" : "last_week");
  const dept = depts.length ? select("department_id", [["", `${t("f_department")}: ${t("all")}`], ...depts.map((d) => [d.id, nm(d)])], "") : null;
  const out = h("div"), queue = h("div");
  const csv = h("a", { class: "btn", href: "#" }, "⬇ ", t("download_excel"));

  const head = [t("att_work_days"), t("att_compliance"), t("att_late"), t("att_early"), t("att_missing"), t("att_absent"), t("att_pending_abs"), t("att_leave_days"), t("att_mission_days")];
  const cells = (s) => [num(s.workDays), pct(s.compliance), s.late ? `${num(s.late)} · ${durText(s.lateMin)}` : "—", s.early ? `${num(s.early)} · ${durText(s.earlyMin)}` : "—",
    num(s.missing), num(s.absent), num(s.pending), num(s.leave), num(s.mission)].map((v) => h("td", { class: "num" }, v));

  async function load() {
    const qs = new URLSearchParams({ from: from.value, to: to.value });
    if (dept && dept.value) qs.set("department_id", dept.value);
    csv.href = `/api/attendance/report?${qs}&format=csv`;
    let r;
    try { r = await api.get(`/api/attendance/report?${qs}`); } catch (e) { clear(out).append(empty(errText(e))); return; }
    const T = r.total;
    clear(out).append(...[
      h("p", { class: "sub" }, `${dmy(r.from)} – ${dmy(r.to)} · `, t("att_report_note"), r.dataTo ? ` · ${t("att_data_to", { d: dmy(r.dataTo) })}` : ""),
      r.start && r.from < r.start ? h("div", { class: "note", style: { marginBottom: "12px" } }, t("att_info_before", { d: dmy(r.start) })) : null,
      h("div", { class: "grid tiles" },
        h("div", { class: `card tile ${T.compliance !== null && T.compliance < 80 ? "warn" : ""}` }, h("div", { class: "n" }, pct(T.compliance)), h("div", { class: "l" }, t("att_compliance"))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, num(T.late || 0)), h("div", { class: "l" }, t("att_late"), " · ", durText(T.lateMin || 0))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, num(T.absent || 0)), h("div", { class: "l" }, t("att_absent"))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, num(T.missing || 0)), h("div", { class: "l" }, t("att_missing"))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, num(r.openRequests)), h("div", { class: "l" }, t("att_open_requests"))),
        h("div", { class: "card tile" }, h("div", { class: "n" }, r.correctionHours === null ? "—" : t("hours", { n: num(r.correctionHours) })), h("div", { class: "l" }, t("att_corr_time")))),
      h("section", { class: "card", style: { marginTop: "16px" } }, h("h2", null, t("att_by_department")),
        r.departments.length ? h("div", { class: "table-wrap" }, h("table", null,
          h("thead", null, h("tr", null, h("th", null, t("f_department")), h("th", { class: "num" }, t("nav_staff")), head.map((x) => h("th", { class: "num" }, x)))),
          h("tbody", null, r.departments.map((d) => h("tr", null, h("td", null, nm(d) || t("no_department")), h("td", { class: "num" }, num(d.staff)), cells(d)))))) : empty(t("att_no_data"))),
      r.people.length ? h("section", { class: "card", style: { marginTop: "16px" } }, h("h2", null, t("att_by_person")), h("p", { class: "sub" }, t("att_by_person_note")),
        h("div", { class: "table-wrap" }, h("table", null,
          h("thead", null, h("tr", null, h("th", null, t("employee")), head.map((x) => h("th", { class: "num" }, x)))),
          h("tbody", null, r.people.map((p) => h("tr", null,
            h("td", null, h("a", { href: `#/attendance?emp=${p.employee.id}&m=${r.to.slice(0, 7)}` }, nm(p.employee)), h("div", { class: "muted" }, `${p.employee.emp_no} · ${t("shift_" + (p.employee.shift === 1 ? 1 : 2))}`)),
            cells(p))))))) : null].filter(Boolean));
  }

  async function loadQueue() {
    if (!can.edit()) return;
    const { items } = await api.get("/api/attendance/hr-queue");
    clear(queue).append(h("section", { class: "card", style: { marginTop: "16px" } },
      h("h2", null, t("att_hr_queue"), items.length ? h("span", { class: "pill" }, items.length) : null), h("p", { class: "sub" }, t("att_hr_queue_hint")),
      items.length ? h("div", { class: "list" }, items.map((r) => h("a", { class: "item", href: `#/leave/${r.id}` },
        h("span", { class: "badge b-pending" }, t("lt_" + r.type)),
        h("div", { class: "grow" }, h("div", { class: "title" }, nm(r)), h("div", { class: "meta" }, when(r), r.type !== "correction" ? ` · ${amountText(r)}` : ""))))) : empty(t("att_queue_empty"))));
  }

  quick.addEventListener("change", () => { if (quick.value !== "custom") { [from.value, to.value] = period(quick.value); load(); } });
  for (const i of [from, to]) i.addEventListener("change", () => { quick.value = "custom"; if (from.value && to.value && from.value <= to.value) load(); else toast(t("err_end_before_start"), "bad"); });
  if (dept) dept.addEventListener("change", load);

  el.append(pageHead(t("nav_att_report"), can.edit() ? h("a", { class: "btn", href: "#/attendance/upload" }, "⬆ ", t("nav_att_upload")) : null, csv),
    h("section", { class: "card" }, h("div", { class: "fields" }, field(t("period"), quick), field(t("holiday_from"), from), field(t("holiday_to"), to), dept ? field(t("f_department"), dept) : null)),
    out, queue);
  await Promise.all([load(), loadQueue()]);
}
