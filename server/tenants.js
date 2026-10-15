import { Router } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "./db.js";
import { allowRoles, invoicesForUser } from "./auth.js";

export const tenantsRouter = Router();

const PAGE_SIZE_MAX = 100;
const SORT_COLUMNS = Object.freeze({
  tenantName: "c.tenant",
  endDate: "c.end_date",
  electricityKwh: "c.electricity_kwh",
});
const CONTRACT_FIELDS = [
  "tenant",
  "payment_status",
  "start_date",
  "end_date",
  "contract_value",
  "billing_period",
  "installment_interval_months",
  "initial_payment_amount",
  "partial_payment_schedule",
  "installment_payments",
  "last_payment_date",
  "electricity_cost_rp",
  "electricity_kwh",
  "phone_cost_rp",
  "pic",
  "contact",
  "notes",
];
const NUMERIC_FIELDS = new Set([
  "contract_value",
  "installment_interval_months",
  "initial_payment_amount",
  "electricity_cost_rp",
  "electricity_kwh",
  "phone_cost_rp",
]);
const TEXT_LIMITS = Object.freeze({
  tenant: 200,
  payment_status: 80,
  billing_period: 20,
  partial_payment_schedule: 1000,
  pic: 200,
  contact: 200,
  notes: 1000,
});

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function readText(value, field, maxLength) {
  if (value == null) return "";
  if (typeof value !== "string") throw validationError(`${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw validationError(`${field} cannot exceed ${maxLength} characters.`);
  }
  return trimmed;
}

function readNumber(value, field, integer = false) {
  if (value === "" || value === null || value === undefined) return null;
  const numeric = Number(value);
  if (
    !Number.isFinite(numeric) ||
    numeric < 0 ||
    (integer && !Number.isInteger(numeric))
  ) {
    throw validationError(`${field} must be a non-negative ${integer ? "integer" : "number"}.`);
  }
  return numeric;
}

function readDate(value, field) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validationError(`${field} must use YYYY-MM-DD format.`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw validationError(`${field} must be a valid calendar date.`);
  }
  return value;
}

function normalizeContract(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validationError("Contract payload must be an object.");
  }
  const contract = {};
  for (const [field, limit] of Object.entries(TEXT_LIMITS)) {
    contract[field] = readText(body[field], field, limit);
  }
  for (const field of NUMERIC_FIELDS) {
    contract[field] = readNumber(
      body[field],
      field,
      field === "installment_interval_months",
    );
  }
  contract.start_date = readDate(body.start_date, "start_date");
  contract.end_date = readDate(body.end_date, "end_date");
  contract.last_payment_date = readDate(body.last_payment_date, "last_payment_date");
  if (!contract.tenant) throw validationError("Nama tenant wajib diisi.");
  if (!["Lunas", "Termin", "Partial Paid", ""].includes(contract.payment_status)) {
    throw validationError("Skema pembayaran tidak dikenal.");
  }
  if (!["occupied", "vacant", "in_progress"].includes(body.occupancy_status)) {
    throw validationError("Status okupansi tidak dikenal.");
  }

  let installments = body.installment_payments ?? [];
  if (typeof installments === "string") {
    try {
      installments = JSON.parse(installments);
    } catch {
      throw validationError("installment_payments must contain valid JSON.");
    }
  }
  if (!Array.isArray(installments)) {
    throw validationError("installment_payments has an invalid format.");
  }
  const seenTerms = new Set();
  const normalizedInstallments = installments.map((item) => {
    if (!item || !Number.isInteger(Number(item.term)) || Number(item.term) < 1) {
      throw validationError("installment_payments has an invalid term number.");
    }
    const term = Number(item.term);
    if (seenTerms.has(term)) throw validationError(`Installment term ${term} is duplicated.`);
    seenTerms.add(term);
    const amount = readNumber(item.amount, "installment amount");
    if (amount === null) throw validationError("Installment amounts are required.");
    return { term, amount };
  }).sort((left, right) => left.term - right.term);
  if (contract.payment_status === "Termin") {
    if (!contract.contract_value) {
      throw validationError("Nilai kontrak wajib diisi untuk pembayaran termin.");
    }
    const amountPaid = normalizedInstallments.reduce((total, item) => total + item.amount, 0);
    if (amountPaid > contract.contract_value) {
      throw validationError("Total pembayaran termin melebihi nilai kontrak.");
    }
  }
  contract.installment_payments = JSON.stringify(normalizedInstallments);
  contract.occupancy_status = body.occupancy_status;
  return contract;
}

function normalizeRooms(body, contract) {
  if (!Array.isArray(body.rooms) || body.rooms.length === 0 || body.rooms.length > 100) {
    throw validationError("Select between 1 and 100 rooms.");
  }
  const building = readText(body.building, "building", 40);
  const floor = readText(body.floor, "floor", 40);
  if (!building || !floor) throw validationError("Building and floor are required.");

  const seen = new Set();
  const rooms = body.rooms.map((room) => {
    if (!room || typeof room !== "object" || Array.isArray(room)) {
      throw validationError("Each room must be an object.");
    }
    const roomId = readText(room?.room_id, "room_id", 80);
    if (!roomId) throw validationError("Every room must have a room_id.");
    if (seen.has(roomId)) throw validationError(`Room ${roomId} is duplicated.`);
    seen.add(roomId);
    return {
      building,
      floor,
      room_id: roomId,
      area_m2: readNumber(room.area_m2, "area_m2"),
      occupancy_status: contract.occupancy_status,
    };
  });
  return rooms;
}

function mapRoomRecord(row) {
  return {
    building: row.building,
    floor: row.floor,
    room_id: row.room_id,
    contract_id: row.contract_id,
    occupancy_status: row.occupancy_status,
    area_m2: row.area_m2 === null ? "" : Number(row.area_m2),
    tenant: row.tenant ?? "",
    payment_status: row.payment_status ?? "",
    start_date: row.start_date ?? "",
    end_date: row.end_date ?? "",
    contract_value: row.contract_value === null ? "" : Number(row.contract_value),
    billing_period: row.billing_period ?? "",
    installment_interval_months: row.installment_interval_months ?? "",
    initial_payment_amount: row.initial_payment_amount === null ? "" : Number(row.initial_payment_amount),
    partial_payment_schedule: row.partial_payment_schedule ?? "",
    installment_payments: JSON.stringify(row.installment_payments ?? []),
    installments: row.installment_payments ?? [],
    last_payment_date: row.last_payment_date ?? "",
    electricity_cost_rp: row.electricity_cost_rp === null ? "" : Number(row.electricity_cost_rp),
    electricity_kwh: row.electricity_kwh === null ? "" : Number(row.electricity_kwh),
    phone_cost_rp: row.phone_cost_rp === null ? "" : Number(row.phone_cost_rp),
    pic: row.pic ?? "",
    contact: row.contact ?? "",
    notes: row.notes ?? "",
  };
}

export function roomRecordForUser(record, user) {
  if (user.role !== "client" || record.tenant === user.tenantName) return record;
  return {
    building: record.building,
    floor: record.floor,
    room_id: record.room_id,
    occupancy_status: record.occupancy_status,
    area_m2: record.area_m2,
  };
}

tenantsRouter.get("/rooms", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.building, r.floor, r.room_id, r.contract_id,
        r.occupancy_status, r.area_m2, c.tenant, c.payment_status,
        c.start_date::text, c.end_date::text, c.contract_value,
        c.billing_period, c.installment_interval_months,
        c.initial_payment_amount, c.partial_payment_schedule,
        c.installment_payments, c.last_payment_date::text,
        c.electricity_cost_rp, c.electricity_kwh, c.phone_cost_rp,
        c.pic, c.contact, c.notes
      FROM contract_rooms r
      JOIN tenant_contracts c ON c.id = r.contract_id
      ORDER BY r.building, r.floor, r.room_id
    `);
    const records = rows
      .map(mapRoomRecord)
      .map((record) => roomRecordForUser(record, req.user));
    res.json({ records, diagnostics: [] });
  } catch (error) {
    next(error);
  }
});

