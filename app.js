/* =========================================================
   PINTAR v2
   Alur: lokasi -> pilih gedung -> pilih lantai -> pilih ruang
   Aturan: klik hanya mengubah state, lalu render() menggambar ulang.
========================================================= */

const SVG_NS = "http://www.w3.org/2000/svg";

/* ---------- STATE ---------- */
const state = {
  view: "area", // "area" | "plan" | "unavailable"
  buildingId: null,
  floorId: null,
  floorPickerOpen: false,
};

let renderToken = 0;
const registry = new Map();
let areaBasemap = null;
let selectedBasemapId = "imagery";

/* ---------- ELEMEN HTML ---------- */
const mapEl = document.getElementById("map");
const titleEl = document.getElementById("title");
const backBtn = document.getElementById("backBtn");
const floorPickerEl = document.getElementById("floorPicker");
const floorPickerTitleEl = document.getElementById("floorPickerTitle");
const detailEl = document.getElementById("detail");
const sidebarEl = document.getElementById("sidebar");
const summaryEl = document.getElementById("summary");
const unitListEl = document.getElementById("unitList");
const searchEl = document.getElementById("search");
const statusEl = document.getElementById("statusFilter");
const hintEl = document.getElementById("hint");
const buildingSelectEl = document.getElementById("buildingSelect");
const floorSelectEl = document.getElementById("floorSelect");
const floorPickerSelectEl = document.getElementById("floorPickerSelect");
const syncStatusEl = document.getElementById("syncStatus");
const updateTimeEl = document.getElementById("updateTime");
const footerUpdateTimeEl = document.getElementById("footerUpdateTime");
const editRoomBtn = document.getElementById("editRoomBtn");
const roomEditor = document.getElementById("roomEditor");
const editorStatusEl = document.getElementById("editorStatus");
const clearTenantBtn = document.getElementById("clearTenantBtn");
const installmentEditorEl = document.getElementById("installmentEditor");
const installmentListEl = document.getElementById("installmentList");
const installmentPaidTotalEl = document.getElementById("installmentPaidTotal");
const installmentRemainingEl = document.getElementById("installmentRemaining");
const contractValueInput = roomEditor.elements.namedItem("contract_value");
const outstandingInput = roomEditor.elements.namedItem("outstanding_amount");
const outstandingLabel = outstandingInput.closest("label");
const paymentStatusInput = roomEditor.elements.namedItem("payment_status");
const actionConfirmDialog = document.getElementById("actionConfirm");
const actionConfirmTitle = document.getElementById("actionConfirmTitle");
const actionConfirmMessage = document.getElementById("actionConfirmMessage");
const actionConfirmCancel = document.getElementById("actionConfirmCancel");
const actionConfirmAccept = document.getElementById("actionConfirmAccept");
let selectedRoomId = null;
let editorRoomId = null;
let resolveActionConfirmation = null;

/* ---------- STATUS (warna ditentukan di satu tempat) ---------- */
const STATUS = {
  occupied: { label: "Terisi", color: "#22c55e" },
  vacant: { label: "Kosong", color: "#ef4444" },
  in_progress: { label: "Dalam Proses", color: "#f59e0b" },
};

const BUILDING_OPTIONS = [
  {
    id: "GKP",
    label: "GKP - Gedung Kantor Pusat",
    name: "Gedung Kantor Pusat",
    polygonId: "GD_GKP",
  },
  {
    id: "GPT",
    label: "GPT - Gedung Pusat Teknologi",
    name: "Gedung Pusat Teknologi",
    polygonId: "GD_GPT",
  },
  {
    id: "GAK3",
    label: "Gedung GAK3",
    name: "Gedung GAK3",
    polygonId: "GD_GAK3",
  },
];

const FLOOR_OPTIONS = [
  { id: "DASAR", label: "Lantai Dasar" },
  ...Array.from({ length: 9 }, (_, index) => {
    const level = index + 2;
    return { id: `L${level}`, label: `Lantai ${level}` };
  }),
  { id: "ROOFTOP", label: "Rooftop" },
];

const BASEMAP_OPTIONS = {
  imagery: {
    label: "Citra satelit",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      'Tiles &copy; <a href="https://goto.arcgisonline.com/maps/World_Imagery">Esri</a>, Vantor, Earthstar Geographics, and the GIS User Community',
  },
  streets: {
    label: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    maxNativeZoom: 19,
  },
};

function statusOf(room) {
  const status = String(room.status || "").trim().toLocaleLowerCase("id-ID");
  if (["aktif", "terisi", "occupied"].includes(status)) return "occupied";
  if (["kosong", "tersedia", "vacant"].includes(status)) return "vacant";
  if (["dalam proses", "in_progress"].includes(status)) return "in_progress";
  return null;
}

function isUnpaid(room) {
  const payment = String(room.payment || "").trim().toLocaleLowerCase("id-ID");
  if (payment === "termin") return Number(room.outstandingAmount) > 0;
  return ["belum bayar", "belum dibayar", "unpaid", "overdue"].includes(payment);
}

statusEl.innerHTML =
  '<option value="all">Semua status</option>' +
  Object.entries(STATUS)
    .map(([k, s]) => `<option value="${k}">${s.label}</option>`)
    .join("") +
  '<option value="overdue">Tunggakan pembayaran</option>';

searchEl.addEventListener("input", applyFilter);
statusEl.addEventListener("change", applyFilter);
buildingSelectEl.addEventListener("change", () => {
  const buildingOption = BUILDING_OPTIONS.find(
    (item) => item.id === buildingSelectEl.value,
  );
  if (!buildingOption) return;

  const building = DATA.buildings.find(
    (item) => item.id === buildingSelectEl.value,
  );
  state.buildingId = buildingOption.id;
  if (building?.active && building.floors.length) {
    state.floorId = building.floors[0].id;
    state.view = "plan";
  } else {
    state.floorId = "DASAR";
    state.view = "unavailable";
  }
  render();
});
floorSelectEl.addEventListener("change", () => {
  const building = getBuilding();
  const floor = building?.floors.find(
    (item) => item.id === floorSelectEl.value,
  );
  state.floorId = floorSelectEl.value;
  state.view = floor ? "plan" : "unavailable";
  render();
});

