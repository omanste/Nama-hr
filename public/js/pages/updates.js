// HR system updates · تحديثات نظام الموارد البشرية (HR and Admin): every change to the HR portal between two dates — by
// environment, area and type, day by day — with the totals, and a PDF / Excel for management. Admin adds, edits and hides.
import { api } from "../api.js";
import { t, getLang, nm } from "../i18n.js";
import { h, clear, select, pageHead, empty, dmy, num, toast, field, errText } from "../ui.js";
import { letterPage, logoData, makePdf } from "../att-pdf.js";
import { pdfPreview } from "../pdf-preview.js";
import { saveXlsx } from "../xlsx-out.js";

const muscatDay = (d = new Date()) => new Date(d.getTime() + 4 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
/** The quick periods: [from, to]. A week starts on Sunday (Oman's working week). */
export function period(kind, today = muscatDay()) {
  const d = new Date(today + "T00:00:00Z"), y = d.getUTCFullYear(), m = d.getUTCMonth();
  const iso = (x) => x.toISOString().slice(0, 10);
  if (kind === "today") return [today, today];
  if (kind === "week") return [addDays(today, -d.getUTCDay()), today];
  if (kind === "month") return [iso(new Date(Date.UTC(y, m, 1))), today];
  if (kind === "last_month") return [iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))];
  return null;
}

