// Company calendar: a month grid with leave (by what each person may see), official holidays, blocked days,
// company occasions and birthdays. HR and Admin add or remove entries here.
import { api } from "../api.js";
import { t, nm, getLang, tx } from "../i18n.js";
import { h, field, select, pageHead, toast, errText, confirm, dmy, todayIso, isPermission, empty } from "../ui.js";
import { render as rerender } from "../app.js";

const pad = (n) => String(n).padStart(2, "0");
const loc = () => (getLang() === "ar" ? "ar-OM-u-nu-latn" : "en-GB");
const shift = (month, n) => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
const inRange = (d, a, b) => d >= a && d <= b;

export async function render(el, _p, { query }) {
  const month = /^\d{4}-\d{2}$/.test(query.get("m") || "") ? query.get("m") : todayIso().slice(0, 7);
  const data = await api.get(`/api/calendar?month=${month}`);
  const [y, m] = month.split("-").map(Number);
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = Sunday
  const today = todayIso();
  const holidays = new Map(data.holidays.map((x) => [x.date, x.name]));
  let selected = query.get("d") && query.get("d").startsWith(month) ? query.get("d") : today.startsWith(month) ? today : `${month}-01`;

  const go = (mm, d) => { location.hash = `#/calendar?m=${mm}${d ? `&d=${d}` : ""}`; };
  const monthSel = select("month", Array.from({ length: 12 }, (_, i) => [pad(i + 1), new Intl.DateTimeFormat(loc(), { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, i, 1)))]), pad(m), { "aria-label": t("month") });
  const years = []; for (let k = y - 3; k <= y + 2; k++) years.push(k);
  const yearSel = select("year", years.map((k) => [k, String(k)]), y, { "aria-label": t("year") });
  monthSel.addEventListener("change", () => go(`${yearSel.value}-${monthSel.value}`));
  yearSel.addEventListener("change", () => go(`${yearSel.value}-${monthSel.value}`));

  const onDay = (d) => ({
    holiday: holidays.get(d),
    blocked: data.events.filter((e) => e.kind === "blocked" && inRange(d, e.start_date, e.end_date)),
    events: data.events.filter((e) => e.kind === "event" && inRange(d, e.start_date, e.end_date)),
    national: data.events.filter((e) => e.kind === "national" && inRange(d, e.start_date, e.end_date)),
    religious: data.events.filter((e) => e.kind === "religious" && inRange(d, e.start_date, e.end_date)),
    birthdays: data.birthdays.filter((b) => b.date === d),
    off: data.items.filter((r) => inRange(d, r.start_date, r.end_date)),
  });

  const grid = h("div", { class: "cal-grid", role: "grid" });
  const detail = h("section", { class: "card", "aria-live": "polite" });
  function drawGrid() {
    // the day names, and a one-letter form for narrow phones (the full names don't fit 7 columns there)
    const dayName = (i, weekday) => new Intl.DateTimeFormat(loc(), { weekday, timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + i)));
    const wk = [0, 1, 2, 3, 4, 5, 6].map((i) => [dayName(i, "short"), dayName(i, "narrow")]);
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(h("div", { class: "cal-cell empty", "aria-hidden": "true" }));
    for (let d = 1; d <= daysIn; d++) {
      const iso = `${month}-${pad(d)}`, x = onDay(iso), dow = new Date(iso + "T00:00:00Z").getUTCDay();
      const leaves = x.off.filter((r) => !isPermission(r.type)), perms = x.off.filter((r) => isPermission(r.type));
      cells.push(h("button", {
        type: "button", class: ["cal-cell", dow === 5 || dow === 6 ? "we" : "", x.holiday ? "hol" : "", x.blocked.length ? "blk" : "", iso === today ? "today" : "", iso === selected ? "sel" : ""].filter(Boolean).join(" "),
        "aria-pressed": String(iso === selected), "aria-label": dmy(iso), onclick: () => { selected = iso; drawGrid(); drawDetail(); },
      },
        h("span", { class: "dnum" }, String(d)),
        x.holiday ? h("span", { class: "tag hol" }, tx(x.holiday)) : null,
        x.blocked.map((e) => h("span", { class: "tag blk" }, "⛔ ", tx(e.name))),
        x.national.map((e) => h("span", { class: "tag nat" }, tx(e.name))),
        x.religious.map((e) => h("span", { class: "tag rel" }, tx(e.name))),
        x.events.map((e) => h("span", { class: `tag ev${e.visibility === "personal" ? " mine" : ""}` }, e.visibility === "personal" ? "🔒 " : "★ ", tx(e.name))),
        x.birthdays.map((b) => h("span", { class: "tag bd" }, "🎂 ", nm(b))),
        leaves.slice(0, 3).map((r) => h("span", { class: `tag lv ${r.status}` }, nm(r))),
        leaves.length > 3 ? h("span", { class: "tag more" }, `+${leaves.length - 3}`) : null,
        perms.length ? h("span", { class: "tag pm" }, "⏱ ", String(perms.length)) : null,
        // phones: dots instead of words
        h("span", { class: "dots", "aria-hidden": "true" },
          x.holiday ? h("i", { class: "hol" }) : null, x.blocked.length ? h("i", { class: "blk" }) : null, x.national.length ? h("i", { class: "nat" }) : null,
          x.religious.length ? h("i", { class: "rel" }) : null, x.events.length ? h("i", { class: "ev" }) : null,
          x.birthdays.length ? h("i", { class: "bd" }) : null, leaves.length ? h("i", { class: "lv" }) : null, perms.length ? h("i", { class: "pm" }) : null)));
    }
    grid.replaceChildren(...wk.map(([w, n]) => h("div", { class: "cal-wk", role: "columnheader", title: w }, h("span", { class: "wk-long" }, w), h("span", { class: "wk-short", "aria-hidden": "true" }, n))), ...cells);
  }
  function drawDetail() {
    const x = onDay(selected);
    const del = (fn) => data.canEdit ? h("button", { class: "btn small danger", type: "button", onclick: fn }, t("delete")) : null;
    const rows = [
      x.holiday ? h("div", { class: "item" }, h("span", { class: "badge b-on_leave" }, t("holiday")), h("div", { class: "grow" }, tx(x.holiday)),
        del(async () => { if (await confirm(t("delete_q"), { danger: true })) { try { await api.del(`/api/calendar/holidays/${selected}`); toast(t("saved")); rerender(); } catch (e) { toast(errText(e), "bad"); } } })) : null,
      ...[...x.national, ...x.religious].map((e) => h("div", { class: "item" }, h("span", { class: `badge ${e.kind === "national" ? "b-approved" : "b-on_leave"}` }, t("cal_" + e.kind)), h("div", { class: "grow" }, tx(e.name)),
        e.fixed ? null : del(async () => { if (await confirm(t("delete_q"), { danger: true })) { try { await api.del(`/api/calendar/entries/${e.id}`); toast(t("saved")); rerender(); } catch (er) { toast(errText(er), "bad"); } } }))),
      ...x.blocked.map((e) => h("div", { class: "item" }, h("span", { class: "badge b-rejected" }, t("cal_blocked")), h("div", { class: "grow" }, tx(e.name), h("div", { class: "meta" }, `${dmy(e.start_date)} – ${dmy(e.end_date)} · ${t("cal_blocked_hint")}`)),
        del(async () => { if (await confirm(t("delete_q"), { danger: true })) { try { await api.del(`/api/calendar/entries/${e.id}`); toast(t("saved")); rerender(); } catch (er) { toast(errText(er), "bad"); } } }))),
      ...x.events.map((e) => h("div", { class: "item" }, h("span", { class: `badge ${e.visibility === "personal" ? "" : "b-pending"}` }, t(e.visibility === "personal" ? "cal_personal" : "cal_event")),
        h("div", { class: "grow" }, tx(e.name), h("div", { class: "meta" }, e.start_date === e.end_date ? dmy(e.start_date) : `${dmy(e.start_date)} – ${dmy(e.end_date)}`,
          e.visibility === "company" && e.by_ar !== null && !e.mine ? ` · ${t("cal_added_by", { name: nm({ name_ar: e.by_ar, name_en: e.by_en }) })}` : "")),
        (e.mine || data.canEdit) && h("button", { class: "btn small danger", type: "button", onclick: async () => { if (await confirm(t("delete_q"), { danger: true })) { try { await api.del(`/api/calendar/entries/${e.id}`); toast(t("saved")); rerender(); } catch (er) { toast(errText(er), "bad"); } } } }, t("delete")))),
      ...x.birthdays.map((b) => h("div", { class: "item" }, h("span", { class: "badge" }, "🎂"), h("div", { class: "grow" }, t("cal_birthday_of", { name: nm(b) })))),
      ...x.off.map((r) => h("a", { class: "item", href: `#/leave/${r.id}` }, h("span", { class: `badge ${r.status === "approved" ? "b-approved" : "b-pending"}` }, t("rs_" + r.status)),
        h("div", { class: "grow" }, h("div", { class: "title" }, nm(r)), h("div", { class: "meta" }, t("lt_" + r.type), isPermission(r.type) ? ` · ${r.early_time}${r.end_time ? "–" + r.end_time : ""}` : r.start_date === r.end_date ? "" : ` · ${dmy(r.start_date)} – ${dmy(r.end_date)}`)))),
    ].filter(Boolean);
    detail.replaceChildren(h("h2", null, new Intl.DateTimeFormat(loc(), { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(selected + "T00:00:00Z"))),
      rows.length ? h("div", { class: "list" }, rows) : empty(t("cal_nothing_day")));
  }
  drawGrid(); drawDetail();

  const legend = h("div", { class: "row sub cal-legend" },
    [["hol", "holiday"], ["nat", "cal_national"], ["rel", "cal_religious"], ["blk", "cal_blocked"], ["ev", "cal_event"], ["bd", "cal_birthday"], ["lv", "cal_leave"], ["pm", "nav_permissions"]].map(([c, k]) => h("span", null, h("i", { class: `key ${c}` }), t(k))));
  el.append(pageHead(t("nav_calendar"),
      data.canEdit ? h("button", { class: "btn", type: "button", onclick: () => importDialog(y) }, "⬇ ", t("cal_import_oman")) : null,
      h("button", { class: "btn primary", type: "button", onclick: () => addDialog(selected, data.canEdit) }, "+ ", t(data.canEdit ? "cal_add" : "cal_add_event"))),
    h("div", { class: "toolbar cal-nav" },
      h("button", { class: "btn", type: "button", "aria-label": t("prev_month"), onclick: () => go(shift(month, -1)) }, getLang() === "ar" ? "→" : "←"),
      monthSel, yearSel,
      h("button", { class: "btn", type: "button", "aria-label": t("next_month"), onclick: () => go(shift(month, 1)) }, getLang() === "ar" ? "←" : "→"),
      h("button", { class: "btn", type: "button", onclick: () => go(today.slice(0, 7), today) }, t("today"))),
    h("section", { class: "card cal-card" }, grid, legend),
    detail);
}

