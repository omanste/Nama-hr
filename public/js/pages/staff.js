import { api } from "../api.js";
import { t, nm, tx, getLang } from "../i18n.js";
import { h, clear, select, pageHead, badge, avatar, empty, dmy, num, toast } from "../ui.js";
import { letterPage, logoData, makePdf } from "../att-pdf.js";
import { pdfPreview } from "../pdf-preview.js";
import { saveXlsx } from "../xlsx-out.js";

const STATUSES = ["active", "on_leave", "resigned", "terminated", "disabled"];
// the columns, in this order everywhere (screen, Excel, PDF) — Status always last: [key, label]
const COLS = [["emp_no", "f_emp_no"], ["name", "sl_name"], ["dept", "f_department"], ["job", "f_job_title"], ["join", "sl_join"], ["remaining", "sl_remaining"], ["status", "f_status"]];
const CENTER = new Set(["emp_no", "join", "remaining", "status"]);
const SORT_KEY = "nama.staffSort";
const loadSort = () => { try { const v = JSON.parse(localStorage.getItem(SORT_KEY)); if (v && COLS.some(([k]) => k === v.key)) return v; } catch {} return { key: "emp_no", dir: 1 }; };
const saveSort = (v) => { try { localStorage.setItem(SORT_KEY, JSON.stringify(v)); } catch {} };

/** HR / Admin: the phone and relationship conversion report, and what still needs a look (each with a link to the person). */
async function phoneReport() {
  let r; try { r = await api.get("/api/admin/phone-report"); } catch { return null; }
  if (!r.report && !r.phones.length && !r.relations.length) return null;
  const R = r.report || { phones: {}, relations: {} };
  const who = (x) => h("a", { href: `#/staff/${x.id}/edit` }, `${x.emp_no} · ${nm(x)}`);
  const left = r.phones.length + r.relations.length;
  return h("details", { class: `card ph-report${left ? " warn" : ""}`, open: left > 0 && left <= 20 },
    h("summary", null, h("b", null, t("ph_report")), left ? h("span", { class: "pill" }, left) : " ✓"),
    r.report ? h("p", { class: "sub" }, t("ph_report_counts", { c: R.phones.converted || 0, o: R.phones.ok || 0, r: R.phones.review || 0, rc: R.relations.converted || 0, ro: R.relations.ok || 0, rr: R.relations.review || 0 })) : null,
    r.phones.length ? [h("h3", null, t("ph_review_phones")), h("ul", null, r.phones.map((x) => h("li", null, who(x), ` — ${t("f_" + x.field)}: `, h("span", { dir: "ltr" }, x.value))))] : null,
    r.relations.length ? [h("h3", null, t("ph_review_rel")), h("ul", null, r.relations.map((x) => h("li", null, who(x), ` — «${x.value}»`)))] : null,
    !left ? h("p", { class: "sub" }, t("ph_none_left")) : null);
}

