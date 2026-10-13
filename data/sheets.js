/* Sinkronisasi baca JSONP dan penulisan prototipe ke Google Sheets. */
const SHEETS_CONFIG = Object.freeze({
  endpointUrl: "https://script.google.com/macros/s/AKfycbw_KfUgZMjzoK_SdQZi2AvEmIS4kKFSr7JnP6_Xy8IsQAcg7Tb0OBjOnL9FP6GQjrB4pA/exec",
  intervalMs: 45_000,
  timeoutMs: 15_000,
  fields: Object.freeze({
    building: "building",
    floor: "floor",
    room_id: "room_id",
    tenant: "tenant",
    occupancy_status: "occupancy_status",
    payment_status: "payment_status",
    area_m2: ["area_m2", "luas_m2"],
    start_date: ["start_date", "mulai_sewa"],
    end_date: ["end_date", "akhir_sewa"],
    rent_per_month: ["rent_per_month", "sewa_per_bulan"],
    outstanding_amount: ["outstanding_amount", "tunggakan", "kekurangan_pembayaran"],
    contract_value: ["contract_value", "nilai_kontrak", "total_nilai_kontrak"],
    installment_payments: "installment_payments",
    last_payment_date: "last_payment_date",
    electricity_kwh: "electricity_kwh",
    water_m3: "water_m3",
    pic: ["pic", "pic_tenant"],
    contact: ["contact", "kontak_tenant"],
    maintenance_status: "maintenance_status",
    complaint_status: "complaint_status",
    notes: ["notes", "catatan"],
  }),
});