export async function render(el, _p, { can }) {
  if (!can.edit()) throw { status: 403 };
  const L = getLang(), admin = can.admin();
  const T = (x, k) => (L === "ar" ? x[`${k}_ar`] || x[`${k}_en`] : x[`${k}_en`] || x[`${k}_ar`]) || "";
  let first = (await api.get("/api/hr-updates?from=0000-01-01&to=0000-01-01").catch(() => ({}))).first || null;
  const kind = select("period", [["all", t("all")], ["today", t("upd_today")], ["week", t("upd_week")], ["month", t("upd_month")], ["last_month", t("upd_last_month")], ["custom", t("upd_custom")]], "month", { "aria-label": t("upd_custom") });
  const from = h("input", { type: "date", "aria-label": t("start_date") }), to = h("input", { type: "date", "aria-label": t("end_date") });
  const env = select("env", [["", `${t("upd_env")}: ${t("env_all")}`], ...["dev", "test", "production"].map((e) => [e, `${t("upd_env")}: ${t("env_" + e)}`])], "", { "aria-label": t("upd_env") });
  const area = select("area", [["", `${t("upd_area")}: ${t("all")}`], ...AREAS.map((a) => [a, t("ua_" + a)])], "", { "aria-label": t("upd_area") });
  const type = select("type", [["", `${t("upd_type")}: ${t("all")}`], ...TYPES.map((a) => [a, t("ut_" + a)])], "", { "aria-label": t("upd_type") });
  const q = h("input", { type: "search", placeholder: t("upd_search"), "aria-label": t("upd_search") });
  const hidden = h("input", { type: "checkbox" });
  const setPeriod = () => {
    const p = kind.value === "all" ? [first ? muscatDay(new Date(first)) : "2026-01-01", muscatDay()] : period(kind.value);
    if (p) { from.value = p[0]; to.value = p[1]; }
    from.disabled = to.disabled = kind.value !== "custom";
  };
  kind.addEventListener("change", () => { setPeriod(); load(); });
  setPeriod();
  const out = h("div");
  let R = null, timer;
  const qs = () => new URLSearchParams({ from: from.value, to: to.value, env: env.value, area: area.value, type: type.value, q: q.value.trim(), ...(hidden.checked ? { hidden: "1" } : {}) });
  async function load() {
    if (from.value && to.value && from.value > to.value) { [from.value, to.value] = [to.value, from.value]; }
    R = await api.get(`/api/hr-updates?${qs()}`);
    first = R.first || first;
    draw();
  }
  const envBadge = (e) => h("span", { class: `env env-${e.env}`, title: [e.version ? `${t("upd_version")}: ${e.version}` : "", e.by ? `${t("upd_by")}: ${e.by === "auto" ? t("upd_auto") : e.by}` : ""].filter(Boolean).join(" · ") }, `${t("env_" + e.env)} ${dmy(e.day)}`);
  function draw() {
    const items = R.items;
    const n = (f) => items.filter(f).length;
    const tile = (label, v) => h("div", { class: "tile" }, h("b", null, num(v)), h("span", null, label));
    const byDay = new Map(); for (const x of items) { if (!byDay.has(x.date)) byDay.set(x.date, []); byDay.get(x.date).push(x); }
    clear(out).append(
      h("div", { class: "upd-tiles" }, tile(t("upd_total"), items.length), ...TYPES.map((k) => tile(t("ut_" + k), n((x) => x.type === k)))),
      h("div", { class: "upd-areas", "aria-label": t("upd_by_area") }, AREAS.filter((a) => n((x) => x.area === a)).map((a) => h("button", { type: "button", class: `chip${area.value === a ? " on" : ""}`, onclick: () => { area.value = area.value === a ? "" : a; load(); } }, `${t("ua_" + a)} · ${num(n((x) => x.area === a))}`))),
      R.deploys && R.deploys[0] ? h("p", { class: "sub" }, t("upd_last_deploy", { d: new Intl.DateTimeFormat(L === "ar" ? "ar-OM-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Muscat" }).format(new Date(R.deploys[0].at)), v: `${t("env_" + R.deploys[0].env)} · ${R.deploys[0].version || "—"}` }), first ? ` · ${t("upd_since", { d: dmy(muscatDay(new Date(first))) })}` : "") : null,
      ...(!items.length ? [empty(t("upd_none"))] : [...byDay].map(([day, list]) => h("section", null,
        h("div", { class: "upd-day" }, h("h3", null, dayTitle(day)), h("span", { class: "pill" }, t("upd_n_day", { n: num(list.length) }))),
        list.map((x) => h("article", { class: `upd-item${x.hidden ? " hid" : ""}` },
          h("div", { class: "top" }, h("b", null, T(x, "title")), h("span", { class: "ut ut-" + x.type }, t("ut_" + x.type)), h("span", { class: "ut" }, t("ua_" + x.area)),
            x.hidden ? h("span", { class: "badge" }, t("upd_hidden")) : null,
            admin ? h("button", { type: "button", class: "btn small", onclick: () => editor(x) }, "✎ ", t("upd_edit")) : null),
          T(x, "desc") ? h("p", null, T(x, "desc")) : null,
          h("div", { class: "envs" }, x.envs.map(envBadge), x.source === "manual" ? h("span", { class: "sub" }, t("upd_manual")) : null)))))));
  }
  const dayTitle = (d) => new Intl.DateTimeFormat(L === "ar" ? "ar-OM-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));

  // Admin: add or edit an entry (words in both languages, area, type, the environments' dates, hidden)
  function editor(x = null) {
    const f = h("form", { class: "form" });
    const inp = (name, v, attrs = {}) => h("input", { name, value: v ?? "", ...attrs });
    const ta = (name, v, dir) => h("textarea", { name, rows: 3, dir }, v ?? "");
    const dateOf = (e) => (x && x.envs.find((y) => y.env === e) || {}).day || "";
    f.append(h("div", { class: "fields" },
      field(t("upd_title_en"), inp("title_en", x && x.title_en, { dir: "ltr" })), field(t("upd_title_ar"), inp("title_ar", x && x.title_ar, { dir: "rtl" })),
      field(t("upd_desc_en"), ta("desc_en", x && x.desc_en, "ltr"), { full: true }), field(t("upd_desc_ar"), ta("desc_ar", x && x.desc_ar, "rtl"), { full: true }),
      field(t("upd_area"), select("area", AREAS.map((a) => [a, t("ua_" + a)]), x ? x.area : "attendance")), field(t("upd_type"), select("type", TYPES.map((a) => [a, t("ut_" + a)]), x ? x.type : "improvement")),
      ...(x ? ["dev", "test", "production"].map((e) => field(`${t("env_" + e)} — ${t("upd_date")}`, inp(`env_${e}`, dateOf(e), { type: "date" })))
        : [field(t("upd_env"), select("env", ["dev", "test", "production"].map((e) => [e, t("env_" + e)]), R.env)), field(t("upd_date"), inp("date", muscatDay(), { type: "date" }))]),
      x ? h("label", { class: "row" }, h("input", { type: "checkbox", name: "hidden", checked: !!x.hidden }), " ", t("upd_hide")) : null));
    const err = h("p", { class: "field-err" });
    const dlg = h("dialog", { class: "dialog" }, h("h2", null, x ? t("upd_edit") : t("upd_add")), f, err,
      h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onclick: save }, t("save")), h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, t("cancel"))));
    async function save() {
      const v = Object.fromEntries(new FormData(f).entries());
      const body = { title_en: v.title_en, title_ar: v.title_ar, desc_en: v.desc_en, desc_ar: v.desc_ar, area: v.area, type: v.type };
      try {
        if (x) { body.hidden = !!f.elements.hidden.checked; body.envs = Object.fromEntries(["dev", "test", "production"].map((e) => [e, v[`env_${e}`] || null])); await api.put(`/api/hr-updates/${x.id}`, body); }
        else { body.env = v.env; body.date = v.date; await api.post("/api/hr-updates", body); }
        dlg.close(); toast(t("saved")); await load();
      } catch (e) { err.textContent = errText(e); }
    }
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (x) { toast(x.message || String(x), "error"); } finally { btn.disabled = false; } };
  const pdfBtn = h("button", { class: "btn", type: "button" }, t("upd_export_pdf"));
  const xlsBtn = h("button", { class: "btn", type: "button" }, t("upd_export_xlsx"));
  // the preview: the period and the environment can be changed in it, and it redraws
  pdfBtn.onclick = () => {
    const pf = h("input", { type: "date", value: from.value }), pt = h("input", { type: "date", value: to.value });
    const pe = select("env", [...env.options].map((o) => [o.value, o.textContent]), env.value);
    pdfPreview({ title: t("upd_title"), options: [{ label: t("start_date"), control: pf }, { label: t("end_date"), control: pt }, { label: t("upd_env"), control: pe }],
      make: async (onStep) => {
        const q = qs(); q.set("from", pf.value); q.set("to", pt.value); q.set("env", pe.value); q.delete("hidden");
        return updatesPdf(await api.get(`/api/hr-updates?${q}`), pf.value, pt.value, onStep);
      } });
  };
  xlsBtn.onclick = () => busy(xlsBtn, () => updatesXlsx(R, from.value, to.value));
  for (const c of [from, to, env, area, type, hidden]) c.addEventListener("change", load);
  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  el.append(pageHead(t("upd_title"), xlsBtn, pdfBtn, admin ? h("button", { class: "btn primary", type: "button", onclick: () => editor() }, t("upd_add")) : null),
    h("div", { class: "toolbar" }, kind, from, to, env, area, type, q, admin ? h("label", { class: "row", style: { gap: "6px" } }, hidden, t("upd_show_hidden")) : null), out);
  await load();
}
const AREAS = ["profiles", "attendance", "shifts", "verification", "permissions", "leave", "calendar", "reports", "backup", "general"];
const TYPES = ["feature", "improvement", "fix"];
const TL = (x, k) => (getLang() === "ar" ? x[`${k}_ar`] || x[`${k}_en`] : x[`${k}_en`] || x[`${k}_ar`]) || "";
const envText = (x) => x.envs.map((e) => `${t("env_" + e.env)} ${dmy(e.day)}`).join(" · ");
const fileBase = (a, b) => `nama-hr-updates-${a}_${b}`;