/* ---------- DATA ---------- */
// Isi nilai bawaan satu kali, supaya data.js bisa singkat
function prepareData() {
  DATA.buildings.forEach((b) =>
    b.floors.forEach((f) =>
      Object.values(f.rooms).forEach((r) => {
        r.tenant ??= r.status === "vacant" ? "Tersedia" : "-";
        r.payment ??= "-";
      }),
    ),
  );
}

function updateDashboard() {
  const configuredBuildings = DATA.buildings;
  const rooms = configuredBuildings.flatMap((building) =>
    building.floors.flatMap((floor) => Object.values(floor.rooms)),
  );
  const attentionUnits = rooms.filter(
    (room) =>
      isUnpaid(room) ||
      (statusOf(room) === "occupied" &&
        ((!room.tenant || room.tenant === "-") ||
          (!room.payment || room.payment === "-"))),
  ).length;
  const occupied = rooms.filter((room) => statusOf(room) === "occupied").length;
  const vacant = rooms.filter((room) => statusOf(room) === "vacant").length;
  const inProgress = rooms.filter((room) => statusOf(room) === "in_progress").length;
  const overdue = rooms.filter(isUnpaid).length;
  const incomplete = rooms.filter(
    (room) =>
      statusOf(room) === "occupied" &&
      ((!room.tenant || room.tenant === "-") ||
        (!room.payment || room.payment === "-")),
  ).length;

  document.getElementById("dashboardBuildingCount").textContent =
    BUILDING_OPTIONS.length;
  document.getElementById("dashboardActiveBuildingCount").textContent =
    configuredBuildings.filter((building) => building.active).length;
  document.getElementById("dashboardTotalBuildingCount").textContent =
    `dari ${BUILDING_OPTIONS.length}`;
  document.getElementById("dashboardUnitCount").textContent = rooms.length;
  document.getElementById("dashboardOccupancyNote").textContent =
    `${vacant} kosong · ${occupied} terisi · ${inProgress} proses`;
  document.getElementById("dashboardOverdueCount").textContent = overdue;
  document.getElementById("attentionCount").textContent = attentionUnits;
  document.getElementById("attentionPaymentCount").textContent =
    `${overdue} unit · Perlu ditinjau`;
  document.getElementById("attentionVacantCount").textContent =
    `${vacant} unit · Tersedia`;
  document.getElementById("attentionIncompleteCount").textContent =
    `${incomplete} unit · Perlu diperbarui`;
}

function setSyncStatus(status, label, updatedAt) {
  syncStatusEl.className = `system-status sync-${status}`;
  syncStatusEl.lastChild.textContent = label;
  if (!updatedAt) return;

  const time = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(updatedAt);
  updateTimeEl.textContent = `Update ${time} WIB`;
  footerUpdateTimeEl.textContent = `Data Google Sheets terakhir diperbarui · ${time} WIB`;
}

function normalizeFloorId(value) {
  return String(value)
    .trim()
    .toLocaleUpperCase("id-ID")
    .replace(/^(?:LANTAI|LT|L)\s*/, "")
    .replace(/\s+/g, "");
}

let lastUnmatchedSignature = "";

const MASTER_ROOM_FIELDS = {
  area_m2: "area",
  start_date: "start",
  end_date: "end",
  rent_per_month: "rent",
  outstanding_amount: "outstandingAmount",
  contract_value: "contractValue",
  last_payment_date: "lastPaymentDate",
  electricity_kwh: "electricityKwh",
  water_m3: "waterM3",
  pic: "pic",
  contact: "contact",
  maintenance_status: "maintenanceStatus",
  complaint_status: "complaintStatus",
  notes: "notes",
};

