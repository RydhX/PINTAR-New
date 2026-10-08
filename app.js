/* =========================================================
   PINTAR v2
   Alur: lokasi -> pilih gedung -> pilih lantai -> pilih ruang
   Aturan: klik hanya mengubah state, lalu render() menggambar ulang.
========================================================= */

const SVG_NS = "http://www.w3.org/2000/svg";

/* ---------- STATE ---------- */
const state = {
  view: "area", // "area" | "floors" | "plan" | "unavailable"
  buildingId: null,
  floorId: null,
};

let renderToken = 0;
const registry = new Map();
let areaBasemap = null;

/* ---------- ELEMEN HTML ---------- */
const mapEl = document.getElementById("map");
const titleEl = document.getElementById("title");
const backBtn = document.getElementById("backBtn");
const detailEl = document.getElementById("detail");
const sidebarEl = document.getElementById("sidebar");
const summaryEl = document.getElementById("summary");
const unitListEl = document.getElementById("unitList");
const searchEl = document.getElementById("search");
const statusEl = document.getElementById("statusFilter");
const hintEl = document.getElementById("hint");
const buildingSelectEl = document.getElementById("buildingSelect");
const floorSelectEl = document.getElementById("floorSelect");

/* ---------- STATUS (warna ditentukan di satu tempat) ---------- */
const STATUS = {
  vacant: { label: "Kosong", color: "#3b82f6" },
  occupied: { label: "Terisi", color: "#22c55e" },
  overdue: { label: "Tunggakan", color: "#ef4444" },
};

const BUILDING_OPTIONS = [
  { id: "GKP", label: "GKP - Gedung Kantor Pusat" },
  { id: "GPT", label: "Gedung GPT" },
  { id: "GAK3", label: "Gedung GAK3" },
];

const FLOOR_OPTIONS = [
  { id: "DASAR", label: "Lantai Dasar" },
  ...Array.from({ length: 9 }, (_, index) => {
    const level = index + 2;
    return { id: `L${level}`, label: `Lantai ${level}` };
  }),
  { id: "ROOFTOP", label: "Rooftop" },
];

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
  MapView.detach();

  hintEl.textContent = {
    area: "Klik gedung yang disorot untuk melihat lantainya",
    floors: "",
    plan: "Klik ruang pada denah. Scroll untuk zoom, seret untuk menggeser",
    unavailable: "",
  }[state.view];

  try {
    if (state.view === "area") await showArea();
    else if (state.view === "floors") showFloors();
    else if (state.view === "plan") await showFloorPlan();
    else showUnavailablePlan();
  } catch (err) {
    console.error(err);
    mapEl.innerHTML = `<p class="error">Gagal memuat: ${err.message}</p>`;
  }
}

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

  DATA.buildings.forEach((b) => {
    const el = findById(b.polygonId);
    if (!el) {
      console.warn("Polygon gedung tidak ditemukan:", b.polygonId);
      return;
    }
    el.classList.add("clickable", "building");
    if (!b.active) el.classList.add("inactive");

    el.addEventListener("click", () => {
      if (!b.active) {
        alert(b.name + " belum tersedia.");
        return;
      }
      state.buildingId = b.id;
      state.view = "floors";
      render();
    });
  });

  const svg = mapEl.querySelector("svg");
  // Perkiraan dari screenshot; ganti dengan batas GPS survei untuk presisi.
  const center = [-6.9386182, 107.6075028];
  const overlayBounds = L.latLngBounds(
  [-6.9398602, 107.605700],
  [-6.9373762, 107.609386]
);

  areaBasemap = L.map(mapEl, {
    center,
    zoom: 19,
    minZoom: 17,
    maxZoom: 20,
    zoomControl: false,
    attributionControl: true,
  });
  L.tileLayer(
    "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png",
    {
      maxZoom: 20,
      attribution:
        '&copy; <a href="https://stadiamaps.com/attribution/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  ).addTo(areaBasemap);
  L.control.zoom({ position: "topright" }).addTo(areaBasemap);
  L.svgOverlay(svg, overlayBounds, { interactive: true }).addTo(areaBasemap);
  requestAnimationFrame(() => areaBasemap?.invalidateSize());
}

/* ---------- TAHAP 2: PILIH LANTAI ---------- */
function showFloors() {
  const b = getBuilding();
  titleEl.textContent = b.name;

  mapEl.innerHTML = `
    <div class="floor-selection">
      <h2>${b.name}</h2>
      <p>Pilih lantai yang ingin dibuka.</p>
      <div class="floor-buttons"></div>
    </div>`;

  const box = mapEl.querySelector(".floor-buttons");
  b.floors.forEach((f) => {
    const btn = document.createElement("button");
    btn.textContent = f.name;
    btn.addEventListener("click", () => {
      state.floorId = f.id;
      state.view = "plan";
      render();
    });
    box.appendChild(btn);
  });
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
  if (state.view === "plan") {
    state.view = "floors";
    state.floorId = null;
  } else if (state.view === "unavailable") {
    state.view = "area";
    state.buildingId = null;
    state.floorId = null;
  } else if (state.view === "floors") {
    state.view = "area";
    state.buildingId = null;
    state.floorId = null;
  }
  render();
}

backBtn.addEventListener("click", goBack);

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
  (e) => e.key === "Escape" && closeDetail(),
);

/* ---------- MULAI ---------- */
MapView.init(mapEl);
prepareData();
render();