/** The PDF for management: letterhead, "From … To …", the summary by area and type, then day by day by environment. */
async function updatesPdf(R, a, b, onStep) {
  const logo = await logoData();
  const head = { title: t("upd_pdf_title"), period: t("upd_from_to", { a: dmy(a), b: dmy(b) }), range: "", generated: R.generated_at, by: "", note: t("upd_prepared") };
  const items = R.items, n = (f) => items.filter(f).length;
  const css = () => h("style", null, `.us{width:100%;border-collapse:collapse;table-layout:fixed}.us th,.us td{border:1px solid #dfe5e3;padding:4px 6px;font-size:10.5px;text-align:center;vertical-align:middle}.us td.s,.us th.s{text-align:start}.us tr.tot td{font-weight:600;background:#f4f7f6}
    .ud{margin:8px 0 2px;font-size:12px;font-weight:600}.ud span{color:#8a9794;font-weight:400;margin-inline-start:8px}.ud .eg{font-size:10px}.ue{margin:2px 0 0;font-size:10px;color:#5b6b68}
    .ul{width:100%;border-collapse:collapse;table-layout:fixed}.ul td{border-bottom:1px solid #eef1f0;padding:3px 6px;font-size:10px;vertical-align:top;text-align:start;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;height:auto!important}.ul td div,.ul td b{white-space:normal!important}.ul td b{font-size:10.5px}.ul td.k{color:#5b6b68}.ul td.k .eg{display:inline-block;margin:1px 2px}
    .eg{display:inline-block;border-radius:8px;padding:0 6px;font-size:9px;margin-inline-end:4px}.eg.dev{background:#FBEBCF;color:#A86500}.eg.test{background:#DDE8F3;color:#2C5C8A}.eg.production{background:#DDF1E5;color:#1F7A4D}`);
  const pages = [];
  // page 1: the summary — a table of areas × types, and the totals
  const areas = AREAS.filter((x) => n((y) => y.area === x));
  pages.push(letterPage(head, logo, [css(),
    h("h2", null, t("upd_summary_h"), h("small", null, `${t("upd_total")}: ${num(items.length)}`)),
    h("table", { class: "us" }, h("colgroup", null, h("col", { style: "width:34%" }), TYPES.map(() => h("col")), h("col")),
      h("thead", null, h("tr", null, h("th", { class: "s" }, t("upd_area")), TYPES.map((k) => h("th", null, t("ut_" + k))), h("th", null, t("upd_total")))),
      h("tbody", null, areas.map((x) => h("tr", null, h("td", { class: "s" }, t("ua_" + x)), TYPES.map((k) => h("td", null, num(n((y) => y.area === x && y.type === k)) || "—")), h("td", null, num(n((y) => y.area === x))))),
        h("tr", { class: "tot" }, h("td", { class: "s" }, t("pdf_totals")), TYPES.map((k) => h("td", null, num(n((y) => y.type === k)))), h("td", null, num(items.length))))),
    h("p", { class: "note" }, t("upd_from_to", { a: dmy(a), b: dmy(b) }), " · ", t("upd_prepared")),
  ]));
  // then day by day: each day's updates grouped by the environment they reached that day
  const byDay = new Map(); for (const x of items) { if (!byDay.has(x.date)) byDay.set(x.date, []); byDay.get(x.date).push(x); }
  const ROWS = 15; let body = [], used = 0;
  const flush = () => { if (body.length) pages.push(letterPage(head, logo, [css(), h("h2", null, t("upd_day_list")), ...body])); body = []; used = 0; };
  for (const [day, list] of byDay) {
    const groups = new Map(); for (const x of list) { const e = (x.envs.find((y) => y.day === day) || x.envs[0] || { env: "dev" }).env; if (!groups.has(e)) groups.set(e, []); groups.get(e).push(x); }
    for (const [e, g] of [...groups].sort((p, q2) => ["dev", "test", "production"].indexOf(p[0]) - ["dev", "test", "production"].indexOf(q2[0]))) {
      for (let i = 0; i < g.length; i += ROWS) {
        const part = g.slice(i, i + ROWS), cost = part.reduce((s, x) => s + 1.3 + Math.ceil(TL(x, "desc").length / 125) * 1.1, 2.2); // a line per ~125 letters of description
        if (used + cost > 40) flush();
        body.push(h("div", { class: "ud" }, dmy(day), h("span", { class: `eg ${e}` }, t("env_" + e)), h("span", null, t("upd_n_day", { n: num(part.length) }))),
          h("table", { class: "ul" }, h("colgroup", null, h("col", { style: "width:13%" }), h("col", { style: "width:11%" }), h("col"), h("col", { style: "width:24%" })),
            h("tbody", null, part.map((x) => h("tr", null, h("td", { class: "k" }, t("ua_" + x.area)), h("td", { class: "k" }, t("ut_" + x.type)),
              h("td", null, h("b", null, TL(x, "title")), TL(x, "desc") ? h("div", { class: "ue" }, TL(x, "desc")) : null),
              h("td", { class: "k" }, x.envs.map((y) => h("span", { class: `eg ${y.env}` }, `${t("env_" + y.env)} ${dmy(y.day)}`))))))));
        used += cost;
      }
    }
  }
  flush();
  return makePdf(pages, `${fileBase(a, b)}.pdf`, onStep);
}