function applySheetRecords(records, endpointDiagnostics = []) {
  const diagnostics = [...endpointDiagnostics];

  const roomsWithUnknownStatus = new Map();
  records.forEach((record) => {
    const building = DATA.buildings.find(
      (item) => item.id.toLocaleUpperCase("id-ID") === record.building.toLocaleUpperCase("id-ID"),
    );
    const floor = building?.floors.find((item) =>
      normalizeFloorId(item.id) === normalizeFloorId(record.floor),
    );
    const room =
      floor && Object.prototype.hasOwnProperty.call(floor.rooms, record.room_id)
        ? floor.rooms[record.room_id]
        : null;
    if (room && !statusOf({ status: record.occupancy_status })) {
      roomsWithUnknownStatus.set(room, { ...room });
    }
  });

  DATA.buildings.forEach((building) =>
    building.floors.forEach((floor) =>
      Object.values(floor.rooms).forEach((room) => {
        room.status = "vacant";
        room.tenant = "Tersedia";
        room.payment = "";
        room.installments = [];
        Object.values(MASTER_ROOM_FIELDS).forEach((field) => delete room[field]);
      }),
    ),
  );

  records.forEach((record) => {
    const building = DATA.buildings.find(
      (item) => item.id.toLocaleUpperCase("id-ID") === record.building.toLocaleUpperCase("id-ID"),
    );
    const floor = building?.floors.find((item) =>
      normalizeFloorId(item.id) === normalizeFloorId(record.floor),
    );
    const roomFound = Boolean(
      floor && Object.prototype.hasOwnProperty.call(floor.rooms, record.room_id),
    );
    const room = roomFound ? floor.rooms[record.room_id] : null;
    if (!room) {
      diagnostics.push({
        reason: !building
          ? "building-not-found"
          : !floor
            ? "floor-not-found"
            : "room-id-not-found",
        buildingId: record.building,
        buildingFound: Boolean(building),
        availableBuildingIds: building ? undefined : DATA.buildings.map((item) => item.id),
        floorId: record.floor,
        floorFound: Boolean(floor),
        availableFloorIds: building?.floors.map((item) => item.id) || [],
        roomId: record.room_id,
        roomFound: floor ? roomFound : null,
        availableRoomIds: floor ? Object.keys(floor.rooms) : [],
      });
      return;
    }

    const occupancy = statusOf({ status: record.occupancy_status });
    if (!occupancy) {
      diagnostics.push({
        reason: "unknown-occupancy-status",
        buildingId: record.building,
        floorId: record.floor,
        roomId: record.room_id,
        status: record.occupancy_status,
      });
      const previousRoom = roomsWithUnknownStatus.get(room);
      if (previousRoom) {
        Object.keys(room).forEach((key) => delete room[key]);
        Object.assign(room, previousRoom);
      }
      return;
    }

    room.status = occupancy;
    room.tenant =
      occupancy === "vacant" ? "Tersedia" : record.tenant || "-";
    room.payment = record.payment_status || "";
    room.installments = record.installments || [];
    Object.entries(MASTER_ROOM_FIELDS).forEach(([source, target]) => {
      if (
        !Object.prototype.hasOwnProperty.call(record, source) ||
        record[source] === ""
      ) {
        return;
      }
      const value = record[source];
      room[target] =
        [
          "area_m2",
          "rent_per_month",
          "outstanding_amount",
          "electricity_kwh",
          "water_m3",
        ].includes(source) && Number.isFinite(Number(value))
          ? Number(value)
          : value;
    });
  });

  const diagnosticSignature = JSON.stringify(diagnostics);
  if (diagnosticSignature !== lastUnmatchedSignature) {
    if (diagnostics.length) {
      console.warn(
        "Diagnostik master Google Sheets (tidak memuat data tenant):",
        diagnostics,
      );
    }
    lastUnmatchedSignature = diagnosticSignature;
  }

  updateDashboard();
  const floor = state.view === "plan" ? getFloor() : null;
  if (!floor) return;

  Object.entries(floor.rooms).forEach(([roomId, room]) => {
    const occupancy = statusOf(room);
    if (occupancy) {
      findById(roomId)?.style.setProperty("--room-color", STATUS[occupancy].color);
    }
  });
  mapEl.querySelectorAll(".room-label").forEach((label) => label.remove());
  addLabels(floor.rooms);
  buildSummary(floor.rooms);
  buildUnitList(floor.rooms);
  applyFilter();

  const selectedRoom = mapEl.querySelector(".room.selected");
  if (selectedRoom && !detailEl.hidden) showDetail(selectedRoom.id);
}

const getBuilding = () => DATA.buildings.find((b) => b.id === state.buildingId);
const getFloor = () => getBuilding().floors.find((f) => f.id === state.floorId);

/* ---------- BANTUAN ---------- */
function findById(id) {
  return mapEl.querySelector("#" + CSS.escape(id));
}

const fmtRupiah = (n) =>
  typeof n === "number" ? "Rp " + n.toLocaleString("id-ID") : "-";

const fmtDate = (s) =>
  s
    ? new Date(s).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "-";

const daysLeft = (end) =>
  end ? Math.ceil((new Date(end) - new Date()) / 86400000) : null;

function remainingText(end) {
  const days = daysLeft(end);
  if (days === null) return "-";
  if (days < 0) return "Berakhir " + -days + " hari lalu";
  if (days <= 90) return days + " hari (segera berakhir)";
  return Math.round(days / 30) + " bulan";
}

/* ---------- MUAT SVG (cache + deteksi encoding) ---------- */
const svgCache = new Map();

async function loadSVG(file) {
  if (!svgCache.has(file)) {
    const res = await fetch(file);
    if (!res.ok) throw new Error("SVG tidak ditemukan: " + file);

    const buf = await res.arrayBuffer();
    const b = new Uint8Array(buf);
    const enc =
      b[0] === 0xff && b[1] === 0xfe
        ? "utf-16le"
        : b[0] === 0xfe && b[1] === 0xff
          ? "utf-16be"
          : "utf-8";

    // Buang deklarasi XML dan DOCTYPE agar aman dimasukkan ke HTML
    const text = new TextDecoder(enc)
      .decode(buf)
      .replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>/g, "");
    svgCache.set(file, text);
  }
  mapEl.innerHTML = svgCache.get(file);
}

/* ---------- RENDER (satu pintu) ---------- */
async function render() {
  document.body.dataset.view = state.view;
  updateNavigationSelectors();
  if (state.view !== "area" && areaBasemap) {
    areaBasemap.remove();
    areaBasemap = null;
  }

  detailEl.hidden = true;
  backBtn.hidden = state.view === "area";
  sidebarEl.hidden = state.view !== "plan" && state.view !== "unavailable";
  floorPickerEl.hidden = state.view !== "area" || !state.floorPickerOpen;
  MapView.detach();

  hintEl.textContent = {
    area: "Klik gedung yang disorot untuk melihat lantainya",
    plan: "Klik ruang pada denah. Scroll untuk zoom, seret untuk menggeser",
    unavailable: "",
  }[state.view];

  try {
    if (state.view === "area") await showArea();
    else if (state.view === "plan") await showFloorPlan();
    else showUnavailablePlan();
  } catch (err) {
    console.error(err);
    mapEl.innerHTML = `<p class="error">Gagal memuat: ${err.message}</p>`;
  }
}

function openFloorPicker(building) {
  state.buildingId = building.id;
  state.floorId = null;
  state.floorPickerOpen = true;
  floorPickerTitleEl.textContent = building.name;
  floorPickerSelectEl.innerHTML =
    '<option value="">Pilih lantai</option>' +
    FLOOR_OPTIONS.map(
      (floor) => `<option value="${floor.id}">${floor.label}</option>`,
    ).join("");

  floorPickerEl.hidden = false;
}

floorPickerSelectEl.addEventListener("change", () => {
  const floorId = floorPickerSelectEl.value;
  if (!floorId) return;

  const building = DATA.buildings.find(
    (item) => item.id === state.buildingId,
  );
  const floor = building?.floors.find((item) => item.id === floorId);
  state.floorId = floorId;
  state.floorPickerOpen = false;
  state.view = floor ? "plan" : "unavailable";
  render();
});

