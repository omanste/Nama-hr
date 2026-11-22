// One PDF preview for every HR report: the PDF's pages in a pop-up (scroll, zoom, "2 / 5"), with Download (exactly the
// file shown), Print and Close; the report's own options (source, month, period…) sit at the top and redraw the preview.
// Desktop: a large centred window; phone: full screen. Esc or the phone's Back button closes it.
import { t } from "./i18n.js";
import { h, num, toast, errText } from "./ui.js";

/**
 * pdfPreview({ title, options: [{ label, control }], make: async (onStep) => ({ blob, images, name }) })
 * `make` builds the PDF from the current option values (it reads the controls itself); `images` are the pages as pictures.
 */
export function pdfPreview({ title, options = [], make }) {
  document.querySelectorAll("dialog.pdfv").forEach((d) => d.close());
  let cur = null, zoom = 1, busy = false, closed = false;
  const pagesBox = h("div", { class: "pdfv-pages", tabindex: "0" });
  const counter = h("span", { class: "pdfv-count", "aria-live": "polite" }, "…");
  const zoomText = h("span", { class: "pdfv-zoom" }, "100%");
  const status = h("div", { class: "pdfv-status", "aria-live": "polite" });
  const dl = h("button", { class: "btn primary", type: "button", disabled: true, onclick: () => cur && save(cur.blob, cur.name) }, "⬇️ ", t("pv_download"));
  const pr = h("button", { class: "btn", type: "button", disabled: true, onclick: () => cur && print(cur.images) }, "🖨️ ", t("pv_print"));
  const setZoom = (z) => { zoom = Math.min(3, Math.max(0.4, Math.round(z * 10) / 10)); zoomText.textContent = `${Math.round(zoom * 100)}%`; pagesBox.style.setProperty("--z", zoom); };
  const opts = options.length ? h("div", { class: "pdfv-opts" }, options.map((o) => h("label", { class: "pdfv-opt" }, h("span", null, o.label), o.control))) : null;
  const dlg = h("dialog", { class: "pdfv", "aria-label": title },
    h("div", { class: "pdfv-head" },
      h("b", { class: "pdfv-title" }, title),
      h("div", { class: "pdfv-tools" },
        h("button", { class: "btn small", type: "button", "aria-label": t("pv_zoom_out"), title: t("pv_zoom_out"), onclick: () => setZoom(zoom - 0.2) }, "−"), zoomText,
        h("button", { class: "btn small", type: "button", "aria-label": t("pv_zoom_in"), title: t("pv_zoom_in"), onclick: () => setZoom(zoom + 0.2) }, "+"),
        counter, dl, pr,
        h("button", { class: "btn", type: "button", onclick: () => close() }, "✕ ", t("pv_close")))),
    opts, status, pagesBox);
  // the page counter follows the page most in view
  pagesBox.addEventListener("scroll", () => {
    if (!cur) return;
    const imgs = [...pagesBox.querySelectorAll("img")], mid = pagesBox.scrollTop + pagesBox.clientHeight / 3;
    let i = imgs.findIndex((im) => im.offsetTop + im.offsetHeight > mid); if (i < 0) i = imgs.length - 1;
    counter.textContent = `${num(i + 1)} / ${num(imgs.length)}`;
  });
  async function build() {
    if (busy) return; busy = true;
    dl.disabled = pr.disabled = true; status.textContent = t("loading");
    try {
      const r = await make((n, of) => { status.textContent = t("pdf_making", { n: num(n), of: num(of) }); });
      if (closed) return;
      cur = r;
      pagesBox.replaceChildren(...r.images.map((src, i) => h("img", { src, alt: t("pdf_page", { n: num(i + 1), of: num(r.images.length) }), class: "pdfv-page" })));
      counter.textContent = `${num(1)} / ${num(r.images.length)}`; pagesBox.scrollTop = 0;
      status.textContent = ""; dl.disabled = pr.disabled = false;
    } catch (e) { cur = null; pagesBox.replaceChildren(); status.textContent = errText(e); }
    finally { busy = false; }
  }
  for (const o of options) o.control.addEventListener("change", build);
  // Back on a phone closes the preview, not the page under it
  history.pushState({ pdfv: true }, "");
  const onPop = () => close(true);
  addEventListener("popstate", onPop);
  function close(fromBack = false) {
    if (closed) return; closed = true;
    removeEventListener("popstate", onPop);
    if (dlg.open) dlg.close();
    dlg.remove();
    if (!fromBack && history.state && history.state.pdfv) history.back();
  }
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); }); // Esc
  document.body.append(dlg); dlg.showModal(); setZoom(1);
  build();
  return { close, refresh: build };
}

function save(blob, name) {
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
/** Print the pages as shown: each picture on its own A4 landscape sheet. */
function print(images) {
  const f = h("iframe", { class: "pdfv-print", title: "print", style: { position: "fixed", width: "0", height: "0", border: "0", right: "0", bottom: "0" } });
  document.body.append(f);
  const d = f.contentDocument;
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4 landscape;margin:0}html,body{margin:0}img{display:block;width:100%;height:auto;page-break-after:always;break-after:page}img:last-child{page-break-after:auto;break-after:auto}</style></head><body>${images.map((s) => `<img src="${s}">`).join("")}</body></html>`);
  d.close();
  // after the print window, the preview has the keyboard again (Esc closes it)
  const go = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast(errText(e), "bad"); } setTimeout(() => { window.focus(); const d2 = document.querySelector("dialog.pdfv .btn.primary"); if (d2) d2.focus(); }, 200); setTimeout(() => f.remove(), 60000); };
  const imgs = [...d.images];
  Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; })))).then(() => setTimeout(go, 50));
}
