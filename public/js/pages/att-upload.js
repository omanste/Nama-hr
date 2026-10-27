// HR uploads the fingerprint machine's export (Excel or CSV). The page reads it here, sends only the punches,
// then each machine number is linked to a person once (a name match is suggested; HR confirms) or set aside.
import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, clear, select, pageHead, empty, num, dmy, dateTime, toast, errText, backLink } from "../ui.js";
import { parseWorkbook } from "../sheet.js";
import { readPunches } from "../punches.js";
import { render as rerender } from "../app.js";

function loadXlsx() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s = document.createElement("script"); s.src = "/vendor/xlsx.full.min.js"; s.onload = () => resolve(window.XLSX); s.onerror = reject; document.head.append(s);
  });
}

export async function render(el, _p, { can }) {
  if (!can.edit()) throw { status: 403 };
  const [dev, ups] = await Promise.all([api.get("/api/attendance/devices"), api.get("/api/attendance/uploads")]);
  const status = h("div", { "aria-live": "polite" });
  const input = h("input", { type: "file", accept: ".xls,.xlsx,.csv", onchange: async () => {
    const f = input.files[0]; if (!f) return;
    clear(status).append(h("p", { class: "sub" }, t("loading")));
    try {
      const XLSX = await loadXlsx();
      const wb = parseWorkbook(XLSX, new Uint8Array(await f.arrayBuffer()), f.name);
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
      const r = readPunches(rows);
      if (r.error) { clear(status).append(h("div", { class: "note bad" }, t("att_file_columns"))); return; }
      if (!r.punches.length) { clear(status).append(h("div", { class: "note bad" }, t("att_file_empty"))); return; }
      const res = await api.post("/api/attendance/upload", { name: f.name, punches: r.punches });
      toast(t("saved"));
      clear(status).append(h("div", { class: "note" }, t("att_uploaded", { n: num(res.rows), a: num(res.added), d: num(res.duplicates), f: dmy(res.from), to: dmy(res.to) }),
        r.skipped ? ` · ${t("att_skipped", { n: num(r.skipped) })}` : "", res.unlinked ? h("div", null, h("b", null, t("att_link_now", { n: num(res.unlinked) }))) : null));
      setTimeout(rerender, 1500);
    } catch (e) { clear(status).append(h("div", { class: "note bad" }, errText(e))); }
  } });

  const people = [["", t("att_choose_person")], ...dev.employees.map((e) => [e.id, `${nm(e)} · ${e.emp_no}`])];
  const row = (d) => {
    const sel = select("employee_id", people, d.employee_id || (d.suggestion && d.suggestion.id) || "", { "aria-label": t("employee") });
    const save = (body) => async () => { try { await api.put(`/api/attendance/devices/${encodeURIComponent(d.machine_no)}`, body); toast(t("saved")); rerender(); } catch (e) { toast(errText(e), "bad"); } };
    return h("tr", { class: d.employee_id || d.ignored ? null : "warn-row" },
      h("td", { class: "num" }, h("b", null, d.machine_no)),
      h("td", null, d.machine_name || "—"),
      h("td", { class: "num" }, num(d.punches)), h("td", null, `${dmy(d.first_date)} – ${dmy(d.last_date)}`),
      h("td", null, d.ignored ? h("span", { class: "muted" }, t("att_set_aside")) : sel,
        !d.employee_id && !d.ignored && d.suggestion ? h("div", { class: "muted" }, t("att_suggested")) : null),
      h("td", null, h("div", { class: "row" },
        d.ignored ? h("button", { class: "btn small", type: "button", onclick: save({ ignored: false }) }, t("att_restore"))
          : h("button", { class: "btn small primary", type: "button", onclick: () => sel.value ? save({ employee_id: Number(sel.value) })() : toast(t("att_choose_person"), "bad") }, t("save")),
        !d.ignored ? h("button", { class: "btn small", type: "button", onclick: save({ ignored: true }) }, t("att_set_aside_btn")) : null)));
  };
  const unlinked = dev.items.filter((d) => !d.employee_id && !d.ignored).length;

  el.append(backLink("#/attendance/report"), pageHead(t("nav_att_upload")),
    h("section", { class: "card" }, h("h2", null, t("att_upload_title")), h("p", { class: "sub" }, t("att_upload_hint")),
      h("label", { class: "btn primary", style: { cursor: "pointer" } }, "⬆ ", t("att_choose_file"), h("span", { hidden: true }, input)), status),
    h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", null, t("att_devices")), unlinked ? h("span", { class: "badge b-pending" }, t("att_unlinked_n", { n: num(unlinked) })) : null),
      h("p", { class: "sub" }, t("att_devices_hint")),
      dev.items.length ? h("div", { class: "table-wrap" }, h("table", null,
        h("thead", null, h("tr", null, [t("att_machine_no"), t("att_machine_name"), t("att_punches"), t("period"), t("employee"), ""].map((x) => h("th", null, x)))),
        h("tbody", null, dev.items.map(row)))) : empty(t("att_no_uploads"))),
    h("section", { class: "card" }, h("h2", null, t("att_uploads")),
      ups.items.length ? h("div", { class: "list" }, ups.items.map((u) => h("div", { class: "item" }, h("div", { class: "grow" }, h("div", { class: "title" }, u.name || "—"),
        h("div", { class: "meta" }, `${dmy(u.from_date)} – ${dmy(u.to_date)} · ${t("att_uploaded_short", { n: num(u.rows), a: num(u.added) })} · ${dateTime(u.uploaded_at)} · ${u.username || ""}`))))) : empty(t("att_no_uploads"))));
}