/** Excel: a Summary sheet (area × type) and a Details sheet, one row per update. */
async function updatesXlsx(R, a, b) {
  const items = R.items, n = (f) => items.filter(f).length;
  const areas = AREAS.filter((x) => n((y) => y.area === x));
  const sum = [[t("upd_area"), ...TYPES.map((k) => t("ut_" + k)), t("upd_total")], ...areas.map((x) => [t("ua_" + x), ...TYPES.map((k) => n((y) => y.area === x && y.type === k)), n((y) => y.area === x)]),
    [t("pdf_totals"), ...TYPES.map((k) => n((y) => y.type === k)), items.length], [], [t("upd_from_to", { a: dmy(a), b: dmy(b) })], [t("upd_prepared")]];
  const det = [[t("upd_date"), t("upd_area"), t("upd_type"), t("upd_title_col"), t("upd_desc_col"), t("upd_envs_col"), t("upd_version")],
    ...items.map((x) => [dmy(x.date), t("ua_" + x.area), t("ut_" + x.type), TL(x, "title"), TL(x, "desc"), envText(x), x.envs.map((e) => e.version).filter(Boolean)[0] || x.commit_sha || ""])];
  await saveXlsx([{ name: t("upd_sheet_summary"), rows: sum, center: [1, 2, 3, 4] }, { name: t("upd_sheet_details"), rows: det, widths: [12, 16, 14, 50, 70, 40, 10], center: [0, 6] }], `${fileBase(a, b)}.xlsx`);
}