function updateNavigationSelectors() {
  buildingSelectEl.innerHTML = BUILDING_OPTIONS.map(
    (building) => `<option value="${building.id}">${building.label}</option>`,
  ).join("");
  buildingSelectEl.value = state.buildingId || "";

  floorSelectEl.innerHTML = FLOOR_OPTIONS.map(
    (floor) => `<option value="${floor.id}">${floor.label}</option>`,
  ).join("");
  floorSelectEl.disabled = !state.buildingId;
  floorSelectEl.value = state.floorId || "";
}

function showUnavailablePlan() {
  const building = BUILDING_OPTIONS.find(
    (item) => item.id === state.buildingId,
  );
  const floor = FLOOR_OPTIONS.find((item) => item.id === state.floorId);
  if (!building || !floor) {
    throw new Error("Pilihan gedung atau lantai tidak valid.");
  }

  titleEl.textContent = `${building.label} - ${floor.label}`;
  mapEl.innerHTML = `
    <div class="plan-unavailable">
      <div class="plan-unavailable-icon" aria-hidden="true">i</div>
      <h2>Denah belum tersedia</h2>
      <p>Denah ${building.label}, ${floor.label} belum tersedia.</p>
      <small>Pilih gedung atau lantai lain dari panel di samping.</small>
    </div>`;
}

function markZones(floorId) {
  const svg = mapEl.querySelector("svg");
  if (!svg) return;

  svg.querySelectorAll("[id]").forEach((node) => {
    if (node.id.startsWith(`${floorId}_`)) {
      node.classList.add("zone");
    }
  });
}

function buildRegistry(rooms = {}) {
  registry.clear();
  Object.entries(rooms).forEach(([roomId, room]) => {
    registry.set(roomId, { room, el: findById(roomId) });
  });
  return registry;
}

function checkSvgAgainstData(rooms = {}) {
  const missing = Object.keys(rooms).filter((roomId) => !findById(roomId));
  if (missing.length) {
    console.warn("Ruang tidak ada di SVG:", missing);
  }
}

/* ---------- TAHAP 1: LOKASI ---------- */
async function showArea() {
  titleEl.textContent = "Area Kantor Pusat";
  if (!window.L) {
    throw new Error(
      "Peta dasar gagal dimuat. Periksa koneksi internet, lalu muat ulang halaman.",
    );
  }
  await loadSVG(AREA_SVG);

  BUILDING_OPTIONS.forEach((building) => {
    const el = findById(building.polygonId);
    if (!el) {
      console.warn("Polygon gedung tidak ditemukan:", building.polygonId);
      return;
    }
    el.classList.add("clickable", "building");

    el.addEventListener("click", () => {
      openFloorPicker(building);
    });
  });

  const svg = mapEl.querySelector("svg");
  svg.querySelectorAll(":scope > g > *").forEach((shape) => {
    if (shape.id === "_77_ATH") return;
    if (
      !["path", "rect", "polygon", "circle", "ellipse"].includes(
        shape.tagName.toLowerCase(),
      )
    ) {
      return;
    }
    const featureGroup = document.createElementNS(SVG_NS, "g");
    featureGroup.classList.add("area-feature");
    shape.parentNode.insertBefore(featureGroup, shape);
    featureGroup.appendChild(shape);
    const originalTransform = shape.getAttribute("transform");
    const bounds = shape.getBBox();
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const scaleTransform =
      `translate(${centerX} ${centerY}) scale(1.03) ` +
      `translate(${-centerX} ${-centerY})`;
    featureGroup.addEventListener("pointerenter", () => {
      featureGroup.classList.add("is-hovered");
      shape.classList.add("is-hovered");
      shape.setAttribute(
        "transform",
        [originalTransform, scaleTransform].filter(Boolean).join(" "),
      );
    });
    featureGroup.addEventListener("pointerleave", () => {
      featureGroup.classList.remove("is-hovered");
      shape.classList.remove("is-hovered");
      if (originalTransform) shape.setAttribute("transform", originalTransform);
      else shape.removeAttribute("transform");
    });
  });

  // Perkiraan dari screenshot; ganti dengan batas GPS survei untuk presisi.
  const center = [-6.9386182, 107.6075028];
  const overlayBounds = L.latLngBounds(
  [-6.9398602, 107.605700],
  [-6.9373762, 107.609386]
);
  const panBounds = overlayBounds.pad(0.12);

  areaBasemap = L.map(mapEl, {
    center,
    zoom: 19,
    minZoom: 17,
    maxZoom: 20,
    maxBounds: panBounds,
    maxBoundsViscosity: 1,
    zoomControl: false,
    attributionControl: true,
  });
  const layers = Object.fromEntries(
    Object.entries(BASEMAP_OPTIONS).map(([id, option]) => [
      id,
      L.tileLayer(option.url, {
        maxZoom: 20,
        maxNativeZoom: option.maxNativeZoom ?? 20,
        attribution: option.attribution,
      }),
    ]),
  );
  layers[selectedBasemapId].addTo(areaBasemap);

  const basemapControl = L.control({ position: "bottomleft" });
  basemapControl.onAdd = () => {
    const container = L.DomUtil.create("div", "basemap-control");
    const label = L.DomUtil.create("label", "", container);
    const select = L.DomUtil.create("select", "", container);
    select.id = "basemap-select";
    label.htmlFor = select.id;
    label.textContent = "Basemap";
    select.setAttribute("aria-label", "Pilih basemap");

    Object.entries(BASEMAP_OPTIONS).forEach(([id, option]) => {
      const item = L.DomUtil.create("option", "", select);
      item.value = id;
      item.textContent = option.label;
    });
    select.value = selectedBasemapId;
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    L.DomEvent.on(select, "change", () => {
      selectedBasemapId = select.value;
      Object.values(layers).forEach((layer) => areaBasemap.removeLayer(layer));
      layers[select.value].addTo(areaBasemap);
    });
    return container;
  };
  basemapControl.addTo(areaBasemap);
  L.control.zoom({ position: "topright" }).addTo(areaBasemap);
  L.svgOverlay(svg, overlayBounds, {
    interactive: true,
    opacity: 0.8,
  }).addTo(areaBasemap);
  requestAnimationFrame(() => areaBasemap?.invalidateSize());
}

