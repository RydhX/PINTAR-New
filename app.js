/* =========================================================
   PINTAR v2
   Alur: lokasi -> pilih gedung -> pilih lantai -> pilih ruang
   Aturan: klik hanya mengubah state, lalu render() menggambar ulang.
========================================================= */

const SVG_NS = "http://www.w3.org/2000/svg";

/* ---------- STATE ---------- */
const state = {
  view: "area", // "area" | "plan" | "unavailable"
  currentView: "map", // "map" | "data" | "client"
  buildingId: null,
  floorId: null,
  floorPickerOpen: false,
  sidebarOpen: false,
  mapControlsOpen: false,
};

let renderToken = 0;
const registry = new Map();
let areaBasemap = null;
let selectedBasemapId = "imagery";

/* ---------- ELEMEN HTML ---------- */
const mapEl = document.getElementById("map");
const sidebarContentEl = document.getElementById("sidebarContent");
const titleEl = document.getElementById("title");
const backBtn = document.getElementById("backBtn");
const floorPickerEl = document.getElementById("floorPicker");
const floorPickerTitleEl = document.getElementById("floorPickerTitle");
const detailEl = document.getElementById("detail");
const sidebarEl = document.getElementById("sidebar");
const openSidebarBtn = document.getElementById("openSidebar");
const sidebarMapControlsEl = document.getElementById("sidebarMapControls");
const mapControlsSidebarEl = document.getElementById("mapControlsSidebar");
const openMapControlsBtn = document.getElementById("openMapControls");
const closeMapControlsBtn = document.getElementById("closeMapControls");
const workspaceLayoutEl = document.getElementById("workspaceLayout");
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
const roomEditorDialog = document.getElementById("roomEditorDialog");
const closeRoomEditorDialogBtn = document.getElementById("closeRoomEditorDialog");
const roomEditorFormHost = document.getElementById("roomEditorFormHost");
const editorStatusEl = document.getElementById("editorStatus");
const clearTenantBtn = document.getElementById("clearTenantBtn");
const contractRoomListEl = document.getElementById("contractRoomList");
const installmentEditorEl = document.getElementById("installmentEditor");
const installmentListEl = document.getElementById("installmentList");
const installmentPaidTotalEl = document.getElementById("installmentPaidTotal");
const installmentRemainingEl = document.getElementById("installmentRemaining");
const partialPaymentEditorEl = document.getElementById("partialPaymentEditor");
const billingPeriodLabelEl = document.getElementById("billingPeriodLabel");
const initialPaymentInput = roomEditor.elements.namedItem("initial_payment_amount");
const partialPaymentScheduleInput = roomEditor.elements.namedItem("partial_payment_schedule");
const partialPaymentRemainingEl = document.getElementById("partialPaymentRemaining");
const contractValueInput = roomEditor.elements.namedItem("contract_value");
const paymentStatusInput = roomEditor.elements.namedItem("payment_status");
const installmentIntervalInput = roomEditor.elements.namedItem("installment_interval_months");
const startDateInput = roomEditor.elements.namedItem("start_date");
const endDateInput = roomEditor.elements.namedItem("end_date");
const actionConfirmDialog = document.getElementById("actionConfirm");
const actionConfirmTitle = document.getElementById("actionConfirmTitle");
const actionConfirmMessage = document.getElementById("actionConfirmMessage");
const actionConfirmCancel = document.getElementById("actionConfirmCancel");
const actionConfirmAccept = document.getElementById("actionConfirmAccept");
const actionSuccessDialog = document.getElementById("actionSuccess");
const actionSuccessTitle = document.getElementById("actionSuccessTitle");
const actionSuccessMessage = document.getElementById("actionSuccessMessage");
const actionSuccessClose = document.getElementById("actionSuccessClose");
const registerTenantBtn = document.getElementById("registerTenantBtn");
const userAvatarEl = document.getElementById("userAvatar");
const userLabelEl = document.getElementById("userLabel");
const mapLayoutEl = document.getElementById("mapLayout");
const tenantTableViewEl = document.getElementById("tenantTableView");
const clientPortalViewEl = document.getElementById("clientPortalView");
const invoicePageEl = document.getElementById("invoicePage");
const showMapViewBtn = document.getElementById("showMapView");
const showTenantTableBtn = document.getElementById("showTenantTable");
const showClientDataBtn = document.getElementById("showClientData");
const newTenantDialog = document.getElementById("newTenantDialog");
const closeNewTenantDialogBtn = document.getElementById("closeNewTenantDialog");
const newTenantFormHost = document.getElementById("newTenantFormHost");
const registrationBuildingEl = document.getElementById("registrationBuilding");
const registrationFloorEl = document.getElementById("registrationFloor");
const registrationRoomEl = document.getElementById("registrationRoom");
const toastEl = document.getElementById("toast");
let selectedRoomId = null;
let editorRoomId = null;
let registrationContext = null;
let toastTimer = null;
let resolveActionConfirmation = null;
let activeRoomPopup = null;

function showActionSuccess(title, message) {
  actionSuccessTitle.textContent = title;
  actionSuccessMessage.textContent = message;
  actionSuccessDialog.showModal();
  actionSuccessClose.focus();
}

actionSuccessClose.addEventListener("click", () => actionSuccessDialog.close());

function applyRole(user) {
  const isAdmin = user.role === "admin";
  const isClient = user.role === "client";
  if (window.matchMedia("(max-width: 900px)").matches) {
    state.sidebarOpen = false;
  }
  registerTenantBtn.hidden = !isAdmin;
  showTenantTableBtn.hidden = isClient;
  showClientDataBtn.hidden = !isClient;
  editRoomBtn.hidden = !isAdmin;
  clearTenantBtn.hidden = true;
  userAvatarEl.textContent = user.displayName.slice(0, 1).toLocaleUpperCase("id-ID");
  userLabelEl.textContent = `${user.displayName} · ${user.role}`;
  workspaceLayoutEl.hidden = false;
  clientPortalViewEl.hidden = true;
  invoicePageEl.hidden = true;
  tenantTableViewEl.hidden = true;
  mapLayoutEl.hidden = false;
  setCurrentView("map");
}

/* ---------- STATUS (warna ditentukan di satu tempat) ---------- */
const STATUS = {
  occupied: { label: "Terisi", color: "#22c55e" },
  vacant: { label: "Kosong", color: "#3b82f6" },
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
  { id: "L1", label: "Lantai 1 (Dasar)" },
  { id: "L2", label: "Lantai 2" },
  { id: "L3", label: "Lantai 3" },
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
  if (["dalam proses", "in_progress", "maintenance", "pemeliharaan"].includes(status)) {
    return "in_progress";
  }
  return null;
}

function isMaintenance(room) {
  return statusOf(room) === "in_progress";
}

function hasTenantData(room) {
  const tenant = String(room?.tenant || "").trim();
  return (
    statusOf(room) !== "vacant" &&
    tenant !== "" &&
    tenant !== "-" &&
    tenant.toLocaleLowerCase("id-ID") !== "tersedia"
  );
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 3500);
}

function isUnpaid(room) {
  const payment = String(room.payment || "").trim().toLocaleLowerCase("id-ID");
  const balance = paymentBalance(room);
  if (balance !== null) return balance > 0;
  return ["belum bayar", "belum dibayar", "unpaid", "overdue", "termin", "partial paid", "partial", "sebagian"].includes(payment);
}

function isPaid(room) {
  const payment = String(room.payment || "").trim().toLocaleLowerCase("id-ID");
  const balance = paymentBalance(room);
  return (
    (payment === "lunas" && (balance === null || balance === 0)) ||
    (["termin", "partial paid", "partial", "sebagian"].includes(payment) && balance === 0)
  );
}

