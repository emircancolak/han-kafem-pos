// ============================================================
// HAN KAFEM - UI CONTROLLER (js/app.js)
// View katmanı — DOM manipülasyonu ve event binding
// ============================================================

import {
  login, logout, register, watchAuthState,
  changePassword,
  fetchMenu, getMenuByCategory,
  addTable, deleteTable, watchTables, moveTable,
  addOrderItem, removeOrderItem, watchTableOrders,
  closeTable, paySelectedItems,
  getDailyRevenue, getDailySalesSummary, getHistoryByDate,
  sendKitchenNotification, watchNotifications, markNotificationReady,
  getAllUsers, updateUserRole, deleteUserRecord,
  formatCurrency,toggleStarredItem, watchStarredItems,
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
// Hesabı Bölme — {key → qty} şeklinde kısmi adet seçimleri
let partialSelections = {};
// Aktif masa ID'si
let currentTableId = null;

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
    showMenuLoadingOverlay(true);
    try {
      await fetchMenu();
    } catch {
      showToast("Menü yüklenemedi!", "error");
    } finally {
      showMenuLoadingOverlay(false);
    }
    showScreen("dashboard");

    // Yıldızlı ürünleri Firebase'den izle
    watchStarredItems((starred) => {
      AppState.starredItems = starred;
      // Eğer masa ekranındaysak menüyü yenile
      if (currentTableId) {
        renderMenu(currentTableId);
      }
    });

    startDashboard();
    startNotificationListener();
  },
  (reason) => {
    // ÇÖZÜM: Buton "Giriş yapılıyor..." durumunda takılı kaldıysa sıfırla
    const loginBtn = document.getElementById("btn-login");
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.textContent = "Giriş Yap";
    }

    if (reason === "pending") {
      showScreen("login");
      // Login ekranı görünür olduğunda hata mesajını göster
      const errEl = document.getElementById("login-error");
      if (errEl) errEl.textContent = "Hesabınız onay bekliyor. Lütfen yöneticinizle iletişime geçin.";
    } else {
      showScreen("login");
    }
  }
);

// ─────────────────────────────────────────────
// Loading Animasyonu
// ─────────────────────────────────────────────
function showMenuLoadingOverlay(show) {
  const overlay = document.getElementById("loading-overlay");
  if (overlay) overlay.classList.toggle("hidden", !show);
}

// ─────────────────────────────────────────────
// GİRİŞ EKRANI
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// GİRİŞ / KAYIT EKRANI — Toggle mekanizması
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// GİRİŞ / KAYIT EKRANI — Toggle mekanizması
// ─────────────────────────────────────────────

let authMode = "login";

function setAuthMode(mode) {
  authMode = mode;

  const loginSection    = document.getElementById("login-section");
  const registerSection = document.getElementById("register-section");
  const toggleFwdRow    = document.querySelector(".auth-toggle:not(#toggle-back-login)");
  const toggleBackRow   = document.getElementById("toggle-back-login");

  // Hata mesajlarını temizle
  const loginErr = document.getElementById("login-error");
  const regErr   = document.getElementById("register-error");
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

// Listener'lar doğrudan id'li butonlara bağlanıyor
document.getElementById("btn-go-register")?.addEventListener("click", () => setAuthMode("register"));
document.getElementById("btn-go-login")?.addEventListener("click",    () => setAuthMode("login"));

// ── GİRİŞ ──
document.getElementById("btn-login").addEventListener("click", async () => {
  const username = document.getElementById("input-username").value.trim();
  const password = document.getElementById("input-password").value;
  const errEl    = document.getElementById("login-error");
  const btn      = document.getElementById("btn-login");

  try {
    errEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "Giriş yapılıyor…";
    
    // Dummy Domain Eklentisi (Burayı ekledik)
    const email = username.includes("@") ? username : `${username}@hankafem.com`;
    
    const rememberMe = document.getElementById("chk-remember-me")?.checked ?? true;
    await login(email, password, rememberMe);
  } catch (err) {
    errEl.textContent = translateAuthError(err.code || err.message);
    btn.disabled = false;
    btn.textContent = "Giriş Yap";
  }
});

["input-username", "input-password"].forEach(id => {
  document.getElementById(id)?.addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("btn-login").click();
  });
});

