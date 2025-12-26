# PPPoE Billing Management System

Sistem manajemen billing lengkap dengan fitur **Multi-User** dan **Sinkronisasi Data Real-Time** untuk pelanggan Internet (PPPoE) dan Gas.

## ✨ Fitur Baru

### Multi-User Support
- **Login dengan multiple user** - Beberapa staf dapat login bersamaan
- **Role-based access** - Admin dan Staff dengan权限 berbeda
- **Session management** - Keamanan dengan JWT token
- **Audit trail** - Log aktivitas semua user

### Real-Time Synchronization
- **Data tersinkronisasi otomatis** antar semua user yang login
- Perubahan langsung terlihat di semua perangkat
- Menggunakan Server-Sent Events (SES) untuk update real-time
- Tidak perlu refresh manual

## 🚀 Instalasi

### 1. Install Dependencies
```bash
npm install
```

### 2. Jalankan Server
```bash
npm start
```

Server akan berjalan di `http://localhost:3000`

## 🔑 Default Login

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin123` |
| Staff | `staff` | `staff123` |

## 👥 Manajemen User (Admin Only)

### Fitur User Management:
- Tambah user baru (Admin/Staff)
- Aktifkan/Nonaktifkan user
- Lihat log aktivitas
- Password terenkripsi dengan bcrypt

### Akses per Role:

| Fitur | Admin | Staff |
|-------|-------|-------|
| Dashboard | ✅ | ✅ |
| Transaksi | ✅ | ✅ |
| Pelanggan | ✅ | ✅ |
| WhatsApp | ✅ | ✅ |
| Laporan | ✅ | ✅ |
| Pengaturan | ✅ | ❌ |
| Kelola User | ✅ | ❌ |
| Backup/Restore | ✅ | ❌ |

## 📱 WhatsApp Integration

### Template Otomatis:
- **Internet/PPPoE**: Pesan tagihan lengkap dengan username & password
- **Gas**: Faktur penjualan gas

### Broadcast:
- Kirim ke satu customer
- Kirim ke semua customer dengan tunggakan (otomatis filter berdasarkan tipe)

## 📊 Sinkronisasi Real-Time

Ketika ada perubahan data (transaksi/customer/settings) dari user manapun:
1. Server menerima data
2. Data disimpan ke SQLite database
3. Server broadcast notifikasi ke semua client yang terhubung via SSE
4. Semua client otomatis refresh data tanpa perlu refresh halaman

### Teknologi:
- **SQLite** - Database terpusat
- **JWT** - Authentication
- **Server-Sent Events (SSE)** - Real-time sync
- **whatsapp-web.js** - WhatsApp automation

## 📂 Struktur File

```
pppoe-billing-server/
├── package.json          # Dependencies
├── server.js             # Express server utama
├── database.js           # SQLite database operations
├── whatsapp.js           # WhatsApp automation
├── .env                  # Konfigurasi (copy dari .env.example)
├── billing.db            # Database SQLite (auto-generated)
├── session/              # Session WhatsApp (auto-generated)
├── public/
│   └── index.html        # Frontend aplikasi
└── README.md             # Dokumentasi
```

## 🔧 API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `GET /api/auth/verify` - Verify token

### Users (Admin Only)
- `GET /api/users` - List semua user
- `POST /api/users` - Tambah user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Hapus user

### Customers
- `GET /api/customers` - List customer
- `POST /api/customers` - Tambah customer
- `PUT /api/customers/:id` - Update customer
- `DELETE /api/customers/:id` - Hapus customer

### Transactions
- `GET /api/transactions` - List transaksi
- `POST /api/transactions` - Tambah transaksi
- `POST /api/transactions/:id/mark-lunas` - Tandai lunas
- `DELETE /api/transactions/:id` - Hapus transaksi
- `GET /api/transactions/stats` - Statistik

### WhatsApp
- `GET /api/whatsapp/status` - Status koneksi
- `POST /api/whatsapp/start` - Mulai service
- `POST /api/whatsapp/stop` - Stop service
- `POST /api/whatsapp/send-billing` - Kirim ke 1 customer
- `POST /api/whatsapp/broadcast` - Broadcast ke semua

### Settings & Backup
- `GET /api/settings` - Ambil pengaturan
- `POST /api/settings` - Simpan pengaturan
- `GET /api/backup` - Export backup (Admin)
- `POST /api/restore` - Restore backup (Admin)

## ⚠️ Catatan

1. **Database**: Semua data tersimpan di `billing.db` (SQLite)
2. **Session WhatsApp**: Hapus folder `session/` untuk reset autentikasi WhatsApp
3. **Token JWT**: Expired dalam 24 jam
4. **Rate Limiting**: Ada jeda 1.5 detik antar pesan broadcast

## 📄 License

MIT License