function numericAmount(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function paymentBalance(room) {
  const payment = String(room.payment || "").trim().toLocaleLowerCase("id-ID");
  const legacyBalance = numericAmount(room.legacyOutstandingAmount);
  if (payment === "lunas") return 0;

  const contractValue = numericAmount(room.contractValue);
  if (contractValue !== null) {
    if (payment === "termin") {
      const paid = (room.installments || []).reduce(
        (total, installment) => total + (numericAmount(installment.amount) || 0),
        0,
      );
      return Math.max(contractValue - paid, 0);
    }
    if (["partial paid", "partial", "sebagian"].includes(payment)) {
      const initialPayment = numericAmount(room.initialPaymentAmount);
      if (initialPayment !== null) return Math.max(contractValue - initialPayment, 0);
    }
  }
  return legacyBalance;
}

function roomColor(room) {
  const occupancy = statusOf(room);
  if (occupancy === "vacant") return "#808080";
  if (isMaintenance(room)) return "#ef4444";
  if (isUnpaid(room)) return "#eab308";
  if (occupancy === "occupied" && isPaid(room)) return "#22c55e";
  return "#94a3b8";
}

function roomStatusLabel(room) {
  if (statusOf(room) === "vacant") return STATUS.vacant.label;
  if (isMaintenance(room)) return "Maintenance";
  if (isUnpaid(room)) return "Tunggakan";
  if (isPaid(room)) return "Lunas";
  const occupancy = statusOf(room);
  return occupancy ? STATUS[occupancy].label : "Status tidak dikenal";
}

function roomLabelText(roomId, room) {
  const occupancy = statusOf(room);
  if (occupancy === "vacant") return "Kosong";
  if (isMaintenance(room)) return "Maintenance";

  const user = Auth.currentUser;
  const canViewTenant = user?.role !== "client" || room.tenant === user.tenantName;
  if (occupancy === "occupied" && hasTenantData(room) && canViewTenant) {
    return room.tenant;
  }
  if (occupancy === "occupied" && user?.role === "client" && !canViewTenant) {
    return "Terisi";
  }
  return occupancy === "occupied" ? roomStatusLabel(room) : roomId;
}

statusEl.innerHTML =
  '<option value="all">Semua status</option>' +
  Object.entries(STATUS)
    .map(([k, s]) => `<option value="${k}">${s.label}</option>`)
    .join("") +
  '<option value="paid">Terisi lunas</option>' +
  '<option value="overdue">Tunggakan pembayaran</option>' +
  '<option value="maintenance">Maintenance</option>';

searchEl.addEventListener("input", () => {
  clearTimeout(searchEl._debounceTimer);
  searchEl._debounceTimer = setTimeout(applyFilter, 150);
});
statusEl.addEventListener("change", applyFilter);
function setActiveTab(tab) {
  const group = tab?.closest("[data-tabs]");
  if (!group) return;
  group.querySelectorAll('[role="tab"]').forEach((item) => {
    const selected = item === tab;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute("aria-controls")).hidden = !selected;
  });
}

document.querySelectorAll("[data-tabs]").forEach((group) => {
  group.addEventListener("click", (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab && group.contains(tab)) setActiveTab(tab);
  });
  group.addEventListener("keydown", (event) => {
    const current = event.target.closest('[role="tab"]');
    if (!current || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...group.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(current);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    event.preventDefault();
    tabs[nextIndex].focus();
    setActiveTab(tabs[nextIndex]);
  });
});
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
  const selectedBuilding = DATA.buildings.find(
    (building) => building.id === state.buildingId,
  );
  const buildings = selectedBuilding ? [selectedBuilding] : DATA.buildings;
  const rooms = buildings.flatMap((building) =>
    building.floors.flatMap((floor) => Object.values(floor.rooms)),
  );
  const metrics = summarizeRooms(rooms);

  document.getElementById("dashboardOccupancyPercent").textContent =
    `${metrics.occupancyPercent}%`;
  document.getElementById("dashboardPaidCount").textContent = metrics.paid;
  document.getElementById("dashboardOverdueCount").textContent =
    `${metrics.chartOverdue} tunggakan`;
  document.getElementById("dashboardExpiringCount").textContent = metrics.expiring;
  document.getElementById("roomDonutDescription").textContent =
    `${metrics.occupied} dari ${metrics.total} ruang terisi`;
  updateRoomDonut(metrics.total, metrics.occupied);

  const paymentTotal = metrics.paid + metrics.chartOverdue;
  const paidWidth = paymentTotal ? (metrics.paid / paymentTotal) * 100 : 0;
  const overdueWidth = paymentTotal ? (metrics.chartOverdue / paymentTotal) * 100 : 0;
  document.getElementById("paymentStatusPaidBar").style.width = `${paidWidth}%`;
  document.getElementById("paymentStatusOverdueBar").style.width = `${overdueWidth}%`;
  document.querySelector(".payment-stacked-bar").setAttribute(
    "aria-label",
    `Lunas ${metrics.paid}, tunggakan ${metrics.chartOverdue}`,
  );
}

function summarizeRooms(rooms) {
  const vacant = rooms.filter((room) => statusOf(room) === "vacant").length;
  const occupied = rooms.filter((room) => statusOf(room) === "occupied").length;
  const paid = rooms.filter(
    (room) => statusOf(room) !== "vacant" && isPaid(room) && !isMaintenance(room),
  ).length;
  const chartOverdue = rooms.filter(
    (room) =>
      statusOf(room) !== "vacant" &&
      !isMaintenance(room) &&
      !isPaid(room) &&
      isUnpaid(room),
  ).length;
  const expiring = rooms.filter((room) => {
    const days = daysLeft(room.end);
    return statusOf(room) !== "vacant" && days !== null && days >= 0 && days < 90;
  }).length;

  return {
    total: rooms.length,
    occupied,
    occupancyPercent: rooms.length ? Math.round((occupied / rooms.length) * 100) : 0,
    paid,
    chartOverdue,
    expiring,
  };
}

function updateRoomDonut(total, occupied) {
  const circumference = 2 * Math.PI * 43;
  const fraction = total > 0 ? occupied / total : 0;
  const occupiedLength = circumference * fraction;
  const visibleLength = Math.max(0, occupiedLength - (occupied > 0 ? 2 : 0));
  const segment = document.getElementById("roomDonutOccupied");
  segment.style.strokeDasharray = `${visibleLength} ${circumference - visibleLength}`;
  segment.style.opacity = occupied > 0 ? "1" : "0";
}

function updateSidebarLayout() {
  const showMapControls =
    state.currentView === "map" &&
    (state.view === "plan" || state.view === "unavailable");
  if (!showMapControls) state.mapControlsOpen = false;
  sidebarEl.hidden = false;
  sidebarMapControlsEl.hidden = !showMapControls;
  sidebarEl.classList.toggle("is-open", state.sidebarOpen);
  sidebarEl.inert = !state.sidebarOpen;
  openSidebarBtn.hidden = state.sidebarOpen;
  openSidebarBtn.setAttribute("aria-expanded", String(state.sidebarOpen));
  openMapControlsBtn.hidden = !showMapControls;
  openMapControlsBtn.setAttribute(
    "aria-expanded",
    String(showMapControls && state.mapControlsOpen),
  );
  mapControlsSidebarEl.classList.toggle(
    "is-open",
    showMapControls && state.mapControlsOpen,
  );
  mapControlsSidebarEl.setAttribute(
    "aria-hidden",
    String(!showMapControls || !state.mapControlsOpen),
  );
  mapControlsSidebarEl.inert = !showMapControls || !state.mapControlsOpen;
  sidebarContentEl.inert = !showMapControls || !state.mapControlsOpen;
}

function closeMapControls() {
  if (!state.mapControlsOpen) return;
  state.mapControlsOpen = false;
  updateSidebarLayout();
}

function setSidebarOpen(isOpen) {
  if (state.sidebarOpen === isOpen) return;
  state.sidebarOpen = isOpen;
  updateSidebarLayout();
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
  footerUpdateTimeEl.textContent = `Database terakhir diperbarui · ${time} WIB`;
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
  outstanding_amount: "legacyOutstandingAmount",
  contract_value: "contractValue",
  billing_period: "billingPeriod",
  installment_interval_months: "installmentIntervalMonths",
  initial_payment_amount: "initialPaymentAmount",
  partial_payment_schedule: "partialPaymentSchedule",
  last_payment_date: "lastPaymentDate",
  electricity_cost_rp: "electricityCostRp",
  electricity_kwh: "electricityKwh",
  phone_cost_rp: "phoneCostRp",
  pic: "pic",
  contact: "contact",
  notes: "notes",
};

