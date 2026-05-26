// ============================================================
// HAN KAFEM - UI CONTROLLER (js/app.js)
// v3.0 — 8 yeni özellik entegre edildi
// ============================================================

import {
  login, logout, register, watchAuthState,
  changePassword,
  fetchMenu, getMenuByCategory,
  addTable, deleteTable, watchTables, moveTable,
  addOrderItem, removeOrderItem, updateOrderQty, watchTableOrders,
  closeTable, paySelectedItems,
  getDailyRevenue, getDailySalesSummary, getMonthlySalesSummary, getHistoryByDate,
  getExpensesByDate, getExpensesByMonth, addExpense, deleteExpense,
  sendKitchenNotification, watchNotifications, markNotificationReady,
  getAllUsers, updateUserRole, deleteUserRecord,
  setInventory, getAllInventory, watchInventory,
  formatCurrency, toggleStarredItem, watchStarredItems,
  AppState
} from "./core.js";

// ─────────────────────────────────────────────
// EKRAN YÖNETİMİ
// ─────────────────────────────────────────────
const screens = {
  login:     document.getElementById("screen-login"),
  dashboard: document.getElementById("screen-dashboard"),
  table:     document.getElementById("screen-table")
};

let activeTableOrderListener = null;
let activeNotifListener      = null;
let partialSelections        = {};
let currentTableId           = null;
// YENİ (Madde 8): Bildirim sesi
let notifAudio = null;
let lastNotifCount = 0;

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

// ─────────────────────────────────────────────
// BAŞLANGIÇ
// ─────────────────────────────────────────────
watchAuthState(
  async (user) => {
    updateHeader(user);

    // YENİ (Madde 1): Garson fiyat gizleme
    applyRoleClass(user.role);

    showMenuLoadingOverlay(true);
    try {
      await fetchMenu();
    } catch {
      showToast("Menü yüklenemedi!", "error");
    } finally {
      showMenuLoadingOverlay(false);
    }

    // YENİ (Madde 2): Stok verilerini yükle ve izle
    await getAllInventory();
    watchInventory((inv) => {
      AppState.inventory = inv;
      if (currentTableId) renderMenu(currentTableId);
    });

    showScreen("dashboard");

    watchStarredItems((starred) => {
      AppState.starredItems = starred;
      if (currentTableId) renderMenu(currentTableId);
    });

    startDashboard();
    startNotificationListener();

    // YENİ (Madde 8): Ses nesnesini hazırla
    initNotifSound();
  },
  (reason) => {
    const loginBtn = document.getElementById("btn-login");
    if (loginBtn) {
      loginBtn.disabled    = false;
      loginBtn.textContent = "Giriş Yap";
    }
    if (reason === "pending") {
      showScreen("login");
      const errEl = document.getElementById("login-error");
      if (errEl) errEl.textContent = "Hesabınız onay bekliyor. Lütfen yöneticinizle iletişime geçin.";
    } else {
      showScreen("login");
    }
  }
);

// ─────────────────────────────────────────────
// YENİ (Madde 1): Rol sınıfı uygula / kaldır
// body.role--waiter olduğunda CSS fiyatları gizler
// ─────────────────────────────────────────────
function applyRoleClass(role) {
  document.body.classList.remove("role--admin", "role--cashier", "role--waiter");
  document.body.classList.add(`role--${role}`);
}

// ─────────────────────────────────────────────
// YENİ (Madde 8): Bildirim sesi
// ─────────────────────────────────────────────
function initNotifSound() {
  try {
    notifAudio = new Audio("sounds/notification.mp3");
    notifAudio.volume = 0.7;
  } catch (e) {
    console.warn("Bildirim sesi yüklenemedi:", e);
  }
}

function playNotifSound() {
  if (!notifAudio) return;
  notifAudio.currentTime = 0;
  notifAudio.play().catch(() => {});
}

// ─────────────────────────────────────────────
// Loading Animasyonu
// ─────────────────────────────────────────────
function showMenuLoadingOverlay(show) {
  const overlay = document.getElementById("loading-overlay");
  if (overlay) overlay.classList.toggle("hidden", !show);
}

function promptPayment(amountText) {
  return new Promise((resolve) => {
    const modal = document.getElementById("modal-payment");
    document.getElementById("payment-modal-desc").textContent = "Tutar: " + amountText;
    modal.classList.remove("hidden");

    const btnCash = document.getElementById("btn-pay-cash");
    const btnCard = document.getElementById("btn-pay-card");
    const btnClose = document.getElementById("modal-payment-close");

    const cleanup = () => {
      modal.classList.add("hidden");
      btnCash.replaceWith(btnCash.cloneNode(true));
      btnCard.replaceWith(btnCard.cloneNode(true));
      btnClose.replaceWith(btnClose.cloneNode(true));
    };

    document.getElementById("btn-pay-cash").addEventListener("click", () => { cleanup(); resolve("cash"); });
    document.getElementById("btn-pay-card").addEventListener("click", () => { cleanup(); resolve("card"); });
    document.getElementById("modal-payment-close").addEventListener("click", () => { cleanup(); resolve(null); });
  });
}
// ─────────────────────────────────────────────
// GİRİŞ / KAYIT EKRANI
// ─────────────────────────────────────────────
let authMode = "login";

function setAuthMode(mode) {
  authMode = mode;
  const loginSection    = document.getElementById("login-section");
  const registerSection = document.getElementById("register-section");
  const toggleFwdRow    = document.querySelector(".auth-toggle:not(#toggle-back-login)");
  const toggleBackRow   = document.getElementById("toggle-back-login");
  const loginErr        = document.getElementById("login-error");
  const regErr          = document.getElementById("register-error");
  if (loginErr) loginErr.textContent = "";
  if (regErr)   regErr.textContent   = "";

  if (mode === "register") {
    loginSection?.classList.add("hidden");
    registerSection?.classList.remove("hidden");
    toggleFwdRow?.classList.add("hidden");
    toggleBackRow?.classList.remove("hidden");
    document.getElementById("input-reg-fullname")?.focus();
  } else {
    loginSection?.classList.remove("hidden");
    registerSection?.classList.add("hidden");
    toggleFwdRow?.classList.remove("hidden");
    toggleBackRow?.classList.add("hidden");
    document.getElementById("input-username")?.focus();
  }
}

document.getElementById("btn-go-register")?.addEventListener("click", () => setAuthMode("register"));
document.getElementById("btn-go-login")?.addEventListener("click",    () => setAuthMode("login"));

document.getElementById("btn-login").addEventListener("click", async () => {
  const username = document.getElementById("input-username").value.trim();
  const password = document.getElementById("input-password").value;
  const errEl    = document.getElementById("login-error");
  const btn      = document.getElementById("btn-login");
  try {
    errEl.textContent   = "";
    btn.disabled        = true;
    btn.textContent     = "Giriş yapılıyor…";
    const email         = username.includes("@") ? username : `${username}@hankafem.com`;
    const rememberMe    = document.getElementById("chk-remember-me")?.checked ?? true;
    await login(email, password, rememberMe);
  } catch (err) {
    errEl.textContent   = translateAuthError(err.code || err.message);
    btn.disabled        = false;
    btn.textContent     = "Giriş Yap";
  }
});

["input-username", "input-password"].forEach(id => {
  document.getElementById(id)?.addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("btn-login").click();
  });
});