export async function render(el, _p, { can, query }) {
  if (!can.edit()) throw { status: 403 };
  const L = getLang(), other = L === "ar" ? "en" : "ar";
  // one name per row, in the language of the screen; the other language (tagged) only when it is missing
  const nameOf = (e) => { const own = String(e[`name_${L}`] || "").trim(), alt = String(e[`name_${other}`] || "").trim(); return own ? { text: own, tag: "" } : { text: alt, tag: alt ? `(${other.toUpperCase()})` : "" }; };
  const deptOf = (e) => (L === "ar" ? e.dept_ar || e.dept_en : e.dept_en || e.dept_ar) || "";
  const jobOf = (e) => tx(e.job_title) || "";
  const daysLeft = (e) => Math.round((e.remaining / D) * 100) / 100;
  let R = await api.get("/api/staff-list"), D = R.day || 480;
  const sel = (name, opts, value, label) => select(name, opts, value, { "aria-label": label });
  const status = sel("status", [["current", `${t("filter_status")}: ${t("sl_current")}`], ["", `${t("filter_status")}: ${t("all")}`], ...STATUSES.map((s) => [s, `${t("filter_status")}: ${t("st_" + s)}`])], query.get("status") ?? "current", t("filter_status"));
  const depts = [...new Map(R.items.filter((e) => e.department_id).map((e) => [e.department_id, deptOf(e)])).entries()].sort((a, b) => a[1].localeCompare(b[1], L));
  const dept = sel("dept", [["", `${t("filter_dept")}: ${t("all")}`], ...depts.map(([id, n]) => [String(id), n])], query.get("dept") || "", t("filter_dept"));
  const jobs = [...new Set(R.items.map(jobOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, L));
  const job = sel("job", [["", `${t("sl_filter_job")}: ${t("all")}`], ...jobs.map((j) => [j, j])], "", t("sl_filter_job"));
  const q = h("input", { type: "search", placeholder: t("sl_search"), "aria-label": t("sl_search"), value: query.get("q") || "" });
  let sort = loadSort(), narrow = false, nowF = "";
  const out = h("div", { class: "sl-out" });
  const fold = (v) => String(v || "").toLowerCase().replace(/[\u064B-\u0652\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
  function shown() {
    const s = fold(q.value.trim());
    return R.items.filter((e) => (status.value === "current" ? ["active", "on_leave"].includes(e.status) : !status.value || e.status === status.value)
      && (!dept.value || String(e.department_id) === dept.value) && (!job.value || jobOf(e) === job.value)
      && (!s || [e.name_ar, e.name_en, e.emp_no].some((v) => fold(v).includes(s))) && (!nowF || (live(e) && live(e).code === nowF)));
  }
  const coll = new Intl.Collator(L === "ar" ? "ar" : "en", { numeric: true, sensitivity: "base" }); // NAMA-2 before NAMA-10
  const value = (e, k) => ({ emp_no: e.emp_no, name: nameOf(e).text, dept: deptOf(e), job: jobOf(e), join: e.join_date, remaining: e.remaining, status: STATUSES.indexOf(e.status) })[k];
  const sorted = (list) => [...list].sort((a, b) => {
    const x = value(a, sort.key), y = value(b, sort.key), blank = (v) => v === null || v === undefined || v === "";
    if (blank(x) || blank(y)) return blank(x) - blank(y); // empty values last, either way
    const r = typeof x === "number" && typeof y === "number" ? x - y : coll.compare(String(x), String(y));
    return (r || coll.compare(String(a.emp_no), String(b.emp_no))) * sort.dir;
  });
  const setSort = (key) => { sort = { key, dir: sort.key === key ? -sort.dir : 1 }; saveSort(sort); draw(); };
  // the text of each cell, the same for the screen and the files
  // the live status: where a current person is right now (from today's attendance); others keep their employment status
  const NOW_CLASS = { on_duty: "b-approved", checked_out: "b-disabled", on_break: "b-pending", excused: "b-on_leave", on_leave: "b-on_leave", mission: "b-mission",
    holiday: "b-disabled", rest: "b-disabled", not_in: "b-pending", absent: "b-rejected", pending: "b-pending",
    missing_in: "b-pending", no_record: "b-disabled", exempt: "b-disabled", unknown: "b-disabled", no_checkout: "b-pending" };
  const live = (e) => (["active", "on_leave"].includes(e.status) && e.now && NOW_CLASS[e.now.code] ? e.now : null);
  const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const nowText = (n) => t("now_" + n.code) + (n.code === "on_duty" || n.code === "excused" ? (n.in !== undefined && n.in !== null ? ` ${hm(n.in)}` : "") : n.code === "checked_out" ? ` ${hm(n.out)}` : n.code === "on_break" && n.since ? ` ${n.since}` : "");
  const statusText = (e) => (live(e) ? nowText(live(e)) : t("st_" + e.status));
  const tipOf = (e, n) => (n.code === "no_checkout" ? `${t("att_in")} ${hm(n.in)} · ${t("now_expected_out", { t: hm(n.expectedOut) })}` : n.code === "no_record" ? t("now_no_record_tip", { d: n.lastUpload ? dmy(n.lastUpload) : "—" }) : t("st_" + e.status));
  const statusBadge = (e) => (live(e) ? h("span", { class: `badge ${NOW_CLASS[live(e).code]}`, title: tipOf(e, live(e)) }, nowText(live(e))) : badge(e.status, "st_"));
  const cellText = (e, k) => k === "emp_no" ? e.emp_no || "—" : k === "name" ? (nameOf(e).text ? nameOf(e).text + (nameOf(e).tag ? ` ${nameOf(e).tag}` : "") : "—")
    : k === "dept" ? deptOf(e) || "—" : k === "job" ? jobOf(e) || "—" : k === "join" ? dmy(e.join_date) : k === "remaining" ? t("days", { n: num(daysLeft(e)) }) : statusText(e);
  function draw() {
    const list = sorted(shown());
    const counts = Object.fromEntries(STATUSES.map((s) => [s, list.filter((e) => e.status === s).length]));
    // and right now: how many are on duty, out, on leave, on a task… (as of the time shown)
    const nowCounts = {}; for (const e of list) { const n = live(e); if (n) nowCounts[n.code] = (nowCounts[n.code] || 0) + 1; }
    const nowLine = Object.keys(nowCounts).length ? h("div", { class: "sl-now" }, h("span", { class: "muted" }, t("now_as_of", { t: R.clock || "" })),
      Object.keys(NOW_CLASS).filter((k) => nowCounts[k]).map((k) => h("button", { type: "button", class: `badge ${NOW_CLASS[k]}${nowF === k ? " on" : ""}`, onclick: () => { nowF = nowF === k ? "" : k; draw(); } }, `${t("now_" + k)} · ${num(nowCounts[k])}`))) : null;
    const summary = h("div", null, h("p", { class: "sub sl-count" }, t("sl_total", { n: num(list.length) }), " · ", STATUSES.filter((s) => counts[s]).map((s) => `${t("st_" + s)} ${num(counts[s])}`).join(" · ")), nowLine);
    if (!list.length) return clear(out).append(summary, empty());
    if (narrow || !matchMedia("(min-width: 700px)").matches) {
      clear(out).append(summary, h("div", { class: "list sl-cards" }, list.map((e) => h("a", { class: "item", href: `#/staff/${e.id}` }, // no photo here: the whole width for the name
        h("div", { class: "grow" }, h("div", { class: "title sl-nm" }, h("span", null, nameOf(e).text || "—"), nameOf(e).tag ? h("small", { class: "sl-tag" }, nameOf(e).tag) : null),
          h("div", { class: "meta" }, [e.emp_no, deptOf(e), jobOf(e)].filter(Boolean).join(" · ")),
          h("div", { class: "meta row", style: { gap: "6px" } }, statusBadge(e), `${t("sl_join")}: ${dmy(e.join_date)} · ${cellText(e, "remaining")}`))))));
      // a name too long for the card: a slightly smaller font, never cut or broken
      const shrink = () => out.querySelectorAll(".sl-cards .sl-nm").forEach((n) => { n.style.fontSize = ""; let px = parseFloat(getComputedStyle(n).fontSize); while (n.scrollWidth > n.clientWidth + 1 && px > 9.5) { px -= 0.5; n.style.fontSize = `${px}px`; } });
      requestAnimationFrame(shrink); setTimeout(shrink, 900); if (document.fonts) document.fonts.ready.then(() => requestAnimationFrame(shrink));
      return;
    }
    const th = ([k, label]) => h("th", { class: CENTER.has(k) ? "c" : null, "aria-sort": sort.key === k ? (sort.dir > 0 ? "ascending" : "descending") : "none" },
      h("button", { class: "th-sort", type: "button", onclick: () => setSort(k) }, t(label), h("span", { class: "arrow", "aria-hidden": "true" }, sort.key === k ? (sort.dir > 0 ? "▲" : "▼") : "↕")));
    clear(out).append(summary, h("div", { class: "table-wrap sl-wrap" }, h("table", { class: "sl-table" },
      h("colgroup", null, h("col", { style: "width:104px" }), h("col", { style: "width:240px" }), h("col"), h("col"), h("col", { style: "width:108px" }), h("col", { style: "width:104px" }), h("col", { style: "width:140px" }), h("col", { style: "width:62px" })),
      h("thead", null, h("tr", null, COLS.map(th), h("th", null, ""))),
      h("tbody", null, list.map((e) => h("tr", null,
        h("td", { class: "c mono" }, e.emp_no || "—"),
        h("td", { class: "sl-nm" }, h("a", { href: `#/staff/${e.id}` }, avatar(e, 28), h("span", null, nameOf(e).text || "—"), nameOf(e).tag ? h("small", { class: "sl-tag" }, nameOf(e).tag) : null)),
        h("td", { class: "cut", title: deptOf(e) }, deptOf(e) || "—"), h("td", { class: "cut", title: jobOf(e) }, jobOf(e) || "—"),
        h("td", { class: "c" }, dmy(e.join_date)), h("td", { class: "c" }, cellText(e, "remaining")), h("td", { class: "c" }, statusBadge(e)),
        h("td", { class: "c" }, h("a", { class: "btn small", href: `#/staff/${e.id}/edit`, title: t("edit"), "aria-label": t("edit") }, "✎"))))))));
    requestAnimationFrame(fit);
  }
  // the portal font arrives after the first drawing (and is wider): measure again then
  if (document.fonts) document.fonts.addEventListener("loadingdone", () => { if (out.isConnected && !narrow) requestAnimationFrame(fit); });
  // the Name column as wide as the widest name as drawn (avatar and tag included); if that leaves Department and Job title
  // too little room on this screen, the names get a slightly smaller font — never a second line, never cut
  function fit() {
    const tb = out.querySelector(".sl-table"); if (!tb) return;
    const col = tb.querySelectorAll("col")[1], cells = [...tb.querySelectorAll("td.sl-nm")]; if (!cells.length) return;
    const cs = getComputedStyle(cells[0]), pad = parseFloat(cs.paddingInlineStart) + parseFloat(cs.paddingInlineEnd);
    const room = tb.parentElement.clientWidth - (104 + 108 + 104 + 140 + 62) - 2 * 120; // the other columns, and at least 120 px each for Department and Job title
    let px = 14, need = 0;
    for (;;) {
      tb.style.setProperty("--sl-name", `${px}px`);
      need = Math.ceil(Math.max(...cells.map((td) => td.firstChild.scrollWidth)) + pad + 2);
      if (need <= room || px <= 11) break;
      px -= 0.5;
    }
    // still too wide for this screen even with the smaller font (a small laptop with the menu open): the card list instead
    if (need > room + 2 * 60) { narrow = true; draw(); return; }
    col.style.width = `${Math.max(160, need)}px`;
  }
  let timer;
  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(draw, 150); });
  for (const s of [status, dept, job]) s.addEventListener("change", draw);
  addEventListener("resize", () => { if (out.isConnected) { clearTimeout(timer); timer = setTimeout(() => { narrow = false; draw(); }, 150); } });
  const stamp = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10); // Muscat date
  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (x) { toast(x.message || String(x), "error"); } finally { btn.disabled = false; } };
  const xlsBtn = h("button", { class: "btn", type: "button" }, t("sl_export_xlsx"));
  const pdfBtn = h("button", { class: "btn", type: "button" }, t("sl_export_pdf"));
  xlsBtn.onclick = () => busy(xlsBtn, async () => {
    const list = sorted(shown());
    await saveXlsx([{ name: t("sl_title_short"), center: COLS.map(([k], i) => (CENTER.has(k) ? i : -1)).filter((i) => i >= 0), rows: [COLS.map(([, l]) => t(l)), ...list.map((e) => COLS.map(([k]) => cellText(e, k)))] }], `nama-staff-list-${stamp()}.xlsx`);
  });
  // the preview: the status filter can be changed in it (the page's other filters apply)
  pdfBtn.onclick = () => {
    const st = select("status", [...status.options].map((o) => [o.value, o.textContent]), status.value);
    pdfPreview({ title: t("sl_title_short"), options: [{ label: t("filter_status"), control: st }],
      make: (onStep) => { status.value = st.value; draw(); return staffPdf(sorted(shown()), { R, cellText, nameOf, stamp, onStep }); } });
  };
  const report = await phoneReport();
  const miss = R.missing || {}, missList = [["department", "sl_miss_dept"], ["job_title", "sl_miss_job"], ["join_date", "sl_miss_join"], ["name_ar", "sl_miss_name_ar"], ["name_en", "sl_miss_name_en"]].filter(([k]) => miss[k]);
  el.append(pageHead(t("staff_title"), h("div", { class: "row" }, xlsBtn, pdfBtn, h("a", { class: "btn primary", href: "#/staff/new" }, t("add_employee")))), report,
    missList.length ? h("details", { class: "card sl-missing" }, h("summary", null, t("sl_missing_title")), h("p", { class: "sub" }, missList.map(([k, l]) => t(l, { n: num(miss[k]) })).join(" · "))) : null,
    h("div", { class: "toolbar" }, q, status, dept, job), out);
  draw();
}