// ── KAYIT OL ──
// ── KAYIT OL ──
document.getElementById("btn-register")?.addEventListener("click", async () => {
  const fullName = document.getElementById("input-reg-fullname").value.trim();
  const username = document.getElementById("input-reg-username").value.trim();
  const password = document.getElementById("input-reg-password").value;
  const errEl    = document.getElementById("register-error");
  const btn      = document.getElementById("btn-register");

  try {
    errEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "Kaydediliyor…";

    const email = username.includes("@") ? username : `${username}@hankafem.com`;

    // core.js'deki register fonksiyonuna verileri gönderiyoruz
    await register(fullName, email, password);

    // ÇÖZÜM: Kayıt ve DB yazma işlemi bitti. 
    // Yarış durumundan (race condition) etkilenen UI'ı kurtarmak için sayfayı yenile.
    // Firebase Auth oturumu aktif olduğu için sayfa açılır açılmaz Dashboard'a yönlendirileceksin.
    btn.textContent = "Başarılı! Yönlendiriliyor...";
    setTimeout(() => {
      window.location.reload();
    }, 500);

  } catch (err) {
    errEl.textContent = translateAuthError(err.code || err.message);
    btn.disabled = false;
    btn.textContent = "Kayıt Ol";
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
  const grid = document.getElementById("table-grid");

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
      const card = buildTableCard(tableId, table);
      grid.appendChild(card);
    });
  });

  const isAdmin = AppState.currentUser?.role === "admin";
  document.getElementById("admin-controls").style.display = isAdmin ? "flex" : "none";

  const staffBtn = document.getElementById("btn-staff-management");
  if (staffBtn) staffBtn.style.display = isAdmin ? "inline-flex" : "none";

  const reportBtn = document.getElementById("btn-report");
  const canReport = ["admin", "cashier"].includes(AppState.currentUser?.role);
  if (reportBtn) reportBtn.style.display = canReport ? "inline-flex" : "none";
}