const SheetsSync = (() => {
  let intervalId = null;
  let activeRequest = null;
  let generation = 0;
  let lastRecordsKey = null;
  let requestSequence = 0;
  let isWriting = false;
  let recordsHandler = null;

  function normalizeFloorKey(value) {
    const floor = String(value)
      .trim()
      .toLocaleUpperCase("id-ID")
      .replace(/^(?:LANTAI|LT|L)\s*/, "")
      .replace(/\s+/g, "");
    if (["DASAR", "GROUND", "GF", "0"].includes(floor)) return "DASAR";
    if (["ROOFTOP", "ATAP"].includes(floor)) return "ROOFTOP";
    return floor.replace(/^0+(?=\d)/, "");
  }

  function roomKey(record) {
    return [
      String(record.building).trim().toLocaleUpperCase("id-ID"),
      normalizeFloorKey(record.floor),
      String(record.room_id).trim(),
    ].join("\u0000");
  }

  function numericValue(value) {
    if (value === undefined || value === null || String(value).trim() === "") return null;
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
    return Number.isFinite(number) ? number : null;
  }

  function normalizeRecords(payload) {
    if (!payload || payload.success !== true || !Array.isArray(payload.records)) {
      const details = Array.isArray(payload?.diagnostics)
        ? payload.diagnostics.map((item) => item.message).filter(Boolean).join(" ")
        : "";
      throw new Error(
        [payload?.error || "Format respons endpoint tidak valid.", details]
          .filter(Boolean)
          .join(" "),
      );
    }
    if (payload.diagnostics !== undefined && !Array.isArray(payload.diagnostics)) {
      throw new Error("Format diagnostik endpoint tidak valid.");
    }

    const seenRooms = new Set();
    const records = payload.records.map((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error(`Data ruang ke-${index + 1} tidak valid.`);
      }

      const record = {};
      Object.keys(SHEETS_CONFIG.fields).forEach((field) => {
        const configuredField = SHEETS_CONFIG.fields[field];
        const sourceFields = Array.isArray(configuredField)
          ? configuredField
          : [configuredField];
        const sourceField = sourceFields.find((key) =>
          Object.prototype.hasOwnProperty.call(row, key),
        );
        const value = sourceField === undefined ? undefined : row[sourceField];
        const isIdentity = ["building", "floor", "room_id"].includes(field);
        const required = [
          "building",
          "floor",
          "room_id",
          "occupancy_status",
        ].includes(field);

        if (value === undefined || value === null) {
          if (required) {
            throw new Error(`Field ${field} pada data ke-${index + 1} wajib diisi.`);
          }
          return;
        }
        if (typeof value !== "string" && typeof value !== "number") {
          throw new Error(`Field ${field} pada data ke-${index + 1} tidak valid.`);
        }

        if (isIdentity) {
          record[field] = String(value);
          if (!record[field].trim()) {
            throw new Error(`Field ${field} pada data ke-${index + 1} wajib diisi.`);
          }
          return;
        }

        if (field === "occupancy_status") {
          record[field] = String(value).trim();
          return;
        }
        if (field !== "building" && field !== "floor" && field !== "room_id") {
          record[field] = String(value).trim();
        }
      });

      const occupancy = record.occupancy_status.trim().toLocaleLowerCase("id-ID");
      const occupancyMap = {
        aktif: "occupied",
        terisi: "occupied",
        occupied: "occupied",
        kosong: "vacant",
        tersedia: "vacant",
        vacant: "vacant",
        "dalam proses": "in_progress",
        in_progress: "in_progress",
      };
      record.occupancy_status = occupancyMap[occupancy] || record.occupancy_status.trim();
      if (record.installment_payments) {
        let installments;
        try {
          installments = JSON.parse(record.installment_payments);
        } catch {
          throw new Error(`Rincian pembayaran termin pada data ke-${index + 1} tidak valid.`);
        }
        if (
          !Array.isArray(installments) ||
          installments.some((item) =>
            !item ||
            !Number.isInteger(Number(item.term)) ||
            Number(item.term) < 1 ||
            !Number.isFinite(Number(item.amount)) ||
            Number(item.amount) < 0
          )
        ) {
          throw new Error(`Rincian pembayaran termin pada data ke-${index + 1} tidak valid.`);
        }
        record.installment_payments = JSON.stringify(
          installments
            .map((item) => ({ term: Number(item.term), amount: Number(item.amount) }))
            .sort((a, b) => a.term - b.term),
        );
        record.installments = JSON.parse(record.installment_payments);
      } else {
        record.installment_payments = "[]";
        record.installments = [];
      }

      const key = roomKey(record);
      if (seenRooms.has(key)) {
        throw new Error(`Kunci ruang duplikat pada data ke-${index + 1}.`);
      }
      seenRooms.add(key);

      const payment = (record.payment_status || "").toLocaleLowerCase("id-ID");
      if (["belum bayar", "belum dibayar", "unpaid", "overdue"].includes(payment)) {
        record.payment_status = "Belum bayar";
      } else if (["lunas", "paid"].includes(payment)) {
        record.payment_status = "Lunas";
      } else if (["partial paid", "partially paid"].includes(payment)) {
        record.payment_status = "Partial paid";
      } else if (payment === "termin") {
        record.payment_status = "Termin";
      }
      return record;
    });

    records.sort((a, b) =>
      `${a.building}\u0000${a.floor}\u0000${a.room_id}`.localeCompare(
        `${b.building}\u0000${b.floor}\u0000${b.room_id}`,
        "id",
      ),
    );
    return {
      records,
      diagnostics: payload.diagnostics || [],
    };
  }

  function requestRecords() {
    return new Promise((resolve, reject) => {
      const callbackName = `__pintarSheetsCallback${++requestSequence}`;
      const script = document.createElement("script");
      let settled = false;
      const timeoutId = window.setTimeout(
        () => finish(new Error("Endpoint tidak merespons dalam batas waktu.")),
        SHEETS_CONFIG.timeoutMs,
      );

      function finish(error, payload) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        script.remove();
        delete window[callbackName];
        if (activeRequest === cancel) activeRequest = null;
        if (error) reject(error);
        else {
          try {
            resolve(normalizeRecords(payload));
          } catch (validationError) {
            reject(validationError);
          }
        }
      }

      function cancel() {
        finish(new Error("Permintaan sinkronisasi dibatalkan."));
      }

      activeRequest = cancel;
      window[callbackName] = (payload) => finish(null, payload);
      script.onerror = () =>
        finish(new Error("Endpoint Google Apps Script tidak dapat diakses."));

      const url = new URL(SHEETS_CONFIG.endpointUrl);
      url.searchParams.set("callback", callbackName);
      url.searchParams.set("_", String(Date.now()));
      script.src = url.href;
      document.head.appendChild(script);
    });
  }

  async function refresh(onRecords, onStatus, currentGeneration) {
    if (activeRequest || isWriting || currentGeneration !== generation) return;
    onStatus("loading", "Memuat data");

    try {
      const snapshot = await requestRecords();
      if (currentGeneration !== generation) return;

      const recordsKey = JSON.stringify(snapshot);
      if (recordsKey !== lastRecordsKey) {
        onRecords(snapshot.records, snapshot.diagnostics);
        lastRecordsKey = recordsKey;
      }
      onStatus("connected", "Terhubung", new Date());
    } catch (error) {
      if (currentGeneration !== generation) return;
      console.error("Sinkronisasi Google Sheets gagal:", error);
      onStatus("error", "Gagal memperbarui");
    }
  }

  function init({ onRecords, onStatus }) {
    if (intervalId !== null) window.clearInterval(intervalId);
    if (activeRequest) activeRequest();
    intervalId = null;
    generation += 1;
    lastRecordsKey = null;
    recordsHandler = onRecords;

    if (!SHEETS_CONFIG.endpointUrl.trim()) {
      onStatus("idle", "Endpoint belum dikonfigurasi");
      return;
    }

    try {
      const endpoint = new URL(SHEETS_CONFIG.endpointUrl);
      if (endpoint.protocol !== "https:") {
        throw new Error("URL endpoint harus menggunakan HTTPS.");
      }
    } catch (error) {
      console.error("Konfigurasi Google Sheets tidak valid:", error);
      onStatus("error", "URL endpoint tidak valid");
      return;
    }

    const currentGeneration = generation;
    refresh(onRecords, onStatus, currentGeneration);
    intervalId = window.setInterval(
      () => refresh(onRecords, onStatus, currentGeneration),
      SHEETS_CONFIG.intervalMs,
    );
  }

  async function sendMutation(action, record) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      SHEETS_CONFIG.timeoutMs,
    );
    try {
      const response = await fetch(SHEETS_CONFIG.endpointUrl, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ action, record }),
        signal: controller.signal,
      });
      if (response.type !== "opaque" && !response.ok) {
        throw new Error(`Endpoint menolak ${action === "vacate" ? "pengosongan data" : "penyimpanan"} (HTTP ${response.status}).`);
      }
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("Endpoint tidak merespons tepat waktu. Periksa spreadsheet sebelum mengulang tindakan.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function saveRecord(record) {
    if (isWriting) throw new Error("Penyimpanan lain sedang berlangsung.");
    if (!recordsHandler) throw new Error("Sinkronisasi Google Sheets belum siap.");

    const expected = normalizeRecords({ success: true, records: [record] }).records[0];
    const key = roomKey(expected);
    isWriting = true;
    try {
      await sendMutation("update", record);

      const deadline = Date.now() + SHEETS_CONFIG.timeoutMs;
      while (activeRequest && Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      if (activeRequest) {
        throw new Error("Tidak dapat memverifikasi perubahan karena pembacaan data belum selesai.");
      }

      const snapshot = await requestRecords();
      const savedRecord = snapshot.records.find((item) => roomKey(item) === key);
      if (!savedRecord) {
        throw new Error("Perubahan belum terverifikasi. Pastikan Code.gs sudah diperbarui dan deployment Apps Script sudah memakai versi terbaru.");
      }

      const changedField = Object.keys(record).find((field) => {
        if (["building", "floor", "room_id"].includes(field)) return false;
        if (
          ["area_m2", "rent_per_month", "outstanding_amount", "contract_value", "electricity_kwh", "water_m3"]
            .includes(field)
        ) {
          const actualNumber = numericValue(savedRecord[field]);
          const expectedNumber = numericValue(expected[field]);
          if (expectedNumber === 0 && actualNumber === null) return false;
          return actualNumber !== expectedNumber;
        }
        return String(savedRecord[field] ?? "").trim() !== String(expected[field] ?? "").trim();
      });
      if (changedField) {
        throw new Error(`Perubahan pada '${changedField}' belum terverifikasi. Periksa header kolom master dan deployment Apps Script.`);
      }

      const recordsKey = JSON.stringify(snapshot);
      if (recordsKey !== lastRecordsKey) {
        recordsHandler(snapshot.records, snapshot.diagnostics);
        lastRecordsKey = recordsKey;
      }
      return true;
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error("Tidak dapat memastikan hasil penulisan. Periksa koneksi, Apps Script, dan spreadsheet.");
      }
      throw error;
    } finally {
      isWriting = false;
    }
  }

  async function clearRecord(identity) {
    if (isWriting) throw new Error("Penyimpanan lain sedang berlangsung.");
    if (!recordsHandler) throw new Error("Sinkronisasi Google Sheets belum siap.");

    const normalized = normalizeRecords({ success: true, records: [{
      ...identity,
      occupancy_status: "vacant",
    }] }).records[0];
    const key = roomKey(normalized);
    isWriting = true;
    try {
      await sendMutation("vacate", identity);

      const deadline = Date.now() + SHEETS_CONFIG.timeoutMs;
      while (activeRequest && Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      if (activeRequest) {
        throw new Error("Tidak dapat memverifikasi penghapusan karena pembacaan data belum selesai.");
      }

      const snapshot = await requestRecords();
      const clearedRecord = snapshot.records.find((item) => roomKey(item) === key);
      if (!clearedRecord) {
        throw new Error("Identitas unit tidak ditemukan setelah pengosongan. Pastikan Code.gs sudah diperbarui dan deployment memakai versi terbaru.");
      }
      const unclearedField = [
        "tenant",
        "payment_status",
        "area_m2",
        "start_date",
        "end_date",
        "rent_per_month",
        "outstanding_amount",
        "contract_value",
        "installment_payments",
        "last_payment_date",
        "electricity_kwh",
        "water_m3",
        "pic",
        "contact",
        "maintenance_status",
        "complaint_status",
        "notes",
      ].find((field) => String(clearedRecord[field] ?? "").trim() !== "");
      if (clearedRecord.occupancy_status !== "vacant" || unclearedField) {
        throw new Error(
          unclearedField
            ? `Data pada '${unclearedField}' belum berhasil dikosongkan. Perbarui dan deploy Code.gs.`
            : "Status unit belum terverifikasi sebagai kosong. Perbarui dan deploy Code.gs.",
        );
      }

      const recordsKey = JSON.stringify(snapshot);
      if (recordsKey !== lastRecordsKey) {
        recordsHandler(snapshot.records, snapshot.diagnostics);
        lastRecordsKey = recordsKey;
      }
      return true;
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error("Tidak dapat memastikan pengosongan data. Periksa koneksi, Apps Script, dan spreadsheet.");
      }
      throw error;
    } finally {
      isWriting = false;
    }
  }

  return Object.freeze({ init, normalizeRecords, saveRecord, clearRecord });
})();