document.getElementById("btn-register")?.addEventListener("click", async () => {
  const fullName = document.getElementById("input-reg-fullname").value.trim();
  const username = document.getElementById("input-reg-username").value.trim();
  const password = document.getElementById("input-reg-password").value;
  const errEl    = document.getElementById("register-error");
  const btn      = document.getElementById("btn-register");
  try {
    errEl.textContent = "";
    btn.disabled      = true;
    btn.textContent   = "Kaydediliyor…";
    const email       = username.includes("@") ? username : `${username}@hankafem.com`;
    await register(fullName, email, password);
    btn.textContent   = "Başarılı! Yönlendiriliyor...";
    setTimeout(() => window.location.reload(), 500);
  } catch (err) {
    errEl.textContent = translateAuthError(err.code || err.message);
    btn.disabled      = false;
    btn.textContent   = "Kayıt Ol";
  }
});

["input-reg-fullname", "input-reg-username", "input-reg-password"].forEach(id => {
  document.getElementById(id)?.addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("btn-register")?.click();
  });
});

// ─────────────────────────────────────────────
// DASHBOARD — MASA GRID
// ─────────────────────────────────────────────
function startDashboard() {
  const grid    = document.getElementById("table-grid");
  const isAdmin = AppState.currentUser?.role === "admin";
  const isWaiter = AppState.currentUser?.role === "waiter";

  watchTables((tables) => {
    grid.innerHTML = "";
    if (Object.keys(tables).length === 0) {
      grid.innerHTML = `<p class="no-tables">Henüz masa eklenmemiş.</p>`;
      return;
    }
    const sorted = Object.entries(tables).sort((a, b) =>
      a[1].name.localeCompare(b[1].name, "tr", { numeric: true, sensitivity: "base" })
    );
    sorted.forEach(([tableId, table]) => {
      const card = buildTableCard(tableId, table, isWaiter);
      grid.appendChild(card);
    });
  });

  document.getElementById("admin-controls").style.display = isAdmin ? "flex" : "none";

  const staffBtn  = document.getElementById("btn-staff-management");
  if (staffBtn) staffBtn.style.display = isAdmin ? "inline-flex" : "none";

  // YENİ (Madde 5): Giderler butonu — admin ve cashier görür
  const expBtn    = document.getElementById("btn-expenses");
  const canReport = ["admin", "cashier"].includes(AppState.currentUser?.role);
  if (expBtn) expBtn.style.display = canReport ? "inline-flex" : "none";

  const reportBtn = document.getElementById("btn-report");
  if (reportBtn) reportBtn.style.display = canReport ? "inline-flex" : "none";

  // YENİ (Madde 2): Stok butonu — sadece admin
  const invBtn = document.getElementById("btn-inventory");
  if (invBtn) invBtn.style.display = isAdmin ? "inline-flex" : "none";
}

// YENİ (Madde 1): Garson masa kartında fiyat yerine "İçerik Gör" butonu
function buildTableCard(tableId, table, isWaiter) {
  const card     = document.createElement("div");
  const occupied = table.status === "occupied";
  const isAdmin  = AppState.currentUser?.role === "admin";

  card.className      = `table-card ${occupied ? "occupied" : "empty"}`;
  card.dataset.tableId = tableId;

  let priceHtml = "";
  if (occupied) {
    if (isWaiter) {
      priceHtml = `<button class="btn btn--sm btn--ghost table-card__view-btn" data-id="${tableId}">📋 İçerik Gör</button>`;
    } else {
      priceHtml = `<div class="table-card__price">${formatCurrency(table.totalPrice || 0)}</div>`;
    }
  } else {
    priceHtml = `<div class="table-card__price">Boş</div>`;
  }

  card.innerHTML = `
    <div class="table-card__icon">${occupied ? "🍽️" : "🪑"}</div>
    <div class="table-card__name">${table.name}</div>
    ${priceHtml}
    ${isAdmin && !occupied
      ? `<button class="btn-icon btn-delete-table" data-id="${tableId}" title="Masayı Sil">✕</button>`
      : ""}
  `;

  // Garson — İçerik Gör butonu
  card.querySelector(".table-card__view-btn")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await openTableContentModal(tableId, table.name);
  });

  card.addEventListener("click", (e) => {
    if (e.target.closest(".btn-delete-table") || e.target.closest(".table-card__view-btn")) return;
    openTableScreen(tableId, table.name);
  });

  card.querySelector(".btn-delete-table")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm(`"${table.name}" masasını silmek istediğinize emin misiniz?`)) return;
    try {
      await deleteTable(tableId);
      showToast(`${table.name} silindi.`);
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  return card;
}

// YENİ (Madde 1): Masa içerik modalı (garson için — fiyatsız)
async function openTableContentModal(tableId, tableName) {
  const modal   = document.getElementById("modal-table-content");
  const titleEl = document.getElementById("table-content-title");
  const listEl  = document.getElementById("table-content-list");
  if (!modal) return;

  titleEl.textContent = `${tableName} — Siparişler`;
  listEl.innerHTML    = `<p style="color:var(--text-3)">Yükleniyor…</p>`;
  modal.classList.remove("hidden");

  const orders = AppState.orders[tableId] || {};
  if (Object.keys(orders).length === 0) {
    listEl.innerHTML = `<p style="color:var(--text-3)">Bu masada açık sipariş yok.</p>`;
    return;
  }

  listEl.innerHTML = "";
  Object.values(orders).forEach(item => {
    const row = document.createElement("div");
    row.className = "content-modal-row";
    row.innerHTML = `
      <span class="content-modal-qty">×${item.quantity}</span>
      <span class="content-modal-name">${item.productName}${item.variation ? ` <em>(${item.variation})</em>` : ""}${item.note ? ` — <small>${item.note}</small>` : ""}</span>
    `;
    listEl.appendChild(row);
  });
}

document.getElementById("modal-table-content-close")?.addEventListener("click", () => {
  document.getElementById("modal-table-content")?.classList.add("hidden");
});
document.getElementById("modal-table-content")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget)
    document.getElementById("modal-table-content").classList.add("hidden");
});

// ─── Otomatik masa isimlendirme ───
function autoTableName() {
  const existingNames = Object.values(AppState.tables).map(t =>
    (t.name || "").toLowerCase().trim()
  );
  let num = 1;
  while (existingNames.includes(`masa ${num}`)) num++;
  return `Masa ${num}`;
}

document.getElementById("btn-add-table")?.addEventListener("click", async () => {
  const inputEl = document.getElementById("input-table-name");
  const name    = inputEl.value.trim() || autoTableName();
  try {
    await addTable(name);
    inputEl.value = "";
    showToast(`${name} eklendi! ✓`);
  } catch (err) {
    showToast(err.message, "error");
  }
});