/** HR/Admin add any kind; everyone else adds an event — personal (only they see it) or shared with all staff. */
function addDialog(day, editor) {
  const kind = select("kind", editor ? [["blocked", t("cal_blocked")], ["event", t("cal_event")], ["national", t("cal_national")], ["religious", t("cal_religious")], ["holiday", t("holiday")]]
    : [["event", t("cal_event")]], editor ? "blocked" : "event");
  const vis = select("visibility", [["personal", t("cal_vis_personal")], ["company", t("cal_vis_company")]], editor ? "company" : "personal");
  const visField = field(t("cal_visibility"), vis, { full: true });
  const from = h("input", { type: "date", value: day, required: true }), to = h("input", { type: "date", value: day });
  const name = h("input", { required: true, maxlength: 100, dir: "auto" });
  const hint = h("p", { class: "sub" });
  const showHint = () => { hint.textContent = kind.value === "event" ? t(vis.value === "personal" ? "cal_hint_personal" : editor ? "cal_hint_event" : "cal_hint_shared") : t("cal_hint_" + kind.value); visField.hidden = kind.value !== "event"; };
  vis.addEventListener("change", showHint);
  kind.addEventListener("change", showHint); showHint();
  const err = h("div", { class: "form-error" });
  const dlg = h("dialog", { class: "dialog" }, h("form", { class: "form", onsubmit: async (ev) => {
    ev.preventDefault();
    try { await api.post("/api/calendar/entries", { kind: kind.value, start: from.value, end: to.value || from.value, name: name.value.trim(), visibility: vis.value }); dlg.close(); toast(t("saved")); rerender(); }
    catch (er) { err.textContent = errText(er); }
  } },
    h("h2", null, t(editor ? "cal_add" : "cal_add_event")),
    h("div", { class: "fields" }, editor ? field(t("kind"), kind, { full: true }) : null, visField, field(t("holiday_from"), from), field(t("holiday_to"), to, { hint: t("holiday_to_hint") }), field(t("cal_name"), name, { full: true })),
    hint, err,
    h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t("cancel")), h("button", { class: "btn primary", type: "submit" }, t("save")))));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal(); name.focus();
}