/** The PDF: the letterhead, the totals by status, then the table (same columns and rules as the screen), page numbers. */
async function staffPdf(list, { R, cellText, nameOf, stamp, onStep }) {
  const logo = await logoData();
  const head = { title: `${t("sl_pdf_title")}`, period: dmy(stamp()), range: "", generated: R.generated_at || new Date().toISOString(), by: nm(R.by), note: t("sl_confidential") };
  const counts = STATUSES.map((s) => [s, list.filter((e) => e.status === s).length]).filter(([, n]) => n);
  // the Name column fits the longest name at the PDF's font; very long names get a slightly smaller font, never two lines
  const c = document.createElement("canvas").getContext("2d");
  let px = 11; const w = () => { c.font = `600 ${px}px 'Plex PDF', sans-serif`; return Math.max(...list.map((e) => c.measureText(cellText(e, "name")).width), 80) + 16; };
  let nameW = w(); while (nameW > 380 && px > 8.5) { px -= 0.5; nameW = w(); }
  const PER = 18, pages = [];
  for (let i = 0; i < Math.max(1, list.length); i += PER) {
    const chunk = list.slice(i, i + PER);
    pages.push(letterPage(head, logo, [
      h("style", null, `.sl td,.sl th{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:middle;height:24px}.sl th{white-space:normal;line-height:1.2}.sl td.n{font-size:${px}px;overflow:visible;text-overflow:clip;font-weight:600}.sl .c{text-align:center}.sl .s{text-align:start;padding-inline:6px}.sl .b{display:inline-block;border-radius:9px;padding:1px 8px;font-size:9.5px}.sl .b-active{background:#DDF1E5;color:#1F7A4D}.sl .b-on_leave{background:#DDE8F3;color:#2C5C8A}.sl .b-resigned{background:#FBEBCF;color:#A86500}.sl .b-terminated{background:#FBE1DE;color:#B42318}.sl .b-disabled{background:#eef1f0;color:#5b6b68}.sl small{color:#8a9794;font-weight:400;margin-inline-start:4px}.stc{display:flex;gap:14px;flex-wrap:wrap;margin:4px 0 8px;font-size:11px}.stc b{font-size:13px;margin-inline-end:4px}`),
      h("h2", null, t("sl_total", { n: num(list.length) }), list.length > PER ? h("small", null, `${num(i + 1)}–${num(Math.min(i + PER, list.length))} / ${num(list.length)}`) : null),
      h("div", { class: "stc" }, counts.map(([s, n]) => h("span", null, h("b", null, num(n)), t("st_" + s)))),
      h("table", { class: "sl", style: "table-layout:fixed;width:100%" },
        h("colgroup", null, h("col", { style: "width:80px" }), h("col", { style: `width:${Math.ceil(nameW)}px` }), h("col"), h("col"), h("col", { style: "width:82px" }), h("col", { style: "width:84px" }), h("col", { style: "width:96px" })),
        h("thead", null, h("tr", null, COLS.map(([k, l]) => h("th", { class: CENTER.has(k) ? "c" : "s" }, t(l))))),
        h("tbody", null, chunk.map((e) => h("tr", null, COLS.map(([k]) => k === "status" ? h("td", { class: "c" }, h("span", { class: `b b-${e.status}` }, cellText(e, "status")))
          : k === "name" ? h("td", { class: "s n" }, nameOf(e).text || "—", nameOf(e).tag ? h("small", null, nameOf(e).tag) : null)
          : h("td", { class: CENTER.has(k) ? "c" : "s" }, cellText(e, k))))))),
    ]));
  }
  return makePdf(pages, `nama-staff-list-${stamp()}.pdf`, onStep);
}
