const CONFIG = Object.freeze({
  SPREADSHEET_ID: "1VfI1BAdLp5iOc6OoeSgVida3xfswuX71Dwe3wKO8HGE",
  SPREADSHEET_NAME: "PINTAR_master",
  PUBLIC_DATA_APPROVED: true,
  PUBLIC_WRITE_APPROVED: true,
  BUILDINGS: Object.freeze([
    { sheetName: "GKP_MASTER", buildingCode: "GKP" },
    { sheetName: "GAK3_MASTER", buildingCode: "GAK3" },
    { sheetName: "GPT_MASTER", buildingCode: "GPT" },
  ]),
});

const FIELD_ALIASES = Object.freeze({
  building: ["building", "gedung"],
  floor: ["floor", "lantai"],
  room_id: ["room_id", "room id", "id_ruang", "id ruang"],
  tenant: ["tenant", "nama_tenant", "nama tenant"],
  occupancy_status: ["occupancy_status", "occupancy status", "status_okupansi", "status okupansi"],
  payment_status: ["payment_status", "payment status", "status_pembayaran", "status pembayaran"],
  area_m2: ["area_m2", "luas_m2", "luas (m2)", "luas"],
  start_date: ["start_date", "mulai_sewa", "tanggal_mulai_sewa"],
  end_date: ["end_date", "akhir_sewa", "tanggal_akhir_sewa"],
  rent_per_month: ["rent_per_month", "sewa_per_bulan", "nilai_sewa"],
  outstanding_amount: ["outstanding_amount", "tunggakan", "jumlah_tunggakan", "kekurangan_pembayaran"],
  contract_value: ["contract_value", "nilai_kontrak", "total_nilai_kontrak"],
  last_payment_date: ["last_payment_date", "pembayaran_terakhir", "tanggal_pembayaran_terakhir"],
  electricity_kwh: ["electricity_kwh", "listrik_kwh", "konsumsi_listrik"],
  water_m3: ["water_m3", "air_m3", "konsumsi_air"],
  pic: ["pic", "pic_tenant"],
  contact: ["contact", "kontak", "kontak_tenant"],
  maintenance_status: ["maintenance_status", "status_pemeliharaan"],
  complaint_status: ["complaint_status", "status_keluhan"],
  notes: ["notes", "catatan"],
});

const REQUIRED_FIELDS = ["floor", "room_id", "tenant", "occupancy_status", "payment_status"];
const EDITABLE_FIELDS = [
  "tenant", "occupancy_status", "payment_status", "area_m2", "start_date",
  "end_date", "rent_per_month", "outstanding_amount", "contract_value", "last_payment_date",
  "electricity_kwh", "water_m3", "pic", "contact", "maintenance_status",
  "complaint_status", "notes",
];
const NUMERIC_FIELDS = [
  "area_m2", "rent_per_month", "outstanding_amount", "contract_value",
  "electricity_kwh", "water_m3",
];
const FIELD_LIMITS = Object.freeze({
  tenant: 200, payment_status: 80, start_date: 80, end_date: 80,
  last_payment_date: 80, pic: 200, contact: 200,
  maintenance_status: 200, complaint_status: 200, notes: 1000,
});

