# Han Kafem POS — Kurulum & Yapılandırma Kılavuzu

## 📁 Klasör / Dosya Yapısı

```
han-kafem/
├── index.html              ← Ana SPA sayfası (tüm ekranlar burada)
├── manifest.json           ← PWA manifest
├── sw.js                   ← Service Worker (offline destek)
│
├── css/
│   └── style.css           ← Tüm UI stilleri
│
├── js/
│   ├── core.js             ← Firebase + Sheets iş mantığı (export'lu)
│   └── app.js              ← UI controller, DOM binding
│
├── icons/
│   ├── icon-192.png        ← PWA ikonu (192×192)
│   └── icon-512.png        ← PWA ikonu (512×512)
│
└── firebase/               ← (sadece referans, deploy edilmez)
    ├── database-structure.json   ← Örnek DB yapısı
    └── database.rules.json       ← Güvenlik kuralları
```

---

## 🔥 Firebase Kurulumu (Adım Adım)

### 1. Proje Oluşturma
1. [console.firebase.google.com](https://console.firebase.google.com) → "Proje Oluştur"
2. Proje adı: `han-kafem`
3. Google Analytics: isteğe bağlı

### 2. Realtime Database
1. Sol menü → **Build → Realtime Database → Create Database**
2. Konum: `europe-west1` (Avrupa/Frankfurt)
3. Başlangıç modu: **Test mode** (sonra kural koyacağız)

### 3. Güvenlik Kurallarını Uygulama
Firebase Console → Realtime Database → **Rules** sekmesi:
```json
// firebase/database.rules.json içeriğini buraya yapıştırın
```

### 4. Authentication Etkinleştirme
1. Sol menü → **Build → Authentication → Get started**
2. **Sign-in method** → Email/Password → Enable

### 5. Kullanıcıları Oluşturma
Authentication → Users → **Add user** ile her kullanıcıyı ekleyin.

Sonra Realtime Database → Data sekmesine girerek `users` noduna rolleri ekleyin:
```json
{
  "users": {
    "KULLANICI_UID_BURAYA": {
      "email": "admin@hankafem.com",
      "displayName": "Admin",
      "role": "admin",
      "createdAt": 1700000000000
    }
  }
}
```
> UID'yi Authentication → Users listesinden kopyalayın.

### 6. Firebase Config'i Uygulamaya Ekleyin
Firebase Console → Project Settings → **Your apps → Web**:
```javascript
// js/core.js dosyasında bu bölümü doldurun:
const firebaseConfig = {
  apiKey:            "...",
  authDomain:        "han-kafem.firebaseapp.com",
  databaseURL:       "https://han-kafem-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "han-kafem",
  storageBucket:     "han-kafem.appspot.com",
  messagingSenderId: "...",
  appId:             "..."
};
```

---

## 📊 Google Sheets Menü Kurulumu

### 1. Sheets Dokümanı Hazırlama
1. [sheets.google.com](https://sheets.google.com) → Yeni belge oluştur
2. Sheet (sekme) adını **`Menü`** olarak değiştirin
3. **A1'den başlayan sütun başlıkları (tam olarak böyle yazın):**

| id | name | category | price | description | active |
|----|------|----------|-------|-------------|--------|
| espresso | Espresso | Kahveler | 45 | Çift shot | TRUE |
| latte | Sütlü Kahve | Kahveler | 55 | | TRUE |
| cheesecake | Cheesecake | Tatlılar | 85 | | TRUE |

**Önemli notlar:**
- `id`: Türkçe karakter olmadan, küçük harf slug (espresso, latte, vs.)
- `price`: Sadece sayı (45, 85.50 gibi — ₺ işareti **koymayın**)
- `active`: Menüde gösterilsin mi? `TRUE` veya `FALSE`

### 2. Paylaşım Ayarı
Sheets → Sağ üst **Share** → "Anyone with the link" → **Viewer**

### 3. Sheet ID'sini Bulma
URL'den kopyalayın:
```
https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID_BURASI/edit
```

### 4. URL'yi core.js'e Ekleme
```javascript
// js/core.js — satır ~60
const SHEETS_URL = "https://opensheet.elk.sh/YOUR_SHEET_ID_BURAYA/Menü";
```

---

## 👥 Roller ve Yetkiler

| Özellik | Admin | Cashier (Kasa) | Waiter (Garson) |
|---------|:-----:|:--------------:|:---------------:|
| Masa Ekleme/Silme | ✅ | ❌ | ❌ |
| Sipariş Ekleme/Çıkarma | ✅ | ✅ | ✅ |
| Hesap Alma (Masa Kapatma) | ✅ | ✅ | ❌ |
| Geçmiş Siparişleri Görme | ✅ | ✅ | ❌ |
| Kullanıcı Yönetimi | ✅ | ❌ | ❌ |

---

## 🗄️ Firebase Veritabanı Ağaç Yapısı

```
/
├── users/
│   └── {uid}/
│       ├── email: string
│       ├── displayName: string
│       ├── role: "admin" | "cashier" | "waiter"
│       └── createdAt: timestamp
│
├── tables/
│   └── {tableId}/
│       ├── name: string          ← "Masa 1", "Bahçe 2"
│       ├── status: "empty"|"occupied"
│       ├── totalPrice: number    ← Anlık toplam
│       ├── openedAt: timestamp   ← İlk sipariş zamanı
│       ├── openedBy: uid
│       └── createdAt: timestamp
│
├── orders/
│   └── {tableId}/
│       └── {orderId}/
│           ├── productId: string
│           ├── productName: string
│           ├── category: string
│           ├── quantity: number
│           ├── unitPrice: number
│           ├── totalPrice: number ← quantity × unitPrice
│           ├── addedAt: timestamp
│           ├── addedBy: uid
│           ├── addedByName: string
│           └── note: string
│
├── history/
│   └── {YYYY-MM-DD}/             ← Günlük gruplandırma
│       └── {sessionId}/
│           ├── tableName: string
│           ├── tableId: string
│           ├── openedAt: timestamp
│           ├── closedAt: timestamp
│           ├── closedBy: uid
│           ├── closedByName: string
│           ├── totalAmount: number
│           ├── itemCount: number
│           └── items: { ...tüm sipariş kalemleri }
│
└── settings/
    ├── cafeName: "Han Kafem"
    ├── currency: "TL"
    ├── sheetsUrl: "https://..."
    └── lastMenuSync: timestamp
```

---

## 🚀 Deploy Seçenekleri

### Firebase Hosting (Önerilen)
```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # public dir: .  |  SPA: yes
firebase deploy
```

### Alternatif: Netlify
Sürükle-bırak ile `han-kafem/` klasörünü [netlify.com/drop](https://netlify.com/drop) adresine atın.

---

## 🔧 Günlük Ciro Sorgulama

`core.js` içindeki `getDailyRevenue` fonksiyonunu kullanarak:
```javascript
import { getDailyRevenue } from "./js/core.js";

const today = new Date().toISOString().split("T")[0]; // "2024-11-14"
const report = await getDailyRevenue(today);
console.log(report);
// {
//   date: "2024-11-14",
//   total: 1245.50,
//   sessionCount: 8,    ← kaç masa kapandı
//   itemCount: 43,       ← toplam ürün adedi
//   sessions: [...]
// }
```

---

## ⚠️ Önemli Notlar

1. **Fiyat güncellemesi**: Sheets'teki fiyatı değiştirdiğinizde yalnızca **yeni eklenecek** ürünler güncellenen fiyatı alır. Zaten masada olan siparişler mevcut `unitPrice` üzerinden hesaplanır — bu kasıtlı bir tasarım kararıdır (ciro tutarlılığı için).

2. **Menü cache**: `fetchMenu()` her sayfa yüklenişinde çağrılır. Çok sık güncelleme yoksa bunu Dashboard açılışında bir kez çağırmak yeterlidir.

3. **PWA kurulumu**: Chrome/Edge'de adres çubuğundaki "Uygulamayı kur" ikonu ile cihaza yüklenebilir.

4. **Çevrimdışı destek**: Service Worker yalnızca UI shell'i önbelleğe alır. Firebase Realtime DB bağlantısı çevrimiçi gerektirir.
