// ============================================================
// HAN KAFEM - CORE LOGIC (js/core.js)
// Firebase Realtime DB + Google Sheets entegrasyonu
// v3.0 — 8 yeni özellik entegre edildi
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence
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
  serverTimestamp,
  runTransaction
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
  currentUser:  null,
  menuItems:    [],
  tables:       {},
  orders:       {},
  listeners:    [],
  starredItems: {},
  inventory:    {},
  isPinVerified: false,   // YENİ: Stok verileri
};

// ─────────────────────────────────────────────
// 3. AUTHENTICATION
// ─────────────────────────────────────────────
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
  AppState.inventory   = {};
  AppState.currentUser = null;
  AppState.isPinVerified = false;
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
          if (userData.role === "pending") {
            await signOut(auth);
            AppState.currentUser = null;
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
        const pinnedStr = String(row.pinned || "").trim().toLowerCase();
        return {
          id:           row.id ? String(row.id).trim() : slugify(name || "bosisim"),
          name,
          category,
          price:        parseFloat(row.price) || 0,
          description:  row.desc || "",
          active:       activeStr === "true",
          pinned:       pinnedStr === "true",
          // YENİ: Varyasyon desteği — Sheets'te "variations" sütunu: "Az,Orta,Çok" gibi
          variations:   row.variations
            ? String(row.variations).split(",").map(v => v.trim()).filter(Boolean)
            : [],
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

export function getMenuByCategory() {
  const grouped = AppState.menuItems.reduce((acc, item) => {
    (acc[item.category] = acc[item.category] || []).push(item);
    return acc;
  }, {});

  const starredIds   = Object.keys(AppState.starredItems || {});
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

  const orders    = ordersSnap.val() || {};
  const fromTable = fromSnap.val();
  const toTable   = toSnap.val();

  const updates = {
    [`orders/${toTableId}`]:               orders,
    [`orders/${fromTableId}`]:             null,
    [`tables/${toTableId}/status`]:        fromTable.status,
    [`tables/${toTableId}/totalPrice`]:    fromTable.totalPrice || 0,
    [`tables/${toTableId}/openedAt`]:      fromTable.openedAt   || Date.now(),
    [`tables/${toTableId}/openedBy`]:      fromTable.openedBy   || AppState.currentUser.uid,
    [`tables/${fromTableId}/status`]:      "empty",
    [`tables/${fromTableId}/totalPrice`]:  0,
    [`tables/${fromTableId}/openedAt`]:    null,
    [`tables/${fromTableId}/openedBy`]:    null,
  };

  await update(ref(db), updates);
  return { fromName: fromTable.name, toName: toTable.name };
}

// ─────────────────────────────────────────────
// 6. SİPARİŞ YÖNETİMİ
// ─────────────────────────────────────────────

/**
 * addOrderItem — variation ve note desteği eklendi (Madde 6)
 * @param {string} tableId
 * @param {object} product
 * @param {number} quantity
 * @param {object} opts — { variation?: string, note?: string }
 */
export async function addOrderItem(tableId, product, quantity = 1, opts = {}) {
  const tableOrdersRef = ref(db, `orders/${tableId}`);
  const snap = await get(tableOrdersRef);
  const existing = snap.val() || {};

  const searchVariation = String(opts.variation || "").trim();
  const searchNote = String(opts.note || "").trim();

  // En güvenli existingKey araması
  let existingKey = null;
  for (const k of Object.keys(existing)) {
    const item = existing[k];
    if (item.productId === product.id &&
        String(item.variation || "").trim() === searchVariation &&
        String(item.note || "").trim() === searchNote) {
      existingKey = k;
      break;
    }
  }

  // Miktar sıfırlama
  if (quantity < 1) {
    if (existingKey) {
      const itemToRemove = existing[existingKey];
      const qtyToRestore = itemToRemove.quantity || 0;

      if (qtyToRestore > 0) {
        const invRef = ref(db, `inventory/${product.id}`);
        await runTransaction(invRef, (current) => {
          if (!current || current.unlimited) return current;
          return { ...current, quantity: (current.quantity || 0) + qtyToRestore, updatedAt: Date.now() };
        });
      }
      await remove(ref(db, `orders/${tableId}/${existingKey}`));
      await recalculateTableTotal(tableId);
    }
    return;
  }

  const orderData = {
    productId: product.id,
    productName: product.name,
    category: product.category,
    quantity,
    unitPrice: product.price,
    totalPrice: +(product.price * quantity).toFixed(2),
    addedAt: Date.now(),
    addedBy: AppState.currentUser.uid,
    addedByName: AppState.currentUser.displayName || AppState.currentUser.email || "İsimsiz",
    note: searchNote,
    variation: searchVariation,
  };

  const prevQty = existingKey ? (existing[existingKey].quantity || 0) : 0;
  const delta = quantity - prevQty;

 if (delta !== 0) { 
    const invRef = ref(db, `inventory/${product.id}`);
    await runTransaction(invRef, (current) => {
      if (!current || current.unlimited) return current;
      const currentStock = current.quantity || 0;
      
      // Sadece artış varsa stok yetersizliği kontrolü yap
      if (delta > 0 && currentStock < delta) {
        throw new Error(`"${product.name}" için yeterli stok yok.`);
      }
      
      return { ...current, quantity: currentStock - delta, updatedAt: Date.now() };
    });
  }

  if (existingKey) {
    await update(ref(db, `orders/${tableId}/${existingKey}`), orderData);
  } else {
    await push(ref(db, `orders/${tableId}`), orderData);
  }

  await recalculateTableTotal(tableId);
}

/**
 * updateOrderQty — Sipariş panelinden direkt adet güncelleme (Madde 7)
 * Garsonların order-panel'den +/- yapabilmesi için kullanılır.
 */
export async function updateOrderQty(tableId, orderKey, newQty) {
  const orderRef = ref(db, `orders/${tableId}/${orderKey}`);
  const snap = await get(orderRef);
  if (!snap.exists()) return;

  const item = snap.val();
  const oldQty = item.quantity || 0;
  const delta = newQty - oldQty;

  // === STOK GÜNCELLEMESİ (Transaction ile) ===
  if (delta !== 0) {
    const invRef = ref(db, `inventory/${item.productId}`);

    await runTransaction(invRef, (currentData) => {
      if (!currentData || currentData.unlimited === true) {
        return currentData;
      }

      const currentStock = currentData.quantity || 0;

      // Artış varsa stok kontrolü yap
      if (delta > 0 && currentStock < delta) {
        throw new Error(`"${item.productName}" için yeterli stok yok. Mevcut: ${currentStock}`);
      }

      const newStock = Math.max(0, currentStock - delta);
      return {
        ...currentData,
        quantity: newStock,
        updatedAt: Date.now()
      };
    });
  }

  // Sipariş miktarını güncelle
  if (newQty < 1) {
    await remove(orderRef);
  } else {
    await update(orderRef, {
      quantity: newQty,
      totalPrice: +(item.unitPrice * newQty).toFixed(2),
    });
  }

  await recalculateTableTotal(tableId);
}

export async function removeOrderItem(tableId, orderKey) {
  const orderRef = ref(db, `orders/${tableId}/${orderKey}`);
  const snap = await get(orderRef);
  if (!snap.exists()) return;

  const item = snap.val();
  const qtyToRestore = item.quantity || 0;

  // Stok iadesi (güvenli)
  if (qtyToRestore > 0) {
    const invRef = ref(db, `inventory/${item.productId}`);
    await runTransaction(invRef, (current) => {
      if (!current || current.unlimited) return current;
      return {
        ...current,
        quantity: (current.quantity || 0) + qtyToRestore,
        updatedAt: Date.now()
      };
    });
  }

  await remove(orderRef);
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
export async function closeTable(tableId, paymentMethod = "cash") {
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

  const today   = getBusinessDate();
  const histKey = push(ref(db, `history/${today}`)).key;

  const isIkram = paymentMethod === "ikram" || (paymentMethod && paymentMethod.method === "ikram");
  let pm = paymentMethod;
  let breakdown = null;
  if (paymentMethod && typeof paymentMethod === "object" && paymentMethod.method === "karma") {
    pm = "karma";
    breakdown = { cash: paymentMethod.cash, card: paymentMethod.card };
  }
  const historyEntry = {
    tableName:    table.name,
    tableId,
    openedAt:     table.openedAt  || Date.now(),
    closedAt:     Date.now(),
    closedBy:     AppState.currentUser.uid,
    closedByName: AppState.currentUser.displayName || AppState.currentUser.email || "İsimsiz Kullanıcı",
    totalAmount:  isIkram ? 0 : +total.toFixed(2),
    itemCount:    Object.keys(orders).length,
    items:        orders,
    paymentType:     "full",
    paymentMethod:   pm,   // "cash" | "card" | "ikram" | "karma"
    paymentBreakdown: breakdown,
    isIkram:         isIkram || false
  };

  const updates = {
    [`history/${today}/${histKey}`]:  historyEntry,
    [`orders/${tableId}`]:            null,
    [`tables/${tableId}/status`]:     "empty",
    [`tables/${tableId}/totalPrice`]: 0,
    [`tables/${tableId}/openedAt`]:   null,
    [`tables/${tableId}/openedBy`]:   null,
  };

  await update(ref(db), updates);
  return historyEntry;
}

// Hesabı Bölme — KISMİ ADET DESTEĞİ
export async function paySelectedItems(tableId, selections, paymentMethod = "cash") {
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

  const paidItems   = {};
  let selectedTotal = 0;
  const updates     = {};

  selections.forEach(({ key, qty }) => {
    const item = orders[key];
    if (!item) return;

    const payQty    = Math.min(Math.max(1, qty), item.quantity);
    const remain    = item.quantity - payQty;
    const unitPrice = item.unitPrice || 0;

    paidItems[key] = {
      ...item,
      quantity:   payQty,
      totalPrice: +(unitPrice * payQty).toFixed(2),
    };
    selectedTotal += unitPrice * payQty;

    if (remain <= 0) {
      updates[`orders/${tableId}/${key}`] = null;
    } else {
      updates[`orders/${tableId}/${key}/quantity`]   = remain;
      updates[`orders/${tableId}/${key}/totalPrice`] = +(unitPrice * remain).toFixed(2);
    }
  });

  if (Object.keys(paidItems).length === 0)
    throw new Error("Ödenecek geçerli ürün bulunamadı.");

  const today   = getBusinessDate();
  const histKey = push(ref(db, `history/${today}`)).key;

  let pm = paymentMethod;
  let breakdown = null;
  if (paymentMethod && typeof paymentMethod === "object" && paymentMethod.method === "karma") {
    pm = "karma";
    breakdown = { cash: paymentMethod.cash, card: paymentMethod.card };
  }
  const historyEntry = {
    tableName:    table.name,
    tableId,
    openedAt:     table.openedAt || Date.now(),
    closedAt:     Date.now(),
    closedBy:     AppState.currentUser.uid,
    closedByName: AppState.currentUser.displayName || AppState.currentUser.email || "İsimsiz",
    totalAmount:  +selectedTotal.toFixed(2),
    itemCount:    Object.keys(paidItems).length,
    items:        paidItems,
    paymentType:    "partial",
    paymentMethod:  pm,
    paymentBreakdown: breakdown
  };

  updates[`history/${today}/${histKey}`] = historyEntry;

  await update(ref(db), updates);
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

export async function getDailySalesSummary(date) {
  requireRole(["admin", "cashier"]);
  const history  = await getHistoryByDate(date);
  const sessions = Object.values(history);

  const productSales = {};
  let grandTotal = 0;

  sessions.forEach(session => {
    if (session.isIkram || session.paymentMethod === "ikram") return; // İkramları cirodan hariç tut (Madde 3)
    grandTotal += session.totalAmount || 0;
    const items = session.items || {};
    Object.values(items).forEach(item => {
      const id = item.productId || item.productName;
      if (!productSales[id]) {
        productSales[id] = {
          productName:  item.productName,
          category:     item.category || "-",
          quantity:     0,
          totalRevenue: 0,
          unitPrice:    item.unitPrice || 0
        };
      }
      productSales[id].quantity     += item.quantity || 1;
      productSales[id].totalRevenue += item.totalPrice || 0;
    });
  });

  const productList = Object.values(productSales)
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  let cashTotal = 0, cardTotal = 0;
  sessions.forEach(s => {
    if (s.isIkram || s.paymentMethod === "ikram") return;
    if (s.paymentMethod === "karma" && s.paymentBreakdown) {
      cashTotal += s.paymentBreakdown.cash || 0;
      cardTotal += s.paymentBreakdown.card || 0;
    } else if (s.paymentMethod === "card") {
      cardTotal += s.totalAmount || 0;
    } else {
      cashTotal += s.totalAmount || 0;
    }
  });

  return {
    date,
    grandTotal:   +grandTotal.toFixed(2),
    cashTotal:    +cashTotal.toFixed(2),
    cardTotal:    +cardTotal.toFixed(2),
    sessionCount: sessions.length,
    products:     productList
  };
}

// YENİ (Madde 4): Aylık satış özeti — seçilen ayın tüm günlerini toplar
export async function getMonthlySalesSummary(yearMonth) {
  requireRole(["admin", "cashier"]);
  // yearMonth: "2024-11" formatında
  const historySnap = await get(ref(db, "history"));
  const allHistory  = historySnap.val() || {};

  const productSales = {};
  let grandTotal     = 0;
  let sessionCount   = 0;
  const dailyRevenue = {};

  Object.entries(allHistory).forEach(([date, daySessions]) => {
    if (!date.startsWith(yearMonth)) return;
    Object.values(daySessions).forEach(session => {
      if (session.isIkram || session.paymentMethod === "ikram") return; // İkram hariç (Madde 3)
      grandTotal += session.totalAmount || 0;
      sessionCount++;
      dailyRevenue[date] = (dailyRevenue[date] || 0) + (session.totalAmount || 0);

      const items = session.items || {};
      Object.values(items).forEach(item => {
        const id = item.productId || item.productName;
        if (!productSales[id]) {
          productSales[id] = {
            productName:  item.productName,
            category:     item.category || "-",
            quantity:     0,
            totalRevenue: 0,
          };
        }
        productSales[id].quantity     += item.quantity || 1;
        productSales[id].totalRevenue += item.totalPrice || 0;
      });
    });
  });

  let cashTotal = 0, cardTotal = 0;
  Object.entries(allHistory).forEach(([date, daySessions]) => {
    if (!date.startsWith(yearMonth)) return;
    Object.values(daySessions).forEach(s => {
      if (s.isIkram || s.paymentMethod === "ikram") return;
      if (s.paymentMethod === "karma" && s.paymentBreakdown) {
        cashTotal += s.paymentBreakdown.cash || 0;
        cardTotal += s.paymentBreakdown.card || 0;
      } else if (s.paymentMethod === "card") {
        cardTotal += s.totalAmount || 0;
      } else {
        cashTotal += s.totalAmount || 0;
      }
    });
  });

  return {
    yearMonth,
    grandTotal:   +grandTotal.toFixed(2),
    cashTotal:    +cashTotal.toFixed(2),
    cardTotal:    +cardTotal.toFixed(2),
    sessionCount,
    products:     Object.values(productSales).sort((a, b) => b.totalRevenue - a.totalRevenue),
    dailyRevenue,
  };
}

// ─────────────────────────────────────────────
// YENİ (Madde 5): GİDERLER (MUHASEBE)
// ─────────────────────────────────────────────

/**
 * Yeni gider ekle.
 * @param {string} date  — "YYYY-MM-DD"
 * @param {object} expense — { type, amount, note }
 */
export async function addExpense(date, expense) {
  requireRole(["admin", "cashier"]);
  if (!expense.type)   throw new Error("Gider türü boş olamaz.");
  if (!expense.amount || isNaN(expense.amount)) throw new Error("Geçerli bir tutar girin.");

  const expRef = push(ref(db, `expenses/${date}`));
  await set(expRef, {
    type:      expense.type.trim(),
    amount:    +parseFloat(expense.amount).toFixed(2),
    note:      (expense.note || "").trim(),
    paymentMethod: expense.paymentMethod || "cash",  // Nakit veya Kredi Kartı (Madde 4)
    createdAt: Date.now(),
    createdBy: AppState.currentUser.uid,
    createdByName: AppState.currentUser.displayName || AppState.currentUser.email,
  });
  return expRef.key;
}

export async function deleteExpense(date, key) {
  requireRole(["admin", "cashier"]);
  await remove(ref(db, `expenses/${date}/${key}`));
}

export async function getExpensesByDate(date) {
  requireRole(["admin", "cashier"]);
  const snap = await get(ref(db, `expenses/${date}`));
  return snap.val() || {};
}

export async function getExpensesByMonth(yearMonth) {
  requireRole(["admin", "cashier"]);
  const snap = await get(ref(db, "expenses"));
  const all  = snap.val() || {};
  let total  = 0;
  const byType = {};

  Object.entries(all).forEach(([date, dayExpenses]) => {
    if (!date.startsWith(yearMonth)) return;
    Object.values(dayExpenses).forEach(e => {
      total += e.amount || 0;
      byType[e.type] = (byType[e.type] || 0) + e.amount;
    });
  });

  return { yearMonth, total: +total.toFixed(2), byType };
}

/**
 * Kasa Nakit Özeti (Nakit Giriş - Nakit Gider = Kalan)
 */
export async function getCashRegisterSummary(date) {
  requireRole(["admin", "cashier"]);
  const history  = await getHistoryByDate(date);
  const expenses = await getExpensesByDate(date);
  const sessions = Object.values(history || {});

  let cashIn = 0;
  sessions.forEach(s => {
    if (s.isIkram || s.paymentMethod === "ikram") return;
    if (s.paymentMethod === "karma" && s.paymentBreakdown) {
      cashIn += s.paymentBreakdown.cash || 0;
    } else if (s.paymentMethod !== "card") {
      cashIn += s.totalAmount || 0;
    }
  });

  let cashOut = 0;
  Object.values(expenses || {}).forEach(e => {
    if ((e.paymentMethod || "cash") === "cash") cashOut += e.amount || 0;
  });

  return {
    date,
    cashIn: +cashIn.toFixed(2),
    cashOut: +cashOut.toFixed(2),
    remaining: +(cashIn - cashOut).toFixed(2)
  };
}

// ─────────────────────────────────────────────
// YENİ (Madde 2): STOK YÖNETİMİ
// ─────────────────────────────────────────────

/**
 * Stok güncelle (admin).
 * @param {string} productId
 * @param {number|null} quantity — null = sınırsız
 */
export async function setInventory(productId, quantity) {
  requireRole("admin");
  const unlimited = quantity === null || quantity === "unlimited";
  await set(ref(db, `inventory/${productId}`), {
    quantity:  unlimited ? null : Math.max(0, parseInt(quantity) || 0),
    unlimited,
    updatedAt: Date.now(),
    updatedBy: AppState.currentUser.uid,
  });
}

export async function getAllInventory() {
  const snap = await get(ref(db, "inventory"));
  AppState.inventory = snap.val() || {};
  return AppState.inventory;
}

export function watchInventory(callback) {
  const invRef = ref(db, "inventory");
  const unsub  = onValue(invRef, (snap) => {
    AppState.inventory = snap.val() || {};
    callback(AppState.inventory);
  });
  AppState.listeners.push(unsub);
  return unsub;
}

/**
 * Sipariş eklerken stok düş.
 * Yeni qty, eski qty'ye göre delta hesaplanır.
 */
export async function deductInventory(productId, deltaQty) {
  const invSnap = await get(ref(db, `inventory/${productId}`));
  if (!invSnap.exists()) return;
  const inv = invSnap.val();
  if (inv.unlimited) return;
  const newQty = Math.max(0, (inv.quantity || 0) - deltaQty);
  await update(ref(db, `inventory/${productId}`), { quantity: newQty, updatedAt: Date.now() });
} 

// ─────────────────────────────────────────────
// Mutfak Bildirim Sistemi
// ─────────────────────────────────────────────
export async function sendKitchenNotification(tableId, tableName, orders) {
  const itemsToSend = [];
  const updates = {};
  let isEkSiparis = false;

  // Masada daha önce mutfağa gönderilmiş ürün var mı kontrol et
  Object.values(orders).forEach(o => {
    if (o.sentQty && o.sentQty > 0) isEkSiparis = true;
  });

  // Sadece yeni eklenen veya miktarı artanları seç
  for (const [key, o] of Object.entries(orders)) {
    const sent = o.sentQty || 0;
    if (o.quantity > sent) {
      itemsToSend.push({
        name: o.productName,
        qty: o.quantity - sent, // Sadece aradaki farkı mutfağa gönder
        variation: o.variation || "",
        note: o.note || ""
      });
      // Ürünün gönderilmiş miktarını güncelle
      updates[`orders/${tableId}/${key}/sentQty`] = o.quantity;
    }
  }

  if (itemsToSend.length === 0) throw new Error("Mutfağa gönderilecek yeni sipariş yok!");

  const notifRef = push(ref(db, "notifications"));
  updates[`notifications/${notifRef.key}`] = {
    tableId,
    tableName: isEkSiparis ? `${tableName} (Ek Sipariş)` : tableName,
    items: itemsToSend,
    sentAt: Date.now(),
    sentBy: AppState.currentUser.uid,
    sentByName: AppState.currentUser.displayName || AppState.currentUser.email,
    status: "pending"
  };
  
  // Masa durumunu mutfak için hazırlanıyor olarak işaretle
  updates[`tables/${tableId}/kitchenStatus`] = "preparing";

  await update(ref(db), updates);
  return notifRef.key;
}

export async function markNotificationReady(notifKey) {
  const snap = await get(ref(db, `notifications/${notifKey}`));
  if (!snap.exists()) return;

  const data = snap.val();
  const updates = {};
  
  // Bildirimi tamamen sil (iş bittiği için)
  updates[`notifications/${notifKey}`] = null;
  
  // Masa durumunu "Hazır" olarak güncelle (masa kartında yeşil rozet çıksın)
  updates[`tables/${data.tableId}/kitchenStatus`] = "ready";

  await update(ref(db), updates);
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
  const validRoles = ["admin", "cashier", "waiter", "pending"];
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
// ─────────────────────────────────────────────
// ADMİN PİN YÖNETİMİ
// ─────────────────────────────────────────────
export async function setAdminPin(newPin) {
  if (AppState.currentUser?.role !== "admin") throw new Error("Sadece admin yetkisi olanlar PIN belirleyebilir.");
  if (!newPin || newPin.length !== 4 || isNaN(newPin)) throw new Error("PIN sadece 4 haneli rakamlardan oluşmalıdır.");
  
  await update(ref(db, `users/${AppState.currentUser.uid}`), { pin: newPin });
  AppState.currentUser.pin = newPin;
  AppState.isPinVerified = true;
}

export async function verifyAdminPin(enteredPin) {
  if (AppState.currentUser?.role !== "admin") return true; // Sadece adminde PIN sor
  
  const actualPin = AppState.currentUser.pin;
  if (!actualPin) throw new Error("PIN oluşturulmamış.");
  
  if (enteredPin === actualPin) {
    AppState.isPinVerified = true;
    return true;
  } else {
    throw new Error("Hatalı PIN. Lütfen tekrar deneyin.");
  }
}

export async function deleteUserRecord(uid) {
  requireRole("admin");
  if (uid === AppState.currentUser.uid)
    throw new Error("Kendinizi silemezsiniz.");
  await remove(ref(db, `users/${uid}`));
}

// Yıldızlı Ürünler
export async function getStarredItems() {
  const snap = await get(ref(db, "settings/starredItems"));
  const val  = snap.val();
  if (!val) return {};
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

// ============================================================
// YENİ: Garson için masa siparişlerini canlı çekme
// ============================================================
export async function getTableOrders(tableId) {
  const { get, ref } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js");
  const snap = await get(ref(db, `orders/${tableId}`));
  return snap.val() || {};
}

// İş Günü (Business Day) Hesaplayıcı
// Saat sabah 05:00'ten önceyse, bir önceki günün tarihini döndürür.
export function getBusinessDate() {
  const now = new Date();
  if (now.getHours() < 5) {
    now.setDate(now.getDate() - 1); // Günü 1 geri al
  }
  // Türkiye saat dilimine uygun formatla (YYYY-MM-DD)
  const offset = now.getTimezoneOffset() * 60000;
  const localISOTime = (new Date(now - offset)).toISOString().slice(0, 10);
  return localISOTime;
}

export { db, auth };
