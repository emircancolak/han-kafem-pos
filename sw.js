// ============================================================
// HAN KAFEM — SERVICE WORKER (sw.js)
// Cache-first for shell assets, network-first for data
// ============================================================

const CACHE_NAME   = "hankafem-v5"; // ← Her büyük güncellemede bunu artır (v5, v6...)
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/core.js",
  "./js/app.js",
  "./manifest.json",
];

// Kurulum
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Aktivasyon: eski cache'leri temizle
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  if (
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("opensheet.elk.sh") ||
    url.hostname.includes("cdnjs.cloudflare.com") ||
    url.hostname.includes("fonts.googleapis.com") ||
    url.hostname.includes("fonts.gstatic.com")
  ) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// Push Notification
self.addEventListener("push", (e) => {
  let data = { title: "Han Kafem", body: "Yeni mutfak bildirimi!" };
  try {
    if (e.data) data = e.data.json();
  } catch {}

  e.waitUntil(
    self.registration.showNotification(data.title || "Han Kafem", {
      body:    data.body    || "Yeni sipariş bildirimi",
      icon:    "/icons/icon-192.png",
      badge:   "/icons/icon-192.png",
      tag:     "kitchen-notification",
      data:    data,
      actions: [
        { action: "ready", title: "✓ Hazır" },
        { action: "dismiss", title: "Kapat" }
      ],
      requireInteraction: true
    })
  );
});

// Bildirim tıklama
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  if (e.action === "dismiss") return;

  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then(clientList => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return self.clients.openWindow("/");
    })
  );
});

// Mesaj dinleyici (Mutfak + Güncelleme)
self.addEventListener("message", (e) => {
  if (e.data?.type === "KITCHEN_NOTIFICATION") {
    const { tableName, items } = e.data.payload || {};
    const bodyText = items?.map(i => `${i.qty}x ${i.name}`).join(", ") || "Sipariş hazır";

    self.registration.showNotification(`🍳 ${tableName} — Yeni Sipariş`, {
      body:    bodyText,
      icon:    "/icons/icon-192.png",
      tag:     `kitchen-${tableName}`,
      requireInteraction: true
    });
  }

  // Service Worker güncelleme için
  if (e.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});