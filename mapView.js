/* =========================================================
   MapView: fokus ke gedung, basemap, pan & zoom
   Dipakai di tampilan denah lantai (view "plan").

   Cara kerja:
   1. Cari "akar denah" (grup SVG yang berisi ruang/zona lantai ini).
   2. Semua saudara di luar akar denah diberi class "basemap" (diredupkan lewat CSS).
   3. viewBox diatur ke kotak akar denah + padding, lalu bisa digeser/di-zoom.
========================================================= */

const MapView = (() => {
  const PAD = 0.16; // ruang konteks di sekitar denah saat fokus (16%)
  const MIN_SCALE = 0.02; // batas zoom-in: lebar viewBox >= 2% peta penuh
  const MAX_SCALE = 1.2; // batas zoom-out: 120% peta penuh
  const DRAG_THRESHOLD = 4; // px, di bawah ini dianggap klik, bukan geser
  const SKIP = "defs,style,title,desc,metadata,script";

  let host = null; // elemen #map
  let controls = null; // tombol + - ⌂
  let svg = null;
  let vb = null; // viewBox aktif {x,y,w,h}
  let home = null; // viewBox fokus gedung
  let full = null; // viewBox peta penuh
  let drag = null;
  let suppressClick = false;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---------- Inisialisasi (sekali) ---------- */
  function init(hostEl) {
    host = hostEl;

    controls = document.createElement("div");
    controls.className = "map-controls";
    controls.hidden = true;
    controls.innerHTML =
      '<button type="button" data-act="in" aria-label="Perbesar">+</button>' +
      '<button type="button" data-act="out" aria-label="Perkecil">−</button>' +
      '<button type="button" data-act="home" aria-label="Fokus ke gedung">⌂</button>';
    host.parentNode.appendChild(controls);

    controls.addEventListener("click", (e) => {
      const act = e.target.closest("button")?.dataset.act;
      if (act === "in") zoomAt(0.7);
      else if (act === "out") zoomAt(1 / 0.7);
      else if (act === "home") reset();
    });

    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);
    host.addEventListener("click", onClickCapture, true);
    window.addEventListener("resize", () => svg && fitAspect());
  }

  /* ---------- Geometri ---------- */
  // Kotak elemen dalam koordinat root <svg> (memperhitungkan semua transform)
  function bboxInRoot(el) {
    let b;
    try {
      b = el.getBBox();
    } catch {
      return null;
    }
    const elM = el.getScreenCTM();
    const svgM = svg.getScreenCTM();
    if (!elM || !svgM || !b.width || !b.height) return null;

    const m = svgM.inverse().multiply(elM);
    const pts = [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x, b.y + b.height],
      [b.x + b.width, b.y + b.height],
    ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));

    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }

  function unionBox(boxes) {
    const list = boxes.filter(Boolean);
    if (!list.length) return null;
    const x1 = Math.min(...list.map((b) => b.x));
    const y1 = Math.min(...list.map((b) => b.y));
    const x2 = Math.max(...list.map((b) => b.x + b.width));
    const y2 = Math.max(...list.map((b) => b.y + b.height));
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  // Kotak + padding, disesuaikan ke rasio layar agar tidak ada letterbox
  function homeBox(box) {
    const r = svg.getBoundingClientRect();
    const aspect = r.width && r.height ? r.width / r.height : box.width / box.height;
    let w = box.width * (1 + PAD * 2);
    let h = box.height * (1 + PAD * 2);
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  function setVB(x, y, w, h) {
    // Pusat tampilan dijaga tetap di dalam peta penuh
    const cx = clamp(x + w / 2, full.x, full.x + full.w);
    const cy = clamp(y + h / 2, full.y, full.y + full.h);
    vb = { x: cx - w / 2, y: cy - h / 2, w, h };
    svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  }

  function fitAspect() {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const h = vb.w / (r.width / r.height);
    setVB(vb.x, vb.y + (vb.h - h) / 2, vb.w, h);
  }

  /* ---------- Cari akar denah & tandai basemap ---------- */
  function findPlan(planId, prefix, rooms) {
    if (planId) {
      const el = svg.querySelector("#" + CSS.escape(planId));
      if (el) return el;
      console.warn("planId tidak ditemukan di SVG:", planId);
    }

    // Cadangan: cari induk bersama semua elemen berawalan id lantai (L2_...)
    const els = [...svg.querySelectorAll("[id]")].filter((e) => e.id.startsWith(prefix));
    rooms.forEach((r) => els.includes(r) || els.push(r));
    if (!els.length) return null;

    const chain = (el) => {
      const c = [];
      for (let n = el; n && n !== svg; n = n.parentNode) c.unshift(n);
      return c;
    };
    const chains = els.map(chain);

    let common = null;
    for (let i = 0; ; i++) {
      const n = chains[0][i];
      if (!n || !chains.every((c) => c[i] === n)) break;
      common = n;
    }
    // Jika hanya ketemu satu ruang, naik satu level ke induknya
    if (common && rooms.includes(common)) {
      common = common.parentNode !== svg ? common.parentNode : null;
    }
    return common;
  }

  function markBasemap(plan) {
    for (let n = plan; n && n !== svg; n = n.parentNode) {
      Array.from(n.parentNode.children).forEach((sib) => {
        if (sib !== n && !sib.matches(SKIP)) sib.classList.add("basemap");
      });
    }
  }

  /* ---------- API ---------- */
  function attach(svgEl, { planId, prefix, rooms }) {
    svg = svgEl;

    const raw = svg.viewBox?.baseVal;
    if (raw && raw.width) {
      full = { x: raw.x, y: raw.y, w: raw.width, h: raw.height };
    } else {
      const b = svg.getBBox();
      full = { x: b.x, y: b.y, w: b.width, h: b.height };
    }

    const plan = findPlan(planId, prefix, rooms);
    const planBox = plan ? bboxInRoot(plan) : null;
    const isExplicitPlan = Boolean(planId && plan?.id === planId);
    let target = null;

    if (planBox && isExplicitPlan) {
      markBasemap(plan);
      target = planBox;
    } else {
      const content = [...svg.querySelectorAll("[id]")].filter((el) =>
        el.id.startsWith(prefix),
      );
      rooms.forEach((room) => content.includes(room) || content.push(room));
      const contentBox = unionBox(content.map(bboxInRoot));
      const planArea = planBox ? planBox.width * planBox.height : 0;
      const contentArea = contentBox ? contentBox.width * contentBox.height : 0;
      const usePlanBox =
        planBox && (!contentBox || planArea <= contentArea * 2.5);

      if (usePlanBox) {
        markBasemap(plan);
        target = planBox;
      } else {
        target = contentBox;
        if (!plan) {
          console.warn(
            "Akar denah tidak ditemukan, basemap tidak ditandai. " +
              "Bungkus denah dalam satu <g> lalu isi planId di data.js.",
          );
        }
      }
    }
    target ??= unionBox(rooms.map(bboxInRoot));

    home = target ? homeBox(target) : { ...full };
    reset();
    controls.hidden = false;
  }

  function detach() {
    svg = null;
    drag = null;
    if (controls) controls.hidden = true;
    host?.classList.remove("dragging");
  }

  function reset() {
    if (svg) setVB(home.x, home.y, home.w, home.h);
  }

  function zoomAt(factor, cx, cy) {
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const m = svg.getScreenCTM();
    if (!m) return;

    const p = new DOMPoint(cx ?? r.left + r.width / 2, cy ?? r.top + r.height / 2).matrixTransform(
      m.inverse(),
    );
    const w = clamp(vb.w * factor, full.w * MIN_SCALE, full.w * MAX_SCALE);
    const k = w / vb.w;
    setVB(p.x - (p.x - vb.x) * k, p.y - (p.y - vb.y) * k, w, vb.h * k);
  }

  /* ---------- Event ---------- */
  function onWheel(e) {
    if (!svg || !svg.isConnected) return;
    e.preventDefault();
    zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY);
  }

  function onDown(e) {
    if (!svg || e.button !== 0 || !svg.contains(e.target)) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, active: false };
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;

    if (!drag.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.active = true;
      host.setPointerCapture(e.pointerId); // baru ditangkap setelah terbukti menggeser
      host.classList.add("dragging");
    }

    const k = svg.getScreenCTM().a; // px layar per satuan SVG
    setVB(vb.x - dx / k, vb.y - dy / k, vb.w, vb.h);
    drag.x = e.clientX;
    drag.y = e.clientY;
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.active) {
      suppressClick = true; // cegah klik "ikutan" setelah menggeser
      setTimeout(() => (suppressClick = false), 0);
      host.classList.remove("dragging");
    }
    drag = null;
  }

  function onClickCapture(e) {
    if (suppressClick) {
      e.stopImmediatePropagation();
      e.preventDefault();
      suppressClick = false;
    }
  }

  return { init, attach, detach, reset, zoomAt };
})();