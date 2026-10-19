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
  const DRAG_THRESHOLD = 4; // px, di bawah ini dianggap klik, bukan geser
  const SKIP = "defs,style,title,desc,metadata,script";

  let host = null; // elemen #map
  let svg = null;
  let svgRect = null;
  let vb = null; // viewBox aktif {x,y,w,h}
  let home = null; // viewBox fokus gedung
  let full = null; // viewBox peta penuh
  let drag = null;
  let pinch = null;
  let viewBoxFrame = 0;
  const touchPointers = new Map();
  let suppressClick = false;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---------- Inisialisasi (sekali) ---------- */
  function init(hostEl) {
    host = hostEl;

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
    const r = svgRect;
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
    if (!home) return;
    const scale = Math.min(1, home.w / w, home.h / h);
    w *= scale;
    h *= scale;
    vb = {
      x: clamp(x, home.x, home.x + home.w - w),
      y: clamp(y, home.y, home.y + home.h - h),
      w,
      h,
    };
    if (viewBoxFrame) return;

    const targetSvg = svg;
    viewBoxFrame = requestAnimationFrame(() => {
      viewBoxFrame = 0;
      if (svg !== targetSvg || !targetSvg?.isConnected || !vb) return;
      writeViewBox(targetSvg);
    });
  }

  function writeViewBox(targetSvg = svg) {
    if (!targetSvg || targetSvg !== svg || !targetSvg.isConnected || !vb) return;
    targetSvg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  }

  function flushViewBox() {
    if (viewBoxFrame) cancelAnimationFrame(viewBoxFrame);
    viewBoxFrame = 0;
    writeViewBox();
  }

  function fitAspect() {
    if (!svg) return;
    svgRect = svg.getBoundingClientRect();
    const r = svgRect;
    if (!r.width || !r.height) return;
    const h = vb.w / (r.width / r.height);
    setVB(vb.x, vb.y + (vb.h - h) / 2, vb.w, h);
  }

  function screenToViewBox(clientX, clientY, rect = svgRect, viewBox = vb) {
    const scale = Math.min(rect.width / viewBox.w, rect.height / viewBox.h);
    const offsetX = (rect.width - viewBox.w * scale) / 2;
    const offsetY = (rect.height - viewBox.h * scale) / 2;
    return {
      x: viewBox.x + (clientX - rect.left - offsetX) / scale,
      y: viewBox.y + (clientY - rect.top - offsetY) / scale,
    };
  }

  function viewBoxScale(rect = svgRect, viewBox = vb) {
    return Math.min(rect.width / viewBox.w, rect.height / viewBox.h);
  }

  function createDrag(id, x, y) {
    return {
      id,
      startX: x,
      startY: y,
      x,
      y,
      deltaX: 0,
      deltaY: 0,
      active: false,
    };
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
        if (sib !== n && !sib.matches(SKIP) && !sib.matches("image")) {
          sib.classList.add("basemap");
        }
      });
    }
  }

  /* ---------- API ---------- */
  function attach(svgEl, { planId, prefix, rooms }) {
    svg = svgEl;
    svgRect = svg.getBoundingClientRect();

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
  }

  function detach() {
    if (viewBoxFrame) cancelAnimationFrame(viewBoxFrame);
    viewBoxFrame = 0;
    svg?.style.removeProperty("transform");
    svg?.classList.remove("is-dragging");
    svg = null;
    svgRect = null;
    drag = null;
    pinch = null;
    touchPointers.clear();
    host?.classList.remove("dragging");
  }

  function finishDrag() {
    if (!drag?.active || !svg) return false;

    const k = viewBoxScale();
    setVB(vb.x - drag.deltaX / k, vb.y - drag.deltaY / k, vb.w, vb.h);
    flushViewBox();
    svg.style.removeProperty("transform");
    svg.classList.remove("is-dragging");
    host.classList.remove("dragging");
    drag = null;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    return true;
  }

  function reset() {
    if (svg) setVB(home.x, home.y, home.w, home.h);
  }

  function zoomAt(factor, cx, cy) {
    if (!svg || !svgRect?.width || !svgRect?.height) return;
    const p = screenToViewBox(
      cx ?? svgRect.left + svgRect.width / 2,
      cy ?? svgRect.top + svgRect.height / 2,
    );
    const w = clamp(vb.w * factor, full.w * MIN_SCALE, home.w);
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
    if (!svg || !svg.contains(e.target)) return;
    if (e.pointerType === "touch") {
      touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPointers.size === 1) {
        drag = createDrag(e.pointerId, e.clientX, e.clientY);
      }
      if (touchPointers.size === 2) {
        finishDrag();
        drag = null;
        startPinch();
      }
      return;
    }
    if (e.button !== 0) return;
    drag = createDrag(e.pointerId, e.clientX, e.clientY);
  }

  function onMove(e) {
    if (e.pointerType === "touch" && touchPointers.has(e.pointerId)) {
      touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touchPointers.size >= 2) {
        updatePinch();
        return;
      }
    }
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;

    if (!drag.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.active = true;
      host.setPointerCapture(e.pointerId); // baru ditangkap setelah terbukti menggeser
      host.classList.add("dragging");
      svg.classList.add("is-dragging");
    }

    drag.deltaX = e.clientX - drag.startX;
    drag.deltaY = e.clientY - drag.startY;
    svg.style.transform =
      `translate3d(${drag.deltaX}px, ${drag.deltaY}px, 0px) scale(1)`;
    drag.x = e.clientX;
    drag.y = e.clientY;
  }

  function onUp(e) {
    if (touchPointers.has(e.pointerId)) {
      touchPointers.delete(e.pointerId);
      if (pinch) {
        pinch = null;
        const remaining = [...touchPointers.entries()][0];
        drag = remaining
          ? createDrag(remaining[0], remaining[1].x, remaining[1].y)
          : null;
        suppressClick = true;
        setTimeout(() => (suppressClick = false), 0);
        return;
      }
    }
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.active) {
      finishDrag();
    }
    drag = null;
  }

  function startPinch() {
    const [first, second] = [...touchPointers.values()];
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    pinch = {
      distance: Math.hypot(dx, dy),
      center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
      rect: svgRect,
      viewBox: { ...vb },
    };
  }

  function updatePinch() {
    const [first, second] = [...touchPointers.values()];
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const distance = Math.hypot(dx, dy);
    if (!distance || !pinch.distance) return;

    const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const scale = pinch.distance / distance;
    const width = clamp(
      pinch.viewBox.w * scale,
      full.w * MIN_SCALE,
      home.w,
    );
    const ratio = width / pinch.viewBox.w;
    const height = pinch.viewBox.h * ratio;
    const anchor = screenToViewBox(
      pinch.center.x,
      pinch.center.y,
      pinch.rect,
      pinch.viewBox,
    );
    const targetCenter = screenToViewBox(center.x, center.y, pinch.rect, {
      x: 0,
      y: 0,
      w: width,
      h: height,
    });

    setVB(anchor.x - targetCenter.x, anchor.y - targetCenter.y, width, height);
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