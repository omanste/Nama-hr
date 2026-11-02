/* Nama HR — shows the portal's pop-up notifications (Web Push) and opens the right page when one is tapped.
 * Nothing is cached here: the app's own files are cached by the browser (versioned). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: e.data ? e.data.text() : "Nama HR" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Nama HR", {
    body: d.body || "", icon: "/icon-192.png", badge: "/icon-192.png", tag: d.tag, renotify: !!d.tag, dir: d.dir || "auto", lang: d.lang,
    data: { link: d.link || "#/" }, actions: (d.actions || []).slice(0, 2),
  }));
});

// a tap on the notification (or one of its buttons): bring the portal forward on that page
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = e.action || (e.notification.data && e.notification.data.link) || "#/";
  const url = new URL("/" + link.replace(/^\//, ""), self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) if (new URL(w.url).origin === self.location.origin) { await w.focus(); try { await w.navigate(url); } catch { w.postMessage({ go: link }); } return; }
    await self.clients.openWindow(url);
  })());
});