/* ---------- TAHAP 3: DENAH LANTAI ---------- */
async function showFloorPlan() {
  const b = getBuilding();
  const f = getFloor();
  titleEl.textContent = `${b.name} - ${f.name}`;
  await loadSVG(f.svg);

  Object.entries(f.rooms).forEach(([roomId, room]) => {
    const el = findById(roomId);
    if (!el) {
      console.warn("Ruang tidak ada di SVG:", roomId);
      return;
    }
    el.classList.add("clickable", "room");
    const occupancy = statusOf(room);
    if (occupancy) {
      el.style.setProperty("--room-color", STATUS[occupancy].color);
    }
    el.addEventListener("click", () => selectRoom(roomId));
  });

  markZones(f.id);
  buildRegistry(f.rooms);
  checkSvgAgainstData(f.rooms);
  addLabels(f.rooms);
  buildSummary(f.rooms);
  buildUnitList(f.rooms);
  applyFilter();

  const svg = mapEl.querySelector("svg");
  await new Promise((resolve) => requestAnimationFrame(resolve));
  if (state.view !== "plan" || mapEl.querySelector("svg") !== svg) return;

  MapView.attach(svg, {
    planId: f.planId,
    prefix: f.id + "_",
    rooms: [...registry.values()].map((entry) => entry.el).filter(Boolean),
  });
}

/* ---------- RINGKASAN + LEGENDA ---------- */
function buildSummary(rooms = {}) {
  const list = Object.values(rooms);

  const rows = Object.entries(STATUS).map(([key, s]) => {
    const n = list.filter((room) => statusOf(room) === key).length;
    return `<div class="sum-item">
              <span class="swatch" style="background:${s.color}"></span>${s.label}<b>${n}</b>
            </div>`;
  });
  const unpaid = list.filter(isUnpaid).length;

  const expiring = list.filter((r) => {
    const d = daysLeft(r.end);
    return d !== null && d >= 0 && d <= 90;
  }).length;

  summaryEl.innerHTML =
    `<div class="sum-item">Total unit<b>${list.length}</b></div>` +
    rows.join("") +
    `<div class="sum-item sum-warn">Tunggakan pembayaran<b>${unpaid}</b></div>` +
    `<div class="sum-item sum-warn">Kontrak berakhir ≤ 90 hari<b>${expiring}</b></div>`;
}

/* ---------- DAFTAR UNIT ---------- */
function buildUnitList(rooms = {}) {
  unitListEl.innerHTML = "";
  Object.entries(rooms).forEach(([roomId, room]) => {
    const occupancy = statusOf(room);
    const st = occupancy ? STATUS[occupancy] : null;
    const item = document.createElement("div");
    item.className = "unit-item";
    item.dataset.id = roomId;
    if (st) item.style.setProperty("--c", st.color);
    const id = document.createElement("b");
    id.textContent = roomId;
    const tenant = document.createElement("span");
    tenant.textContent = room.tenant || (occupancy === "vacant" ? "Tersedia" : "-");
    const status = document.createElement("small");
    if (st) status.style.color = st.color;
    status.textContent = st?.label || "Status tidak dikenal";
    item.append(id, tenant, status);
    item.addEventListener("click", () => selectRoom(roomId));
    unitListEl.appendChild(item);
  });
}

function confirmAction({ title, message, acceptLabel, variant = "primary" }) {
  actionConfirmTitle.textContent = title;
  actionConfirmMessage.textContent = message;
  actionConfirmAccept.textContent = acceptLabel;
  actionConfirmDialog.dataset.variant = variant;
  actionConfirmDialog.showModal();
  actionConfirmCancel.focus();
  return new Promise((resolve) => {
    resolveActionConfirmation = resolve;
  });
}

function closeActionConfirmation(confirmed) {
  if (!actionConfirmDialog.open) return;
  actionConfirmDialog.close(confirmed ? "confirm" : "cancel");
}

actionConfirmCancel.addEventListener("click", () => closeActionConfirmation(false));
actionConfirmAccept.addEventListener("click", () => closeActionConfirmation(true));
actionConfirmDialog.addEventListener("close", () => {
  resolveActionConfirmation?.(actionConfirmDialog.returnValue === "confirm");
  resolveActionConfirmation = null;
});

/* ---------- PENCARIAN & FILTER ---------- */
function applyFilter() {
  const floor = getFloor();
  if (!floor) return;

  const q = searchEl.value.trim().toLowerCase();
  const wanted = statusEl.value;

  Object.entries(floor.rooms).forEach(([roomId, room]) => {
    const occupancy = statusOf(room);
    const match =
      (wanted === "all" ||
        (wanted === "overdue" ? isUnpaid(room) : wanted === occupancy)) &&
      (roomId + " " + (room.tenant || "")).toLowerCase().includes(q);

    unitListEl
      .querySelector(`[data-id="${CSS.escape(roomId)}"]`)
      ?.toggleAttribute("hidden", !match);
    findById(roomId)?.classList.toggle("dimmed", !match);
    mapEl
      .querySelector(`.room-label[data-room-id="${CSS.escape(roomId)}"]`)
      ?.classList.toggle("dimmed", !match);
  });
}

