const CustomRooftop = (() => {
  const FLOOR_ID = "Lantai 11";
  const BUILDING_ID = "GKP";
  const button = document.getElementById("rooftopDrawButton");
  const status = document.getElementById("rooftopAreaStatus");
  const dialog = document.getElementById("customTenantAreaDialog");
  const form = document.getElementById("customTenantAreaForm");
  const formStatus = document.getElementById("customTenantAreaStatus");
  const cancelButton = document.getElementById("cancelCustomTenantArea");
  const money = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  });

  let active = false;
  let planSvg = null;
  let features = [];
  let drawMap = null;
  let drawSurface = null;
  let draftGeometry = null;
  let isSaving = false;

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
      polygon.classList.add(`is-${String(feature.status).toLowerCase()}`);
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

  function openAreaForm(geometry) {
    draftGeometry = geometry;
    form.reset();
    formStatus.textContent = "";
    if (!dialog.open) dialog.showModal();
    form.elements.namedItem("tenant_name").focus();
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
        openAreaForm(geometry);
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

  async function loadAreas() {
    const response = await fetch(
      `/api/tenants/custom-polygon?floor_id=${encodeURIComponent(FLOOR_ID)}`,
      { headers: Auth.headers(), cache: "no-store" },
    );
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Server memberikan respons tidak valid (HTTP ${response.status}).`);
    }
    if (!response.ok) throw new Error(payload.error || `Gagal memuat area (HTTP ${response.status}).`);
    return payload.records;
  }

  button.addEventListener("click", startDrawing);
  cancelButton.addEventListener("click", () => {
    draftGeometry = null;
    dialog.close();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!isSaving) {
      draftGeometry = null;
      dialog.close();
    }
  });
  dialog.addEventListener("close", () => {
    draftGeometry = null;
    form.reset();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!eligible() || !draftGeometry || isSaving) return;
    const submitButton = form.querySelector('[type="submit"]');
    const values = new FormData(form);
    const payload = {
      floor_id: FLOOR_ID,
      geometry: draftGeometry,
      tenant_name: String(values.get("tenant_name") || ""),
      usage_type: String(values.get("usage_type") || ""),
      status: String(values.get("status") || ""),
      area_sqm: Number(values.get("area_sqm")),
      rent_price: Number(values.get("rent_price")),
    };
    isSaving = true;
    submitButton.disabled = true;
    formStatus.textContent = "";
    try {
      const response = await fetch("/api/tenants/custom-polygon", {
        method: "POST",
        headers: {
          ...Auth.headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error(`Server memberikan respons tidak valid (HTTP ${response.status}).`);
      }
      if (!response.ok) throw new Error(result.error || `Gagal menyimpan area (HTTP ${response.status}).`);
      if (!eligible()) {
        dialog.close();
        return;
      }
      features.push(result.feature);
      addFeaturesToSvg();
      dialog.close();
      setStatus(`Area ${result.feature.tenant_name} berhasil disimpan (${result.feature.area_sqm} m²).`, "success");
    } catch (error) {
      formStatus.textContent = `Gagal menyimpan area: ${error.message}`;
    } finally {
      isSaving = false;
      submitButton.disabled = false;
    }
  });

  async function attach({ buildingId, floorId, floorName, svg }) {
    stopDrawing({ preserveView: false });
    active = buildingId === BUILDING_ID &&
      floorId === "L11" &&
      floorName === FLOOR_ID;
    planSvg = active ? svg : null;
    features = [];
    button.hidden = !active || Auth.currentUser?.role !== "admin";
    button.setAttribute("aria-pressed", "false");
    button.textContent = "Tambah Area Tenant (Gambar Poligon)";
    setStatus("");
    if (!active) return;
    try {
      features = await loadAreas();
      if (!active || !planSvg?.isConnected) return;
      addFeaturesToSvg();
    } catch (error) {
      console.error("Gagal memuat poligon tenant rooftop:", error);
      setStatus(`Gagal memuat area rooftop: ${error.message}`, "error");
    }
  }

  function detach() {
    stopDrawing({ preserveView: false });
    active = false;
    planSvg?.querySelector("#customTenantAreasLayer")?.remove();
    planSvg = null;
    features = [];
    button.hidden = true;
    if (dialog.open && !isSaving) dialog.close();
    setStatus("");
  }

  return Object.freeze({ attach, detach });
})();
