// Light / dark: follows the phone or computer until the person picks one; the choice is kept on this device.
// Loaded as a plain script in <head> (before the page draws, so there is no flash) and imported by the app.
(function () {
  const KEY = "hr_theme";
  const media = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const current = () => saved() || (media && media.matches ? "dark" : "light");
  function apply() {
    const s = saved();
    if (s) document.documentElement.setAttribute("data-theme", s); else document.documentElement.removeAttribute("data-theme");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", current() === "dark" ? "#0B1614" : "#154540");
  }
  function toggle() {
    const next = current() === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, next); } catch {}
    apply();
    return next;
  }
  if (media && media.addEventListener) media.addEventListener("change", apply);
  window.hrTheme = { current, toggle, apply };
  apply();
})();
