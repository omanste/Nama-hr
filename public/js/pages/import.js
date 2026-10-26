// Excel import wizard: upload → map columns → preview (server validates) → import.
import { api } from "../api.js";
import { t, nm, both } from "../i18n.js";
import { h, clear, field, select, toast, errText, todayIso, dmy, num } from "../ui.js";
import { parseWorkbook } from "../sheet.js";

const FIELDS = ["name_ar", "name_en", "emp_no", "department", "job_title", "manager", "join_date", "opening_days", "civil_id", "civil_id_expiry", "nationality", "dob",
  "mobile", "email", "address", "emergency_name", "emergency_relation", "emergency_phone", "contract_type", "contract_end", "status",
  "education", "specialization", "experience", "languages", "skills", "certifications", "main_tasks", "gender"];

// Header words that identify a field, most specific first. Matching ignores hamza/alef/ya/ta-marbuta differences.
const SYNONYMS = {
  opening_days: ["اجمالي الرصيد المتبق", "remaining balance", "opening balance", "current balance", "balance"],
  name_ar: ["اسم الموظف", "الاسم بالعربيه", "الاسم العربي", "arabic name", "name (arabic)", "name ar", "الاسم"],
  name_en: ["الاسم بالانجليزيه", "english name", "name (english)", "name en", "full name", "name"],
  emp_no: ["الرقم الوظيفي", "رقم الموظف", "employee id", "employee no", "emp no", "staff id"],
  join_date: ["تاريخ تعيين", "تاريخ التعيين", "تاريخ الالتحاق", "join date", "joining date", "date of joining", "hire date"],
  department: ["القسم", "الاداره", "department", "dept"],
  job_title: ["المسمي الوظيفي", "الوظيفه", "job title", "position", "designation"],
  civil_id_expiry: ["انتهاء البطاقه", "civil id expiry", "id expiry"],
  civil_id: ["الرقم المدني", "البطاقه المدنيه", "civil id", "civil no"],
  nationality: ["الجنسيه", "nationality"], dob: ["تاريخ الميلاد", "date of birth", "dob", "birth date"],
  mobile: ["الهاتف", "الجوال", "mobile", "phone"], email: ["البريد", "email", "e-mail"], address: ["العنوان", "address"],
  contract_type: ["نوع العقد", "contract type"], contract_end: ["نهايه العقد", "contract end"], status: ["الحاله", "status"],
  manager: ["المدير المباشر", "direct manager", "line manager", "reports to"],
  gender: ["الجنس", "النوع", "gender", "sex"],
  education: ["اعلي مؤهل", "المؤهل العلمي", "educational qualification", "education"], specialization: ["التخصص", "specialization", "major"],
  experience: ["سنوات الخبره", "years of work experience", "years of experience"], languages: ["اللغات", "languages"],
  skills: ["المهارات", "key skills", "skills"], certifications: ["الدورات والشهادات", "certifications", "courses"],
  main_tasks: ["المهام والمسؤوليات", "main tasks", "responsibilities"],
};
const norm = (s) => String(s ?? "").toLowerCase().replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();

let xlsxLoaded;
function loadXlsx() {
  return xlsxLoaded ||= new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s = document.createElement("script"); s.src = "/vendor/xlsx.full.min.js"; s.onload = () => resolve(window.XLSX); s.onerror = reject; document.head.append(s);
  });
}