// ─────────────────────────────────────────────
// MASA DETAY EKRANI
// ─────────────────────────────────────────────
function openTableScreen(tableId, tableName) {
  if (activeTableOrderListener) {
    activeTableOrderListener();
    activeTableOrderListener = null;
  }

  currentTableId    = tableId;
  partialSelections = {};

  document.getElementById("table-screen-title").textContent = tableName;
  showScreen("table");
  renderMenu(tableId);

  activeTableOrderListener = watchTableOrders(tableId, (orders) => {
    renderOrderList(tableId, orders);
  });

  document.getElementById("btn-back").onclick = () => {
    if (activeTableOrderListener) {
      activeTableOrderListener();
      activeTableOrderListener = null;
    }
    currentTableId = null;
    showScreen("dashboard");
  };

  const canClose   = ["admin", "cashier"].includes(AppState.currentUser?.role);
  const isWaiter   = AppState.currentUser?.role === "waiter";
  const closeBtn   = document.getElementById("btn-close-table");
  const moveBtn    = document.getElementById("btn-move-table");
  const kitchenBtn = document.getElementById("btn-send-kitchen");
  const mobileSlot = document.getElementById("close-table-mobile-slot");
  const headerRight = document.querySelector("#screen-table .header-right");

  if (window.innerWidth <= 540) {
    if (mobileSlot) {
      if (moveBtn)    mobileSlot.appendChild(moveBtn);
      if (kitchenBtn) mobileSlot.appendChild(kitchenBtn);
      if (closeBtn)   mobileSlot.appendChild(closeBtn);
    }
  } else {
    if (headerRight) {
      if (moveBtn)    headerRight.appendChild(moveBtn);
      if (kitchenBtn) headerRight.appendChild(kitchenBtn);
      if (closeBtn)   headerRight.appendChild(closeBtn);
    }
  }

  if (closeBtn) {
    if (canClose) {
      closeBtn.removeAttribute("hidden");
      closeBtn.style.setProperty("display", "flex", "important");
    } else {
      closeBtn.style.setProperty("display", "none", "important");
    }
  }

  const paySelectedBtn = document.getElementById("btn-pay-selected");
  if (paySelectedBtn) {
    paySelectedBtn.style.display = canClose ? "" : "none";
    paySelectedBtn.onclick = async () => {
      const selArr = Object.entries(partialSelections)
        .filter(([, qty]) => qty > 0)
        .map(([key, qty]) => ({ key, qty }));
      if (selArr.length === 0)
        return showToast("Lütfen ödenecek ürünleri seçin.", "warn");
      const orders   = AppState.orders[tableId] || {};
      const selTotal = selArr.reduce((s, { key, qty }) => {
        return s + (orders[key]?.unitPrice || 0) * qty;
      }, 0);
      const lines    = selArr.map(({ key, qty }) =>
        `${orders[key]?.productName || key}: ${qty} adet`).join("\n");
     if (!confirm(`Aşağıdaki ürünler için ${formatCurrency(selTotal)} ödensin mi?\n\n${lines}`)) return;
      const paymentMethod = await promptPayment(formatCurrency(selTotal));
if (!paymentMethod) return;
      try {
        const selArrSnapshot = [...selArr];
        partialSelections    = {};
        const result         = await paySelectedItems(tableId, selArrSnapshot, paymentMethod);
        showToast(`✓ ${formatCurrency(result.selectedTotal)} ödendi (${paymentMethod === "cash" ? "Nakit" : "Kredi Kartı"}). Kalan sipariş masada açık.`);
      } catch (err) {
        showToast(err.message, "error");
      }
    };
  }

  if (closeBtn) {
    closeBtn.onclick = async () => {
      if (!confirm(`"${tableName}" masasını kapatmak ve hesabı almak istiyor musunuz?`)) return;
      const totalAmount = Object.values(AppState.orders[tableId] || {}).reduce((sum, i) => sum + (i.totalPrice || 0), 0);
const paymentMethod = await promptPayment(formatCurrency(totalAmount));
if (!paymentMethod) return;
      try {
        const summary = await closeTable(tableId, paymentMethod);
        showToast(`✓ Hesap alındı: ${formatCurrency(summary.totalAmount)} (${paymentMethod === "cash" ? "Nakit" : "Kredi Kartı"})`);
        if (activeTableOrderListener) {
          activeTableOrderListener();
          activeTableOrderListener = null;
        }
        currentTableId = null;
        showScreen("dashboard");
      } catch (err) {
        showToast(err.message, "error");
      }
    };
  }

  if (moveBtn) moveBtn.onclick = () => openMoveTableModal(tableId);

  if (kitchenBtn) {
    kitchenBtn.onclick = async () => {
      const orders = AppState.orders[tableId] || {};
      if (Object.keys(orders).length === 0)
        return showToast("Sipariş listesi boş!", "warn");
      try {
        await sendKitchenNotification(tableId, tableName, orders);
        showToast("✓ Mutfağa bildirim gönderildi!");
        sendBrowserNotification("Yeni Sipariş", `${tableName} sipariş bildirimi mutfağa iletildi.`);
      } catch (err) {
        showToast("Mutfak bildirimi gönderilemedi: " + err.message, "error");
      }
    };
  }
}

// ─────────────────────────────────────────────
// MENÜ RENDER — Stok ve Varyasyon desteği
// ─────────────────────────────────────────────
function renderMenu(tableId) {
  const menuEl  = document.getElementById("menu-list");
  const grouped = getMenuByCategory();
  menuEl.innerHTML = "";

  Object.entries(grouped).forEach(([category, items]) => {
    const catEl    = document.createElement("div");
    catEl.className = "menu-category";
    const isPinned = category.includes("Öne Çıkanlar");
    catEl.innerHTML = `<h3 class="menu-category__title ${isPinned ? "menu-category__title--hot" : ""}">${category}</h3>`;

    items.forEach(product => {
      const row       = document.createElement("div");
      row.className   = "menu-item";
      const isAdmin   = AppState.currentUser?.role === "admin";
      const isStarred = !!(AppState.starredItems || {})[product.id];
      const inv       = AppState.inventory[product.id];
      const isOut     = inv && !inv.unlimited && (inv.quantity <= 0);
      const stockLabel = isOut ? `<span class="stock-badge stock-badge--out">Tükendi</span>`
        : (inv && !inv.unlimited ? `<span class="stock-badge">Stok: ${inv.quantity}</span>` : "");

      const hasVariations = product.variations && product.variations.length > 0;
      row.innerHTML = `
        <div class="menu-item__info">
          <span class="menu-item__name">${product.name} ${stockLabel}</span>
          <span class="menu-item__price">${formatCurrency(product.price)}</span>
        </div>
        <div class="menu-item__controls">
          ${isAdmin
            ? `<button class="btn-star ${isStarred ? "btn-star--active" : ""}" data-id="${product.id}" title="${isStarred ? "Yıldızı Kaldır" : "Öne Çıkar"}">${isStarred ? "⭐" : "☆"}</button>`
            : ""}
          ${hasVariations
            ? `<select class="inline-var-select" data-id="${product.id}" title="Varyasyon seç">
                ${product.variations.map(v => `<option value="${v}">${v}</option>`).join("")}
               </select>`
            : ""}
          <button class="btn-note" data-id="${product.id}" title="Not ekle">📝</button>
          <input class="inline-note-input hidden" data-id="${product.id}" type="text" placeholder="Not…" maxlength="80" />
          <button class="btn-qty btn-minus" data-id="${product.id}">−</button>
          <span class="qty-display" id="qty-${product.id}">0</span>
          <button class="btn-qty btn-plus"  data-id="${product.id}" ${isOut ? "disabled" : ""}>+</button>
        </div>
      `;

      if (isAdmin) {
        row.querySelector(".btn-star")?.addEventListener("click", async (e) => {
          e.stopPropagation();
          const btn   = e.currentTarget;
          btn.disabled = true;
          try {
            await toggleStarredItem(product.id, isStarred);
          } catch (err) {
            showToast("Hata: " + err.message, "error");
          } finally {
            btn.disabled = false;
          }
        });
      }

      // Not butonu toggle
      row.querySelector(".btn-note").addEventListener("click", (e) => {
        e.stopPropagation();
        const noteInput = row.querySelector(".inline-note-input");
        noteInput.classList.toggle("hidden");
        if (!noteInput.classList.contains("hidden")) noteInput.focus();
      });

      row.querySelector(".btn-plus").addEventListener("click", async (e) => {
        if (isOut) return;
        const btn       = e.target;
        btn.disabled    = true;
        
        // OPTIMISTIC UPDATE: DOM üzerinden sayıyı al (Firebase gecikmesini bekleme)
        const qtyEl = document.getElementById(`qty-${product.id}`);
        const currentLocalQty = parseInt(qtyEl?.textContent || "0");
        if (qtyEl) qtyEl.textContent = String(currentLocalQty + 1);

        try {
          const variation = row.querySelector(".inline-var-select")?.value || "";
          const note      = (row.querySelector(".inline-note-input")?.value || "").trim();
          // Backend'e lokalde hesapladığımız kesin sayıyı yolluyoruz
          await addOrderItem(tableId, product, currentLocalQty + 1, { variation, note });
        } catch (err) {
          if (qtyEl) qtyEl.textContent = String(currentLocalQty); // Hata varsa geri al
          showToast("Hata: " + err.message, "error");
        } finally {
          btn.disabled = false;
        }
      });

      row.querySelector(".btn-minus").addEventListener("click", async (e) => {
        const btn   = e.target;
        const qtyEl = document.getElementById(`qty-${product.id}`);
        
        // Ekranda o an yazan güncel sayıyı alıyoruz
        const currentLocalQty = parseInt(qtyEl?.textContent || "0");
        
        // Zaten 0 ise boşuna backend'e istek atıp yormayalım
        if (currentLocalQty <= 0) return; 

        btn.disabled = true;
        
        // OPTIMISTIC UPDATE: Ekrandaki sayıyı Firebase'i beklemeden hemen 1 azalt
        if (qtyEl) qtyEl.textContent = String(currentLocalQty - 1);

        try {
          const variation = row.querySelector(".inline-var-select")?.value || "";
          const note      = (row.querySelector(".inline-note-input")?.value || "").trim();
          
          // Backend'e lokalde hesapladığımız kesin sayıyı (eski sayı - 1) gönderiyoruz
          await addOrderItem(tableId, product, currentLocalQty - 1, { variation, note });
        } catch (err) {
          // Eğer Firebase'de bir hata olursa, ekrandaki sayıyı eski haline geri getir
          if (qtyEl) qtyEl.textContent = String(currentLocalQty); 
          showToast("Hata: " + err.message, "error");
        } finally {
          btn.disabled = false;
        }
      });

      catEl.appendChild(row);
    });

    menuEl.appendChild(catEl);
  });
}