/* ---------- LABEL RUANG ---------- */
function addLabels(rooms = {}) {
  const svg = mapEl.querySelector("svg");
  if (!svg) return;

  const FONT = 26;

  Object.entries(rooms).forEach(([roomId, room]) => {
    const el = findById(roomId);
    if (!el) return;
    const occupancy = statusOf(room);
    if (!occupancy || occupancy === "vacant") return;

    const box = el.getBBox();
    const text = room.tenant || roomId;

    const maxChars = Math.max(6, Math.floor(box.width / (FONT * 0.6)));
    const lines = [];
    let line = "";
    text.split(" ").forEach((word) => {
      const candidate = (line + " " + word).trim();
      if (candidate.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    });
    if (line) lines.push(line);

    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("class", "room-label");
    t.dataset.roomId = roomId;
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("pointer-events", "none");

    const cx = box.x + box.width / 2;
    const startY =
      box.y + box.height / 2 - ((lines.length - 1) * FONT * 1.1) / 2;

    lines.forEach((l, i) => {
      const span = document.createElementNS(SVG_NS, "tspan");
      span.setAttribute("x", cx);
      span.setAttribute("y", startY + i * FONT * 1.1);
      span.setAttribute("dominant-baseline", "middle");
      span.textContent = l;
      t.appendChild(span);
    });

    svg.appendChild(t);
  });
}

/* ---------- TAHAP 4: DETAIL RUANG ---------- */
function selectRoom(roomId) {
  selectedRoomId = roomId;
  mapEl
    .querySelectorAll(".room.selected")
    .forEach((e) => e.classList.remove("selected"));
  findById(roomId)?.classList.add("selected");

  document
    .querySelectorAll(".unit-item")
    .forEach((i) => i.classList.toggle("active", i.dataset.id === roomId));

  showDetail(roomId);
}

function showDetail(roomId) {
  const room = getFloor().rooms[roomId];
  populateRoomEditor(roomId, room);
  const occupancy = statusOf(room);
  const occupancyStatus = occupancy ? STATUS[occupancy] : null;
  const d = daysLeft(room.end);

  const rows = [];
  const hasValue = (value) =>
    value !== undefined &&
    value !== null &&
    String(value).trim() !== "" &&
    String(value).trim() !== "-";
  const addRow = (label, value, className = "") => {
    if (hasValue(value)) rows.push([label, value, className]);
  };
  const formatMoney = (value) => {
    const amount =
      typeof value === "number"
        ? value
        : Number(String(value).replace(/[^\d.-]/g, ""));
    return Number.isFinite(amount) ? fmtRupiah(amount) : value;
  };
  const formatDateIfValid = (value) => {
    if (!hasValue(value)) return "";
    return Number.isNaN(new Date(value).getTime()) ? value : fmtDate(value);
  };

  addRow("Pembayaran", room.payment);
  if (String(room.payment || "").toLocaleLowerCase("id-ID") === "termin") {
    const installments = Array.isArray(room.installments) ? room.installments : [];
    const paidTotal = installments.reduce(
      (total, item) => total + (Number(item.amount) || 0),
      0,
    );
    const remaining = Math.max((Number(room.contractValue) || 0) - paidTotal, 0);
    addRow(
      "Total nilai kontrak",
      hasValue(room.contractValue) ? formatMoney(room.contractValue) : "",
    );
    installments.forEach((item) => {
      addRow(`Pembayaran termin ${item.term}`, formatMoney(item.amount));
    });
    addRow("Total dibayar", formatMoney(paidTotal));
    addRow("Kekurangan hingga lunas", formatMoney(remaining), remaining > 0 ? "warn" : "");
  }
  addRow("Luas", hasValue(room.area) ? `${room.area} m²` : "");
  addRow("Mulai sewa", formatDateIfValid(room.start));
  addRow("Berakhir", formatDateIfValid(room.end));
  if (hasValue(room.end) && d !== null) {
    addRow("Sisa kontrak", remainingText(room.end), d <= 90 ? "warn" : "");
  }
  addRow("Sewa / bulan", hasValue(room.rent) ? formatMoney(room.rent) : "");
  if (String(room.payment || "").toLocaleLowerCase("id-ID") !== "termin") {
    addRow(
      "Tunggakan",
      hasValue(room.outstandingAmount) ? formatMoney(room.outstandingAmount) : "",
    );
  }
  addRow("Pembayaran terakhir", formatDateIfValid(room.lastPaymentDate));
  addRow(
    "Konsumsi listrik",
    hasValue(room.electricityKwh) ? `${room.electricityKwh} kWh` : "",
  );
  addRow("Konsumsi air", hasValue(room.waterM3) ? `${room.waterM3} m³` : "");
  addRow("PIC", room.pic);
  addRow("Kontak", room.contact);
  addRow("Pemeliharaan", room.maintenanceStatus);
  addRow("Keluhan", room.complaintStatus);
  addRow("Catatan", room.notes);

  document.getElementById("dUnit").textContent = "Unit " + roomId;
  document.getElementById("dTenant").textContent = room.tenant || "";
  const pill = document.getElementById("dStatus");
  pill.textContent = occupancyStatus?.label || "Status tidak dikenal";
  if (occupancyStatus) pill.style.setProperty("--c", occupancyStatus.color);
  else pill.style.removeProperty("--c");
  const detailRows = document.getElementById("dRows");
  detailRows.replaceChildren();
  rows.forEach(([key, value, className]) => {
    const row = document.createElement("div");
    row.className = `row ${className || ""}`;
    const label = document.createElement("span");
    label.textContent = key;
    const content = document.createElement("b");
    content.textContent = String(value);
    row.append(label, content);
    detailRows.appendChild(row);
  });

  detailEl.hidden = false;
}

const EDITABLE_ROOM_FIELDS = [
  "tenant",
  "occupancy_status",
  "payment_status",
  "area_m2",
  "start_date",
  "end_date",
  "rent_per_month",
  "outstanding_amount",
  "contract_value",
  "last_payment_date",
  "electricity_kwh",
  "water_m3",
  "pic",
  "contact",
  "maintenance_status",
  "complaint_status",
  "notes",
];

function populateRoomEditor(roomId, room) {
  if (!roomEditor.hidden && editorRoomId === roomId) return;
  roomEditor.hidden = true;
  editorRoomId = roomId;
  editorStatusEl.textContent = "";

  const occupancy = statusOf(room);
  const values = {
    tenant: occupancy === "vacant" || room.tenant === "Tersedia" ? "" : room.tenant || "",
    occupancy_status: occupancy || "vacant",
    payment_status: room.payment || "",
    area_m2: numericInputValue(room.area),
    start_date: dateInputValue(room.start),
    end_date: dateInputValue(room.end),
    rent_per_month: numericInputValue(room.rent),
    outstanding_amount: numericInputValue(room.outstandingAmount),
    contract_value: numericInputValue(room.contractValue),
    last_payment_date: dateInputValue(room.lastPaymentDate),
    electricity_kwh: numericInputValue(room.electricityKwh),
    water_m3: numericInputValue(room.waterM3),
    pic: room.pic,
    contact: room.contact,
    maintenance_status: room.maintenanceStatus,
    complaint_status: room.complaintStatus,
    notes: room.notes,
  };

  const paymentSelect = roomEditor.elements.namedItem("payment_status");
  const paymentValue = String(values.payment_status || "");
  if (
    paymentValue &&
    !Array.from(paymentSelect.options).some((option) => option.value === paymentValue)
  ) {
    paymentSelect.add(new Option(paymentValue, paymentValue));
  }

  EDITABLE_ROOM_FIELDS.forEach((field) => {
    const control = roomEditor.elements.namedItem(field);
    if (!control) return;
    control.value = control.hasAttribute("data-currency")
      ? formatCurrencyInput(values[field])
      : values[field] ?? "";
    if (control.hasAttribute("data-currency")) updateCurrencyPreview(field, values[field]);
  });
  renderInstallments(room.installments || []);
  updateInstallmentMode();
}

function dateInputValue(value) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const monthNames = {
    januari: "01", februari: "02", maret: "03", april: "04",
    mei: "05", juni: "06", juli: "07", agustus: "08",
    september: "09", oktober: "10", november: "11", desember: "12",
  };
  const localDate = text.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})$/);
  if (!localDate) return "";
  const month = monthNames[localDate[2].toLocaleLowerCase("id-ID")];
  if (!month) return "";
  return `${localDate[3]}-${month}-${localDate[1].padStart(2, "0")}`;
}