function applyDatabaseRecords(records, endpointDiagnostics = []) {
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
        room.contractId = "";
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
    room.contractId = record.contract_id || "";
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
          "outstanding_amount",
          "electricity_kwh",
          "electricity_cost_rp",
          "phone_cost_rp",
          "contract_value",
          "initial_payment_amount",
          "installment_interval_months",
        ].includes(source) && Number.isFinite(Number(value))
          ? Number(value)
          : value;
    });
  });

  const diagnosticSignature = JSON.stringify(diagnostics);
  if (diagnosticSignature !== lastUnmatchedSignature) {
    if (diagnostics.length) {
      console.warn(
        "Diagnostik pemetaan database (tidak memuat data tenant):",
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
      findById(getSvgId(room, roomId))?.style.setProperty(
        "--room-color",
        roomColor(room),
      );
    }
  });
  mapEl.querySelectorAll(".room-label").forEach((label) => label.remove());
  addLabels(floor.rooms);
  buildSummary(floor.rooms);
  buildUnitList(floor.rooms);
  applyFilter();

  if (
    selectedRoomId &&
    floor.rooms[selectedRoomId] &&
    findById(getSvgId(floor.rooms[selectedRoomId], selectedRoomId))?.classList.contains("selected") &&
    !detailEl.hidden
  ) {
    showDetail(selectedRoomId);
  }
}

const getBuilding = () => DATA.buildings.find((b) => b.id === state.buildingId);
const getFloor = () => getBuilding().floors.find((f) => f.id === state.floorId);

/* ---------- BANTUAN ---------- */
function findById(id) {
  return mapEl.querySelector("#" + CSS.escape(id));
}

/* Dapatkan SVG element ID dari room object (support svgId mapping untuk L4-L10 pakai L3 SVG) */
function getSvgId(room, logicalId) {
  return room.svgId || logicalId;
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
// Cache menyimpan parsed SVGDocument (cloneable), bukan string
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
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "image/svg+xml");
    const svg = doc.documentElement;
    // Simpan clone asli untuk di-clone nanti
    svgCache.set(file, svg.cloneNode(true));
  }
  // Clone dari cache dan inject ke DOM (lebih cepat dari innerHTML + parse)
  mapEl.innerHTML = "";
  mapEl.appendChild(svgCache.get(file).cloneNode(true));
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
  updateSidebarLayout();
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

function renderCurrentView() {
  if (state.view === "area" && areaBasemap) return Promise.resolve();
  return render();
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

function markZones(svgPrefix) {
  const svg = mapEl.querySelector("svg");
  if (!svg) return;

  svg.querySelectorAll("[id]").forEach((node) => {
    if (node.id.startsWith(svgPrefix)) {
      node.classList.add("zone");
    }
  });
}

function buildRegistry(rooms = {}) {
  registry.clear();
  const index = { 
    el: new Map(), 
    labelEl: new Map(), 
    listEl: new Map() 
  };
  
  Object.entries(rooms).forEach(([roomId, room]) => {
    const svgId = getSvgId(room, roomId);
    const el = findById(svgId);
    registry.set(roomId, { room, el });
    if (el) index.el.set(roomId, el);
    
    const label = mapEl.querySelector(`.room-label[data-room-id="${CSS.escape(roomId)}"]`);
    if (label) index.labelEl.set(roomId, label);
    
    const listItem = unitListEl.querySelector(`[data-id="${CSS.escape(roomId)}"]`);
    if (listItem) index.listEl.set(roomId, listItem);
  });
  
  registry.index = index; // simpan index untuk applyFilter
  return registry;
}

function checkSvgAgainstData(rooms = {}) {
  const missing = Object.entries(rooms)
    .filter(([roomId, room]) => !findById(getSvgId(room, roomId)))
    .map(([roomId]) => roomId);
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
    const svgId = getSvgId(room, roomId);
    const el = findById(svgId);
    if (!el) {
      console.warn("Ruang tidak ada di SVG:", roomId, "(svgId:", svgId, ")");
      return;
    }
    el.classList.add("clickable", "room");
    const occupancy = statusOf(room);
    el.style.setProperty("--room-color", roomColor(room));
    el.addEventListener("click", (event) => {
      closeDetail();
      showRoomPopup(roomId, el, event);
    });
  });

  markZones(f.svgPrefix || f.id + "_");
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
    prefix: f.svgPrefix || f.id + "_",
    rooms: [...registry.values()].map((entry) => entry.el).filter(Boolean),
  });
}

/* ---------- RINGKASAN + LEGENDA ---------- */
function buildSummary(rooms = {}) {
  const list = Object.values(rooms);
  const paid = list.filter(
    (room) => statusOf(room) !== "vacant" && isPaid(room) && !isMaintenance(room),
  ).length;
  const unpaid = list.filter(isUnpaid).length;
  const vacant = list.filter((room) => statusOf(room) === "vacant").length;
  const maintenance = list.filter(isMaintenance).length;

  const expiring = list.filter((r) => {
    const d = daysLeft(r.end);
    return statusOf(r) !== "vacant" && d !== null && d >= 0 && d < 90;
  }).length;

  summaryEl.innerHTML =
    `<div class="sum-item">Total ruang<b>${list.length}</b></div>` +
    `<div class="sum-item"><span class="swatch" style="background:${STATUS.occupied.color}"></span>Terisi lunas<b>${paid}</b></div>` +
    `<div class="sum-item sum-overdue"><span class="swatch"></span>Tunggakan pembayaran<b>${unpaid}</b></div>` +
    `<div class="sum-item"><span class="swatch" style="background:${STATUS.vacant.color}"></span>Unit kosong<b>${vacant}</b></div>` +
    `<div class="sum-item"><span class="swatch" style="background:${STATUS.in_progress.color}"></span>Maintenance<b>${maintenance}</b></div>` +
    `<div class="sum-item sum-warn">Kontrak berakhir &lt; 90 hari<b>${expiring}</b></div>`;
}

/* ---------- DAFTAR UNIT ---------- */
function buildUnitList(rooms = {}) {
  unitListEl.innerHTML = "";
  Object.entries(rooms).forEach(([roomId, room]) => {
    const occupancy = statusOf(room);
    const color = roomColor(room);
    const item = document.createElement("div");
    item.className = "unit-item";
    item.dataset.id = roomId;
    item.style.setProperty("--c", color);
    const id = document.createElement("b");
    id.textContent = roomId;
    const tenant = document.createElement("span");
    tenant.textContent = room.tenant ||
      (occupancy === "vacant" ? "Tersedia" : Auth.currentUser?.role === "client" ? "Terisi" : "-");
    const status = document.createElement("small");
    status.style.color = color;
    status.textContent = roomStatusLabel(room);
    item.append(id, tenant, status);
    item.addEventListener("click", () => selectRoom(roomId));
    unitListEl.appendChild(item);
  });
}