/** Sheet → {grid, merges}. grid is an array of rows (arrays of raw cell values). */
function sheetGrid(XLSX, ws) {
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  return { grid, merges: ws["!merges"] || [] };
}
/** Column labels from 1–2 header rows, filling merged cells across their range. */
function headerLabels(grid, merges, start, count) {
  const rows = [];
  for (let r = start; r < start + count; r++) rows.push([...(grid[r] || [])]);
  for (const m of merges) {
    if (m.e.r < start || m.s.r >= start + count) continue;
    const v = (grid[m.s.r] || [])[m.s.c];
    for (let r = Math.max(m.s.r, start); r <= Math.min(m.e.r, start + count - 1); r++) for (let c = m.s.c; c <= m.e.c; c++) rows[r - start][c] = v;
  }
  const width = Math.max(0, ...grid.slice(start, start + count + 30).map((r) => (r ? r.length : 0)));
  return Array.from({ length: width }, (_, c) => {
    const parts = [];
    for (const row of rows) { const v = row[c]; if (v !== null && v !== undefined && String(v).trim() && !parts.includes(String(v).trim())) parts.push(String(v).trim()); }
    return parts.join(" / ");
  });
}
function autoMap(labels) {
  const map = {}, used = new Set();
  for (const f of FIELDS) {
    const names = both("f_" + f); // labels of this app's own template, in either language
    const i = labels.findIndex((l, idx) => !used.has(idx) && names.some((n) => norm(l) === norm(n)));
    if (i !== -1) { map[f] = i; used.add(i); }
  }
  for (const [f, syns] of Object.entries(SYNONYMS)) {
    if (map[f] !== undefined) continue;
    for (const syn of syns) {
      const i = labels.findIndex((l, idx) => !used.has(idx) && norm(l).includes(norm(syn)));
      if (i !== -1) { map[f] = i; used.add(i); break; }
    }
  }
  return map;
}

