// ============================================================
// HAN KAFEM - CORE LOGIC (js/core.js)
// Firebase Realtime DB + Google Sheets entegrasyonu
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  browserLocalPersistence,       // ← YENİ
  browserSessionPersistence,     // ← YENİ
  setPersistence                 // ← YENİ

} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  push,
  update,
  remove,
  onValue,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// ─────────────────────────────────────────────
// 1. FIREBASE YAPILANDIRMASI
// ─────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDvJoehfhKmew2RTJT3AjmavDJI6RE-QGU",
  authDomain: "han-kafem.firebaseapp.com",
  databaseURL: "https://han-kafem-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "han-kafem",
  storageBucket: "han-kafem.firebasestorage.app",
  messagingSenderId: "87710897067",
  appId: "1:87710897067:web:5d9ada18b9f2c3a5cbf8ee",
  measurementId: "G-YLC90BZW0X"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

setPersistence(auth, browserLocalPersistence).catch(() => {});

// ─────────────────────────────────────────────
// 2. UYGULAMA DURUMU (STATE)
// ─────────────────────────────────────────────
export const AppState = {
  currentUser: null,
  menuItems:   [],
  tables:      {},
  orders:      {},
  listeners:   [],
  starredItems: {},
};

// ─────────────────────────────────────────────
// 3. AUTHENTICATION
// ─────────────────────────────────────────────

// Kullanıcı adını Firebase'in beklediği e-posta formatına çevirir.
const DUMMY_DOMAIN = "@hankafem.com";
function toEmail(username) {
  const u = username.trim().toLowerCase();
  return u.includes("@") ? u : u + DUMMY_DOMAIN;
}

export async function login(username, password, rememberMe = true) {
  const email       = toEmail(username);
  const persistence = rememberMe ? browserLocalPersistence : browserSessionPersistence;
  await setPersistence(auth, persistence);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const uid  = cred.user.uid;
  const snapshot = await get(ref(db, `users/${uid}`));
  if (!snapshot.exists()) throw new Error("Kullanıcı profili bulunamadı.");
  const userData = snapshot.val();
  AppState.currentUser = { uid, email, ...userData };
  return AppState.currentUser;
}

/**
 * Yeni kullanıcı kaydı.
 * @param {string} fullName   - Ad Soyad
 * @param {string} username   - Kullanıcı adı (örn: "ahmet")
 * @param {string} password   - Şifre (min 6 karakter)
 * Varsayılan rol: "waiter"
 */
export async function register(fullName, username, password) {
  if (!fullName.trim()) throw new Error("Ad Soyad boş olamaz.");
  if (!username.trim()) throw new Error("Kullanıcı adı boş olamaz.");
  if (password.length < 6) throw new Error("Şifre en az 6 karakter olmalıdır.");

  const email = toEmail(username);
  const cred  = await createUserWithEmailAndPassword(auth, email, password);
  const uid   = cred.user.uid;

  const userData = {
  email,
  displayName: fullName.trim(),
  role: "pending"
};

  await set(ref(db, `users/${uid}`), userData);
  AppState.currentUser = { uid, ...userData };
  return AppState.currentUser;
}

export async function logout() {
  cleanupListeners();
  AppState.menuItems   = [];
  AppState.tables      = {};
  AppState.orders      = {};
  AppState.currentUser = null;
  await signOut(auth);
}

export function watchAuthState(onLoggedIn, onLoggedOut) {
  onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      try {
        const snap = await get(ref(db, `users/${firebaseUser.uid}`));
        if (snap.exists()) {
         const userData = snap.val();
          AppState.currentUser = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          ...userData
        };

      // Pending kullanıcıyı engelle
      if (userData.role === "pending") {
      await signOut(auth);
      AppState.currentUser = null;
      // app.js tarafındaki onLoggedOut çalışacak, login ekranına döner
      onLoggedOut("pending");
      return;
      }
          onLoggedIn(AppState.currentUser);
        } else {
          onLoggedOut();
        }
      } catch {
        onLoggedOut();
      }
    } else {
      onLoggedOut();
    }
  });
}

// ─────────────────────────────────────────────
// 4. GOOGLE SHEETS MENÜ ÇEKME
// ─────────────────────────────────────────────
const SHEETS_URL = "https://opensheet.elk.sh/106UdRlB66eCxZAdrxtyKCynb3UTrvoEpObLvRYjzlrI/Sayfa1";