// ─────────────────────────────────────────────
// SİPARİŞ LİSTESİ RENDER — Madde 7: Garson direkt düzenleme
// ─────────────────────────────────────────────
function renderOrderList(tableId, orders) {
  const listEl  = document.getElementById("order-list");
  const totalEl = document.getElementById("order-total");
  listEl.innerHTML = "";

  const entries  = Object.entries(orders);
  const canClose = ["admin", "cashier"].includes(AppState.currentUser?.role);
  const isWaiter = AppState.currentUser?.role === "waiter";
  let total = 0;

  if (entries.length === 0) {
    listEl.innerHTML    = `<p class="order-empty">Henüz sipariş yok.</p>`;
    totalEl.textContent = formatCurrency(0);
    updateSelectedTotal(orders);
    return;
  }

  // partialSelections temizle
  Object.keys(partialSelections).forEach(k => {
    if (!orders[k]) {
      delete partialSelections[k];
    } else {
      const maxAllowed = orders[k].quantity || 0;
      if (partialSelections[k] > maxAllowed) partialSelections[k] = maxAllowed;
      if (partialSelections[k] <= 0) delete partialSelections[k];
    }
  });

  entries.forEach(([key, item]) => {
    total += item.totalPrice || 0;
    const selQty     = partialSelections[key] ?? 0;
    const maxQty     = item.quantity ?? 0;
    const safeSelQty = Math.min(selQty, maxQty);

    const row = document.createElement("div");
    row.className = `order-item${safeSelQty > 0 ? " order-item--selected" : ""}`;

    const variationHtml = item.variation ? `<span class="order-item__variation">${item.variation}</span>` : "";
    const noteHtml      = item.note      ? `<span class="order-item__note">📝 ${item.note}</span>`      : "";

    // Herkes için sipariş ekle/çıkar butonları (Garson, Kasa, Admin)
    let orderControlHtml = `
      <div class="order-item__waiter-ctrl">
        <button class="btn-qty btn-minus-order" data-key="${key}" style="width:28px;height:28px;font-size:1rem;">−</button>
        <span class="order-item__qty" style="min-width:1.5rem;text-align:center;font-weight:bold;">${item.quantity}</span>
        <button class="btn-qty btn-plus-order" data-key="${key}" style="width:28px;height:28px;font-size:1rem;">+</button>
      </div>
    `;

    // Sadece Kasa ve Admin için Kısmi Ödeme (Seçilenleri Öde) alanı
    let partialControlHtml = "";
    if (canClose) {
      partialControlHtml = `
        <div class="order-item__partial" style="margin-top:4px; display:flex; align-items:center; gap:4px; background:var(--surface-2); padding:4px 6px; border-radius:6px; width:fit-content;">
          <span style="font-size:0.7rem; color:var(--accent);">Ödenecek Seç:</span>
          <button class="btn-partial btn-partial-minus" data-key="${key}" ${safeSelQty <= 0 ? "disabled" : ""}>−</button>
          <span class="partial-qty" title="Ödenecek adet">${safeSelQty}</span>
          <button class="btn-partial btn-partial-plus"  data-key="${key}" ${safeSelQty >= maxQty ? "disabled" : ""}>+</button>
        </div>
      `;
    }

    row.innerHTML = `
      ${orderControlHtml}
      <div class="order-item__info">
        <span class="order-item__name">${item.productName}</span>
        ${variationHtml}${noteHtml}
        ${partialControlHtml}
      </div>
      <span class="order-item__total price-hidden">${formatCurrency(item.totalPrice)}</span>
    `;

    // --- EVENT LISTENERS ---

    // 1. Sipariş Düzenleme (Herkes Kullanabilir)
    row.querySelector(".btn-plus-order").addEventListener("click", async (e) => {
      e.target.disabled = true;
      try { await updateOrderQty(tableId, key, item.quantity + 1); }
      catch (err) { showToast(err.message, "error"); }
      finally { e.target.disabled = false; }
    });

    row.querySelector(".btn-minus-order").addEventListener("click", async (e) => {
      e.target.disabled = true;
      try { await updateOrderQty(tableId, key, item.quantity - 1); }
      catch (err) { showToast(err.message, "error"); }
      finally { e.target.disabled = false; }
    });

    // 2. Kısmi Ödeme Seçimi (Sadece Kasa/Admin)
    if (canClose) {
      row.querySelector(".btn-partial-plus").addEventListener("click", () => {
        const cur = partialSelections[key] ?? 0;
        if (cur < maxQty) {
          partialSelections[key] = cur + 1;
          renderOrderList(tableId, orders);
        }
      });

      row.querySelector(".btn-partial-minus").addEventListener("click", () => {
        const cur = partialSelections[key] ?? 0;
        if (cur > 0) {
          partialSelections[key] = cur - 1;
          if (partialSelections[key] === 0) delete partialSelections[key];
          renderOrderList(tableId, orders);
        }
      });
    }

    listEl.appendChild(row);

    const qtyEl = document.getElementById(`qty-${item.productId}`);
    if (qtyEl) qtyEl.textContent = item.quantity;
  });

  // Siparişte olmayan ürünlerin qty'sini sıfırla
  AppState.menuItems.forEach(p => {
    const inOrder = entries.some(([, item]) => item.productId === p.id);
    if (!inOrder) {
      const qtyEl = document.getElementById(`qty-${p.id}`);
      if (qtyEl) qtyEl.textContent = "0";
    }
  });

  totalEl.textContent = formatCurrency(total);
  updateSelectedTotal(orders);
}