function doGet(e) {
  const callback = e && e.parameter && e.parameter.callback;
  if (!callback || !/^__pintarSheetsCallback\d+$/.test(callback)) {
    return ContentService.createTextOutput("Invalid callback")
      .setMimeType(ContentService.MimeType.TEXT);
  }
  if (!CONFIG.PUBLIC_DATA_APPROVED) {
    return jsonp(callback, { success: false, error: "Public data has not been approved." });
  }

  try {
    const spreadsheet = openSpreadsheet();
    const records = [];
    const diagnostics = [];
    const seenRooms = new Set();

    CONFIG.BUILDINGS.forEach((building) => {
      const sheet = spreadsheet.getSheetByName(building.sheetName);
      if (!sheet) throw new Error("Tab tidak ditemukan: " + building.sheetName);
      const lastRow = sheet.getLastRow();
      const lastColumn = sheet.getLastColumn();
      if (lastRow === 0 || lastColumn === 0) {
        diagnostics.push({
          sheet: building.sheetName,
          reason: "empty-sheet",
          message: "Tab master kosong; tidak ada baris data.",
        });
        return;
      }

      const values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
      const columns = getColumns(values[0]);
      const installmentColumns = getInstallmentColumns(values[0]);
      const missing = REQUIRED_FIELDS.filter((field) => columns[field] === -1);
      if (missing.length) {
        throw new Error(
          "Kolom wajib tidak ditemukan pada " + building.sheetName + ": " + missing.join(", "),
        );
      }

      values.slice(1).forEach((row, index) => {
        if (row.every((value) => !String(value).trim())) return;
        const rowNumber = index + 2;
        const record = {};
        Object.keys(FIELD_ALIASES).forEach((field) => {
          const column = columns[field];
          if (column !== -1) record[field] = String(row[column] || "").trim();
        });
        record.installment_payments = JSON.stringify(
          installmentColumns
            .map(({ term, column }) => ({
              term: term,
              amount: numericValue(row[column]),
            }))
            .filter((item) => item.amount !== null),
        );

        if (!record.building) record.building = building.buildingCode;
        if (record.building !== building.buildingCode) {
          diagnostics.push(rowDiagnostic(building, rowNumber, "building-mismatch", "Kode gedung tidak sesuai tab."));
          return;
        }
        if (!record.floor || !isValidFloor(record.floor)) {
          diagnostics.push(rowDiagnostic(building, rowNumber, "invalid-floor", "Nilai floor kosong atau tidak valid."));
          return;
        }
        if (!record.room_id || !/^[A-Za-z0-9_-]{1,80}$/.test(record.room_id)) {
          diagnostics.push(rowDiagnostic(building, rowNumber, "invalid-room-id", "room_id kosong atau tidak valid."));
          return;
        }
        if (!record.occupancy_status) {
          diagnostics.push(rowDiagnostic(building, rowNumber, "missing-occupancy", "occupancy_status wajib diisi."));
          return;
        }

        const occupancy = normalizeOccupancy(record.occupancy_status);
        if (!occupancy) {
          diagnostics.push(rowDiagnostic(building, rowNumber, "unknown-occupancy", "Status okupansi tidak dikenal."));
          return;
        }
        record.occupancy_status = occupancy;

        const key = roomKey(record.building, record.floor, record.room_id);
        if (seenRooms.has(key)) {
          diagnostics.push(rowDiagnostic(building, rowNumber, "duplicate-room", "Kunci gedung/lantai/ruang duplikat."));
          return;
        }
        seenRooms.add(key);
        records.push(record);
      });
    });

    return jsonp(callback, { success: true, records: records, diagnostics: diagnostics });
  } catch (error) {
    console.error("PINTAR read endpoint error:", error);
    return jsonp(callback, { success: false, error: String(error.message || error) });
  }
}

