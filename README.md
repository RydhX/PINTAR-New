# PINTAR — Peta Interaktif Area & Tenant PT INTI

PINTAR adalah aplikasi WebGIS untuk melihat denah ruang, mengelola data tenant, dan menampilkan kontrak yang tersimpan di PostgreSQL.

## Menjalankan dengan Docker

Prasyarat: Docker Desktop dengan Docker Compose aktif.

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Buka <http://localhost:3000/login>. Backend menunggu database siap, membuat tabel pada database baru, lalu menyajikan aplikasi web dan API pada origin yang sama. Setelah login berhasil, aplikasi berpindah ke <http://localhost:3000/dashboard>.

Perintah operasional:

```powershell
docker compose ps
docker compose logs -f app
docker compose down
```

Database disimpan dalam volume persisten `pintar_postgres_data`. `docker compose down` mempertahankan data. Untuk menghapus data database prototipe secara permanen:

```powershell
docker compose down --volumes
```

Atur `POSTGRES_PASSWORD` pada file `.env` sebelum dipakai oleh lebih dari satu developer. Nilai bawaan di compose hanya untuk pengembangan lokal.

## Menjalankan tanpa Docker

Prasyarat: Node.js 22+, PostgreSQL, dan npm.

```powershell
npm install
Copy-Item .env.example .env
npm run db:init
npm start
```

Set `DATABASE_URL` di `.env` agar menunjuk database PostgreSQL lokal.

## API

- `GET /api/health` — status backend dan koneksi database.
- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` — sesi login demo.
- `GET /api/rooms` — snapshot ruang; detail tenant dibatasi untuk akun client.
- `GET /api/tenants?page=1&pageSize=25&sortBy=tenantName&sortDir=asc&paymentScheme=Termin` — data tenant dengan pagination, sorting, dan filter server-side. Data client dibatasi pada tenant miliknya. `pageSize` maksimum 100.
- `GET /api/invoices` — invoice mock sesuai cakupan role/tenant.
- `POST /api/contracts` — buat/perbarui kontrak (admin).
- `DELETE /api/rooms` — lepaskan ruang dari kontraknya (admin); kontrak dihapus otomatis jika tidak lagi memiliki ruang.

API terlindungi menggunakan bearer session token. Endpoint baca dapat digunakan semua role yang login; endpoint mutasi kontrak hanya mengizinkan admin. Nilai uang dan utilitas tersimpan sebagai angka PostgreSQL, tanggal sebagai `DATE`, dan pembayaran termin sebagai JSONB.

## Login demo dan role

Gunakan akun berikut pada halaman login:

| Role | Username | Password | Cakupan |
| --- | --- | --- | --- |
| Admin | `admin` | `admin123` | Peta, tabel, tambah, edit, dan hapus |
| Internal | `internal` | `internal123` | Peta, seluruh data tenant, ekspor; hanya baca |
| Client Tenant | `client` | `client123` | Ketersediaan ruang, data tenant PT Coba, dan invoice mock miliknya |

Login ini hanya untuk prototipe: akun, sesi, dan invoice berada di memori; sesi berakhir saat server dimulai ulang. Jangan gunakan kredensial ini atau mekanisme ini untuk produksi. Autentikasi produksi memerlukan penyimpanan/password hashing, sesi yang dikelola dengan aman, perlindungan CSRF bila memakai cookie, dan proses provisioning user-tenant yang tervalidasi.

Halaman login menyediakan pilihan akun demo yang mengisi kredensial secara otomatis. Dashboard mempertahankan peta WebGIS dan memakai layout panel mengambang untuk filter ruang dan detail unit. Route `/dashboard` dan `/login` dilayani sebagai entry point frontend; login tetap diverifikasi oleh API.

## Tabel tenant dan ekspor

Pilih **Data Tenant** di header untuk melihat daftar kontrak dari database. Tabel menggunakan pagination, filter skema pembayaran, dan pengurutan server-side. Tombol **Lihat** membuka ruang pertama pada denah untuk kontrak multi-ruang. Simpan atau hapus melalui editor peta akan langsung memuat ulang tabel.

Ekspor CSV mengeluarkan nominal sebagai angka dan tanggal ISO. Ekspor XLSX mempertahankan nilai uang sebagai angka dengan format Rupiah dan tanggal sebagai sel tanggal. SheetJS dimuat dari CDN untuk ekspor Excel.

## Struktur proyek

```text
index.html
style.css
app.js
data.js
data/
  auth.js                Login mock, session token, dan route guard frontend
  api.js                 REST API client untuk denah
  client-portal.js       UI data tenant dan invoice milik client
  tenant-table.js        UI tabel, filter, pagination, dan ekspor
server/
  index.js               Express server, route frontend, dan static hosting
  auth.js                Mock login, sesi, dan middleware RBAC
  tenants.js             Endpoint ruang, kontrak, dan tabel tenant
  db.js                  PostgreSQL connection pool
  schema.sql             Struktur database dan indeks
docker-compose.yml
Dockerfile
```

Data peta dan daftar ruang yang dapat dipilih masih dikonfigurasi pada `data.js`; data tenant/kontrak tersimpan di PostgreSQL. Invoice yang ditampilkan adalah fixture mock, bukan invoice akuntansi dari database. RBAC ini dimaksudkan untuk demo lokal saja; jangan buka port server ke jaringan publik atau masukkan data pribadi/kontrak nyata sebelum autentikasi produksi dan kebijakan keamanan ditetapkan.