export async function render(el, _p, { can }) {
  if (!can.edit()) throw { status: 403 };
  const S = { step: 1, file: null, wb: null, sheet: null, start: 0, count: 1, asOf: todayIso(), labels: [], data: [], mapping: {}, preview: null, onlyErrors: false, createLogins: false, result: null };
  const body = h("div", { class: "grid" });
  const steps = h("ol", { class: "steps" });
  el.append(h("h1", null, t("import_title")), steps, body);

  function drawSteps() {
    steps.replaceChildren(...["step_upload", "step_map", "step_preview", "step_done"].map((k, i) => h("li", { "aria-current": S.step === i + 1 ? "step" : null, class: S.step > i + 1 ? "done" : null }, t(k))));
  }
  function go(n) { S.step = n; drawSteps(); clear(body); [null, stepUpload, stepMap, stepPreview, stepDone][n](); window.scrollTo(0, 0); }

  function recompute() {
    const ws = S.wb.Sheets[S.sheet];
    const { grid, merges } = sheetGrid(window.XLSX, ws);
    S.labels = headerLabels(grid, merges, S.start, S.count);
    S.data = grid.slice(S.start + S.count);
  }

  // ---- step 1
  function stepUpload() {
    const fileIn = h("input", { type: "file", accept: ".xlsx,.xls,.csv", "aria-label": t("choose_file") });
    const opts = h("div", { class: "fields" });
    const info = h("div", { class: "sub" });
    const nextBtn = h("button", { class: "btn primary", type: "button", disabled: !S.wb, onclick: () => go(2) }, t("next"));
    function drawOpts() {
      if (!S.wb) { opts.replaceChildren(); return; }
      const sheetSel = select("sheet", S.wb.SheetNames.map((n) => [n, n]), S.sheet, { onchange: (e) => { S.sheet = e.target.value; detect(); drawOpts(); } });
      const startIn = h("input", { type: "number", min: 1, value: S.start + 1, onchange: (e) => { S.start = Math.max(0, Number(e.target.value) - 1); recompute(); drawOpts(); } });
      const countSel = select("count", [["1", "1"], ["2", "2"]], S.count, { onchange: (e) => { S.count = Number(e.target.value); recompute(); drawOpts(); } });
      const asOf = h("input", { type: "date", value: S.asOf, onchange: (e) => { S.asOf = e.target.value || todayIso(); } });
      opts.replaceChildren(field(t("sheet"), sheetSel), field(t("header_row_from"), startIn), field(t("header_rows_count"), countSel), field(t("balance_as_of"), asOf),
        h("div", { class: "field full" }, h("div", { class: "table-wrap" }, h("table", null, h("tbody", null,
          h("tr", null, S.labels.map((l) => h("th", null, l || "—"))),
          S.data.slice(0, 3).map((r) => h("tr", null, S.labels.map((_, c) => h("td", null, r[c] ?? "")))))))));
    }
    function detect() {
      // two header rows when the first header row has vertical merges (like "2026 / سنوية")
      const ws = S.wb.Sheets[S.sheet];
      const merges = ws["!merges"] || [];
      S.start = 0;
      S.count = merges.some((m) => m.s.r === 0 && m.e.r === 1) ? 2 : 1;
      recompute();
    }
    fileIn.addEventListener("change", async () => {
      const f = fileIn.files[0]; if (!f) return;
      try {
        const XLSX = await loadXlsx();
        S.file = f.name; S.wb = parseWorkbook(XLSX, new Uint8Array(await f.arrayBuffer()), f.name);
        S.sheet = S.wb.SheetNames[0]; detect(); drawOpts(); nextBtn.disabled = false; info.textContent = f.name;
      } catch (e) { toast(errText(e), "bad"); }
    });
    body.append(h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", null, t("choose_file")), h("button", { class: "btn small", type: "button", onclick: downloadTemplate }, t("download_template"))),
      fileIn, info, h("div", { style: { marginTop: "14px" } }, opts)),
      h("div", { class: "form-actions" }, nextBtn));
    drawOpts();
  }

  // ---- step 2
  async function stepMap() {
    let saved = { headers: [], mapping: {} };
    try { saved = await api.get("/api/import/mapping"); } catch {}
    if (!Object.keys(S.mapping).length) S.mapping = JSON.stringify(saved.headers) === JSON.stringify(S.labels) ? { ...saved.mapping } : autoMap(S.labels);
    const fieldFor = (c) => Object.keys(S.mapping).find((f) => Number(S.mapping[f]) === c) || "";
    const sample = (c) => { const r = S.data.find((row) => row && row[c] !== null && row[c] !== undefined && String(row[c]).trim()); return r ? String(r[c]) : ""; };
    const err = h("div", { class: "form-error" });
    const rows = S.labels.map((label, c) => {
      const sel = select(`col${c}`, [["", t("ignore")], ...FIELDS.map((f) => [f, t("f_" + f)])], fieldFor(c), { "aria-label": label || `${t("column")} ${c + 1}`, onchange: (e) => {
        for (const f of Object.keys(S.mapping)) if (Number(S.mapping[f]) === c) delete S.mapping[f];
        if (e.target.value) S.mapping[e.target.value] = c;
        go(2);
      } });
      return h("tr", null, h("td", null, label || h("span", { class: "muted" }, `${t("column")} ${c + 1}`)), h("td", { class: "muted" }, sample(c).slice(0, 40)), h("td", null, sel));
    });
    body.append(h("section", { class: "card" }, h("h2", null, t("step_map")),
      h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, t("column")), h("th", null, t("sample")), h("th", null, t("maps_to")))), h("tbody", null, rows)))),
      err,
      h("div", { class: "form-actions" }, h("button", { class: "btn", type: "button", onclick: () => go(1) }, t("back")),
        h("button", { class: "btn primary", type: "button", onclick: () => {
          if (S.mapping.name_ar === undefined && S.mapping.name_en === undefined) { err.textContent = t("need_name_column"); return; }
          api.put("/api/import/mapping", { headers: S.labels, mapping: S.mapping }).catch(() => {});
          S.preview = null; go(3);
        } }, t("run_preview"))));
  }

  // ---- step 3
  async function stepPreview() {
    body.append(h("div", { class: "loading" }, t("loading")));
    try { S.preview = S.preview || await api.post("/api/import/preview", { rows: S.data, mapping: S.mapping, asOf: S.asOf }); }
    catch (e) { clear(body).append(h("div", { class: "note bad" }, errText(e)), h("button", { class: "btn", type: "button", onclick: () => go(2) }, t("back"))); return; }
    clear(body);
    const P = S.preview;
    const cols = ["emp_no", "name_ar", "name_en", "department", "manager", "join_date", "opening_days"].filter((f) => f === "emp_no" || S.mapping[f] !== undefined);
    const firstData = S.start + S.count + 1;
    const table = h("tbody");
    const draw = () => table.replaceChildren(...P.rows.filter((r) => !S.onlyErrors || r.errors.length).map((r) => {
      const bad = new Set(r.errors.map((e) => e.field));
      return h("tr", { class: r.errors.length ? "has-err" : null },
        h("td", { class: "num" }, firstData + r.row),
        cols.map((f) => h("td", { class: bad.has(f) ? "cell-err" : null }, f.endsWith("date") ? dmy(r.values[f]) : f === "opening_days" && r.values[f] != null ? num(r.values[f]) : r.values[f] ?? "")),
        h("td", null, r.errors.map((e) => h("span", { class: "issue err" }, t("ic_" + e.code))), r.warnings.map((w) => h("span", { class: "issue warn" }, t("ic_" + w.code)))));
    }));
    draw();
    const logins = h("label", { class: "row" }, h("input", { type: "checkbox", checked: S.createLogins, onchange: (e) => { S.createLogins = e.target.checked; } }), t("create_logins"));
    body.append(
      h("div", { class: "grid tiles" },
        h("div", { class: "card tile good" }, h("div", { class: "n" }, num(P.summary.ok)), h("div", { class: "l" }, t("rows_ok"))),
        h("div", { class: "card tile alert" }, h("div", { class: "n" }, num(P.summary.errors)), h("div", { class: "l" }, t("rows_err"))),
        h("div", { class: "card tile warn" }, h("div", { class: "n" }, num(P.summary.warnings)), h("div", { class: "l" }, t("rows_warn")))),
      h("p", { class: "sub" }, t("data_rows_found", { n: num(P.summary.total) }), " · ", t("balance_as_of"), " ", dmy(S.asOf)),
      h("label", { class: "row" }, h("input", { type: "checkbox", checked: S.onlyErrors, onchange: (e) => { S.onlyErrors = e.target.checked; draw(); } }), t("only_errors")),
      h("div", { class: "table-wrap keep-table" }, h("table", null, h("thead", null, h("tr", null, h("th", null, "#"), cols.map((f) => h("th", null, t("f_" + f))), h("th", null, t("details")))), table)),
      logins,
      h("div", { class: "form-actions" }, h("button", { class: "btn", type: "button", onclick: () => go(2) }, t("back")),
        h("button", { class: "btn primary", type: "button", disabled: !P.summary.ok, onclick: async (e) => {
          e.target.disabled = true;
          try { S.result = await api.post("/api/import/commit", { rows: S.data, mapping: S.mapping, asOf: S.asOf, createLogins: S.createLogins }); go(4); }
          catch (er) { e.target.disabled = false; toast(errText(er), "bad"); }
        } }, t("import_rows", { n: num(P.summary.ok) }))));
  }

  // ---- step 4
  function stepDone() {
    const R = S.result;
    body.append(h("section", { class: "card" }, h("h2", null, t("import_done", { n: num(R.created) })),
      R.skipped ? h("p", { class: "sub" }, `${t("rows_err")}: ${num(R.skipped)}`) : null,
      R.logins.length ? h("div", { class: "grid", style: { marginTop: "12px" } }, h("div", { class: "note" }, t("logins_note")),
        h("button", { class: "btn gold", type: "button", onclick: () => downloadLogins(R.logins) }, t("download_logins"))) : null),
      h("div", { class: "row" }, h("a", { class: "btn primary", href: "#/staff" }, t("nav_staff")), h("button", { class: "btn", type: "button", onclick: () => render(clear(el), _p, { can }) }, t("import_again"))));
  }

  go(1);
}

function download(name, blob) {
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function downloadLogins(logins) {
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const csv = [["emp_no", "name", "username", "one_time_password"].join(","), ...logins.map((l) => [l.emp_no, nm(l), l.username, l.tempPassword].map(q).join(","))].join("\r\n");
  download(`nama-hr-logins-${todayIso()}.csv`, new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
}
async function downloadTemplate() {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet([FIELDS.map((f) => t("f_" + f))]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Staff");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  download("nama-hr-template.xlsx", new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}