function showRoomPopup(roomId, roomElement, event) {
  closeMapControls();
  activeRoomPopup?.remove();
  const room = getFloor()?.rooms[roomId];
  if (!room) return;

  const popup = document.createElement("section");
  popup.className = "map-room-popup";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", `Ringkasan ruang ${roomId}`);

  const heading = document.createElement("div");
  heading.className = "map-room-popup-heading";
  const title = document.createElement("strong");
  title.textContent = roomId;
  const closeButton = document.createElement("button");
  closeButton.className = "map-room-popup-close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Tutup ringkasan ruang");
  closeButton.textContent = "×";
  closeButton.addEventListener("click", () => {
    popup.remove();
    activeRoomPopup = null;
  });
  heading.append(title, closeButton);

  const tenant = document.createElement("p");
  tenant.className = "map-room-popup-tenant";
  const isClient = Auth.currentUser?.role === "client";
  const canViewTenant = !isClient || room.tenant === Auth.currentUser.tenantName;
  tenant.textContent = isClient && statusOf(room) !== "vacant" && !canViewTenant
    ? "Informasi tenant tidak tersedia"
    : statusOf(room) !== "vacant" && room.tenant && room.tenant !== "Tersedia"
      ? room.tenant
      : "Belum ada tenant";

  const status = document.createElement("span");
  status.className = "map-room-popup-status";
  status.textContent = roomStatusLabel(room);

  const payment = document.createElement("p");
  payment.className = "map-room-popup-payment";
  payment.textContent = canViewTenant && room.payment && room.payment !== "-"
    ? `Pembayaran: ${room.payment}`
    : isClient && !canViewTenant && statusOf(room) !== "vacant"
      ? "Ruang terisi"
      : "Belum ada informasi pembayaran";

  const detailsButton = document.createElement("button");
  detailsButton.className = "map-room-popup-details";
  detailsButton.type = "button";
  detailsButton.textContent = "View Tenant Details";
  if (!isClient || canViewTenant && statusOf(room) !== "vacant") {
    detailsButton.addEventListener("click", () => {
      popup.remove();
      activeRoomPopup = null;
      selectRoom(roomId, { allowVacant: !isClient });
    });
  }

  popup.append(heading, tenant, status, payment);
  if (!isClient || canViewTenant && statusOf(room) !== "vacant") {
    popup.appendChild(detailsButton);
  }
  mapEl.appendChild(popup);
  activeRoomPopup = popup;

  const mapBounds = mapEl.getBoundingClientRect();
  const roomBounds = roomElement.getBoundingClientRect();
  const popupBounds = popup.getBoundingClientRect();
  const pointerX = Number.isFinite(event?.clientX)
    ? event.clientX - mapBounds.left
    : roomBounds.left + roomBounds.width / 2 - mapBounds.left;
  const pointerY = Number.isFinite(event?.clientY)
    ? event.clientY - mapBounds.top
    : roomBounds.top + roomBounds.height / 2 - mapBounds.top;
  const margin = 12;
  const left = Math.max(
    margin,
    Math.min(pointerX - popupBounds.width / 2, mapBounds.width - popupBounds.width - margin),
  );
  const top = Math.max(
    margin,
    Math.min(pointerY - popupBounds.height - 14, mapBounds.height - popupBounds.height - margin),
  );
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
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
  if (!floor || !registry.index) return;

  const q = searchEl.value.trim().toLowerCase();
  const wanted = statusEl.value;
  const { el, labelEl, listEl } = registry.index;

  // Gunakan requestAnimationFrame untuk batch DOM updates
  requestAnimationFrame(() => {
    Object.entries(floor.rooms).forEach(([roomId, room]) => {
      const occupancy = statusOf(room);
      const match = (wanted === "all" ||
        (wanted === "overdue" ? isUnpaid(room) :
          wanted === "paid" ? isPaid(room) && occupancy !== "vacant" && !isMaintenance(room) :
          wanted === "maintenance" ? isMaintenance(room) :
          wanted === occupancy)) &&
        (roomId + " " + (room.tenant || "")).toLowerCase().includes(q);

      const hide = !match;
      listEl.get(roomId)?.toggleAttribute("hidden", hide);
      el.get(roomId)?.classList.toggle("dimmed", hide);
      labelEl.get(roomId)?.classList.toggle("dimmed", hide);
    });
  });
}

/* ---------- LABEL RUANG ---------- */
function addLabels(rooms = {}) {
  const svg = mapEl.querySelector("svg");
  if (!svg) return;

  const FONT = 26;

  // 1. Hapus label lama pakai DocumentFragment (batch remove)
  const oldLabels = svg.querySelectorAll(".room-label");
  if (oldLabels.length) {
    const frag = document.createDocumentFragment();
    oldLabels.forEach(l => frag.appendChild(l));
  }

  // 2. Kumpulkan SEMUA label baru dalam DocumentFragment (batch insert)
  const frag = document.createDocumentFragment();

  Object.entries(rooms).forEach(([roomId, room]) => {
    const svgId = getSvgId(room, roomId);
    const el = findById(svgId);
    if (!el) return;
    const box = el.getBBox();
    const text = roomLabelText(roomId, room);

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

    frag.appendChild(t); // Masuk ke fragment, BELUM ke DOM
  });

  // 3. Single reflow: insert SEMUA label sekaligus
  svg.appendChild(frag);
}

/* ---------- TAHAP 4: DETAIL RUANG ---------- */
function selectRoom(roomId, { allowVacant = false } = {}) {
  const room = getFloor()?.rooms[roomId];
  const user = Auth.currentUser;
  if (
    user?.role === "client" &&
    (!room || statusOf(room) === "vacant" || room.tenant !== user.tenantName)
  ) {
    closeDetail();
    showToast("Detail ruang hanya tersedia untuk tenant terkait.");
    return;
  }
  if (!room || (!allowVacant && !hasTenantData(room))) {
    closeDetail();
    showToast("Ruangan/Tenant ini belum terisi");
    return;
  }
  activeRoomPopup?.remove();
  activeRoomPopup = null;

  selectedRoomId = roomId;
  mapEl
    .querySelectorAll(".room.selected")
    .forEach((e) => e.classList.remove("selected"));
  findById(getSvgId(room, roomId))?.classList.add("selected");

  document
    .querySelectorAll(".unit-item")
    .forEach((i) => i.classList.toggle("active", i.dataset.id === roomId));
  clearTenantBtn.hidden = !hasTenantData(room);
  editRoomBtn.hidden = user?.role !== "admin";
  clearTenantBtn.hidden = user?.role !== "admin" || !hasTenantData(room);

  showDetail(roomId);
}

function showDetail(roomId) {
  closeMapControls();
  const room = getFloor().rooms[roomId];
  populateRoomEditor(roomId, room);
  const d = daysLeft(room.end);

  const rows = { general: [], payment: [], utilities: [] };
  const hasValue = (value) =>
    value !== undefined &&
    value !== null &&
    String(value).trim() !== "" &&
    String(value).trim() !== "-";
  const addRow = (section, label, value, className = "") => {
    if (hasValue(value)) rows[section].push([label, value, className]);
  };
  const linkedRooms = room.contractId
    ? Object.entries(getFloor().rooms)
        .filter(([, item]) => item.contractId === room.contractId)
        .map(([id]) => id)
    : [roomId];
  addRow("general", "Ruangan dalam kontrak", linkedRooms.join(", "));
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

  addRow("payment", "Status pembayaran", room.payment);
  addRow(
    "payment",
    String(room.payment || "").toLocaleLowerCase("id-ID") === "lunas"
      ? "Nilai pembayaran penuh"
      : "Nilai kontrak",
    hasValue(room.contractValue) ? formatMoney(room.contractValue) : "",
  );
  const paymentScheme = String(room.payment || "").toLocaleLowerCase("id-ID");
  if (paymentScheme === "lunas") {
    const billingPeriod = room.billingPeriod === "yearly" ? "Per-Tahun" : "Per-Bulan";
    addRow("payment", "Periode pembayaran", billingPeriod);
  } else if (paymentScheme === "termin") {
    const installments = Array.isArray(room.installments) ? room.installments : [];
    const paidTotal = installments.reduce(
      (total, item) => total + (Number(item.amount) || 0),
      0,
    );
    const interval = numericAmount(room.installmentIntervalMonths);
    addRow(
      "payment",
      "Interval pembayaran",
      interval ? `Setiap ${interval} bulan` : "",
    );
    const schedule = buildInstallmentSchedule(
      room.contractValue,
      room.start,
      room.end,
      interval || 0,
      installments,
    );
    schedule.forEach((item) => {
      addRow("payment", `Termin ${item.term} · ${item.dueDate}`, `${formatMoney(item.paid)} / ${formatMoney(item.amount)}`);
    });
    addRow("payment", "Total dibayar", formatMoney(paidTotal));
    addRow(
      "payment",
      "Sisa pembayaran",
      formatMoney(paymentBalance(room) || 0),
      (paymentBalance(room) || 0) > 0 ? "warn" : "",
    );
  } else if (["partial paid", "partial", "sebagian"].includes(paymentScheme)) {
    const remaining = paymentBalance(room);
    addRow("payment", "Uang muka / DP", formatMoney(room.initialPaymentAmount));
    addRow(
      "payment",
      "Sisa untuk jadwal khusus",
      remaining === null ? "" : formatMoney(remaining),
      remaining > 0 ? "warn" : "",
    );
    addRow("payment", "Jadwal pelunasan", room.partialPaymentSchedule);
  }
  addRow("general", "Luas", hasValue(room.area) ? `${room.area} m²` : "");
  addRow("payment", "Mulai sewa", formatDateIfValid(room.start));
  addRow("payment", "Berakhir", formatDateIfValid(room.end));
  if (hasValue(room.end) && d !== null) {
    addRow("payment", "Sisa kontrak", remainingText(room.end), d < 90 ? "warn" : "");
  }
  addRow("payment", "Pembayaran terakhir", formatDateIfValid(room.lastPaymentDate));
  addRow(
    "utilities",
    "Biaya listrik",
    hasValue(room.electricityCostRp) ? formatMoney(room.electricityCostRp) : "",
  );
  addRow(
    "utilities",
    "Pemakaian listrik",
    hasValue(room.electricityKwh) ? `${room.electricityKwh} kWh` : "",
  );
  addRow(
    "utilities",
    "Biaya telepon",
    hasValue(room.phoneCostRp) ? formatMoney(room.phoneCostRp) : "",
  );
  addRow("general", "PIC", room.pic);
  addRow("general", "Kontak Client", room.contact);
  addRow("utilities", "Catatan", room.notes);

  document.getElementById("dUnit").textContent = "Unit " + roomId;
  document.getElementById("dTenant").textContent = room.tenant || "";
  const pill = document.getElementById("dStatus");
  pill.textContent = roomStatusLabel(room);
  pill.style.setProperty("--c", roomColor(room));
  setActiveTab(document.getElementById("detailGeneralTab"));
  Object.entries({
    general: "dRows",
    payment: "dPaymentRows",
    utilities: "dUtilityRows",
  }).forEach(([section, elementId]) => {
    const detailRows = document.getElementById(elementId);
    detailRows.replaceChildren();
    if (!rows[section].length) {
      const empty = document.createElement("p");
      empty.className = "detail-empty";
      empty.textContent = section === "utilities"
        ? "Belum ada data utilitas."
        : "Belum ada data pembayaran.";
      detailRows.appendChild(empty);
    }
    rows[section].forEach(([key, value, className]) => {
      const row = document.createElement("div");
      row.className = `row ${className || ""}`;
      const label = document.createElement("span");
      label.textContent = key;
      const content = document.createElement("b");
      content.textContent = String(value);
      row.append(label, content);
      detailRows.appendChild(row);
    });
  });

  detailEl.hidden = false;
}

