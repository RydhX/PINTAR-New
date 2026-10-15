# Database PostgreSQL PINTAR

## Menyalakan layanan

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Compose menjalankan PostgreSQL 16 dan Express. Container aplikasi menggunakan alamat internal Docker `db:5432`, sedangkan komputer host dapat mengakses PostgreSQL di `localhost:5433` agar tidak berbenturan dengan PostgreSQL yang mungkin sudah terpasang di Windows. Schema dibuat saat volume database pertama kali diinisialisasi.

Jika volume database telah ada sebelum perubahan schema, jalankan migrasi schema:

```powershell
Get-Content server/schema.sql | docker compose exec -T db psql -U pintar -d pintar
```

Jalankan `docker compose down --volumes` hanya jika ingin menghapus database dan seluruh data prototipe.

## Endpoint dan model data

- `tenant_contracts` menyimpan detail bersama tenant, skema/tagihan, tanggal kontrak, dan utilitas.
- `contract_rooms` menyimpan relasi kontrak ke ruang, status okupansi, serta luas per ruang. Kunci gedung/lantai/ruang unik mencegah ruang tertaut ke dua kontrak sekaligus.
- `GET /api/rooms` memberi data ruang untuk WebGIS.
- `GET /api/tenants` memberi data tabel dengan filter, sorting, dan pagination.
- `POST /api/contracts` memvalidasi input dan menyimpan kontrak plus ruang dalam satu transaksi.
- `DELETE /api/rooms` melepas ruang dari kontrak dan menghapus kontrak jika sudah tidak memiliki ruang.

Detail request/response dan perintah pengembangan ada di README.