export async function fetchMenu() {
  try {
    const res = await fetch(SHEETS_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Sheets yanıtı: ${res.status}`);
    const raw = await res.json();

    AppState.menuItems = raw
      .map(row => {
        const name      = String(row.name || "").trim();
        const category  = String(row.category || "").trim();
        const activeStr = String(row.active || "").trim().toLowerCase();
        // ÖZELLİK: "pinned" sütununu oku — "true" ise öne çıkanlara alınır
        const pinnedStr = String(row.pinned || "").trim().toLowerCase();
        return {
          id:          row.id ? String(row.id).trim() : slugify(name || "bosisim"),
          name,
          category,
          price:       parseFloat(row.price) || 0,
          description: row.desc || "",
          active:      activeStr === "true",
          pinned:      pinnedStr === "true",
        };
      })
      .filter(item => item.active && item.name !== "" && item.category !== "" && item.price > 0);

    console.log(`✅ Menü yüklendi: ${AppState.menuItems.length} ürün`);
    return AppState.menuItems;
  } catch (err) {
    console.error("❌ Menü çekme hatası:", err);
    throw err;
  }
}

/**
 * Menüyü kategorilere göre gruplar.
 * Sheets'teki "pinned=true" olan ürünler en üste "⭐ Öne Çıkanlar" kategorisinde gösterilir.
 */
export function getMenuByCategory() {
  const grouped = AppState.menuItems.reduce((acc, item) => {
    (acc[item.category] = acc[item.category] || []).push(item);
    return acc;
  }, {});

  // Firebase'den yıldızlı ürünler (Google Sheets pinned yerine)
  const starredIds  = Object.keys(AppState.starredItems || {});
  const starredItems = AppState.menuItems.filter(item => starredIds.includes(item.id));

  if (starredItems.length > 0) {
    const ordered = { "⭐ Öne Çıkanlar": starredItems };
    Object.assign(ordered, grouped);
    return ordered;
  }

  return grouped;
}

// ─────────────────────────────────────────────
// 5. MASA YÖNETİMİ
// ─────────────────────────────────────────────
export async function addTable(tableName) {
  requireRole("admin");
  const newRef = push(ref(db, "tables"));
  await set(newRef, {
    name:      tableName.trim(),
    status:    "empty",
    createdAt: Date.now(),
    createdBy: AppState.currentUser.uid
  });
  return newRef.key;
}

export async function deleteTable(tableId) {
  requireRole("admin");
  const snap = await get(ref(db, `tables/${tableId}`));
  if (!snap.exists()) throw new Error("Masa bulunamadı.");
  if (snap.val().status === "occupied")
    throw new Error("Dolu masayı silemezsiniz. Önce hesabı alın.");
  await remove(ref(db, `tables/${tableId}`));
}

export function watchTables(callback) {
  const tableRef = ref(db, "tables");
  const unsub    = onValue(tableRef, (snap) => {
    AppState.tables = snap.val() || {};
    callback(AppState.tables);
  });
  AppState.listeners.push(unsub);
  return unsub;
}

// Masa Taşıma — siparişleri bir masadan diğerine aktarır
export async function moveTable(fromTableId, toTableId) {
  requireRole(["admin", "cashier", "waiter"]);

  const [fromSnap, toSnap, ordersSnap] = await Promise.all([
    get(ref(db, `tables/${fromTableId}`)),
    get(ref(db, `tables/${toTableId}`)),
    get(ref(db, `orders/${fromTableId}`))
  ]);

  if (!fromSnap.exists()) throw new Error("Kaynak masa bulunamadı.");
  if (!toSnap.exists())   throw new Error("Hedef masa bulunamadı.");
  if (toSnap.val().status === "occupied")
    throw new Error("Hedef masa dolu. Lütfen boş bir masa seçin.");

  const orders      = ordersSnap.val() || {};
  const fromTable   = fromSnap.val();
  const toTable     = toSnap.val();

  const updates = {
    [`orders/${toTableId}`]:   orders,
    [`orders/${fromTableId}`]: null,
    [`tables/${toTableId}/status`]:     fromTable.status,
    [`tables/${toTableId}/totalPrice`]: fromTable.totalPrice || 0,
    [`tables/${toTableId}/openedAt`]:   fromTable.openedAt   || Date.now(),
    [`tables/${toTableId}/openedBy`]:   fromTable.openedBy   || AppState.currentUser.uid,
    [`tables/${fromTableId}/status`]:     "empty",
    [`tables/${fromTableId}/totalPrice`]: 0,
    [`tables/${fromTableId}/openedAt`]:   null,
    [`tables/${fromTableId}/openedBy`]:   null,
  };

  await update(ref(db), updates);
  return { fromName: fromTable.name, toName: toTable.name };
}

// ─────────────────────────────────────────────
// 6. SİPARİŞ YÖNETİMİ
// ─────────────────────────────────────────────
export async function addOrderItem(tableId, product, quantity = 1) {
  if (quantity < 1) return removeOrderItem(tableId, product.id);

  const tableOrdersRef = ref(db, `orders/${tableId}`);
  const snap    = await get(tableOrdersRef);
  const existing = snap.val() || {};

  const existingKey = Object.keys(existing).find(
    k => existing[k].productId === product.id
  );

  const orderData = {
    productId:   product.id,
    productName: product.name,
    category:    product.category,
    quantity,
    unitPrice:   product.price,
    totalPrice:  +(product.price * quantity).toFixed(2),
    addedAt:     Date.now(),
    addedBy:     AppState.currentUser.uid,
    addedByName: AppState.currentUser.displayName || AppState.currentUser.email || "İsimsiz Kullanıcı",
    note:        ""
  };

  if (existingKey) {
    await update(ref(db, `orders/${tableId}/${existingKey}`), orderData);
  } else {
    await push(ref(db, `orders/${tableId}`), orderData);
  }

  await recalculateTableTotal(tableId);
}

export async function removeOrderItem(tableId, productId) {
  const snap = await get(ref(db, `orders/${tableId}`));
  if (!snap.exists()) return;
  const orders = snap.val();
  const keyToDelete = Object.keys(orders).find(k => orders[k].productId === productId);
  if (!keyToDelete) return;
  await remove(ref(db, `orders/${tableId}/${keyToDelete}`));
  await recalculateTableTotal(tableId);
}

async function recalculateTableTotal(tableId) {
  const snap   = await get(ref(db, `orders/${tableId}`));
  const orders = snap.val() || {};
  const total  = Object.values(orders)
    .reduce((sum, item) => sum + (item.totalPrice || 0), 0);

  const updates = {
    [`tables/${tableId}/totalPrice`]: +total.toFixed(2),
    [`tables/${tableId}/status`]:     total > 0 ? "occupied" : "empty",
  };

  const tableSnap = await get(ref(db, `tables/${tableId}`));
  if (tableSnap.val()?.status === "empty" && total > 0) {
    updates[`tables/${tableId}/openedAt`] = Date.now();
    updates[`tables/${tableId}/openedBy`] = AppState.currentUser.uid;
  }

  await update(ref(db), updates);
}

export function watchTableOrders(tableId, callback) {
  const ordersRef = ref(db, `orders/${tableId}`);
  const unsub = onValue(ordersRef, (snap) => {
    const data = snap.val() || {};
    AppState.orders[tableId] = data;
    callback(data);
  });
  AppState.listeners.push(unsub);
  return unsub;
}

// ─────────────────────────────────────────────
// 7. MASA KAPATMA (HESAP ALMA)
// ─────────────────────────────────────────────
export async function closeTable(tableId) {
  requireRole(["admin", "cashier"]);

  const [tableSnap, ordersSnap] = await Promise.all([
    get(ref(db, `tables/${tableId}`)),
    get(ref(db, `orders/${tableId}`))
  ]);

  if (!tableSnap.exists()) throw new Error("Masa bulunamadı.");

  const table  = tableSnap.val();
  const orders = ordersSnap.val() || {};
  const total  = Object.values(orders)
    .reduce((sum, item) => sum + (item.totalPrice || 0), 0);

  const today   = new Date().toISOString().split("T")[0];
  const histKey = push(ref(db, `history/${today}`)).key;

  const historyEntry = {
    tableName:    table.name,
    tableId,
    openedAt:     table.openedAt  || Date.now(),
    closedAt:     Date.now(),
    closedBy:     AppState.currentUser.uid,
    closedByName: AppState.currentUser.displayName || AppState.currentUser.email || "İsimsiz Kullanıcı",
    totalAmount:  +total.toFixed(2),
    itemCount:    Object.keys(orders).length,
    items:        orders,
    paymentType:  "full"
  };

  const updates = {
    [`history/${today}/${histKey}`]: historyEntry,
    [`orders/${tableId}`]:           null,
    [`tables/${tableId}/status`]:    "empty",
    [`tables/${tableId}/totalPrice`]: 0,
    [`tables/${tableId}/openedAt`]:  null,
    [`tables/${tableId}/openedBy`]:  null,
  };

  await update(ref(db), updates);
  return historyEntry;
}

// ─────────────────────────────────────────────
// Hesabı Bölme — KISMİ ADET DESTEĞİ
// Seçilen sipariş kalemlerinde belirtilen adeti öde, masada kalan bırak.
// @param {string} tableId
// @param {Array<{key: string, qty: number}>} selections
//   key  → sipariş Firebase anahtarı
//   qty  → ödenmek istenen adet (≥1, ≤item.quantity)
// ─────────────────────────────────────────────
export async function paySelectedItems(tableId, selections) {
  requireRole(["admin", "cashier"]);

  const [tableSnap, ordersSnap] = await Promise.all([
    get(ref(db, `tables/${tableId}`)),
    get(ref(db, `orders/${tableId}`))
  ]);

  if (!tableSnap.exists()) throw new Error("Masa bulunamadı.");

  const table  = tableSnap.val();
  const orders = ordersSnap.val() || {};

  if (!selections || selections.length === 0)
    throw new Error("Ödenecek ürün seçilmedi.");

  // Tarihçe için ödenen kalemleri kaydet
  const paidItems = {};
  let selectedTotal = 0;

  const updates = {};

  selections.forEach(({ key, qty }) => {
    const item = orders[key];
    if (!item) return;

    const payQty  = Math.min(Math.max(1, qty), item.quantity); // 1 ≤ payQty ≤ mevcut
    const remain  = item.quantity - payQty;
    const unitPrice = item.unitPrice || 0;

    // Tarihçeye eklenecek kalem
    paidItems[key] = {
      ...item,
      quantity:   payQty,
      totalPrice: +(unitPrice * payQty).toFixed(2),
    };
    selectedTotal += unitPrice * payQty;

    if (remain <= 0) {
      // Tüm adedi ödendi → siparişten tamamen kaldır
      updates[`orders/${tableId}/${key}`] = null;
    } else {
      // Kısmi ödeme → kalan adeti güncelle
      updates[`orders/${tableId}/${key}/quantity`]   = remain;
      updates[`orders/${tableId}/${key}/totalPrice`] = +(unitPrice * remain).toFixed(2);
    }
  });

  if (Object.keys(paidItems).length === 0)
    throw new Error("Ödenecek geçerli ürün bulunamadı.");

  const today   = new Date().toISOString().split("T")[0];
  const histKey = push(ref(db, `history/${today}`)).key;

  const historyEntry = {
    tableName:    table.name,
    tableId,
    openedAt:     table.openedAt  || Date.now(),
    closedAt:     Date.now(),
    closedBy:     AppState.currentUser.uid,
    closedByName: AppState.currentUser.displayName || AppState.currentUser.email || "İsimsiz",
    totalAmount:  +selectedTotal.toFixed(2),
    itemCount:    Object.keys(paidItems).length,
    items:        paidItems,
    paymentType:  "partial"
  };

  updates[`history/${today}/${histKey}`] = historyEntry;

  await update(ref(db), updates);

  // Kalan siparişler için masa toplamını yeniden hesapla
  await recalculateTableTotal(tableId);

  return { ...historyEntry, selectedTotal: +selectedTotal.toFixed(2) };
}

// ─────────────────────────────────────────────
// 8. GEÇMİŞ SİPARİŞLER & GÜN SONU CİROSU
// ─────────────────────────────────────────────
export async function getHistoryByDate(date) {
  requireRole(["admin", "cashier"]);
  const snap = await get(ref(db, `history/${date}`));
  return snap.val() || {};
}

export async function getDailyRevenue(date) {
  const history  = await getHistoryByDate(date);
  const sessions = Object.values(history);
  return {
    date,
    total:        +sessions.reduce((s, h) => s + h.totalAmount, 0).toFixed(2),
    sessionCount: sessions.length,
    itemCount:    sessions.reduce((s, h) => s + h.itemCount, 0),
    sessions
  };
}

// Gelişmiş Gün Sonu Raporu — ürün bazlı satış özeti
export async function getDailySalesSummary(date) {
  requireRole(["admin", "cashier"]);
  const history  = await getHistoryByDate(date);
  const sessions = Object.values(history);

  const productSales = {};
  let grandTotal = 0;

  sessions.forEach(session => {
    grandTotal += session.totalAmount || 0;
    const items = session.items || {};
    Object.values(items).forEach(item => {
      const id = item.productId || item.productName;
      if (!productSales[id]) {
        productSales[id] = {
          productName: item.productName,
          category:    item.category || "-",
          quantity:    0,
          totalRevenue: 0,
          unitPrice:   item.unitPrice || 0
        };
      }
      productSales[id].quantity     += item.quantity || 1;
      productSales[id].totalRevenue += item.totalPrice || 0;
    });
  });

  const productList = Object.values(productSales)
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  return {
    date,
    grandTotal:   +grandTotal.toFixed(2),
    sessionCount: sessions.length,
    products:     productList
  };
}

// ─────────────────────────────────────────────
// Mutfak Bildirim Sistemi
// ─────────────────────────────────────────────
export async function sendKitchenNotification(tableId, tableName, orders) {
  const notifRef = push(ref(db, "notifications"));
  const items = Object.values(orders).map(o => ({
    name: o.productName,
    qty:  o.quantity
  }));

  await set(notifRef, {
    tableId,
    tableName,
    items,
    sentAt:    Date.now(),
    sentBy:    AppState.currentUser.uid,
    sentByName: AppState.currentUser.displayName || AppState.currentUser.email,
    status:    "pending"
  });

  return notifRef.key;
}

export async function markNotificationReady(notifKey) {
  await remove(ref(db, `notifications/${notifKey}`));
}

export function watchNotifications(callback) {
  const notifRef = ref(db, "notifications");
  const unsub    = onValue(notifRef, (snap) => {
    callback(snap.val() || {});
  });
  AppState.listeners.push(unsub);
  return unsub;
}

// ─────────────────────────────────────────────
// Kullanıcı Yetki Yönetimi
// ─────────────────────────────────────────────
export async function getAllUsers() {
  requireRole("admin");
  const snap = await get(ref(db, "users"));
  return snap.val() || {};
}

export async function updateUserRole(uid, newRole) {
  requireRole("admin");
  const validRoles = ["admin", "cashier", "waiter","pending"];
  if (!validRoles.includes(newRole)) throw new Error("Geçersiz rol.");
  await update(ref(db, `users/${uid}`), { role: newRole });
}

// ─────────────────────────────────────────────
// YARDIMCI FONKSİYONLAR
// ─────────────────────────────────────────────
function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!AppState.currentUser) throw new Error("Oturum açılmamış.");
  if (!allowed.includes(AppState.currentUser.role))
    throw new Error(`Bu işlem için yetkiniz yok. Gerekli rol: ${allowed.join(" veya ")}`);
}

function slugify(text) {
  if (!text) return `id_${Date.now()}`;
  return String(text)
    .toLowerCase()
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
    .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]/g, "_");
}

function cleanupListeners() {
  AppState.listeners.forEach(unsub => unsub());
  AppState.listeners = [];
}

export async function changePassword(newPassword) {
  const user = auth.currentUser;
  if (!user) throw new Error("Oturum açılmamış.");
  if (newPassword.length < 6) throw new Error("Şifre en az 6 karakter olmalıdır.");
  await updatePassword(user, newPassword);
}

export async function deleteUserRecord(uid) {
  requireRole("admin");
  if (uid === AppState.currentUser.uid)
    throw new Error("Kendinizi silemezsiniz.");
  await remove(ref(db, `users/${uid}`));
}

// ─────────────────────────────────────────────
// Yıldızlı Ürünler (Firebase settings/starredItems)
// ─────────────────────────────────────────────
export async function getStarredItems() {
  const snap = await get(ref(db, "settings/starredItems"));
  const val  = snap.val();
  if (!val) return {};
  // Hem object hem array formatını destekle
  if (typeof val === "object") return val;
  return {};
}

export async function toggleStarredItem(productId, currentlyStarred) {
  requireRole("admin");
  const itemRef = ref(db, `settings/starredItems/${productId}`);
  if (currentlyStarred) {
    await remove(itemRef);
  } else {
    await set(itemRef, true);
  }
}

export function watchStarredItems(callback) {
  const starRef = ref(db, "settings/starredItems");
  const unsub   = onValue(starRef, (snap) => {
    callback(snap.val() || {});
  });
  AppState.listeners.push(unsub);
  return unsub;
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency", currency: "TRY", minimumFractionDigits: 2
  }).format(amount || 0);
}

export { db, auth };