const EDITABLE_ROOM_FIELDS = [
  "tenant",
  "occupancy_status",
  "payment_status",
  "start_date",
  "end_date",
  "contract_value",
  "billing_period",
  "installment_interval_months",
  "initial_payment_amount",
  "partial_payment_schedule",
  "last_payment_date",
  "electricity_cost_rp",
  "electricity_kwh",
  "phone_cost_rp",
  "pic",
  "contact",
  "notes",
];

function populateRoomEditor(
  roomId,
  room,
  { isNew = false, rooms = getFloor().rooms } = {},
) {
  if (!isNew && !roomEditor.hidden && editorRoomId === roomId) return;
  roomEditor.hidden = true;
  setActiveTab(document.getElementById("editorGeneralTab"));
  editorRoomId = roomId;
  editorStatusEl.textContent = "";

  const occupancy = statusOf(room);
  const values = {
    tenant: isNew || occupancy === "vacant" || room.tenant === "Tersedia" ? "" : room.tenant || "",
    occupancy_status: isNew ? "occupied" : occupancy || "vacant",
    payment_status: room.payment || "",
    start_date: dateInputValue(room.start),
    end_date: dateInputValue(room.end),
    contract_value: numericInputValue(room.contractValue),
    billing_period: room.billingPeriod || "monthly",
    installment_interval_months: room.installmentIntervalMonths || "6",
    initial_payment_amount: numericInputValue(room.initialPaymentAmount),
    partial_payment_schedule: room.partialPaymentSchedule || "",
    last_payment_date: dateInputValue(room.lastPaymentDate),
    electricity_cost_rp: numericInputValue(room.electricityCostRp),
    electricity_kwh: numericInputValue(room.electricityKwh),
    phone_cost_rp: numericInputValue(room.phoneCostRp),
    pic: room.pic,
    contact: room.contact,
    notes: room.notes,
  };

  const paymentSelect = roomEditor.elements.namedItem("payment_status");
  const normalizedPayment = String(values.payment_status || "").trim().toLocaleLowerCase("id-ID");
  values.payment_status = normalizedPayment === "partial paid" || normalizedPayment === "partially paid"
    ? "Partial Paid"
    : normalizedPayment === "termin"
      ? "Termin"
      : normalizedPayment === "lunas" || normalizedPayment === "paid"
        ? "Lunas"
        : "";
  if (
    values.initial_payment_amount === "" &&
    ["partial paid", "partially paid"].includes(normalizedPayment) &&
    numericAmount(room.contractValue) !== null &&
    numericAmount(room.legacyOutstandingAmount) !== null
  ) {
    values.initial_payment_amount =
      numericAmount(room.contractValue) - numericAmount(room.legacyOutstandingAmount);
  }
  roomEditor.elements.namedItem("occupancy_status").closest("label").hidden = isNew;
  EDITABLE_ROOM_FIELDS.forEach((field) => {
    const control = roomEditor.elements.namedItem(field);
    if (!control) return;
    control.value = control.hasAttribute("data-currency")
      ? formatCurrencyInput(values[field])
      : values[field] ?? "";
    if (control.hasAttribute("data-currency")) updateCurrencyPreview(field, values[field]);
  });
  renderContractRoomPicker(roomId, room, rooms);
  renderInstallments(room.installments || []);
  updateInstallmentMode();
}

function renderContractRoomPicker(selectedRoomId, selectedRoom, rooms = getFloor().rooms) {
  const contractId = selectedRoom.contractId || "";
  const linkedRoomIds = new Set(
    Object.entries(rooms)
      .filter(([, room]) => room.contractId && room.contractId === contractId)
      .map(([roomId]) => roomId),
  );
  linkedRoomIds.add(selectedRoomId);
  contractRoomListEl.replaceChildren();

  Object.entries(rooms).forEach(([roomId, room]) => {
    const isLinkedToAnotherContract =
      room.contractId && room.contractId !== contractId;
    const isUnavailable =
      statusOf(room) !== "vacant" && roomId !== selectedRoomId && !room.contractId;
    const row = document.createElement("label");
    row.className = "contract-room-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = roomId;
    checkbox.checked = linkedRoomIds.has(roomId);
    checkbox.disabled = Boolean(isLinkedToAnotherContract || isUnavailable);

    const name = document.createElement("span");
    name.className = "contract-room-name";
    name.textContent = roomId + (checkbox.disabled ? " · sudah digunakan" : "");

    const area = document.createElement("input");
    area.type = "number";
    area.min = "0";
    area.step = "any";
    area.placeholder = "Luas m²";
    area.value = numericInputValue(room.area);
    area.setAttribute("aria-label", `Luas ruangan ${roomId} dalam meter persegi`);
    area.disabled = !checkbox.checked || checkbox.disabled;

    checkbox.addEventListener("change", () => {
      area.disabled = !checkbox.checked;
    });
    row.append(checkbox, name, area);
    contractRoomListEl.appendChild(row);
  });
}

function availableRegistrationBuildings() {
  return DATA.buildings.filter((building) =>
    building.floors.some((floor) => Object.keys(floor.rooms).length > 0),
  );
}

function updateRegistrationFloors() {
  const building = DATA.buildings.find(
    (item) => item.id === registrationBuildingEl.value,
  );
  registrationContext = null;
  roomEditor.hidden = true;
  registrationFloorEl.replaceChildren(new Option("Pilih lantai", ""));
  registrationRoomEl.replaceChildren(new Option("Pilih ruang", ""));
  registrationFloorEl.disabled = !building;
  registrationRoomEl.disabled = true;
  if (!building) return;

  building.floors
    .filter((floor) => Object.keys(floor.rooms).length > 0)
    .forEach((floor) =>
      registrationFloorEl.add(new Option(floor.name, floor.id)),
    );
  registrationFloorEl.value = "";
}