function updateSelectedTotal(orders) {
  const selTotalEl = document.getElementById("selected-total");
  const payBtn     = document.getElementById("btn-pay-selected");
  if (!selTotalEl) return;

  const canClose = ["admin", "cashier"].includes(AppState.currentUser?.role);
  if (!canClose) {
    selTotalEl.classList.add("hidden");
    if (payBtn) payBtn.style.display = "none";
    return;
  }

  const selTotal   = Object.entries(partialSelections).reduce((s, [key, qty]) => {
    return s + (orders[key]?.unitPrice || 0) * qty;
  }, 0);
  const hasSelection = Object.keys(partialSelections).length > 0;

  if (hasSelection) {
    const lines = Object.entries(partialSelections)
      .map(([key, qty]) => `${orders[key]?.productName || key}: ${qty} adet`)
      .join(" · ");
    selTotalEl.textContent = `Seçili: ${formatCurrency(selTotal)} (${lines})`;
    selTotalEl.classList.remove("hidden");
    if (payBtn) payBtn.classList.remove("hidden");
  } else {
    selTotalEl.classList.add("hidden");
    if (payBtn) payBtn.classList.add("hidden");
  }
}

function getProductQtyInOrder(tableId, productId, variation = "", note = "") {
  const tableOrders = AppState.orders[tableId] || {};
  const item = Object.values(tableOrders).find(o =>
    o.productId === productId &&
    (o.variation || "") === variation &&
    (o.note || "") === note
  );
  return item?.quantity || 0;
}

// ─────────────────────────────────────────────
// Masa Taşıma
// ─────────────────────────────────────────────
function openMoveTableModal(fromTableId) {
  const modal    = document.getElementById("modal-move-table");
  const listEl   = document.getElementById("move-table-list");
  const fromName = AppState.tables[fromTableId]?.name || "Mevcut Masa";
  document.getElementById("move-table-from-name").textContent = fromName;

  const emptyTables = Object.entries(AppState.tables)
    .filter(([id, t]) => id !== fromTableId && t.status === "empty")
    .sort((a, b) => a[1].name.localeCompare(b[1].name, "tr", { numeric: true }));

  listEl.innerHTML = "";
  if (emptyTables.length === 0) {
    listEl.innerHTML = `<p class="empty-state-text">Taşınabilecek boş masa yok.</p>`;
  } else {
    emptyTables.forEach(([toId, toTable]) => {
      const btn = document.createElement("button");
      btn.className   = "btn btn--accent move-table-btn";
      btn.textContent = toTable.name;
      btn.addEventListener("click", async () => {
        try {
          const result = await moveTable(fromTableId, toId);
          closeMoveTableModal();
          showToast(`✓ Masa taşındı: ${result.fromName} → ${result.toName}`);
          openTableScreen(toId, result.toName);
        } catch (err) {
          showToast(err.message, "error");
        }
      });
      listEl.appendChild(btn);
    });
  }
  modal.classList.remove("hidden");
}

function closeMoveTableModal() {
  document.getElementById("modal-move-table")?.classList.add("hidden");
}

document.getElementById("modal-move-table-close")?.addEventListener("click", closeMoveTableModal);
document.getElementById("modal-move-table")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeMoveTableModal();
});

// ─────────────────────────────────────────────
// Mutfak Bildirim Sistemi — Madde 8: Ses
// ─────────────────────────────────────────────
function startNotificationListener() {
  if (activeNotifListener) {
    activeNotifListener();
    activeNotifListener = null;
  }

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  activeNotifListener = watchNotifications((notifications) => {
    const count   = Object.keys(notifications).length;
    const badge   = document.getElementById("notif-badge");
    const panel   = document.getElementById("notif-panel-list");

    // YENİ (Madde 8): Yeni bildirim gelince ses çal
    if (count > lastNotifCount && lastNotifCount >= 0) {
      playNotifSound();
    }
    lastNotifCount = count;

    if (badge) {
      badge.textContent = count;
      badge.classList.toggle("hidden", count === 0);
    }

    if (panel) {
      panel.innerHTML = "";
      if (count === 0) {
        panel.innerHTML = `<p class="notif-empty">Bekleyen bildirim yok.</p>`;
        return;
      }
      Object.entries(notifications)
        .sort((a, b) => (b[1].sentAt || 0) - (a[1].sentAt || 0))
        .forEach(([key, notif]) => {
          const el = document.createElement("div");
          el.className = "notif-item";
          // YENİ (Madde 6): Varyasyon ve not bilgisini notif panelinde göster
          const itemsText = (notif.items || [])
            .map(i => {
              let t = `${i.qty}× ${i.name}`;
              if (i.variation) t += ` (${i.variation})`;
              if (i.note)      t += ` — ${i.note}`;
              return t;
            }).join(", ");
          el.innerHTML = `
            <div class="notif-item__header">
              <strong>${notif.tableName}</strong>
              <span class="notif-item__time">${formatRelativeTime(notif.sentAt)}</span>
            </div>
            <div class="notif-item__items">${itemsText}</div>
            <button class="btn btn--sm btn--primary notif-ready-btn" data-key="${key}">✓ Hazır</button>
          `;
          el.querySelector(".notif-ready-btn").addEventListener("click", async (e) => {
            e.stopPropagation();
            try {
              await markNotificationReady(key);
              showToast("Bildirim tamamlandı ✓");
            } catch (err) {
              showToast(err.message, "error");
            }
          });
          panel.appendChild(el);
        });
    }
  });
}

document.getElementById("btn-notif-toggle")?.addEventListener("click", () => {
  const panel = document.getElementById("notif-dropdown");
  if (panel) panel.classList.toggle("hidden");
});

document.addEventListener("click", (e) => {
  const panel  = document.getElementById("notif-dropdown");
  const toggle = document.getElementById("btn-notif-toggle");
  if (panel && !panel.contains(e.target) && e.target !== toggle) {
    panel.classList.add("hidden");
  }
});

async function sendBrowserNotification(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg) {
        reg.showNotification(title, { body, icon: "icons/icon-192.png" });
      } else {
        new Notification(title, { body, icon: "icons/icon-192.png" });
      }
    } catch (err) {
      console.warn("Tarayıcı bildirimi hatası:", err);
    }
  }
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "az önce";
  if (mins < 60) return `${mins} dk önce`;
  return `${Math.floor(mins / 60)} sa önce`;
}

// ─────────────────────────────────────────────
// GÜN SONU RAPORU + AYLIK RAPOR (Madde 4)
// ─────────────────────────────────────────────
document.getElementById("btn-report")?.addEventListener("click", () => {
  const modal = document.getElementById("modal-report");
  if (modal) {
    const today = new Date().toISOString().split("T")[0];
    document.getElementById("report-date-input").value   = today;
    document.getElementById("report-month-input").value  = today.slice(0, 7);
    document.getElementById("report-type-day").checked   = true;
    modal.classList.remove("hidden");
    loadDailyReport(today);
  }
});

document.getElementById("report-date-input")?.addEventListener("change", (e) => {
  if (document.getElementById("report-type-day")?.checked) loadDailyReport(e.target.value);
});

document.getElementById("report-month-input")?.addEventListener("change", (e) => {
  if (document.getElementById("report-type-month")?.checked) loadMonthlyReport(e.target.value);
});

document.getElementById("report-type-day")?.addEventListener("change", () => {
  const date = document.getElementById("report-date-input").value;
  if (date) loadDailyReport(date);
});

document.getElementById("report-type-month")?.addEventListener("change", () => {
  const month = document.getElementById("report-month-input").value;
  if (month) loadMonthlyReport(month);
});

document.getElementById("modal-report-close")?.addEventListener("click", () => {
  document.getElementById("modal-report")?.classList.add("hidden");
});

document.getElementById("modal-report")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget)
    document.getElementById("modal-report").classList.add("hidden");
});

