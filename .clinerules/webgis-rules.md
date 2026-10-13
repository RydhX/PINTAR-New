# General Coding Rules
1. Selalu tulis kode yang modular, bersih, dan berikan komentar penjelasan singkat dalam Bahasa Indonesia.
2. Sebelum mengubah file yang ada, selalu baca konteks file terkait terlebih dahulu.
3. Hindari mengganti seluruh kode jika hanya perlu menambahkan fitur kecil (gunakan incremental editing).

# WebGIS & Frontend Stack Guidance
1. Pastikan penanganan data spasial (GeoJSON/Leaflet/Mapbox) dioptimalkan agar tidak lag saat rendering data/tenant banyak.
2. Gunakan struktur CSS/Tailwind yang rapi dan responsif di layar laptop maupun mobile.
3. Hindari penggunaan variabel global yang berpotensi bentrok; gunakan ES6 module atau struktur fungsi terisolasi.