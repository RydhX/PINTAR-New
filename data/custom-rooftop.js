const CustomRooftop = (() => {
  const FLOOR_ID = "Lantai 11";
  const BUILDING_ID = "GKP";
  const button = document.getElementById("rooftopDrawButton");
  const status = document.getElementById("rooftopAreaStatus");
  const money = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  });

  let active = false;
  let planSvg = null;
  let features = [];
  let onSelectArea = null;
  let drawMap = null;
  let drawSurface = null;

  function eligible() {
    return active &&
      Auth.currentUser?.role === "admin" &&
      document.body.dataset.view === "plan";
  }

  function setStatus(message, type = "") {
    status.textContent = message;
    status.className = `rooftop-area-status${type ? ` is-${type}` : ""}`;
    status.hidden = !message;
  }

  function normalizeLocalGeometry(geometry) {
    if (geometry?.type !== "Polygon" || !Array.isArray(geometry.coordinates)) {
      throw new Error("Bentuk area yang digambar tidak valid.");
    }
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring) =>
        ring.map(([x, y]) => [x, -y]),
      ),
    };
  }

  function addFeaturesToSvg() {
    if (!planSvg?.isConnected) return;
    planSvg.querySelector("#customTenantAreasLayer")?.remove();
    const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layer.id = "customTenantAreasLayer";
    layer.setAttribute("aria-label", "Area tenant khusus rooftop");

    features.forEach((feature) => {
      const ring = feature.geometry?.coordinates?.[0];
      if (!Array.isArray(ring) || ring.length < 4) return;
      const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      polygon.classList.add("custom-tenant-area-polygon");
      polygon.classList.add(`is-${String(feature.status || "").toLowerCase()}`);
      polygon.setAttribute(
        "points",
        ring.map(([x, y]) => `${Number(x)} ${Number(y)}`).join(" "),
      );
      polygon.setAttribute(
        "aria-label",
        `${feature.tenant_name}, ${feature.usage_type}, ${feature.area_sqm} m², ${feature.status}`,
      );
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent =
        `${feature.tenant_name} · ${feature.usage_type} · ${feature.area_sqm} m² · ` +
        `${feature.status} · ${money.format(Number(feature.rent_price))}`;
      polygon.appendChild(title);
      polygon.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelectArea?.(feature.room_id);
      });
      layer.appendChild(polygon);
    });

    planSvg.appendChild(layer);
  }

  function stopDrawing({ preserveView = true } = {}) {
    if (drawMap) {
      if (preserveView) {
        const bounds = drawMap.getBounds();
        MapView.setViewBox({
          x: bounds.getWest(),
          y: -bounds.getNorth(),
          w: bounds.getEast() - bounds.getWest(),
          h: bounds.getNorth() - bounds.getSouth(),
        });
      }
      drawMap.remove();
      drawMap = null;
    }
    drawSurface?.remove();
    drawSurface = null;
    MapView.setInteractionLocked(false);
    button.setAttribute("aria-pressed", "false");
    button.textContent = "Tambah Area Tenant (Gambar Poligon)";
  }

  function startDrawing() {
    if (!eligible()) return;
    if (drawMap) {
      stopDrawing();
      setStatus("Penggambaran area dibatalkan.");
      return;
    }

    const viewBox = MapView.getViewBox();
    if (!viewBox || !window.L?.PM) {
      setStatus("Alat gambar rooftop belum siap. Muat ulang halaman dan coba lagi.", "error");
      return;
    }

    drawSurface = document.createElement("div");
    drawSurface.id = "rooftopDrawSurface";
    drawSurface.setAttribute("aria-label", "Peta untuk menggambar area rooftop");
    document.getElementById("map").appendChild(drawSurface);
    MapView.setInteractionLocked(true);

    drawMap = L.map(drawSurface, {
      crs: L.CRS.Simple,
      zoomControl: false,
      attributionControl: false,
      doubleClickZoom: false,
      zoomSnap: 0,
      zoomDelta: 0.5,
      maxZoom: 8,
      minZoom: -8,
    });
    const bounds = L.latLngBounds(
      L.latLng(-(viewBox.y + viewBox.h), viewBox.x),
      L.latLng(-viewBox.y, viewBox.x + viewBox.w),
    );
    drawMap.fitBounds(bounds, { animate: false, padding: [0, 0] });
    drawMap.on("pm:create", (event) => {
      try {
        const geometry = normalizeLocalGeometry(event.layer.toGeoJSON().geometry);
        stopDrawing();
        setStatus("Poligon selesai. Lengkapi formulir pendaftaran tenant rooftop.");
        window.dispatchEvent(new CustomEvent("pintar:rooftop-area-drawn", {
          detail: { geometry },
        }));
      } catch (error) {
        stopDrawing();
        setStatus(`Poligon tidak dapat digunakan: ${error.message}`, "error");
      }
    });
    drawMap.pm.enableDraw("Polygon", {
      allowSelfIntersection: false,
      pathOptions: {
        color: "#0f766e",
        fillColor: "#14b8a6",
        fillOpacity: 0.28,
        weight: 3,
      },
    });
    button.setAttribute("aria-pressed", "true");
    button.textContent = "Batal menggambar";
    setStatus("Klik titik-titik pada denah, lalu klik titik awal untuk menutup poligon.");
  }

  button.addEventListener("click", startDrawing);

  async function attach({ buildingId, floorId, floorName, svg, areas = [], onSelect }) {
    stopDrawing({ preserveView: false });
    active = buildingId === BUILDING_ID &&
      floorId === "L11" &&
      floorName === FLOOR_ID;
    planSvg = active ? svg : null;
    features = active ? areas : [];
    onSelectArea = active ? onSelect : null;
    button.hidden = !active || Auth.currentUser?.role !== "admin";
    button.setAttribute("aria-pressed", "false");
    button.textContent = "Tambah Area Tenant (Gambar Poligon)";
    setStatus("");
    if (!active) return;
    addFeaturesToSvg();
  }

  function detach() {
    stopDrawing({ preserveView: false });
    active = false;
    planSvg?.querySelector("#customTenantAreasLayer")?.remove();
    planSvg = null;
    features = [];
    onSelectArea = null;
    button.hidden = true;
    setStatus("");
  }

  function updateAreas(areas) {
    if (!active) return;
    features = areas;
    addFeaturesToSvg();
  }

  return Object.freeze({ attach, detach, updateAreas });
})();