function updateRegistrationRooms() {
  const building = DATA.buildings.find(
    (item) => item.id === registrationBuildingEl.value,
  );
  const floor = building?.floors.find(
    (item) => item.id === registrationFloorEl.value,
  );
  registrationRoomEl.replaceChildren(new Option("Pilih ruang", ""));
  registrationRoomEl.disabled = !floor;
  roomEditor.hidden = true;
  if (!floor) {
    registrationContext = null;
    return;
  }

  const vacantRooms = Object.entries(floor.rooms).filter(
    ([, room]) => statusOf(room) === "vacant",
  );
  vacantRooms.forEach(([roomId]) =>
    registrationRoomEl.add(new Option(roomId, roomId)),
  );
  if (!vacantRooms.length) {
    registrationRoomEl.replaceChildren(new Option("Tidak ada ruang kosong", ""));
    registrationRoomEl.disabled = true;
    registrationContext = null;
    return;
  }

  registrationRoomEl.value = "";
  registrationContext = null;
}

function updateRegistrationTarget() {
  const building = DATA.buildings.find(
    (item) => item.id === registrationBuildingEl.value,
  );
  const floor = building?.floors.find(
    (item) => item.id === registrationFloorEl.value,
  );
  const roomId = registrationRoomEl.value;
  const room = floor?.rooms[roomId];
  if (!building || !floor || !room || statusOf(room) !== "vacant") {
    registrationContext = null;
    roomEditor.hidden = true;
    return;
  }

  registrationContext = {
    buildingId: building.id,
    floorId: floor.id,
    roomId,
  };
  populateRoomEditor(roomId, room, { isNew: true, rooms: floor.rooms });
  roomEditor.hidden = false;
  roomEditor.querySelector('[type="submit"]').textContent = "Daftarkan tenant";
}

function beginNewTenantRegistration() {
  const buildings = availableRegistrationBuildings();
  if (!buildings.length) {
    showToast("Belum ada gedung dan lantai dengan ruang terpetakan untuk pendaftaran.");
    return;
  }

  registrationBuildingEl.replaceChildren(new Option("Pilih gedung", ""));
  buildings.forEach((building) =>
    registrationBuildingEl.add(new Option(building.name, building.id)),
  );
  registrationFloorEl.replaceChildren(new Option("Pilih lantai", ""));
  registrationRoomEl.replaceChildren(new Option("Pilih ruang", ""));
  registrationFloorEl.disabled = true;
  registrationRoomEl.disabled = true;
  registrationContext = null;
  roomEditor.hidden = true;
  newTenantFormHost.appendChild(roomEditor);
  newTenantDialog.showModal();
  registrationBuildingEl.focus();
}

registerTenantBtn.addEventListener("click", beginNewTenantRegistration);
registrationBuildingEl.addEventListener("change", updateRegistrationFloors);
registrationFloorEl.addEventListener("change", updateRegistrationRooms);
registrationRoomEl.addEventListener("change", updateRegistrationTarget);
closeNewTenantDialogBtn.addEventListener("click", () => newTenantDialog.close());
newTenantDialog.addEventListener("close", () => {
  roomEditor.hidden = true;
  roomEditor.elements.namedItem("occupancy_status").closest("label").hidden = false;
  roomEditor.querySelector('[type="submit"]').textContent = "Simpan ke database";
  roomEditorFormHost.appendChild(roomEditor);
  registrationContext = null;
  editorRoomId = null;
  editorStatusEl.textContent = "";
});

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
    .map((input) => ({
      term: Number(input.dataset.term),
      amount: numericInputValue(input.value),
    }))
    .filter((item) => item.amount !== "");
}

function addMonths(value, months) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const targetMonth = date.getMonth() + months;
  const lastDay = new Date(date.getFullYear(), targetMonth + 1, 0).getDate();
  return new Date(date.getFullYear(), targetMonth, Math.min(date.getDate(), lastDay));
}

function installmentCount(start, end, interval) {
  if (!start || !end || !Number.isInteger(interval) || interval < 1) return 0;
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    return 0;
  }
  let months = (endDate.getFullYear() - startDate.getFullYear()) * 12 +
    endDate.getMonth() - startDate.getMonth();
  const anniversary = addMonths(start, months);
  if (anniversary && anniversary < endDate) months += 1;
  return Math.max(1, Math.ceil(months / interval));
}

function buildInstallmentSchedule(contractValue, start, end, interval, paidInstallments = []) {
  const total = numericAmount(contractValue);
  const count = installmentCount(dateInputValue(start), dateInputValue(end), Number(interval));
  if (total === null || total <= 0 || !count) return [];
  const paidByTerm = new Map(
    paidInstallments.map((item) => [Number(item.term), numericAmount(item.amount) || 0]),
  );
  const baseAmount = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) => {
    const term = index + 1;
    const dueDate = addMonths(dateInputValue(start), index * Number(interval));
    return {
      term,
      amount: term === count ? total - baseAmount * (count - 1) : baseAmount,
      paid: paidByTerm.get(term) || 0,
      dueDate: dueDate
        ? dueDate.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
        : "-",
    };
  });
}

function renderInstallments(paidInstallments) {
  installmentListEl.replaceChildren();
  const interval = Number(installmentIntervalInput.value);
  const schedule = buildInstallmentSchedule(
    numericInputValue(contractValueInput.value),
    startDateInput.value,
    endDateInput.value,
    interval,
    paidInstallments,
  );
  schedule.forEach((installment) => {
    const row = document.createElement("div");
    row.className = "installment-row";
    const terms = document.createElement("div");
    terms.className = "installment-due";
    terms.textContent = `Termin ${installment.term} · ${installment.dueDate} · ${fmtRupiah(installment.amount)}`;
    const label = document.createElement("label");
    const labelText = document.createElement("span");
    labelText.textContent = "Nominal dibayar (Rp)";
    const input = document.createElement("input");
    input.className = "installment-amount";
    input.dataset.term = String(installment.term);
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.value = formatCurrencyInput(installment.paid);
    label.append(labelText, input);
    row.append(terms, label);
    installmentListEl.appendChild(row);
  });
  if (!schedule.length && paymentStatusInput.value.toLocaleLowerCase("id-ID") === "termin") {
    const hint = document.createElement("p");
    hint.className = "detail-empty";
    hint.textContent = "Isi nilai kontrak dan rentang tanggal kontrak untuk membuat jadwal termin.";
    installmentListEl.appendChild(hint);
  }
  updateInstallmentSummary();
}

function updateInstallmentSummary() {
  const paidTotal = readInstallments().reduce((total, item) => total + item.amount, 0);
  const contractValue = numericInputValue(contractValueInput.value);
  const remaining = Math.max((contractValue || 0) - paidTotal, 0);
  installmentPaidTotalEl.textContent = fmtRupiah(paidTotal);
  installmentRemainingEl.textContent = fmtRupiah(remaining);
  installmentRemainingEl.classList.toggle(
    "installment-overpaid",
    contractValue !== "" && paidTotal > contractValue,
  );
}

function updatePartialPaymentSummary() {
  const contractValue = numericInputValue(contractValueInput.value);
  const initialPayment = numericInputValue(initialPaymentInput.value);
  partialPaymentRemainingEl.textContent =
    contractValue === "" || initialPayment === ""
      ? "Isi nilai kontrak dan DP"
      : fmtRupiah(Math.max(contractValue - initialPayment, 0));
}

function updateInstallmentSchedule() {
  renderInstallments(readInstallments());
}

function updateInstallmentMode() {
  const mode = paymentStatusInput.value.toLocaleLowerCase("id-ID");
  const isInstallment = mode === "termin";
  const isPartial = ["partial paid", "partial", "sebagian"].includes(mode);
  const isPaidInFull = mode === "lunas";
  installmentEditorEl.hidden = !isInstallment;
  partialPaymentEditorEl.hidden = !isPartial;
  billingPeriodLabelEl.hidden = !isPaidInFull;
  if (isInstallment) updateInstallmentSchedule();
  if (isPartial) updatePartialPaymentSummary();
}

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