function numericInputValue(value) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  let text = String(value).trim().replace(/[^\d,.-]/g, "");
  if (text.includes(",") && text.includes(".")) {
    text = text.lastIndexOf(",") > text.lastIndexOf(".")
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, "");
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : "";
}

function formatCurrencyInput(value) {
  const number = numericInputValue(value);
  return number === "" ? "" : new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 0,
  }).format(number);
}

function updateCurrencyPreview(field, value) {
  const preview = roomEditor.querySelector(`[data-currency-preview="${field}"]`);
  if (!preview) return;
  const amount = numericInputValue(value);
  preview.textContent = amount === ""
    ? ""
    : `Tampilan: Rp ${new Intl.NumberFormat("id-ID", {
      maximumFractionDigits: 0,
    }).format(amount)}`;
}

function sanitizeCurrencyWhileTyping(input) {
  const digits = input.value.replace(/\D/g, "");
  input.value = digits;
  updateCurrencyPreview(input.name, digits);
}

function readInstallments() {
  return Array.from(installmentListEl.querySelectorAll(".installment-amount"))
    .map((input, index) => ({
      term: index + 1,
      amount: numericInputValue(input.value),
    }))
    .filter((item) => item.amount !== "");
}

function renderInstallments(installments) {
  installmentListEl.replaceChildren();
  installments.forEach((installment, index) => {
    const row = document.createElement("div");
    row.className = "installment-row";
    const label = document.createElement("label");
    const labelText = document.createElement("span");
    labelText.textContent = `Nominal termin ${index + 1} (Rp)`;
    const input = document.createElement("input");
    input.className = "installment-amount";
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.value = formatCurrencyInput(installment.amount);
    label.append(labelText, input);
    const remove = document.createElement("button");
    remove.className = "remove-installment";
    remove.type = "button";
    remove.setAttribute("aria-label", `Hapus termin ${index + 1}`);
    remove.title = `Hapus termin ${index + 1}`;
    remove.textContent = "×";
    row.append(label, remove);
    installmentListEl.appendChild(row);
  });
  updateInstallmentSummary();
}

function updateInstallmentSummary() {
  const paidTotal = readInstallments().reduce((total, item) => total + item.amount, 0);
  const contractValue = numericInputValue(contractValueInput.value);
  const remaining = Math.max((contractValue || 0) - paidTotal, 0);
  installmentPaidTotalEl.textContent = fmtRupiah(paidTotal);
  installmentRemainingEl.textContent = fmtRupiah(remaining);
  if (paymentStatusInput.value.toLocaleLowerCase("id-ID") === "termin") {
    outstandingInput.value = String(remaining);
    updateCurrencyPreview("outstanding_amount", remaining);
  }
  installmentRemainingEl.classList.toggle(
    "installment-overpaid",
    contractValue !== "" && paidTotal > contractValue,
  );
}

function updateInstallmentMode() {
  const isInstallment = paymentStatusInput.value.toLocaleLowerCase("id-ID") === "termin";
  installmentEditorEl.hidden = !isInstallment;
  outstandingLabel.hidden = isInstallment;
  if (isInstallment) updateInstallmentSummary();
}

document.getElementById("addInstallmentBtn").addEventListener("click", () => {
  renderInstallments([...readInstallments(), { amount: "" }]);
  installmentListEl.lastElementChild?.querySelector("input")?.focus();
});

installmentListEl.addEventListener("input", (event) => {
  if (!event.target.matches(".installment-amount")) return;
  sanitizeCurrencyWhileTyping(event.target);
  updateInstallmentSummary();
});

installmentListEl.addEventListener("focusin", (event) => {
  if (!event.target.matches(".installment-amount")) return;
  const amount = numericInputValue(event.target.value);
  event.target.value = amount === "" ? "" : String(amount);
});

installmentListEl.addEventListener("focusout", (event) => {
  if (!event.target.matches(".installment-amount")) return;
  event.target.value = formatCurrencyInput(event.target.value);
});

installmentListEl.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-installment");
  if (!button) return;
  const row = button.closest(".installment-row");
  const rows = Array.from(installmentListEl.children);
  const amounts = rows
    .filter((item) => item !== row)
    .map((item) => ({ amount: numericInputValue(item.querySelector("input").value) }));
  renderInstallments(amounts);
});

