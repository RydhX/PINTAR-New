/* Struktur peta dan data cadangan awal PINTAR */
const AREA_SVG = "assets/Area77_DraftTata.svg";

/* Helper: generate rooms for typical floors (L3-L10) using L3 SVG IDs */
function generateTypicalFloorRooms(prefix, svgPrefix = "L3_") {
  const rooms = {};
  // L3 has 32 rooms: L3_R01 to L3_R32
  for (let i = 1; i <= 32; i++) {
    const num = String(i).padStart(2, "0");
    const logicalId = `${prefix}_R${num}`;      // e.g., L4_R01
    const svgId = `${svgPrefix}_R${num}`;       // e.g., L3_R01 (actual SVG element ID)
    rooms[logicalId] = { status: "vacant", svgId };
  }
  return { rooms, svgPrefix };
}

/* L2 rooms (from new GKP_L2.svg: L2_R01 to L2_R17) */
const L2_ROOMS = {};
for (let i = 1; i <= 17; i++) {
  const num = String(i).padStart(2, "0");
  L2_ROOMS[`L2_R${num}`] = { status: "vacant" };
}
// Add some sample tenants for L2 (matching existing data where possible)
L2_ROOMS.L2_R02 = { tenant: "PT TRI LINTANG MANDIRI", status: "occupied", payment: "Lunas", area: 120, start: "2024-01-01", end: "2026-12-31", rent: 15000000, pic: "Nama PIC", contact: "08xxxxxxxxxx" };
L2_ROOMS.L2_R04 = { tenant: "PT IBP", status: "occupied", payment: "Lunas" };
L2_ROOMS.L2_R05 = { tenant: "PT INTEN", status: "occupied", payment: "Lunas" };
L2_ROOMS.L2_R06 = { tenant: "SHOWROOM PT INTI", status: "occupied", payment: "Lunas" };
L2_ROOMS.L2_R07 = { tenant: "PT KAU", status: "occupied", payment: "Belum bayar" };
L2_ROOMS.L2_R10 = { tenant: "Data Centre & Gudang AOD", status: "occupied", payment: "Lunas" };

const L3_DATA = generateTypicalFloorRooms("L3", "L3");
const L4_DATA = generateTypicalFloorRooms("L4", "L3");
const L5_DATA = generateTypicalFloorRooms("L5", "L3");
const L6_DATA = generateTypicalFloorRooms("L6", "L3");
const L7_DATA = generateTypicalFloorRooms("L7", "L3");
const L8_DATA = generateTypicalFloorRooms("L8", "L3");
const L9_DATA = generateTypicalFloorRooms("L9", "L3");
const L10_DATA = generateTypicalFloorRooms("L10", "L3");

const DATA = {
  buildings: [
    {
      id: "GKP",
      name: "Gedung Kantor Pusat",
      active: true,
      polygonId: "GD_GKP", // id polygon gedung di Area77_DraftTata.svg
      floors: [
        {
          id: "L1",
          name: "Lantai 1 (Dasar)",
          svg: "assets/gkp/GKP_L1.svg",
          planId: "UNIT_GKP_L1",
          svgPrefix: "L1_", // TODO: update when L1 SVG gets room IDs
          rooms: {},
        },
        {
          id: "L2",
          name: "Lantai 2",
          svg: "assets/gkp/GKP_L2.svg",
          planId: "UNIT_GKP_L2",
          svgPrefix: "L2_",
          rooms: L2_ROOMS,
        },
        {
          id: "L3",
          name: "Lantai 3",
          svg: "assets/gkp/GKP_L3.svg",
          planId: "UNIT_GKP_L3",
          svgPrefix: L3_DATA.svgPrefix,
          rooms: L3_DATA.rooms,
        },
        {
          id: "L4",
          name: "Lantai 4",
          svg: "assets/gkp/GKP_L3.svg", // same layout as L3
          planId: "UNIT_GKP_L3",
          svgPrefix: L4_DATA.svgPrefix,
          rooms: L4_DATA.rooms,
        },
        {
          id: "L5",
          name: "Lantai 5",
          svg: "assets/gkp/GKP_L3.svg",
          planId: "UNIT_GKP_L3",
          svgPrefix: L5_DATA.svgPrefix,
          rooms: L5_DATA.rooms,
        },
        {
          id: "L6",
          name: "Lantai 6",
          svg: "assets/gkp/GKP_L3.svg",
          planId: "UNIT_GKP_L3",
          svgPrefix: L6_DATA.svgPrefix,
          rooms: L6_DATA.rooms,
        },
        {
          id: "L7",
          name: "Lantai 7",
          svg: "assets/gkp/GKP_L3.svg",
          planId: "UNIT_GKP_L3",
          svgPrefix: L7_DATA.svgPrefix,
          rooms: L7_DATA.rooms,
        },
        {
          id: "L8",
          name: "Lantai 8",
          svg: "assets/gkp/GKP_L3.svg",
          planId: "UNIT_GKP_L3",
          svgPrefix: L8_DATA.svgPrefix,
          rooms: L8_DATA.rooms,
        },
        {
          id: "L9",
          name: "Lantai 9",
          svg: "assets/gkp/GKP_L3.svg",
          planId: "UNIT_GKP_L3",
          svgPrefix: L9_DATA.svgPrefix,
          rooms: L9_DATA.rooms,
        },
        {
          id: "L10",
          name: "Lantai 10",
          svg: "assets/gkp/GKP_L3.svg",
          planId: "UNIT_GKP_L3",
          svgPrefix: L10_DATA.svgPrefix,
          rooms: L10_DATA.rooms,
        },
      ],
    },
    {
      id: "GPT",
      name: "Gedung Pusat Teknologi",
      active: false,
      polygonId: "GD_GPT",
      floors: [],
    },
    {
      id: "GAK3",
      name: "Gedung AK3",
      active: false,
      polygonId: "GD_GAK3",
      floors: [],
    },
  ],
};