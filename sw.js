// ============================================================
// HAN KAFEM — SERVICE WORKER (sw.js)
// Cache-first for shell assets, network-first for data
// YENİ ÖZELLİK: Mutfak Bildirim Sistemi — push notification desteği
// ============================================================

const CACHE_NAME   = "hankafem-v2";
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

// Fetch: App shell → cache-first | Dış API → network-first
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
    return; // Varsayılan network davranışı
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// YENİ ÖZELLİK: Mutfak Bildirim Sistemi — Web Push bildirimi al
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

// YENİ ÖZELLİK: Mutfak Bildirim Sistemi — bildirim tıklaması
self.addEventListener("notificationclick", (e) => {
  e.notification.close();

  if (e.action === "dismiss") return;

  // Uygulamayı öne getir veya aç
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then(clientList => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return self.clients.openWindow("/");
    })
  );
});

// YENİ ÖZELLİK: Mutfak Bildirim Sistemi — uygulama içi mesaj dinleyici
// app.js'den postMessage ile bildirim tetiklenebilir
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
});