async function loadDailyReport(date) {
  const bodyEl  = document.getElementById("report-body");
  const totalEl = document.getElementById("report-total");
  const countEl = document.getElementById("report-session-count");
  const expEl   = document.getElementById("report-expense-total");
  const netEl   = document.getElementById("report-net");

  bodyEl.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-3)">Yükleniyor…</td></tr>`;

  try {
    const [summary, expenses] = await Promise.all([
      getDailySalesSummary(date),
      getExpensesByDate(date).catch(() => ({})),
    ]);

    const expTotal = Object.values(expenses).reduce((s, e) => s + (e.amount || 0), 0);
    const net      = summary.grandTotal - expTotal;

    totalEl.textContent = formatCurrency(summary.grandTotal);
    countEl.textContent = `${summary.sessionCount} hesap`;
    if (expEl) expEl.textContent = formatCurrency(expTotal);
    if (netEl) netEl.textContent = formatCurrency(net);

    bodyEl.innerHTML = "";
    if (summary.products.length === 0) {
      bodyEl.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-3)">Bu tarihte kayıt yok.</td></tr>`;
      return;
    }

    summary.products.forEach((p, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${p.productName}</td>
        <td>${p.category}</td>
        <td style="text-align:center">${p.quantity}</td>
        <td style="text-align:right;font-weight:600;color:var(--accent)">${formatCurrency(p.totalRevenue)}</td>
      `;
      bodyEl.appendChild(tr);
    });
  } catch (err) {
    bodyEl.innerHTML = `<tr><td colspan="5" style="color:#e74c3c">Hata: ${err.message}</td></tr>`;
  }
}

async function loadMonthlyReport(yearMonth) {
  const bodyEl  = document.getElementById("report-body");
  const totalEl = document.getElementById("report-total");
  const countEl = document.getElementById("report-session-count");
  const expEl   = document.getElementById("report-expense-total");
  const netEl   = document.getElementById("report-net");

  bodyEl.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-3)">Yükleniyor…</td></tr>`;

  try {
    const [summary, expenses] = await Promise.all([
      getMonthlySalesSummary(yearMonth),
      getExpensesByMonth(yearMonth).catch(() => ({ total: 0 })),
    ]);

    const expTotal = expenses.total || 0;
    const net      = summary.grandTotal - expTotal;

    totalEl.textContent = formatCurrency(summary.grandTotal);
    countEl.textContent = `${summary.sessionCount} hesap`;
    if (expEl) expEl.textContent = formatCurrency(expTotal);
    if (netEl) netEl.textContent = formatCurrency(net);

    bodyEl.innerHTML = "";
    if (summary.products.length === 0) {
      bodyEl.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-3)">Bu ayda kayıt yok.</td></tr>`;
      return;
    }

    summary.products.forEach((p, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${p.productName}</td>
        <td>${p.category}</td>
        <td style="text-align:center">${p.quantity}</td>
        <td style="text-align:right;font-weight:600;color:var(--accent)">${formatCurrency(p.totalRevenue)}</td>
      `;
      bodyEl.appendChild(tr);
    });
  } catch (err) {
    bodyEl.innerHTML = `<tr><td colspan="5" style="color:#e74c3c">Hata: ${err.message}</td></tr>`;
  }
}

// PDF İndirme — Günlük ve Aylık (Madde 4 & 5)
document.getElementById("btn-report-pdf")?.addEventListener("click", async () => {
  const isMonthly = document.getElementById("report-type-month")?.checked;
  const date    = isMonthly
    ? document.getElementById("report-month-input").value
    : document.getElementById("report-date-input").value;

  if (!date) return showToast("Lütfen tarih/ay seçin.", "warn");

  const summary = isMonthly
    ? await getMonthlySalesSummary(date).catch(() => null)
    : await getDailySalesSummary(date).catch(() => null);

  const expensesData = isMonthly
    ? await getExpensesByMonth(date).catch(() => ({ total: 0, byType: {} }))
    : await getExpensesByDate(date).catch(() => ({}));

  if (!summary) return showToast("Rapor yüklenemedi.", "error");

  const expTotal = isMonthly
    ? (expensesData.total || 0)
    : Object.values(expensesData).reduce((s, e) => s + (e.amount || 0), 0);

  const net = summary.grandTotal - expTotal;

  const { jsPDF } = window.jspdf;
  const doc       = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  showToast("PDF hazırlanıyor…", "warn");

  let fontName = "helvetica";
  try {
    const res    = await fetch("https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Regular.ttf");
    const buffer = await res.arrayBuffer();
    let binary   = "";
    new Uint8Array(buffer).forEach(b => (binary += String.fromCharCode(b)));
    const fontB64 = window.btoa(binary);
    doc.addFileToVFS("Roboto-Regular.ttf", fontB64);
    doc.addFont("Roboto-Regular.ttf", "Roboto", "normal");
    doc.setFont("Roboto");
    fontName = "Roboto";
  } catch (e) {
    console.warn("Font indirilemedi, varsayılana dönülüyor.");
  }

 // tr() her zaman çalışır: Roboto yüklense bile bazı PDF renderer'lar
  // özel Türkçe karakterleri bozar; güvenli ASCII dönüşümü yapalım.
  const tr = (str) => String(str)
    .replace(/ğ/g,"g").replace(/Ğ/g,"G")
    .replace(/ü/g,"u").replace(/Ü/g,"U")
    .replace(/ş/g,"s").replace(/Ş/g,"S")
    .replace(/ı/g,"i").replace(/İ/g,"I")
    .replace(/ö/g,"o").replace(/Ö/g,"O")
    .replace(/ç/g,"c").replace(/Ç/g,"C");


  const title = isMonthly
    ? tr(`Han Kafem — Aylık Rapor (${date})`)
    : tr(`Han Kafem — Gün Sonu Raporu`);

  doc.setFontSize(18); doc.setFont(fontName, "bold");
  doc.text(title, 14, 20);
  doc.setFont(fontName, "normal"); doc.setFontSize(11);
  doc.text(tr(`Dönem: ${date}`), 14, 30);
  doc.text(tr(`İşlem Sayısı: ${summary.sessionCount} hesap`), 14, 37);

  const tableData = summary.products.map((p, i) => [
    i + 1, tr(p.productName), tr(p.category), p.quantity, formatCurrency(p.totalRevenue)
  ]);

  doc.autoTable({
    head: [[tr("#"), tr("Ürün"), tr("Kategori"), tr("Adet"), tr("Ciro")]],
    body: tableData,
    startY: 44,
    theme: "striped",
    headStyles:    { fillColor: [232, 148, 26], textColor: 15, font: fontName },
    styles:        { font: fontName, fontSize: 10 },
    columnStyles:  { 0: { halign: "center" }, 3: { halign: "center" }, 4: { halign: "right" } }
  });
  
  // ── Gider Detay Tablosu ──────────────────────────────────
  const expTableData = isMonthly
    ? Object.entries(expensesData.byType || {}).map(([type, amount], i) => [
        i + 1, tr(type), formatCurrency(amount)
      ])
    : Object.values(expensesData).map((e, i) => [
        i + 1, tr(e.type), tr(e.note || ""), formatCurrency(e.amount)
      ]);

  if (expTableData.length > 0) {
    const expHead = isMonthly
      ? [[tr("#"), tr("Gider Türü"), tr("Tutar")]]
      : [[tr("#"), tr("Gider Türü"), tr("Not"), tr("Tutar")]];
    const expCols = isMonthly
      ? { 0: { halign: "center" }, 2: { halign: "right" } }
      : { 0: { halign: "center" }, 3: { halign: "right" } };

    const expStartY = (doc.lastAutoTable?.finalY || 120) + 10;
    doc.setFontSize(12); doc.setFont(fontName, "bold");
    doc.text(tr("--- Gider Detaylari ---"), 14, expStartY);

    doc.autoTable({
      head: expHead,
      body: expTableData,
      startY: expStartY + 6,
      theme: "striped",
      headStyles:   { fillColor: [180, 60, 60], textColor: 255, font: fontName },
      styles:       { font: fontName, fontSize: 9 },
      columnStyles: expCols,
    });
  }

  // YENİ (Madde 5): Rapor alt özeti — Ciro / Gider / Net Gelir
  const finalY = doc.lastAutoTable?.finalY || 120;
  doc.setFontSize(12); doc.setFont(fontName, "bold");
  doc.text(tr("--- Mali Ozet ---"), 14, finalY + 12);
  doc.setFont(fontName, "normal"); doc.setFontSize(11);
  doc.text(tr(`CIRO (Toplam Gelir) : ${formatCurrency(summary.grandTotal)}`), 14, finalY + 20);
  doc.text(tr(`  - Nakit           : ${formatCurrency(summary.cashTotal || 0)}`), 14, finalY + 27);
  doc.text(tr(`  - Kredi Karti     : ${formatCurrency(summary.cardTotal || 0)}`), 14, finalY + 34);
  doc.text(tr(`GIDER (Toplam)      : ${formatCurrency(expTotal)}`),           14, finalY + 41);
  doc.setFont(fontName, "bold");
  doc.text(tr(`NET GELIR           : ${formatCurrency(net)}`),                14, finalY + 49);
  doc.save(`hankafem-rapor-${date}.pdf`);
  showToast("PDF oluşturuldu! ✓");
});

// ─────────────────────────────────────────────
// YENİ (Madde 5): GİDERLER MODALI
// ─────────────────────────────────────────────
document.getElementById("btn-expenses")?.addEventListener("click", () => {
  const modal = document.getElementById("modal-expenses");
  if (!modal) return;
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("expense-date-input").value = today;
  modal.classList.remove("hidden");
  loadExpenses(today);
});

document.getElementById("expense-date-input")?.addEventListener("change", (e) => {
  loadExpenses(e.target.value);
});

document.getElementById("modal-expenses-close")?.addEventListener("click", () => {
  document.getElementById("modal-expenses")?.classList.add("hidden");
});
document.getElementById("modal-expenses")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget)
    document.getElementById("modal-expenses").classList.add("hidden");
});

document.getElementById("btn-add-expense")?.addEventListener("click", async () => {
  const date   = document.getElementById("expense-date-input").value;
  const type   = document.getElementById("expense-type-input").value;
  const amount = document.getElementById("expense-amount-input").value;
  const note   = document.getElementById("expense-note-input").value;
  const errEl  = document.getElementById("expense-error");
  if (errEl) errEl.textContent = "";
  try {
    await addExpense(date, { type, amount: parseFloat(amount), note });
    document.getElementById("expense-type-input").value   = "";
    document.getElementById("expense-amount-input").value = "";
    document.getElementById("expense-note-input").value   = "";
    showToast("Gider kaydedildi ✓");
    loadExpenses(date);
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  }
});

async function loadExpenses(date) {
  const listEl  = document.getElementById("expense-list");
  const totalEl = document.getElementById("expense-total-display");
  if (!listEl) return;
  listEl.innerHTML = `<p style="color:var(--text-3)">Yükleniyor…</p>`;
  try {
    const expenses = await getExpensesByDate(date);
    const entries  = Object.entries(expenses);
    const total    = entries.reduce((s, [, e]) => s + (e.amount || 0), 0);
    if (totalEl) totalEl.textContent = formatCurrency(total);

    listEl.innerHTML = "";
    if (entries.length === 0) {
      listEl.innerHTML = `<p style="color:var(--text-3);font-size:.85rem">Bu tarihte gider yok.</p>`;
      return;
    }
    entries.forEach(([key, exp]) => {
      const row = document.createElement("div");
      row.className = "expense-row";
      row.innerHTML = `
        <div class="expense-row__info">
          <span class="expense-row__type">${exp.type}</span>
          ${exp.note ? `<span class="expense-row__note">${exp.note}</span>` : ""}
        </div>
        <span class="expense-row__amount">${formatCurrency(exp.amount)}</span>
        <button class="btn btn--danger btn--sm" data-key="${key}" data-date="${date}">✕</button>
      `;
      row.querySelector("button").addEventListener("click", async (e) => {
        const k = e.target.dataset.key;
        const d = e.target.dataset.date;
        if (!confirm("Bu gideri silmek istediğinize emin misiniz?")) return;
        try {
          await deleteExpense(d, k);
          showToast("Gider silindi.");
          loadExpenses(d);
        } catch (err) {
          showToast(err.message, "error");
        }
      });
      listEl.appendChild(row);
    });
  } catch (err) {
    listEl.innerHTML = `<p style="color:#e74c3c">Hata: ${err.message}</p>`;
  }
}

// ─────────────────────────────────────────────
// YENİ (Madde 2): STOK YÖNETİMİ MODALI
// ─────────────────────────────────────────────
document.getElementById("btn-inventory")?.addEventListener("click", () => {
  const modal = document.getElementById("modal-inventory");
  if (!modal) return;
  modal.classList.remove("hidden");
  renderInventoryList();
});

document.getElementById("modal-inventory-close")?.addEventListener("click", () => {
  document.getElementById("modal-inventory")?.classList.add("hidden");
});
document.getElementById("modal-inventory")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget)
    document.getElementById("modal-inventory").classList.add("hidden");
});

function renderInventoryList() {
  const listEl = document.getElementById("inventory-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  if (AppState.menuItems.length === 0) {
    listEl.innerHTML = `<p style="color:var(--text-3)">Menü yüklenmedi.</p>`;
    return;
  }

  AppState.menuItems.forEach(product => {
    const inv        = AppState.inventory[product.id] || {};
    const unlimited  = inv.unlimited !== false; // Varsayılan: sınırsız
    const qty        = inv.quantity ?? "";

    const row = document.createElement("div");
    row.className = "inventory-row";
    row.innerHTML = `
      <div class="inventory-row__info">
        <span class="inventory-row__name">${product.name}</span>
        <span class="inventory-row__cat">${product.category}</span>
      </div>
      <div class="inventory-row__ctrl">
        <label class="inventory-unlimited-label">
          <input type="checkbox" class="inv-unlimited-chk" data-id="${product.id}" ${unlimited ? "checked" : ""}/>
          Sınırsız
        </label>
        <input type="number" class="inv-qty-input" data-id="${product.id}"
          value="${unlimited ? "" : qty}" min="0" placeholder="Adet"
          ${unlimited ? "disabled" : ""} style="width:80px" />
        <button class="btn btn--primary btn--sm inv-save-btn" data-id="${product.id}">Kaydet</button>
      </div>
    `;

    const chk      = row.querySelector(".inv-unlimited-chk");
    const qtyInput = row.querySelector(".inv-qty-input");
    const saveBtn  = row.querySelector(".inv-save-btn");

    chk.addEventListener("change", () => {
      qtyInput.disabled = chk.checked;
      if (chk.checked) qtyInput.value = "";
    });

    saveBtn.addEventListener("click", async () => {
      const isUnlimited = chk.checked;
      const newQty      = isUnlimited ? null : parseInt(qtyInput.value);
      if (!isUnlimited && (isNaN(newQty) || newQty < 0)) {
        return showToast("Geçerli bir stok miktarı girin.", "warn");
      }
      try {
        await setInventory(product.id, newQty);
        showToast(`${product.name} stoku güncellendi ✓`);
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    listEl.appendChild(row);
  });
}

// ─────────────────────────────────────────────
// Kullanıcı Yetki Yönetimi — Personel Modalı
// ─────────────────────────────────────────────
document.getElementById("btn-staff-management")?.addEventListener("click", async () => {
  const modal  = document.getElementById("modal-staff");
  const listEl = document.getElementById("staff-list");
  if (!modal) return;
  listEl.innerHTML = `<p style="color:var(--text-3)">Yükleniyor…</p>`;
  modal.classList.remove("hidden");
  try {
    const users      = await getAllUsers();
    const roleLabels = { admin: "Admin", cashier: "Kasa", waiter: "Garson", pending: "⏳ Bekliyor" };
    listEl.innerHTML = "";
    if (Object.keys(users).length === 0) {
      listEl.innerHTML = `<p style="color:var(--text-3)">Kullanıcı bulunamadı.</p>`;
      return;
    }
    Object.entries(users).forEach(([uid, user]) => {
      const isSelf = uid === AppState.currentUser.uid;
      const row    = document.createElement("div");
      row.className = "staff-row";
      row.innerHTML = `
        <div class="staff-row__info">
          <span class="staff-row__name">${user.displayName || user.email || uid}</span>
          <span class="staff-row__email">${user.email || ""}</span>
          ${user.role === "pending" ? `<span class="staff-pending-badge">⏳ Onay Bekliyor</span>` : ""}
        </div>
        <select class="staff-role-select" data-uid="${uid}" ${isSelf ? "disabled" : ""}>
          <option value="admin"   ${user.role === "admin"   ? "selected" : ""}>Admin</option>
          <option value="cashier" ${user.role === "cashier" ? "selected" : ""}>Kasa</option>
          <option value="waiter"  ${user.role === "waiter"  ? "selected" : ""}>Garson</option>
          <option value="pending" ${user.role === "pending" ? "selected" : ""}>⏳ Bekliyor</option>
        </select>
        ${isSelf
          ? `<span class="staff-self-badge">(Sen)</span>`
          : `<button class="btn btn--danger btn--sm staff-delete-btn" data-uid="${uid}" data-name="${user.displayName || uid}">Sil</button>`
        }
      `;

      if (!isSelf) {
        row.querySelector(".staff-role-select").addEventListener("change", async (e) => {
          const newRole = e.target.value;
          try {
            await updateUserRole(uid, newRole);
            showToast(`${user.displayName || uid} → ${roleLabels[newRole]} ✓`);
          } catch (err) {
            showToast(err.message, "error");
            e.target.value = user.role;
          }
        });

        row.querySelector(".staff-delete-btn")?.addEventListener("click", async (e) => {
          const name = e.target.dataset.name;
          if (!confirm(`"${name}" kullanıcısını silmek istediğinize emin misiniz?\nBu işlem geri alınamaz.`)) return;
          try {
            await deleteUserRecord(uid);
            row.remove();
            showToast(`${name} silindi.`);
          } catch (err) {
            showToast(err.message, "error");
          }
        });
      }

      listEl.appendChild(row);
    });
  } catch (err) {
    listEl.innerHTML = `<p style="color:#e74c3c">Hata: ${err.message}</p>`;
  }
});

document.getElementById("modal-staff-close")?.addEventListener("click", () => {
  document.getElementById("modal-staff")?.classList.add("hidden");
});
document.getElementById("modal-staff")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget)
    document.getElementById("modal-staff").classList.add("hidden");
});

// ─────────────────────────────────────────────
// HEADER VE LOGOUT
// ─────────────────────────────────────────────
function updateHeader(user) {
  const roleLabels = { admin: "Admin", cashier: "Kasa", waiter: "Garson" };
  document.getElementById("header-user").textContent =
    `${user.displayName} (${roleLabels[user.role] || user.role})`;
}

document.getElementById("btn-logout")?.addEventListener("click", async () => {
  if (activeNotifListener) {
    activeNotifListener();
    activeNotifListener = null;
  }
  await logout();
  showScreen("login");
});

// ─────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast     = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("toast--visible"), 10);
  setTimeout(() => {
    toast.classList.remove("toast--visible");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ─────────────────────────────────────────────
// FIREBASE HATA MESAJLARI
// ─────────────────────────────────────────────
function translateAuthError(code) {
  const map = {
    "auth/invalid-email":          "Geçersiz kullanıcı adı formatı.",
    "auth/user-not-found":         "Kullanıcı bulunamadı.",
    "auth/wrong-password":         "Hatalı şifre.",
    "auth/too-many-requests":      "Çok fazla deneme. Lütfen bekleyin.",
    "auth/invalid-credential":     "Kullanıcı adı veya şifre hatalı.",
    "auth/network-request-failed": "Ağ bağlantısı hatası.",
    "auth/email-already-in-use":   "Bu kullanıcı adı zaten alınmış.",
    "auth/weak-password":          "Şifre en az 6 karakter olmalıdır.",
    "auth/operation-not-allowed":  "Kayıt şu an devre dışı.",
  };
  return map[code] || code || "İşlem başarısız. Lütfen tekrar deneyin.";
}

// ─────────────────────────────────────────────
// AYARLAR MODALI
// ─────────────────────────────────────────────
document.getElementById("btn-settings")?.addEventListener("click", () => {
  document.getElementById("modal-settings")?.classList.remove("hidden");
});
document.getElementById("modal-settings-close")?.addEventListener("click", () => {
  document.getElementById("modal-settings")?.classList.add("hidden");
});
document.getElementById("modal-settings")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget)
    document.getElementById("modal-settings").classList.add("hidden");
});

document.getElementById("btn-change-password")?.addEventListener("click", async () => {
  const pw1   = document.getElementById("input-new-password").value;
  const pw2   = document.getElementById("input-new-password-confirm").value;
  const errEl = document.getElementById("settings-pw-error");
  const btn   = document.getElementById("btn-change-password");
  errEl.textContent = "";
  if (!pw1) return (errEl.textContent = "Yeni şifre boş olamaz.");
  if (pw1 !== pw2) return (errEl.textContent = "Şifreler eşleşmiyor.");
  try {
    btn.disabled = true; btn.textContent = "Güncelleniyor…";
    await changePassword(pw1);
    showToast("Şifre güncellendi ✓");
    document.getElementById("input-new-password").value         = "";
    document.getElementById("input-new-password-confirm").value = "";
    document.getElementById("modal-settings").classList.add("hidden");
  } catch (err) {
    if (err.code === "auth/requires-recent-login") {
      errEl.textContent = "Bu işlem için yeniden giriş yapmanız gerekiyor.";
    } else {
      errEl.textContent = translateAuthError(err.code || err.message);
    }
  } finally {
    btn.disabled = false; btn.textContent = "Şifreyi Güncelle";
  }
});

const themeToggle = document.getElementById("toggle-theme");
const themeLabel  = document.getElementById("theme-label");

function applyTheme(isLight) {
  document.body.setAttribute("data-theme", isLight ? "light" : "dark");
  if (themeLabel) themeLabel.textContent = isLight ? "Açık (Matcha Latte)" : "Koyu (Espresso)";
}

const savedTheme  = localStorage.getItem("hankafem_theme");
const isLightSaved = savedTheme === "light";
if (themeToggle) themeToggle.checked = isLightSaved;
applyTheme(isLightSaved);

themeToggle?.addEventListener("change", (e) => {
  const isLight = e.target.checked;
  applyTheme(isLight);
  localStorage.setItem("hankafem_theme", isLight ? "light" : "dark");
});

// app.js'in en altına ekle:
document.addEventListener("click", (e) => {
  // Eğer mobildeysek ve order-panel'in üst kısmına (başlığa) tıklandıysa
  if (window.innerWidth <= 540) {
    const orderPanel = document.querySelector(".order-panel");
    if (orderPanel && e.target === orderPanel) {
      orderPanel.classList.toggle("open");
    }
  }
});