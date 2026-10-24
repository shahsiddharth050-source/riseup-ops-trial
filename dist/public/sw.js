/* RISEUP OPS: no offline caching (data must always be live); this only lets phones add the app to the home screen. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
/* open the job when a reminder notification is tapped */
self.addEventListener("notificationclick", e => { e.notification.close(); const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => { for (const c of cs) { if ("focus" in c) { c.navigate ? c.navigate(url).catch(() => {}) : null; return c.focus(); } } return self.clients.openWindow(url); })); });
/* reminders sent by the server when the app is closed */
self.addEventListener("push", e => { let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: "RISEUP OPS", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "RISEUP OPS", { body: d.body || "", icon: "/favicon.png", badge: "/favicon.png", data: { url: d.url || "/" }, tag: d.title, requireInteraction: true })); });
