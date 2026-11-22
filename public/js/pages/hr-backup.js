// HR backup & restore (Admin only): the full HR backup (zip) or the settings (json); restore with a preview per section,
// the sections ticked, typed RESTORE; the history of backups and restores, with download.
import { api } from "../api.js";
import { t } from "../i18n.js";
import { h, pageHead, field, toast, errText, num, dateTime, empty } from "../ui.js";
import { render as rerender } from "../app.js";

const SECTIONS = ["settings", "staff", "attendance", "requests", "calendar", "documents"];

/** Download through fetch (the file name comes from the server), so a slow full backup shows that it's working. */
async function download(url, btn) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = t("hb_making");
  try {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw await r.json().catch(() => ({ status: r.status }));
    const name = (/filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "") || [])[1] || "nama-hr-backup";
    const a = h("a", { href: URL.createObjectURL(await r.blob()), download: name });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  } catch (e) { toast(errText(e), "bad"); }
  finally { btn.disabled = false; btn.textContent = label; }
}

export async function render(el, _p, { me }) {
  if (me.user.role !== "admin") throw { status: 403 };
  const photos = h("input", { type: "checkbox", name: "photos", style: { width: "20px", height: "20px", minHeight: "0", flex: "none" } });
  const fullBtn = h("button", { class: "btn primary", type: "button", onclick: () => download(`/api/admin/hr-backup?type=full${photos.checked ? "&photos=1" : ""}`, fullBtn).then(loadHistory) }, "⬇ ", t("hb_full"));
  const setBtn = h("button", { class: "btn", type: "button", onclick: () => download("/api/admin/hr-backup?type=settings", setBtn).then(loadHistory) }, "⬇ ", t("hb_settings"));

  // restore
  const file = h("input", { type: "file", accept: ".zip,.json,application/zip,application/json" });
  const out = h("div");
  const previewBtn = h("button", { class: "btn", type: "button", onclick: async () => {
    const f = file.files[0];
    if (!f) { file.focus(); return; }
    previewBtn.disabled = true;
    try { showPreview(await api.upload("/api/admin/hr-backup/preview", f)); } catch (e) { toast(errText(e), "bad"); out.replaceChildren(); }
    finally { previewBtn.disabled = false; }
  } }, "🔍 ", t("hb_preview"));
  function showPreview(p) {
    const H = p.header;
    const ticks = {};
    const rows = SECTIONS.filter((s) => p.available.includes(s)).map((s) => {
      const c = p.preview[s] || {};
      ticks[s] = h("input", { type: "checkbox", checked: true, "aria-label": t("hb_s_" + s), style: { width: "20px", height: "20px", minHeight: "0" } });
      return h("tr", null, h("td", null, h("label", { class: "row", style: { gap: "8px", flexWrap: "nowrap" } }, ticks[s], t("hb_s_" + s))),
        ...["added", "changed", "unchanged", "skipped"].map((k) => h("td", { class: "num" }, c[k] ? h("b", { class: k === "skipped" ? "bad-text" : null }, num(c[k])) : "0")));
    });
    const word = h("input", { name: "confirm", dir: "ltr", autocomplete: "off", placeholder: "RESTORE", style: { maxWidth: "200px" } });
    const apply = h("button", { class: "btn danger", type: "button", onclick: async () => {
      if (word.value.trim() !== "RESTORE") { toast(t("hb_type"), "bad"); word.focus(); return; }
      const sections = SECTIONS.filter((s) => ticks[s] && ticks[s].checked);
      apply.disabled = true;
      try {
        const r = await api.post("/api/admin/hr-backup/restore", { token: p.token, sections, confirm: "RESTORE" });
        out.replaceChildren(h("div", { class: "note" }, "✓ ", t("hb_done")), result(r.result, r.skipped_items));
        loadHistory();
      } catch (e) { toast(errText(e), "bad"); apply.disabled = false; }
    } }, t("hb_apply"));
    out.replaceChildren(h("div", { class: "card", style: { marginTop: "12px" } },
      h("p", { class: "sub" }, t("hb_from", { type: t(H.type === "settings" ? "hb_t_settings" : "hb_t_full"), env: H.env, by: H.created_by || "—", at: dateTime(H.created_at) })),
      h("div", { class: "table-wrap keep-table" }, h("table", null,
        h("thead", null, h("tr", null, h("th", null, t("hb_section")), ...["hb_added", "hb_changed", "hb_unchanged", "hb_skipped"].map((k) => h("th", { class: "num" }, t(k))))),
        h("tbody", null, rows))),
      skippedList(p.skipped),
      h("p", { class: "note" }, t("hb_new_staff_note")),
      h("div", { class: "fields", style: { marginTop: "10px" } }, field(t("hb_type"), word)),
      h("div", { class: "row end" }, apply)));
  }
  const skippedList = (list) => (list && list.length ? h("details", { class: "note bad", open: true }, h("summary", null, `${t("hb_skipped_list")} (${num(list.length)})`),
    h("ul", null, list.slice(0, 200).map((x) => h("li", null, `${t("hb_s_" + x.section)}: ${x.what} — ${x.why}`)))) : null);
  const result = (res, skipped) => h("div", null, h("div", { class: "table-wrap keep-table" }, h("table", null,
    h("thead", null, h("tr", null, h("th", null, t("hb_section")), ...["hb_added", "hb_changed", "hb_unchanged", "hb_skipped"].map((k) => h("th", { class: "num" }, t(k))))),
    h("tbody", null, Object.entries(res).map(([s, c]) => h("tr", null, h("td", null, t("hb_s_" + s)), ...["added", "changed", "unchanged", "skipped"].map((k) => h("td", { class: "num" }, num(c[k] || 0)))))))),
    skippedList(skipped));

  // history
  const hist = h("div");
  async function loadHistory() {
    let items;
    try { ({ items } = await api.get("/api/admin/hr-backup/history")); } catch (e) { hist.replaceChildren(empty(errText(e))); return; }
    const total = (c) => Object.values(c || {}).reduce((n, x) => n + (x.records ?? (x.added || 0) + (x.changed || 0)), 0);
    hist.replaceChildren(items.length ? h("div", { class: "list" }, items.map((x) => h("div", { class: "item" },
      h("div", { class: "grow" }, h("div", { class: "title" }, t("hb_k_" + x.kind), " · ", t(x.type === "settings" ? "hb_t_settings" : "hb_t_full"), " · ", x.env || ""),
        h("div", { class: "meta" }, dateTime(x.at), " · ", x.username || "—", " · ", x.sections.map((s) => t("hb_s_" + s)).join("، "), " · ", num(total(x.counts)))),
      x.downloadable ? h("button", { class: "btn small", type: "button", onclick: (ev) => download(`/api/admin/hr-backup/history/${x.id}/download`, ev.currentTarget) }, "⬇ ", t("hb_download")) : null))) : empty(t("hb_none")));
  }

  el.append(pageHead(t("hb_title")),
    h("section", { class: "card" }, h("p", { class: "sub" }, t("hb_hint")),
      h("div", { class: "hb-grid" },
        h("div", null, fullBtn, h("p", { class: "sub" }, t("hb_full_hint")), h("label", { class: "row", style: { gap: "8px" } }, photos, t("hb_photos"))),
        h("div", null, setBtn, h("p", { class: "sub" }, t("hb_settings_hint"))))),
    h("section", { class: "card" }, h("h2", null, t("hb_restore")), h("p", { class: "sub" }, t("hb_restore_hint")),
      h("div", { class: "row", style: { gap: "10px" } }, field(t("hb_file"), file), previewBtn), out),
    h("section", { class: "card" }, h("h2", null, t("hb_history")), hist));
  loadHistory();
}
