/* Struktur peta dan data cadangan awal PINTAR */
const AREA_SVG = "assets/Area77_DraftTata.svg";

/* GKP lantai 3 memiliki 32 ruang; ID SVG dipakai sebagai kunci data ruang. */
function generateFloorRooms(prefix, svgPrefix = prefix) {
  const rooms = {};
  for (let i = 1; i <= 32; i++) {
    const num = String(i).padStart(2, "0");
    const logicalId = `${prefix}_R${num}`;
    const svgId = `${svgPrefix}_R${num}`;
    rooms[logicalId] = { status: "vacant", svgId };
  }
  return { rooms, svgPrefix };
}

/* L2 rooms (GKP_L2.svg: L2_R01 to L2_R17) */
const L1_ROOMS = {};
for (let i = 1; i <= 2; i++) {
  const num = String(i).padStart(2, "0");
  L1_ROOMS[`L1_R${num}`] = { status: "vacant" };
}

const L2_ROOMS = {};
for (let i = 1; i <= 17; i++) {
  const num = String(i).padStart(2, "0");
  L2_ROOMS[`L2_R${num}`] = { status: "vacant" };
}
const L3_DATA = generateFloorRooms("L3");
const TYPICAL_FLOORS = Array.from({ length: 7 }, (_, index) => {
  const floorNumber = index + 4;
  const floorId = `L${floorNumber}`;
  const floorData = generateFloorRooms(floorId);
  return {
    id: floorId,
    name: `Lantai ${floorNumber}`,
    svg: "assets/gkp/GKP_L3.svg",
    svgTemplateFloorId: "L3",
    planId: `UNIT_GKP_${floorId}`,
    svgPrefix: floorData.svgPrefix,
    rooms: floorData.rooms,
  };
});

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
          svgPrefix: "L1_",
          rooms: L1_ROOMS,
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
        ...TYPICAL_FLOORS,
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