contractValueInput.addEventListener("input", () => {
  updateInstallmentSchedule();
  updatePartialPaymentSummary();
});
paymentStatusInput.addEventListener("change", updateInstallmentMode);
installmentIntervalInput.addEventListener("change", updateInstallmentSchedule);
startDateInput.addEventListener("change", updateInstallmentSchedule);
endDateInput.addEventListener("change", updateInstallmentSchedule);
initialPaymentInput.addEventListener("input", updatePartialPaymentSummary);

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
  roomEditor.querySelector('[type="submit"]').textContent = "Simpan Perubahan";
  roomEditorDialog.showModal();
});

document.getElementById("cancelRoomEdit").addEventListener("click", () => {
  if (registrationContext) {
    newTenantDialog.close();
    return;
  }
  roomEditor.hidden = true;
  editorStatusEl.textContent = "";
  roomEditorDialog.close();
  if (selectedRoomId) {
    populateRoomEditor(selectedRoomId, getFloor().rooms[selectedRoomId]);
  }
});

closeRoomEditorDialogBtn.addEventListener("click", () => {
  document.getElementById("cancelRoomEdit").click();
});

roomEditorDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  document.getElementById("cancelRoomEdit").click();
});

roomEditorDialog.addEventListener("close", () => {
  roomEditor.hidden = true;
  roomEditor.querySelector('[type="submit"]').textContent = "Simpan ke database";
  editorStatusEl.textContent = "";
  roomEditorFormHost.appendChild(roomEditor);
});

roomEditor.addEventListener("submit", async (event) => {
  event.preventDefault();
  const isNewRegistration = Boolean(registrationContext);
  const activeRoomId = registrationContext?.roomId || selectedRoomId;
  const buildingId = registrationContext?.buildingId || state.buildingId;
  const floorId = registrationContext?.floorId || state.floorId;
  const floor = DATA.buildings
    .find((building) => building.id === buildingId)
    ?.floors.find((item) => item.id === floorId);
  if (!activeRoomId || !buildingId || !floorId || !floor) return;

  const installments = readInstallments();
  const contractValue = numericInputValue(contractValueInput.value);
  const totalPaid = installments.reduce((total, item) => total + item.amount, 0);
  const paymentMode = paymentStatusInput.value.toLocaleLowerCase("id-ID");
  if (!["lunas", "termin", "partial paid"].includes(paymentMode)) {
    editorStatusEl.textContent = "Pilih skema pembayaran Lunas, Termin, atau Partial Paid.";
    setActiveTab(document.getElementById("editorPaymentTab"));
    paymentStatusInput.focus();
    return;
  }
  if (contractValue === "" || contractValue <= 0) {
    editorStatusEl.textContent = "Isi nilai pembayaran atau nilai kontrak lebih dari Rp0.";
    setActiveTab(document.getElementById("editorPaymentTab"));
    contractValueInput.focus();
    return;
  }
  if (paymentMode === "lunas" && !["monthly", "yearly"].includes(roomEditor.elements.namedItem("billing_period").value)) {
    editorStatusEl.textContent = "Pilih periode pembayaran Per-Bulan atau Per-Tahun.";
    setActiveTab(document.getElementById("editorPaymentTab"));
    roomEditor.elements.namedItem("billing_period").focus();
    return;
  }
  if (paymentMode === "termin") {
    const expectedCount = installmentCount(
      startDateInput.value,
      endDateInput.value,
      Number(installmentIntervalInput.value),
    );
    if (!expectedCount) {
      editorStatusEl.textContent = "Isi rentang tanggal kontrak yang valid untuk membuat jadwal termin.";
      setActiveTab(document.getElementById("editorPaymentTab"));
      startDateInput.focus();
      return;
    }
    if (installments.some((item) => item.amount > 0) && installments.length > expectedCount) {
      editorStatusEl.textContent = "Pembayaran termin melebihi jumlah jadwal yang dibuat.";
      return;
    }
    if (totalPaid > contractValue) {
      editorStatusEl.textContent = "Total nominal yang sudah dibayar tidak boleh melebihi nilai kontrak.";
      setActiveTab(document.getElementById("editorPaymentTab"));
      return;
    }
  }
  if (paymentMode === "partial paid") {
    const initialPayment = numericInputValue(initialPaymentInput.value);
    if (initialPayment === "" || initialPayment <= 0 || initialPayment > contractValue) {
      editorStatusEl.textContent = "Isi nominal DP lebih dari Rp0 dan tidak melebihi nilai kontrak.";
      setActiveTab(document.getElementById("editorPaymentTab"));
      initialPaymentInput.focus();
      return;
    }
    if (!partialPaymentScheduleInput.value.trim()) {
      editorStatusEl.textContent = "Isi jadwal pelunasan sesuai kesepakatan.";
      setActiveTab(document.getElementById("editorPaymentTab"));
      partialPaymentScheduleInput.focus();
      return;
    }
  }

  const formData = new FormData(roomEditor);
  const tenantName = String(formData.get("tenant") || "").trim();
  if (!tenantName) {
    editorStatusEl.textContent = "Nama tenant wajib diisi.";
    roomEditor.elements.namedItem("tenant").focus();
    return;
  }
  if (!["occupied", "in_progress"].includes(String(formData.get("occupancy_status") || ""))) {
    editorStatusEl.textContent = "Status okupansi kontrak harus Terisi atau Dalam Proses.";
    setActiveTab(document.getElementById("editorGeneralTab"));
    roomEditor.elements.namedItem("occupancy_status").focus();
    return;
  }
  if (isNewRegistration && statusOf(floor.rooms[activeRoomId]) !== "vacant") {
    editorStatusEl.textContent = "Ruang yang dipilih sudah tidak kosong. Pilih ruang lain.";
    return;
  }
  const linkedRooms = Array.from(
    contractRoomListEl.querySelectorAll('input[type="checkbox"]:checked'),
  ).map((checkbox) => {
    const areaInput = checkbox.closest(".contract-room-option").querySelector('input[type="number"]');
    return {
      room_id: checkbox.value,
      area_m2: areaInput.value === "" ? "" : Number(areaInput.value),
    };
  });
  if (!linkedRooms.length) {
    editorStatusEl.textContent = "Pilih minimal satu ruangan untuk kontrak.";
    return;
  }

  const confirmed = await confirmAction({
    title: isNewRegistration ? "Daftarkan tenant baru?" : "Simpan data kontrak?",
    message: `${isNewRegistration ? "Data tenant akan ditambahkan sebagai baris baru" : "Data instansi akan disimpan"} dan ditautkan ke ${linkedRooms.length} ruangan: ${linkedRooms.map((room) => room.room_id).join(", ")}.`,
    acceptLabel: isNewRegistration ? "Ya, daftarkan" : "Ya, simpan",
  });
  if (!confirmed) return;

  const record = {
    building: buildingId,
    floor: floorId,
    room_id: activeRoomId,
    contract_id: isNewRegistration ? "" : floor.rooms[activeRoomId].contractId || "",
  };
  EDITABLE_ROOM_FIELDS.forEach((field) => {
    const value = String(formData.get(field) || "").trim();
    record[field] = [
      "area_m2",
      "electricity_kwh",
    ].includes(field)
      ? value === ""
        ? ""
        : Number(value)
      : [
        "contract_value",
        "initial_payment_amount",
        "installment_interval_months",
        "electricity_cost_rp",
        "phone_cost_rp",
      ].includes(field)
        ? numericInputValue(value)
      : value;
  });
  record.billing_period = paymentMode === "lunas" ? record.billing_period : "";
  record.installment_interval_months =
    paymentMode === "termin" ? Number(installmentIntervalInput.value) : "";
  record.initial_payment_amount =
    paymentMode === "partial paid" ? numericInputValue(initialPaymentInput.value) : "";
  record.partial_payment_schedule =
    paymentMode === "partial paid" ? partialPaymentScheduleInput.value.trim() : "";
  if (isNewRegistration) record.occupancy_status = "occupied";
  record.installment_payments = JSON.stringify(paymentMode === "termin" ? installments : []);

  const saveButton = roomEditor.querySelector('[type="submit"]');
  saveButton.disabled = true;
  editorStatusEl.textContent = "Menyimpan dan memverifikasi perubahan...";
  try {
    if (isNewRegistration) {
      await TenantApi.createContract(record, linkedRooms);
      const createdAt = { ...registrationContext };
      newTenantDialog.close();
      state.buildingId = createdAt.buildingId;
      state.floorId = createdAt.floorId;
      state.view = "plan";
      await render();
      selectRoom(createdAt.roomId);
    } else {
      await TenantApi.saveContract(record, linkedRooms);
      roomEditor.hidden = true;
      roomEditorDialog.close();
    }
    showActionSuccess(
      isNewRegistration ? "Tenant berhasil didaftarkan" : "Berhasil disimpan",
      isNewRegistration
        ? "Tenant baru berhasil ditambahkan ke database."
        : "Perubahan data unit berhasil disimpan ke database.",
    );
  } catch (error) {
    console.error("Penyimpanan data unit gagal:", error);
    editorStatusEl.textContent = error.message || "Perubahan gagal disimpan.";
  } finally {
    saveButton.disabled = false;
  }
});

