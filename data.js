/* Struktur peta dan data cadangan awal PINTAR */
const AREA_SVG = "assets/Area77_DraftTata.svg";

const DATA = {
  buildings: [
    {
      id: "GKP",
      name: "Gedung Kantor Pusat",
      active: true,
      polygonId: "GD_GKP", // id polygon gedung di Area77_DraftTata.svg
      floors: [
        {
          id: "L2",
          name: "Lantai 2",
          svg: "assets/GKP_LT_2_DraftTata.svg",
          // Ruang kosong cukup { status: "vacant" }
          rooms: {
            L2_SH01: { status: "vacant" },
            L2_R01: { status: "vacant" },
            L2_R02: {
              tenant: "PT TRI LINTANG MANDIRI",
              status: "occupied",
              payment: "Lunas",
              area: 120, // m2, angka saja
              start: "2024-01-01", // TAHUN-BULAN-TANGGAL
              end: "2026-12-31",
              rent: 15000000, // rupiah per bulan, angka saja
              pic: "Nama PIC",
              contact: "08xxxxxxxxxx",
            },
            L2_R03: { status: "vacant" },
            L2_R04: { tenant: "PT IBP", status: "occupied", payment: "Lunas" },
            L2_R05: { tenant: "PT INTEN", status: "occupied", payment: "Lunas" },
            L2_R05B: { status: "vacant" },
            L2_R06: { tenant: "SHOWROOM PT INTI", status: "occupied", payment: "Lunas" },
            L2_R06B: { status: "vacant" },
            L2_R07: { tenant: "PT KAU", status: "occupied", payment: "Belum bayar" },
            L2_R08: { status: "vacant" },
            L2_R09: { status: "vacant" },
            L2_R10: { tenant: "Data Centre & Gudang AOD", status: "occupied", payment: "Lunas" },
          },
        },
      ],
    },
  ],
};