tenantsRouter.get("/tenants", async (req, res, next) => {
  try {
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 25);
    const sortBy = String(req.query.sortBy ?? "tenantName");
    const sortDir = String(req.query.sortDir ?? "asc").toLowerCase();
    const paymentScheme =
      typeof req.query.paymentScheme === "string" ? req.query.paymentScheme.trim() : "";

    if (!Number.isInteger(page) || page < 1) throw validationError("page must be a positive integer.");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE_MAX) {
      throw validationError(`pageSize must be between 1 and ${PAGE_SIZE_MAX}.`);
    }
    if (!Object.hasOwn(SORT_COLUMNS, sortBy)) throw validationError("sortBy is not supported.");
    if (!["asc", "desc"].includes(sortDir)) throw validationError("sortDir must be asc or desc.");

    const filters = [];
    const params = [];
    if (req.user.role === "client") {
      params.push(req.user.tenantName);
      filters.push(`c.tenant = $${params.length}`);
    }
    if (paymentScheme) {
      params.push(paymentScheme);
      filters.push(`c.payment_status = $${params.length}`);
    }
    const filter = filters.length ? `AND ${filters.join(" AND ")}` : "";
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM tenant_contracts c
       WHERE EXISTS (SELECT 1 FROM contract_rooms r WHERE r.contract_id = c.id)
       ${filter}`,
      params,
    );
    const totalRecords = countResult.rows[0].total;
    const offset = (page - 1) * pageSize;
    const valueOffset = params.length + 1;
    const limitOffset = params.length + 2;
    const orderColumn = SORT_COLUMNS[sortBy];
    const { rows } = await pool.query(
      `SELECT c.id, c.tenant, c.contact, c.pic, c.notes, c.payment_status,
       c.start_date::text, c.end_date::text, c.contract_value, c.billing_period,
       c.installment_interval_months, c.initial_payment_amount,
       c.partial_payment_schedule, c.installment_payments,
       c.last_payment_date::text, c.electricity_cost_rp, c.electricity_kwh,
       c.phone_cost_rp,
        COALESCE(
          json_agg(json_build_object(
            'building', r.building, 'floor', r.floor, 'room_id', r.room_id
          ) ORDER BY r.building, r.floor, r.room_id)
          FILTER (WHERE r.room_id IS NOT NULL),
          '[]'::json
        ) AS rooms
       FROM tenant_contracts c
       LEFT JOIN contract_rooms r ON r.contract_id = c.id
       WHERE TRUE ${filter}
       GROUP BY c.id
       HAVING COUNT(r.room_id) > 0
       ORDER BY ${orderColumn} ${sortDir.toUpperCase()} NULLS LAST, c.id ASC
       LIMIT $${limitOffset} OFFSET $${valueOffset}`,
      [...params, offset, pageSize],
    );

    res.json({
      records: rows.map((row) => ({
        id: row.id,
        tenantName: row.tenant,
        contact: row.contact,
        pic: row.pic,
        notes: row.notes,
        paymentScheme: row.payment_status,
        startDate: row.start_date,
        endDate: row.end_date,
        contractValue: row.contract_value === null ? null : Number(row.contract_value),
        billingPeriod: row.billing_period,
        installmentIntervalMonths: row.installment_interval_months,
        initialPaymentAmount: row.initial_payment_amount === null
          ? null
          : Number(row.initial_payment_amount),
        partialPaymentSchedule: row.partial_payment_schedule,
        installmentPayments: row.installment_payments,
        lastPaymentDate: row.last_payment_date,
        electricityCostRp: row.electricity_cost_rp === null ? null : Number(row.electricity_cost_rp),
        electricityKwh: row.electricity_kwh === null ? null : Number(row.electricity_kwh),
        phoneCostRp: row.phone_cost_rp === null ? null : Number(row.phone_cost_rp),
        rooms: row.rooms.map((room) => `${room.building} ${room.floor} / ${room.room_id}`),
        firstRoom: row.rooms[0] ?? null,
      })),
      meta: {
        page,
        pageSize,
        totalRecords,
        totalPages: Math.ceil(totalRecords / pageSize),
      },
    });
  } catch (error) {
    next(error);
  }
});

tenantsRouter.get("/invoices", (req, res) => {
  res.json({ records: invoicesForUser(req.user) });
});

tenantsRouter.post("/contracts", allowRoles("admin"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const contract = normalizeContract(req.body);
    const rooms = normalizeRooms(req.body, contract);
    const contractId = req.body.contract_id || randomUUID();
    if (
      typeof contractId !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(contractId)
    ) {
      throw validationError("contract_id must be a UUID.");
    }

    await client.query("BEGIN");
    const roomIds = rooms.map((room) => room.room_id);
    const { rows: conflictingRooms } = await client.query(
      `SELECT building, floor, room_id FROM contract_rooms
       WHERE building = $1 AND floor = $2 AND room_id = ANY($3::text[])
         AND contract_id <> $4::uuid
       FOR UPDATE`,
      [rooms[0].building, rooms[0].floor, roomIds, contractId],
    );
    if (conflictingRooms.length) {
      throw validationError(
        `Room ${conflictingRooms.map((room) => room.room_id).join(", ")} already belongs to another contract.`,
      );
    }

    await client.query(
      `INSERT INTO tenant_contracts (
        id, tenant, payment_status, start_date, end_date, contract_value,
        billing_period, installment_interval_months, initial_payment_amount,
        partial_payment_schedule, installment_payments, last_payment_date,
        electricity_cost_rp, electricity_kwh, phone_cost_rp, pic, contact, notes,
        updated_at
      ) VALUES (
        $1::uuid, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10,
        $11::jsonb, $12::date, $13, $14, $15, $16, $17, $18, NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        tenant = EXCLUDED.tenant,
        payment_status = EXCLUDED.payment_status,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        contract_value = EXCLUDED.contract_value,
        billing_period = EXCLUDED.billing_period,
        installment_interval_months = EXCLUDED.installment_interval_months,
        initial_payment_amount = EXCLUDED.initial_payment_amount,
        partial_payment_schedule = EXCLUDED.partial_payment_schedule,
        installment_payments = EXCLUDED.installment_payments,
        last_payment_date = EXCLUDED.last_payment_date,
        electricity_cost_rp = EXCLUDED.electricity_cost_rp,
        electricity_kwh = EXCLUDED.electricity_kwh,
        phone_cost_rp = EXCLUDED.phone_cost_rp,
        pic = EXCLUDED.pic,
        contact = EXCLUDED.contact,
        notes = EXCLUDED.notes,
        updated_at = NOW()`,
      [
        contractId,
        contract.tenant,
        contract.payment_status,
        contract.start_date,
        contract.end_date,
        contract.contract_value,
        contract.billing_period,
        contract.installment_interval_months,
        contract.initial_payment_amount,
        contract.partial_payment_schedule,
        contract.installment_payments,
        contract.last_payment_date,
        contract.electricity_cost_rp,
        contract.electricity_kwh,
        contract.phone_cost_rp,
        contract.pic,
        contract.contact,
        contract.notes,
      ],
    );

    await client.query(
      `DELETE FROM contract_rooms
       WHERE contract_id = $1::uuid AND building = $2 AND floor = $3
         AND NOT (room_id = ANY($4::text[]))`,
      [contractId, rooms[0].building, rooms[0].floor, roomIds],
    );
    for (const room of rooms) {
      await client.query(
        `INSERT INTO contract_rooms (
          building, floor, room_id, contract_id, occupancy_status, area_m2
        ) VALUES ($1, $2, $3, $4::uuid, $5, $6)
        ON CONFLICT (building, floor, room_id) DO UPDATE SET
          contract_id = EXCLUDED.contract_id,
          occupancy_status = EXCLUDED.occupancy_status,
          area_m2 = EXCLUDED.area_m2`,
        [
          room.building,
          room.floor,
          room.room_id,
          contractId,
          room.occupancy_status,
          room.area_m2,
        ],
      );
    }

    await client.query("COMMIT");
    res.status(200).json({ success: true, contract_id: contractId, rooms });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

tenantsRouter.delete("/rooms", allowRoles("admin"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const building = readText(req.body?.building, "building", 40);
    const floor = readText(req.body?.floor, "floor", 40);
    const roomId = readText(req.body?.room_id, "room_id", 80);
    if (!building || !floor || !roomId) {
      throw validationError("building, floor, and room_id are required.");
    }

    await client.query("BEGIN");
    const result = await client.query(
      `DELETE FROM contract_rooms
       WHERE building = $1 AND floor = $2 AND room_id = $3
       RETURNING contract_id`,
      [building, floor, roomId],
    );
    if (!result.rowCount) {
      throw Object.assign(new Error("Room record was not found."), { status: 404 });
    }
    await client.query(
      `DELETE FROM tenant_contracts c
       WHERE c.id = $1::uuid
         AND NOT EXISTS (SELECT 1 FROM contract_rooms r WHERE r.contract_id = c.id)`,
      [result.rows[0].contract_id],
    );
    await client.query("COMMIT");
    res.json({ success: true, building, floor, room_id: roomId });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

export { normalizeContract, normalizeRooms };