function buildTableCard(tableId, table) {
  const card     = document.createElement("div");
  const occupied = table.status === "occupied";

  card.className = `table-card ${occupied ? "occupied" : "empty"}`;
  card.dataset.tableId = tableId;

  card.innerHTML = `
    <div class="table-card__icon">${occupied ? "🍽️" : "🪑"}</div>
    <div class="table-card__name">${table.name}</div>
    <div class="table-card__price">
      ${occupied ? formatCurrency(table.totalPrice || 0) : "Boş"}
    </div>
    ${AppState.currentUser?.role === "admin" && !occupied
      ? `<button class="btn-icon btn-delete-table" data-id="${tableId}" title="Masayı Sil">✕</button>`
      : ""}
  `;

  card.addEventListener("click", (e) => {
    if (e.target.closest(".btn-delete-table")) return;
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

// ─────────────────────────────────────────────
// OTOMATİK MASA İSİMLENDİRME
// Input boş bırakılırsa mevcut masaları tarar,
// "Masa N" formatında ilk boş numarayı bulur.
// ─────────────────────────────────────────────
function autoTableName() {
  const existingNames = Object.values(AppState.tables).map(t =>
    (t.name || "").toLowerCase().trim()
  );

  let num = 1;
  while (existingNames.includes(`masa ${num}`)) {
    num++;
  }
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

  currentTableId = tableId;
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

  // ─────────────────────────────────────────────
  // Mobil Buton Yönetimi ve Yetkilendirme
  // ─────────────────────────────────────────────
  const canClose    = ["admin", "cashier"].includes(AppState.currentUser?.role);
  const closeBtn    = document.getElementById("btn-close-table");
  const moveBtn     = document.getElementById("btn-move-table");
  const kitchenBtn  = document.getElementById("btn-send-kitchen");
  const mobileSlot  = document.getElementById("close-table-mobile-slot");
  const headerRight = document.querySelector("#screen-table .header-right");

  // Mobil ekranda tüm eylem butonlarını alt kısımdaki slota taşı
  if (window.innerWidth <= 540) {
    if (mobileSlot) {
      if (moveBtn) mobileSlot.appendChild(moveBtn);
      if (kitchenBtn) mobileSlot.appendChild(kitchenBtn);
      if (closeBtn) mobileSlot.appendChild(closeBtn);
    }
  } else {
    // Bilgisayarda tekrar yukarıya (header) al
    if (headerRight) {
      if (moveBtn) headerRight.appendChild(moveBtn);
      if (kitchenBtn) headerRight.appendChild(kitchenBtn);
      if (closeBtn) headerRight.appendChild(closeBtn);
    }
  }

  // Yetki: "waiter" için hesabı al butonunu kesinlikle gizle
  if (closeBtn) {
    if (canClose) {
      closeBtn.removeAttribute("hidden");
      closeBtn.style.setProperty("display", "flex", "important");
    } else {
      closeBtn.style.setProperty("display", "none", "important");
    }
  }

  // ─────────────────────────────────────────────
  // "Seçilenleri Öde" — Sadece admin / cashier
  // ─────────────────────────────────────────────
  const paySelectedBtn = document.getElementById("btn-pay-selected");
  if (paySelectedBtn) {
    paySelectedBtn.style.display = canClose ? "" : "none";

    paySelectedBtn.onclick = async () => {
      const selArr = Object.entries(partialSelections)
        .filter(([, qty]) => qty > 0)
        .map(([key, qty]) => ({ key, qty }));

      if (selArr.length === 0)
        return showToast("Lütfen ödenecek ürünleri seçin.", "warn");

      const orders = AppState.orders[tableId] || {};
      const selTotal = selArr.reduce((s, { key, qty }) => {
        const unitPrice = orders[key]?.unitPrice || 0;
        return s + unitPrice * qty;
      }, 0);

      const lines = selArr.map(({ key, qty }) =>
        `${orders[key]?.productName || key}: ${qty} adet`
      ).join("\n");

      if (!confirm(`Aşağıdaki ürünler için ${formatCurrency(selTotal)} ödensin mi?\n\n${lines}`)) return;

      try {
        const selArrSnapshot = [...selArr];
        partialSelections = {};
        const result = await paySelectedItems(tableId, selArrSnapshot);
        showToast(`✓ ${formatCurrency(result.selectedTotal)} ödendi. Kalan sipariş masada açık.`);
      } catch (err) {
        showToast(err.message, "error");
      }
    };
  }

  // Masayı tamamen kapatma işlemi
  if (closeBtn) {
    closeBtn.onclick = async () => {
      if (!confirm(`"${tableName}" masasını kapatmak ve hesabı almak istiyor musunuz?`)) return;
      try {
        const summary = await closeTable(tableId);
        showToast(`✓ Hesap alındı: ${formatCurrency(summary.totalAmount)}`);
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

  // Masa Taşıma
  if (moveBtn) {
    moveBtn.onclick = () => openMoveTableModal(tableId);
  }

  // Mutfak Bildirim
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
// MENÜ RENDER
// ─────────────────────────────────────────────
function renderMenu(tableId) {
  const menuEl = document.getElementById("menu-list");
  const grouped = getMenuByCategory();
  menuEl.innerHTML = "";

  Object.entries(grouped).forEach(([category, items]) => {
    const catEl = document.createElement("div");
    catEl.className = "menu-category";

    const isPinned = category.includes("Öne Çıkanlar");
    catEl.innerHTML = `<h3 class="menu-category__title ${isPinned ? "menu-category__title--hot" : ""}">${category}</h3>`;

    items.forEach(product => {
      const row = document.createElement("div");
      row.className = "menu-item";
      const isAdmin   = AppState.currentUser?.role === "admin";
const isStarred = !!(AppState.starredItems || {})[product.id];

row.innerHTML = `
  <div class="menu-item__info">
    <span class="menu-item__name">${product.name}</span>
    <span class="menu-item__price">${formatCurrency(product.price)}</span>
  </div>
  <div class="menu-item__controls">
    ${isAdmin
      ? `<button class="btn-star ${isStarred ? "btn-star--active" : ""}"
                 data-id="${product.id}"
                 title="${isStarred ? "Yıldızı Kaldır" : "Öne Çıkar"}">
           ${isStarred ? "⭐" : "☆"}
         </button>`
      : ""}
    <button class="btn-qty btn-minus" data-id="${product.id}">−</button>
    <span class="qty-display" id="qty-${product.id}">0</span>
    <button class="btn-qty btn-plus" data-id="${product.id}">+</button>
  </div>
`;

// Yıldız toggle listener — YENİ (mevcut + ve - listener'larından önce)
if (isAdmin) {
  row.querySelector(".btn-star")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await toggleStarredItem(product.id, isStarred);
      // renderMenu çağrısı watchStarredItems listener'ı tarafından tetiklenecek
    } catch (err) {
      showToast("Hata: " + err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });
}

      row.querySelector(".btn-plus").addEventListener("click", async (e) => {
        const btn = e.target;
        btn.disabled = true;
        try {
          const current = getProductQtyInOrder(tableId, product.id);
          await addOrderItem(tableId, product, current + 1);
        } catch (err) {
          showToast("Hata: " + err.message, "error");
        } finally {
          btn.disabled = false;
        }
      });

      row.querySelector(".btn-minus").addEventListener("click", async (e) => {
  const btn   = e.target;
  const qtyEl = document.getElementById(`qty-${product.id}`);
  btn.disabled = true;
  try {
    const current = getProductQtyInOrder(tableId, product.id);
    if (current > 0) {
      const newQty = current - 1;
      // UI'yi anında sıfırla; Firebase callback geç gelebilir
      if (qtyEl) qtyEl.textContent = String(newQty);
      await addOrderItem(tableId, product, newQty);
    } else {
      // Zaten 0, UI'yi düzelt
      if (qtyEl) qtyEl.textContent = "0";
    }
  } catch (err) {
    // Hata durumunda DB'den güncel değeri yeniden çek
    const fallback = getProductQtyInOrder(tableId, product.id);
    if (qtyEl) qtyEl.textContent = String(fallback);
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
// SİPARİŞ LİSTESİ RENDER
// Her kalem için +/- butonlarıyla "ödenecek adet" seçimi
// ─────────────────────────────────────────────
function renderOrderList(tableId, orders) {
  const listEl  = document.getElementById("order-list");
  const totalEl = document.getElementById("order-total");
  listEl.innerHTML = "";

  const entries = Object.entries(orders);
  let total = 0;

  if (entries.length === 0) {
    listEl.innerHTML = `<p class="order-empty">Henüz sipariş yok.</p>`;
    totalEl.textContent = formatCurrency(0);
    updateSelectedTotal(orders);
    return;
  }

  // partialSelections'ı mevcut siparişlerle temizle + adetleri sınırla
  Object.keys(partialSelections).forEach(k => {
    if (!orders[k]) {
      delete partialSelections[k];
    } else {
      // Ürün adeti Firebase'de azalmışsa seçimi düzelt
      const maxAllowed = orders[k].quantity || 0;
      if (partialSelections[k] > maxAllowed) {
        partialSelections[k] = maxAllowed;
      }
      if (partialSelections[k] <= 0) delete partialSelections[k];
    }
  });

  entries.forEach(([key, item]) => {
    total += item.totalPrice || 0;

    const canClose = ["admin", "cashier"].includes(AppState.currentUser?.role);
    const selQty = partialSelections[key] ?? 0;
    const maxQty = item.quantity ?? 0;
    // Ekstra güvenlik: selQty hiçbir zaman maxQty'yi aşmasın
    const safeSelQty = Math.min(selQty, maxQty);

    const row = document.createElement("div");
    row.className = `order-item${safeSelQty > 0 ? " order-item--selected" : ""}`;

    row.innerHTML = `
      <div class="order-item__partial" style="${canClose ? "" : "visibility:hidden;pointer-events:none"}">
        <button class="btn-partial btn-partial-minus" data-key="${key}" ${safeSelQty <= 0 ? "disabled" : ""}>−</button>
        <span class="partial-qty" title="Ödenecek adet">${safeSelQty}</span>
        <button class="btn-partial btn-partial-plus"  data-key="${key}" ${safeSelQty >= maxQty ? "disabled" : ""}>+</button>
      </div>
      <span class="order-item__name">${item.productName}</span>
      <span class="order-item__qty">x${item.quantity}</span>
      <span class="order-item__total">${formatCurrency(item.totalPrice)}</span>
    `;

    // Ödenecek adet +
    row.querySelector(".btn-partial-plus").addEventListener("click", () => {
      const cur = partialSelections[key] ?? 0;
      if (cur < maxQty) {
        partialSelections[key] = cur + 1;
        renderOrderList(tableId, orders);
      }
    });

    // Ödenecek adet -
    row.querySelector(".btn-partial-minus").addEventListener("click", () => {
      const cur = partialSelections[key] ?? 0;
      if (cur > 0) {
        partialSelections[key] = cur - 1;
        if (partialSelections[key] === 0) delete partialSelections[key];
        renderOrderList(tableId, orders);
      }
    });

    listEl.appendChild(row);

    // Menü qty göstergelerini güncelle
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

// Seçili kısmi ödeme toplamını güncelle
function updateSelectedTotal(orders) {
  const selTotalEl = document.getElementById("selected-total");
  const payBtn     = document.getElementById("btn-pay-selected");
  if (!selTotalEl) return;

  // Waiter rolü hiçbir zaman kısmi ödeme yapamaz
  const canClose = ["admin", "cashier"].includes(AppState.currentUser?.role);
  if (!canClose) {
    selTotalEl.classList.add("hidden");
    if (payBtn) payBtn.style.display = "none";
    return;
  }

  const selTotal = Object.entries(partialSelections).reduce((s, [key, qty]) => {
    const unitPrice = orders[key]?.unitPrice || 0;
    return s + unitPrice * qty;
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

function getProductQtyInOrder(tableId, productId) {
  const tableOrders = AppState.orders[tableId] || {};
  const item = Object.values(tableOrders).find(o => o.productId === productId);
  return item?.quantity || 0;
}

// ─────────────────────────────────────────────
// Masa Taşıma — Modal
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
      btn.className = "btn btn--accent move-table-btn";
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
// Mutfak Bildirim Sistemi
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
          const itemsText = (notif.items || [])
            .map(i => `${i.qty}x ${i.name}`)
            .join(", ");
          el.innerHTML = `
            <div class="notif-item__header">
              <strong>${notif.tableName}</strong>
              <span class="notif-item__time">${formatRelativeTime(notif.sentAt)}</span>
            </div>
            <div class="notif-item__items">${itemsText}</div>
            <button class="btn btn--sm btn--primary notif-ready-btn" data-key="${key}">✓ Hazır</button>
          `;
          el.querySelector(".notif-ready-btn").addEventListener("click", async (e) => {
            e.stopPropagation(); // Tıklamanın arkaya geçip menüyü kapatmasını engeller
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

function sendBrowserNotification(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "icons/icon-192.png" });
  }
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "az önce";
  if (mins < 60) return `${mins} dk önce`;
  return `${Math.floor(mins / 60)} sa önce`;
}

// ─────────────────────────────────────────────
// GÜN SONU RAPORU + PDF (Türkçe karakter desteği)
// ─────────────────────────────────────────────
document.getElementById("btn-report")?.addEventListener("click", () => {
  const modal = document.getElementById("modal-report");
  if (modal) {
    const today = new Date().toISOString().split("T")[0];
    document.getElementById("report-date-input").value = today;
    modal.classList.remove("hidden");
    loadReport(today);
  }
});

document.getElementById("report-date-input")?.addEventListener("change", (e) => {
  loadReport(e.target.value);
});

document.getElementById("modal-report-close")?.addEventListener("click", () => {
  document.getElementById("modal-report")?.classList.add("hidden");
});

document.getElementById("modal-report")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget)
    document.getElementById("modal-report").classList.add("hidden");
});

async function loadReport(date) {
  const bodyEl   = document.getElementById("report-body");
  const totalEl  = document.getElementById("report-total");
  const countEl  = document.getElementById("report-session-count");
  bodyEl.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-3)">Yükleniyor…</td></tr>`;

  try {
    const summary = await getDailySalesSummary(date);

    totalEl.textContent = formatCurrency(summary.grandTotal);
    countEl.textContent = `${summary.sessionCount} hesap`;

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

// ─────────────────────────────────────────────
// PDF — Türkçe karakter desteği için gömülü TTF
//
// NOT: Aşağıdaki ROBOTO_TTF_BASE64 değişkenini,
// Roboto-Regular.ttf dosyasının Base64 karşılığıyla
// doldurun. Terminalde şu komutla üretebilirsiniz:
//   base64 -w 0 Roboto-Regular.ttf
// veya Node.js ile:
//   require("fs").readFileSync("Roboto-Regular.ttf","base64")
//
// woff2 KULLANMAYIN — jsPDF sadece TTF destekler.
// String boş bırakılırsa otomatik olarak helvetica +
// Türkçe karakter normalize fallback'e geçer.
// ─────────────────────────────────────────────

// Buraya Roboto-Regular.ttf'nin Base64 string'ini yapıştırın:
document.getElementById("btn-report-pdf")?.addEventListener("click", async () => {
  const date    = document.getElementById("report-date-input").value;
  const summary = await getDailySalesSummary(date).catch(() => null);
  if (!summary) return showToast("Rapor yüklenemedi.", "error");

  const { jsPDF } = window.jspdf;
  const doc       = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // Kullanıcıya işlemin başladığını bildiriyoruz çünkü font inmesi 1-2 saniye sürebilir
  showToast("PDF hazırlanıyor, lütfen bekleyin...", "warn");

  let fontName = "helvetica";
  
  try {
    // 1. Fontu güvenilir bir CDN'den otomatik çekiyoruz (Terminal'e gerek kalmadı)
    const res = await fetch("https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Regular.ttf");
    const buffer = await res.arrayBuffer();
    
    // 2. JS ile anında Base64'e çeviriyoruz
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const fontB64 = window.btoa(binary);

    // 3. jsPDF'e yüklüyoruz
    doc.addFileToVFS("Roboto-Regular.ttf", fontB64);
    doc.addFont("Roboto-Regular.ttf", "Roboto", "normal");
    doc.setFont("Roboto");
    fontName = "Roboto";
  } catch (e) {
    console.warn("Font internetten çekilemedi, varsayılana dönülüyor:", e);
    // Hata olursa varsayılan helvetica ile devam eder (Türkçe karakterleri replace ederek)
  }

  // Türkçe karakterleri normalize et (fallback helvetica için)
  const tr = (str) => fontName === "Roboto"
    ? String(str)
    : String(str)
        .replace(/ğ/g, "g").replace(/Ğ/g, "G")
        .replace(/ü/g, "u").replace(/Ü/g, "U")
        .replace(/ş/g, "s").replace(/Ş/g, "S")
        .replace(/ı/g, "i").replace(/İ/g, "I")
        .replace(/ö/g, "o").replace(/Ö/g, "O")
        .replace(/ç/g, "c").replace(/Ç/g, "C");

  // Başlık ve Bilgiler
  doc.setFontSize(18);
  doc.setFont(fontName, "bold");
  doc.text(tr("Han Kafem — Gün Sonu Raporu"), 14, 20);

  doc.setFont(fontName, "normal");
  doc.setFontSize(11);
  doc.text(tr(`Tarih: ${date}`), 14, 30);
  doc.text(tr(`Toplam Ciro: ${formatCurrency(summary.grandTotal)}`), 14, 37);
  doc.text(tr(`İşlem Sayısı: ${summary.sessionCount} hesap`), 14, 44);

  // Tablo Verileri
  const tableData = summary.products.map((p, i) => [
    i + 1,
    tr(p.productName),
    tr(p.category),
    p.quantity,
    formatCurrency(p.totalRevenue)
  ]);

  doc.autoTable({
    head: [[tr("#"), tr("Ürün"), tr("Kategori"), tr("Adet"), tr("Ciro")]],
    body: tableData,
    startY: 52,
    theme: "striped",
    headStyles: { fillColor: [232, 148, 26], textColor: 15, font: fontName },
    styles: { font: fontName, fontSize: 10 },
    columnStyles: { 0: { halign: "center" }, 3: { halign: "center" }, 4: { halign: "right" } }
  });

  doc.save(`hankafem-rapor-${date}.pdf`);
  showToast("PDF oluşturuldu! ✓");
});

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
    const users = await getAllUsers();
    listEl.innerHTML = "";

    if (Object.keys(users).length === 0) {
      listEl.innerHTML = `<p style="color:var(--text-3)">Kullanıcı bulunamadı.</p>`;
      return;
    }

    const roleLabels = { admin: "Admin", cashier: "Kasa", waiter: "Garson", pending: "⏳ Bekliyor" };

    Object.entries(users).forEach(([uid, user]) => {
      const isSelf = uid === AppState.currentUser.uid;
      const row = document.createElement("div");
      row.className = "staff-row";
      row.innerHTML = `
  <div class="staff-row__info">
    <span class="staff-row__name">${user.displayName || user.email || uid}</span>
    <span class="staff-row__email">${user.email || ""}</span>
    ${user.role === "pending"
      ? `<span class="staff-pending-badge">⏳ Onay Bekliyor</span>`
      : ""}
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

// Rol değişimi listener (mevcut)
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

  // Silme listener — YENİ
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
// TOAST BİLDİRİMLER
// ─────────────────────────────────────────────
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
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
// Önceki adımda eklediğiniz settings-modal bloğunun sonuna:
document.getElementById("btn-change-password")?.addEventListener("click", async () => {
  const pw1   = document.getElementById("input-new-password").value;
  const pw2   = document.getElementById("input-new-password-confirm").value;
  const errEl = document.getElementById("settings-pw-error");
  const btn   = document.getElementById("btn-change-password");

  errEl.textContent = "";
  if (!pw1) return (errEl.textContent = "Yeni şifre boş olamaz.");
  if (pw1 !== pw2) return (errEl.textContent = "Şifreler eşleşmiyor.");

  try {
    btn.disabled = true;
    btn.textContent = "Güncelleniyor…";
    await changePassword(pw1);
    showToast("Şifre güncellendi ✓");
    document.getElementById("input-new-password").value = "";
    document.getElementById("input-new-password-confirm").value = "";
    document.getElementById("modal-settings").classList.add("hidden");
  } catch (err) {
    // Firebase "requires-recent-login" hatasını yakala
    if (err.code === "auth/requires-recent-login") {
      errEl.textContent = "Bu işlem için yeniden giriş yapmanız gerekiyor. Lütfen çıkış yapıp tekrar giriş yapın.";
    } else {
      errEl.textContent = translateAuthError(err.code || err.message);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Şifreyi Güncelle";
  }
});

// ── Tema Yönetimi ──
const themeToggle = document.getElementById("toggle-theme");
const themeLabel  = document.getElementById("theme-label");

function applyTheme(isLight) {
  document.body.setAttribute("data-theme", isLight ? "light" : "dark");
  if (themeLabel) {
    themeLabel.textContent = isLight ? "Açık (Matcha Latte)" : "Koyu (Espresso)";
  }
}

// localStorage'dan yükle
const savedTheme = localStorage.getItem("hankafem_theme");
const isLightSaved = savedTheme === "light";
if (themeToggle) themeToggle.checked = isLightSaved;
applyTheme(isLightSaved);

themeToggle?.addEventListener("change", (e) => {
  const isLight = e.target.checked;
  applyTheme(isLight);
  localStorage.setItem("hankafem_theme", isLight ? "light" : "dark");
});