function doPost(e) {
  if (!CONFIG.PUBLIC_WRITE_APPROVED) {
    return jsonResponse({ success: false, error: "Public writing has not been approved." });
  }

  const lock = LockService.getScriptLock();
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("Request body kosong.");
    }
    const request = JSON.parse(e.postData.contents);
    if (!request || !["update", "vacate"].includes(request.action) || !request.record) {
      throw new Error("Format request tidak valid.");
    }

    const record = request.record;
    const buildingCode = cleanString(record.building, 40);
    const floor = cleanString(record.floor, 40);
    const roomId = cleanString(record.room_id, 80);
    if (!buildingCode || !floor || !isValidFloor(floor)) throw new Error("Gedung atau lantai tidak valid.");
    if (!roomId || !/^[A-Za-z0-9_-]{1,80}$/.test(roomId)) throw new Error("room_id tidak valid.");
    if (request.action === "update") {
      const occupancy = normalizeOccupancy(record.occupancy_status);
      if (!occupancy) throw new Error("Status okupansi tidak valid.");
      if (occupancy === "occupied" && !cleanString(record.tenant, 200)) {
        throw new Error("Tenant wajib diisi untuk unit terisi.");
      }
    }
    if (!lock.tryLock(10000)) throw new Error("Spreadsheet sedang diperbarui. Coba lagi.");

    const building = CONFIG.BUILDINGS.find((item) => item.buildingCode === buildingCode);
    if (!building) throw new Error("Gedung tidak terdaftar.");
    const spreadsheet = openSpreadsheet();
    const sheet = spreadsheet.getSheetByName(building.sheetName);
    if (!sheet) throw new Error("Tab tidak ditemukan: " + building.sheetName);
    const lastRow = sheet.getLastRow();
    let lastColumn = sheet.getLastColumn();
    if (lastRow === 0 || lastColumn === 0) throw new Error("Tab master belum memiliki header.");

    const header = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
    const columns = getColumns(header);
    const missing = REQUIRED_FIELDS.filter((field) => columns[field] === -1);
    if (missing.length) throw new Error("Kolom wajib tidak ditemukan: " + missing.join(", "));

    const buildingColumn = columns.building;
    const rows = lastRow > 1
      ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getDisplayValues()
      : [];
    const matches = [];
    rows.forEach((row, index) => {
      const rowBuilding = buildingColumn === -1 || !row[buildingColumn]
        ? buildingCode
        : row[buildingColumn].trim();
      if (
        rowBuilding === buildingCode &&
        normalizeFloor(row[columns.floor]) === normalizeFloor(floor) &&
        row[columns.room_id].trim() === roomId
      ) matches.push(index + 2);
    });
    if (matches.length > 1) throw new Error("Unit duplikat ditemukan; tidak ada baris yang diubah.");
    if (request.action === "vacate") {
      if (matches.length === 0) {
        throw new Error("Unit tidak ditemukan; tidak ada data yang dikosongkan.");
      }
      const targetRow = matches[0];
      EDITABLE_FIELDS.forEach((field) => {
        if (columns[field] === -1) return;
        const value = field === "occupancy_status" ? occupancyForSheet("vacant") : "";
        sheet.getRange(targetRow, columns[field] + 1).setValue(value);
      });
      getInstallmentColumns(header).forEach(({ column }) => {
        sheet.getRange(targetRow, column + 1).setValue("");
      });
      SpreadsheetApp.flush();
      return jsonResponse({
        success: true,
        action: "vacate",
        building: buildingCode,
        floor: floor,
        room_id: roomId,
      });
    }

    const occupancy = normalizeOccupancy(record.occupancy_status);
    const installments = parseInstallments(record.installment_payments);
    const isInstallmentPayment = String(record.payment_status || "")
      .trim().toLowerCase() === "termin";
    if (isInstallmentPayment) {
      ensureFieldColumn(sheet, header, columns, "contract_value", "nilai_kontrak");
      ensureFieldColumn(sheet, header, columns, "outstanding_amount", "kekurangan_pembayaran");
      lastColumn = sheet.getLastColumn();
    }
    const values = {};
    const spreadsheetTimeZone = spreadsheet.getSpreadsheetTimeZone();
    EDITABLE_FIELDS.forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(record, field)) return;
      const column = columns[field];
      const raw = record[field] === null || record[field] === undefined ? "" : record[field];
      if (column === -1) {
        const isEmpty = String(raw).trim() === "";
        const isZeroDefault = NUMERIC_FIELDS.includes(field) &&
          Number.isFinite(Number(raw)) && Number(raw) === 0;
        if (!isEmpty && !isZeroDefault) {
          throw new Error("Kolom '" + field + "' belum tersedia pada tab master.");
        }
        return;
      }
      values[field] = validateField(field, raw, occupancy, spreadsheetTimeZone);
    });
    const contractValue = Object.prototype.hasOwnProperty.call(record, "contract_value")
      ? validateField("contract_value", record.contract_value, occupancy, spreadsheetTimeZone)
      : "";
    if (isInstallmentPayment && !contractValue) {
      throw new Error("Total nilai kontrak wajib diisi untuk pembayaran termin.");
    }
    const totalInstallments = installments.reduce((total, item) => total + item.amount, 0);
    if (isInstallmentPayment && totalInstallments > contractValue) {
      throw new Error("Total pembayaran termin tidak boleh melebihi nilai kontrak.");
    }
    if (isInstallmentPayment) {
      values.outstanding_amount = contractValue - totalInstallments;
    }
    const installmentColumns = ensureInstallmentColumns(sheet, header, installments);
    lastColumn = sheet.getLastColumn();
    const installmentAmounts = new Map(
      installments.map((item) => [item.term, item.amount]),
    );
    values.occupancy_status = occupancyForSheet(occupancy);
    if (Object.prototype.hasOwnProperty.call(record, "payment_status")) {
      values.payment_status = paymentForSheet(record.payment_status);
    }
    if (!Object.prototype.hasOwnProperty.call(values, "tenant")) {
      values.tenant = cleanString(record.tenant, 200);
    }

    let targetRow;
    if (matches.length === 0) {
      const newRow = Array(lastColumn).fill("");
      if (buildingColumn !== -1) newRow[buildingColumn] = buildingCode;
      newRow[columns.floor] = floor;
      newRow[columns.room_id] = roomId;
      Object.keys(values).forEach((field) => {
        newRow[columns[field]] = values[field];
      });
      targetRow = lastRow + 1;
      sheet.getRange(targetRow, 1, 1, lastColumn).setValues([newRow]);
    } else {
      targetRow = matches[0];
      Object.keys(values).forEach((field) => {
        sheet.getRange(targetRow, columns[field] + 1).setValue(values[field]);
      });
    }
    if (columns.contract_value !== -1) {
      sheet.getRange(targetRow, columns.contract_value + 1).setValue(contractValue);
    }
    installmentColumns.forEach(({ term, column }) => {
      sheet.getRange(targetRow, column + 1).setValue(installmentAmounts.get(term) || "");
    });
    ["start_date", "end_date", "last_payment_date"].forEach((field) => {
      if (columns[field] !== -1 && values[field]) {
        sheet.getRange(targetRow, columns[field] + 1).setNumberFormat("yyyy-mm-dd");
      }
    });
    SpreadsheetApp.flush();
    return jsonResponse({
      success: true,
      action: matches.length === 0 ? "insert" : "update",
      building: buildingCode,
      floor: floor,
      room_id: roomId,
    });
  } catch (error) {
    console.error("PINTAR write endpoint error:", error);
    return jsonResponse({ success: false, error: String(error.message || error) });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function openSpreadsheet() {
  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID === "PASTE_SPREADSHEET_ID_HERE") {
    throw new Error("Isi CONFIG.SPREADSHEET_ID terlebih dahulu.");
  }
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  if (spreadsheet.getName() !== CONFIG.SPREADSHEET_NAME) {
    throw new Error("Nama spreadsheet tidak sesuai.");
  }
  return spreadsheet;
}