clearTenantBtn.addEventListener("click", () => {
  if (selectedRoomId && hasTenantData(getFloor()?.rooms[selectedRoomId])) {
    clearRoomRecord(selectedRoomId);
  }
});

async function clearRoomRecord(roomId) {
  if (!state.buildingId || !state.floorId) return;
  const identity = `${state.buildingId} / ${state.floorId} / ${roomId}`;
  const confirmed = await confirmAction({
    title: "Hapus seluruh baris tenant?",
    message: `Data tenant untuk ${identity} akan dihapus dari database. Tindakan ini tidak dapat dibatalkan.`,
    acceptLabel: "Ya, hapus baris",
    variant: "danger",
  });
  if (!confirmed) return;

  const saveButton = roomEditor.querySelector('[type="submit"]');
  saveButton.disabled = true;
  clearTenantBtn.disabled = true;
  editorStatusEl.textContent = "Menghapus data tenant...";
  try {
    await TenantApi.deleteRecord({
      building: state.buildingId,
      floor: state.floorId,
      room_id: roomId,
    });
    closeDetail();
    editorStatusEl.textContent = "Baris tenant berhasil dihapus.";
    showActionSuccess(
      "Baris berhasil dihapus",
      "Data tenant berhasil dihapus dari database.",
    );
  } catch (error) {
    console.error("Penghapusan baris tenant gagal:", error);
    editorStatusEl.textContent = error.message || "Data unit gagal dihapus.";
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
  if (roomEditorDialog.open) roomEditorDialog.close();
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
document.getElementById("collapseSidebar").addEventListener("click", () => {
  setSidebarOpen(false);
});
openSidebarBtn.addEventListener("click", () => {
  setSidebarOpen(true);
});
openMapControlsBtn.addEventListener("click", () => {
  activeRoomPopup?.remove();
  activeRoomPopup = null;
  closeDetail();
  state.mapControlsOpen = true;
  updateSidebarLayout();
});
closeMapControlsBtn.addEventListener("click", () => {
  closeMapControls();
});
sidebarEl.addEventListener("click", () => {
  setSidebarOpen(!state.sidebarOpen);
});
sidebarEl
  .querySelector(".main-navigation")
  .addEventListener("click", (event) => event.stopPropagation());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.mapControlsOpen) {
    closeMapControls();
    openMapControlsBtn.focus();
    return;
  }
  if (event.key === "Escape" && state.sidebarOpen) {
    setSidebarOpen(false);
    openSidebarBtn.focus();
  }
});
document.querySelectorAll("[data-map-controls-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("[data-map-controls-tab]").forEach((item) => {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute("aria-controls")).hidden = !selected;
    });
  });
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll("[data-map-controls-tab]")];
    const index = tabs.indexOf(tab);
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + offset + tabs.length) % tabs.length];
    next.click();
    next.focus();
  });
});
function setCurrentView(view) {
  state.currentView = view;
  [
    [showMapViewBtn, view === "map"],
    [showTenantTableBtn, view === "data"],
    [showClientDataBtn, view === "client"],
  ].forEach(([button, isActive]) => {
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-current", isActive ? "page" : "false");
  });
  updateSidebarLayout();
}

showMapViewBtn.addEventListener("click", () => {
  ClientPortal.closeInvoice();
  tenantTableViewEl.hidden = true;
  clientPortalViewEl.hidden = true;
  invoicePageEl.hidden = true;
  mapLayoutEl.hidden = false;
  document.body.dataset.view = state.view;
  setCurrentView("map");
  void renderCurrentView();
});
showTenantTableBtn.addEventListener("click", () => {
  if (Auth.currentUser?.role === "client") return;
  ClientPortal.closeInvoice();
  mapLayoutEl.hidden = true;
  tenantTableViewEl.hidden = false;
  clientPortalViewEl.hidden = true;
  invoicePageEl.hidden = true;
  document.body.dataset.view = "tenants";
  setCurrentView("data");
  void TenantTable.refresh();
});
showClientDataBtn.addEventListener("click", () => {
  if (Auth.currentUser?.role !== "client") return;
  ClientPortal.closeInvoice();
  mapLayoutEl.hidden = true;
  tenantTableViewEl.hidden = true;
  clientPortalViewEl.hidden = false;
  invoicePageEl.hidden = true;
  document.body.dataset.view = "client";
  setCurrentView("client");
  void ClientPortal.refresh();
});
document.addEventListener("pintar:open-room", async (event) => {
  const { building, floor, room_id: roomId } = event.detail;
  if (!building || !floor || !roomId) return;
  const buildingData = DATA.buildings.find(
    (item) => item.id.toLocaleUpperCase("id-ID") === building.toLocaleUpperCase("id-ID"),
  );
  const floorData = buildingData?.floors.find(
    (item) => normalizeFloorId(item.id) === normalizeFloorId(floor),
  );
  if (!buildingData || !floorData || !floorData.rooms[roomId]) {
    console.warn("Tenant room is not mapped to a floor plan:", event.detail);
    return;
  }

  state.buildingId = buildingData.id;
  state.floorId = floorData.id;
  state.view = "plan";
  setCurrentView("map");
  tenantTableViewEl.hidden = true;
  clientPortalViewEl.hidden = true;
  invoicePageEl.hidden = true;
  mapLayoutEl.hidden = false;
  await render();
  selectRoom(roomId);
});
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape") {
      if (newTenantDialog.open) return;
      activeRoomPopup?.remove();
      activeRoomPopup = null;
      closeDetail();
      closeFloorPicker();
    }
  },
);

/* ---------- MULAI ---------- */
let appInitialized = false;

window.addEventListener("pintar:authenticated", (event) => {
  const user = event.detail.user;
  if (!user) return;
  applyRole(user);
  if (!appInitialized) {
    MapView.init(mapEl);
    prepareData();
    appInitialized = true;
  }
  activeRoomPopup?.remove();
  activeRoomPopup = null;
  closeDetail();
  applyDatabaseRecords([]);
  updateDashboard();
  void renderCurrentView();
  TenantApi.init({
    onRecords: (records, diagnostics) => {
      applyDatabaseRecords(records, diagnostics);
      if (user.role === "client") void ClientPortal.refresh();
    },
    onStatus: setSyncStatus,
  });
  if (!tenantTableViewEl.hidden && user.role !== "client") void TenantTable.refresh();
  if (!clientPortalViewEl.hidden && user.role === "client") void ClientPortal.refresh();
});

window.addEventListener("pintar:logged-out", () => {
  TenantApi.stop();
  activeRoomPopup?.remove();
  activeRoomPopup = null;
  closeDetail();
  if (appInitialized) {
    applyDatabaseRecords([]);
    updateDashboard();
  }
  mapLayoutEl.hidden = false;
  workspaceLayoutEl.hidden = false;
  tenantTableViewEl.hidden = true;
  clientPortalViewEl.hidden = true;
  invoicePageEl.hidden = true;
});

void Auth.restore();
