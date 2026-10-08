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

/* ---------- STATUS (warna ditentukan di satu tempat) ---------- */
const STATUS = {
  vacant: { label: "Kosong", color: "#3b82f6" },
  occupied: { label: "Terisi", color: "#22c55e" },
  overdue: { label: "Tunggakan", color: "#ef4444" },
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
  if (room.status === "vacant") return "vacant";
  if (room.payment === "Belum bayar") return "overdue";
  return "occupied";
}

statusEl.innerHTML =
  '<option value="all">Semua status</option>' +
  Object.entries(STATUS)
    .map(([k, s]) => `<option value="${k}">${s.label}</option>`)
    .join("");

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

function markZones() {
  const svg = mapEl.querySelector("svg");
  if (!svg) return;

  svg.querySelectorAll("[id]").forEach((node) => {
    if (node.id.startsWith("L2_")) {
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
    el.style.setProperty("--room-color", STATUS[statusOf(room)].color);
    el.addEventListener("click", () => selectRoom(roomId));
  });

  markZones();
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
    const n = list.filter((r) => statusOf(r) === key).length;
    return `<div class="sum-item">
              <span class="swatch" style="background:${s.color}"></span>${s.label}<b>${n}</b>
            </div>`;
  });

  const expiring = list.filter((r) => {
    const d = daysLeft(r.end);
    return d !== null && d >= 0 && d <= 90;
  }).length;

  summaryEl.innerHTML =
    `<div class="sum-item">Total unit<b>${list.length}</b></div>` +
    rows.join("") +
    `<div class="sum-item sum-warn">Kontrak berakhir ≤ 90 hari<b>${expiring}</b></div>`;
}

/* ---------- DAFTAR UNIT ---------- */
function buildUnitList(rooms = {}) {
  unitListEl.innerHTML = "";
  Object.entries(rooms).forEach(([roomId, room]) => {
    const st = STATUS[statusOf(room)];
    const item = document.createElement("div");
    item.className = "unit-item";
    item.dataset.id = roomId;
    item.style.setProperty("--c", st.color);
    item.innerHTML = `<b>${roomId}</b>
                      <span>${room.tenant || "-"}</span>
                      <small style="color:${st.color}">${st.label}</small>`;
    item.addEventListener("click", () => selectRoom(roomId));
    unitListEl.appendChild(item);
  });
}

/* ---------- PENCARIAN & FILTER ---------- */
function applyFilter() {
  const floor = getFloor();
  if (!floor) return;

  const q = searchEl.value.trim().toLowerCase();
  const wanted = statusEl.value;

  Object.entries(floor.rooms).forEach(([roomId, room]) => {
    const match =
      (wanted === "all" || wanted === statusOf(room)) &&
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

    const box = el.getBBox();
    const text = room.status === "vacant" ? "KOSONG" : room.tenant || roomId;

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
  const st = STATUS[statusOf(room)];
  const d = daysLeft(room.end);

  const rows = [
    ["Pembayaran", room.payment],
    ["Luas", room.area ? room.area + " m²" : "-"],
    ["Mulai sewa", fmtDate(room.start)],
    ["Berakhir", fmtDate(room.end)],
    [
      "Sisa kontrak",
      remainingText(room.end),
      d !== null && d <= 90 ? "warn" : "",
    ],
    ["Sewa / bulan", fmtRupiah(room.rent)],
    ["PIC", room.pic || "-"],
    ["Kontak", room.contact || "-"],
  ];

  document.getElementById("dUnit").textContent = "Unit " + roomId;
  document.getElementById("dTenant").textContent = room.tenant;
  const pill = document.getElementById("dStatus");
  pill.textContent = st.label;
  pill.style.setProperty("--c", st.color);
  document.getElementById("dRows").innerHTML = rows
    .map(
      ([k, v, cls]) =>
        `<div class="row ${cls || ""}"><span>${k}</span><b>${v}</b></div>`,
    )
    .join("");

  detailEl.hidden = false;
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
render();