contractValueInput.addEventListener("input", updateInstallmentSummary);
paymentStatusInput.addEventListener("change", updateInstallmentMode);

roomEditor.querySelectorAll("[data-currency]").forEach((input) => {
  input.addEventListener("input", () => sanitizeCurrencyWhileTyping(input));
  input.addEventListener("blur", () => {
    input.value = formatCurrencyInput(input.value);
  });
  input.addEventListener("focus", () => {
    input.value = numericInputValue(input.value) === ""
      ? ""
      : String(numericInputValue(input.value));
  });
});

editRoomBtn.addEventListener("click", () => {
  if (!selectedRoomId) return;
  roomEditor.hidden = false;
  editorStatusEl.textContent = "";
});

document.getElementById("cancelRoomEdit").addEventListener("click", () => {
  roomEditor.hidden = true;
  editorStatusEl.textContent = "";
  if (selectedRoomId) {
    populateRoomEditor(selectedRoomId, getFloor().rooms[selectedRoomId]);
  }
});

roomEditor.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedRoomId || !state.buildingId || !state.floorId) return;

  const installments = readInstallments();
  const contractValue = numericInputValue(contractValueInput.value);
  const totalPaid = installments.reduce((total, item) => total + item.amount, 0);
  if (paymentStatusInput.value.toLocaleLowerCase("id-ID") === "termin") {
    if (contractValue === "" || contractValue <= 0) {
      editorStatusEl.textContent = "Isi total nilai kontrak untuk pembayaran termin.";
      contractValueInput.focus();
      return;
    }
    if (totalPaid > contractValue) {
      editorStatusEl.textContent = "Total pembayaran termin tidak boleh melebihi nilai kontrak.";
      return;
    }
  }

  const confirmed = await confirmAction({
    title: "Simpan perubahan unit?",
    message: `Perubahan data unit ${state.buildingId} / ${state.floorId} / ${selectedRoomId} akan disimpan ke spreadsheet.`,
    acceptLabel: "Ya, simpan",
  });
  if (!confirmed) return;

  const formData = new FormData(roomEditor);
  const record = {
    building: state.buildingId,
    floor: state.floorId,
    room_id: selectedRoomId,
  };
  EDITABLE_ROOM_FIELDS.forEach((field) => {
    const value = String(formData.get(field) || "").trim();
    record[field] = [
      "area_m2",
      "electricity_kwh",
      "water_m3",
    ].includes(field)
      ? value === ""
        ? ""
        : Number(value)
      : ["rent_per_month", "outstanding_amount", "contract_value"].includes(field)
        ? numericInputValue(value)
      : value;
  });
  record.installment_payments = JSON.stringify(installments);

  const saveButton = roomEditor.querySelector('[type="submit"]');
  saveButton.disabled = true;
  editorStatusEl.textContent = "Menyimpan dan memverifikasi perubahan...";
  try {
    await SheetsSync.saveRecord(record);
    roomEditor.hidden = true;
    editorStatusEl.textContent = "Perubahan tersimpan dan terverifikasi.";
  } catch (error) {
    console.error("Penyimpanan data unit gagal:", error);
    editorStatusEl.textContent = error.message || "Perubahan gagal disimpan.";
  } finally {
    saveButton.disabled = false;
  }
});

clearTenantBtn.addEventListener("click", () => {
  if (selectedRoomId) clearRoomRecord(selectedRoomId);
});

async function clearRoomRecord(roomId) {
  if (!state.buildingId || !state.floorId) return;
  const identity = `${state.buildingId} / ${state.floorId} / ${roomId}`;
  const confirmed = await confirmAction({
    title: "Kosongkan data tenant?",
    message: `Data tenant dan detail unit ${identity} akan dikosongkan dari spreadsheet. Baris serta identitas gedung, lantai, dan room_id tetap dipertahankan.`,
    acceptLabel: "Ya, kosongkan",
    variant: "danger",
  });
  if (!confirmed) return;

  const saveButton = roomEditor.querySelector('[type="submit"]');
  saveButton.disabled = true;
  clearTenantBtn.disabled = true;
  editorStatusEl.textContent = "Mengosongkan data tenant dan memverifikasi perubahan...";
  try {
    await SheetsSync.clearRecord({
      building: state.buildingId,
      floor: state.floorId,
      room_id: roomId,
    });
    roomEditor.hidden = true;
    editorStatusEl.textContent = "Data tenant dikosongkan. Identitas unit tetap tersimpan.";
  } catch (error) {
    console.error("Pengosongan data tenant gagal:", error);
    editorStatusEl.textContent = error.message || "Data unit gagal dikosongkan.";
  } finally {
    saveButton.disabled = false;
    clearTenantBtn.disabled = false;
  }
}

/* ---------- TAHAP 5: KEMBALI ---------- */
function goBack() {
  if (state.view === "plan" || state.view === "unavailable") {
    state.view = "area";
    state.buildingId = null;
    state.floorId = null;
  }
  state.floorPickerOpen = false;
  render();
}

backBtn.addEventListener("click", goBack);

function closeFloorPicker() {
  if (!state.floorPickerOpen) return;
  state.floorPickerOpen = false;
  state.buildingId = null;
  state.floorId = null;
  floorPickerEl.hidden = true;
}

document
  .getElementById("closeFloorPicker")
  .addEventListener("click", closeFloorPicker);

function closeDetail() {
  detailEl.hidden = true;
  selectedRoomId = null;
  mapEl
    .querySelectorAll(".room.selected")
    .forEach((e) => e.classList.remove("selected"));
  document
    .querySelectorAll(".unit-item.active")
    .forEach((i) => i.classList.remove("active"));
}
document.getElementById("closeDetail").addEventListener("click", closeDetail);
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape") {
      closeDetail();
      closeFloorPicker();
    }
  },
);

/* ---------- MULAI ---------- */
MapView.init(mapEl);
prepareData();
updateDashboard();
render();
SheetsSync.init({
  onRecords: applySheetRecords,
  onStatus: setSyncStatus,
});