function getColumns(header) {
  const normalized = header.map((value) => String(value).trim().toLowerCase());
  const columns = {};
  Object.keys(FIELD_ALIASES).forEach((field) => {
    columns[field] = normalized.findIndex((name) => FIELD_ALIASES[field].includes(name));
  });
  return columns;
}

function getInstallmentColumns(header) {
  return header
    .map((value, column) => {
      const match = String(value).trim().toLowerCase().match(/^(?:termin|term)[ _-]*(\d+)$/);
      return match ? { term: Number(match[1]), column: column } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.term - b.term);
}

function ensureFieldColumn(sheet, header, columns, field, headerName) {
  if (columns[field] !== -1) return columns[field];
  let column = sheet.getLastColumn() + 1;
  const maxColumns = sheet.getMaxColumns();
  if (column > maxColumns) sheet.insertColumnsAfter(maxColumns, column - maxColumns);
  sheet.getRange(1, column).setValue(headerName);
  columns[field] = column - 1;
  header[column - 1] = headerName;
  return columns[field];
}

function ensureInstallmentColumns(sheet, header, installments) {
  const columns = getInstallmentColumns(header);
  const byTerm = new Map(columns.map((item) => [item.term, item.column]));
  let lastColumn = header.length;
  installments.forEach((item) => {
    if (byTerm.has(item.term)) return;
    lastColumn += 1;
    const maxColumns = sheet.getMaxColumns();
    if (lastColumn > maxColumns) {
      sheet.insertColumnsAfter(maxColumns, lastColumn - maxColumns);
    }
    sheet.getRange(1, lastColumn).setValue("termin_" + item.term);
    byTerm.set(item.term, lastColumn - 1);
  });
  return Array.from(byTerm, ([term, column]) => ({ term: term, column: column }))
    .sort((a, b) => a.term - b.term);
}

function parseInstallments(value) {
  let installments;
  try {
    installments = typeof value === "string" && value.trim()
      ? JSON.parse(value)
      : [];
  } catch (error) {
    throw new Error("Format rincian pembayaran termin tidak valid.");
  }
  if (!Array.isArray(installments)) {
    throw new Error("Rincian pembayaran termin harus berupa daftar.");
  }
  const seen = new Set();
  return installments.map((item) => {
    const term = Number(item && item.term);
    const amount = Number(item && item.amount);
    if (!Number.isInteger(term) || term < 1 || seen.has(term)) {
      throw new Error("Nomor termin tidak valid atau duplikat.");
    }
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("Nominal pembayaran termin harus berupa angka nol atau lebih.");
    }
    seen.add(term);
    return { term: term, amount: amount };
  }).sort((a, b) => a.term - b.term);
}