/** Add the expected religious occasions (Hijri calendar) for a year — and, if ticked, the expected official holidays (days off). */
function importDialog(year) {
  const sel = select("year", [year - 1, year, year + 1].map((k) => [k, String(k)]), year);
  const hol = h("input", { type: "checkbox", name: "holidays" });
  const err = h("div", { class: "form-error" });
  const dlg = h("dialog", { class: "dialog" }, h("form", { class: "form", onsubmit: async (ev) => {
    ev.preventDefault();
    try { const r = await api.post("/api/calendar/import-oman", { year: Number(sel.value), holidays: hol.checked }); dlg.close();
      toast(t("cal_imported", { n: r.added, y: r.year }) + (hol.checked ? ` · ${t("cal_imported_hol", { n: r.holidays })}` : "")); rerender(); }
    catch (er) { err.textContent = errText(er); }
  } },
    h("h2", null, t("cal_import_oman")), h("p", { class: "sub" }, t("cal_import_hint")),
    field(t("year"), sel),
    h("label", { class: "row", style: { alignItems: "flex-start", flexWrap: "nowrap", gap: "10px", margin: "6px 0" } }, hol, h("span", null, h("b", null, t("cal_import_hol")), h("span", { class: "sub", style: { display: "block" } }, t("cal_import_hol_hint")))), err,
    h("div", { class: "row end" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t("cancel")), h("button", { class: "btn primary", type: "submit" }, t("cal_import")))));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}