function numericValue(value) {
  let normalized = String(value === null || value === undefined ? "" : value)
    .trim()
    .replace(/[^\d,.-]/g, "");
  if (!normalized) return null;
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.lastIndexOf(",") > normalized.lastIndexOf(".")
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  } else if (normalized.includes(",")) {
    normalized = /,\d{1,2}$/.test(normalized)
      ? normalized.replace(",", ".")
      : normalized.replace(/,/g, "");
  } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, "");
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalizeOccupancy(value) {
  const status = String(value || "").trim().toLocaleLowerCase("id-ID");
  if (["aktif", "terisi", "occupied"].includes(status)) return "occupied";
  if (["kosong", "tersedia", "vacant"].includes(status)) return "vacant";
  if (["dalam proses", "in progress", "in_progress"].includes(status)) return "in_progress";
  return "";
}

function normalizeFloor(value) {
  let floor = String(value || "").trim().toLocaleUpperCase("id-ID")
    .replace(/^(?:LANTAI|LT|L)\s*/, "").replace(/\s+/g, "");
  if (["DASAR", "GROUND", "GF", "0"].includes(floor)) return "DASAR";
  if (["ROOFTOP", "ATAP"].includes(floor)) return "ROOFTOP";
  return floor.replace(/^0+(?=\d)/, "");
}

function isValidFloor(value) {
  const floor = String(value || "").trim().toLocaleUpperCase("id-ID");
  return /^(?:(?:LANTAI|LT|L)?\s*\d{1,2}|DASAR|GROUND|GF|ROOFTOP|ATAP)$/.test(floor);
}

function roomKey(building, floor, roomId) {
  return [building, normalizeFloor(floor), roomId].join("|");
}

function cleanString(value, maxLength) {
  const text = String(value === null || value === undefined ? "" : value).trim();
  if (text.length > maxLength) throw new Error("Nilai melebihi batas panjang.");
  return text;
}

function validateField(field, raw, occupancy, spreadsheetTimeZone) {
  if (field === "occupancy_status") return occupancyForSheet(occupancy);
  if (field === "payment_status") return paymentForSheet(raw);
  if (NUMERIC_FIELDS.includes(field)) {
    if (String(raw).trim() === "") return "";
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error("Nilai numerik '" + field + "' tidak valid.");
    return value;
  }
  const value = cleanString(raw, FIELD_LIMITS[field] || 200);
  if (["start_date", "end_date", "last_payment_date"].includes(field) &&
  value && !isValidDate(value)) throw new Error("Tanggal '" + field + "' harus berformat YYYY-MM-DD.");
  if (["start_date", "end_date", "last_payment_date"].includes(field) && value) {
    return Utilities.parseDate(value, spreadsheetTimeZone, "yyyy-MM-dd");
  }
  if (value.startsWith("=")) throw new Error("Nilai teks tidak boleh diawali tanda '='.");
  return value;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function occupancyForSheet(occupancy) {
  return {
    occupied: "terisi",
    vacant: "kosong",
    in_progress: "dalam proses",
  }[occupancy];
}

function paymentForSheet(value) {
  const payment = String(value || "").trim().toLocaleLowerCase("id-ID");
  if (!payment) return "";
  if (["lunas", "paid"].includes(payment)) return "paid";
  if (["termin", "installment", "installments"].includes(payment)) return "Termin";
  if (["belum bayar", "belum dibayar", "unpaid", "overdue"].includes(payment)) {
    return "overdue";
  }
  if (["partial paid", "partially paid"].includes(payment)) return "partial paid";
  throw new Error("Status pembayaran tidak valid.");
}

function rowDiagnostic(building, row, reason, message) {
  return { sheet: building.sheetName, row: row, reason: reason, message: message };
}

function jsonp(callback, payload) {
  return ContentService.createTextOutput(callback + "(" + JSON.stringify(payload) + ");")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
