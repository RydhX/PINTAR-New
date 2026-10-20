import { Router } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "./db.js";
import {
  allowRoles,
  CLIENT_DEFAULT_PASSWORD,
  hashClientPassword,
  invoicesForUser,
} from "./auth.js";
import { buildInvoiceSchedule, contractMonthCount } from "./billing.js";
import { buildUtilitySchedule } from "./utility-payments.js";

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
  "rental_invoice_scheme",
  "separate_utility_invoices",
  "start_date",
  "end_date",
  "contract_value",
  "billing_period",
  "installment_interval_months",
  "initial_payment_amount",
  "partial_balance_due_date",
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

export function normalizeCustomTenantArea(body, { building, floor, contract, rooms } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validationError("Custom area payload must be an object.");
  }
  if (building !== "GKP" || floor !== "L11") {
    throw validationError("Custom tenant areas can only be saved on Lantai 11.");
  }
  if (
    !Array.isArray(rooms) ||
    rooms.length !== 1 ||
    !/^L11_CUSTOM_[0-9a-f]{32}$/i.test(rooms[0].room_id)
  ) {
    throw validationError("A rooftop polygon must be registered as one custom Lantai 11 unit.");
  }

  const geometry = body.geometry;
  const ring = geometry?.type === "Polygon" && Array.isArray(geometry.coordinates)
    ? geometry.coordinates[0]
    : null;
  if (
    !ring ||
    geometry.coordinates.length !== 1 ||
    ring.length < 4 ||
    ring.length > 2001 ||
    ring.some((position) =>
      !Array.isArray(position) ||
      position.length !== 2 ||
      !position.every(Number.isFinite) ||
      position[0] < 0 ||
      position[0] > 6000 ||
      position[1] < 0 ||
      position[1] > 3500
    )
  ) {
    throw validationError("Polygon must be a single closed ring within the Lantai 11 plan.");
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    throw validationError("Polygon ring must be closed.");
  }

  const usageType = readText(body.usage_type, "usage_type", 80);
  const areaSqm = rooms[0].area_m2;
  const tenantName = contract?.tenant;
  const rentPrice = contract?.contract_value;
  const status = contract?.occupancy_status === "in_progress"
    ? "NEGOSIASI"
    : "DISEWA";
  if (!usageType) throw validationError("usage_type is required.");
  if (!tenantName) throw validationError("tenant_name is required.");
  if (!Number.isFinite(areaSqm) || areaSqm <= 0 || areaSqm > 10_000_000) {
    throw validationError("area_sqm must be greater than 0 and no more than 10000000.");
  }
  if (!Number.isFinite(rentPrice) || rentPrice <= 0 || rentPrice > 1_000_000_000_000) {
    throw validationError("rent_price is required and must not exceed 1000000000000.");
  }

  return {
    buildingId: "GKP",
    floorId: "Lantai 11",
    roomId: rooms[0].room_id,
    geometry,
    areaSqm,
    tenantName,
    usageType,
    status,
    rentPrice,
  };
}

function rentTotalCents(monthlyRent, monthCount) {
  const totalCents = Math.round(monthlyRent * 100) * monthCount;
  if (!Number.isSafeInteger(totalCents)) {
    throw validationError("Total sewa kontrak melebihi batas nominal yang didukung.");
  }
  return totalCents;
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
  contract.partial_balance_due_date = readDate(
    body.partial_balance_due_date,
    "partial_balance_due_date",
  );
  contract.last_payment_date = readDate(body.last_payment_date, "last_payment_date");
  contract.rental_invoice_scheme = body.rental_invoice_scheme ?? "LUNAS";
  if (!["LUNAS", "TERMIN", "PARTIAL"].includes(contract.rental_invoice_scheme)) {
    throw validationError("Skema invoice sewa tidak dikenal.");
  }
  contract.payment_status = {
    LUNAS: "Lunas",
    TERMIN: "Termin",
    PARTIAL: "Partial Paid",
  }[contract.rental_invoice_scheme];
  if (
    body.separate_utility_invoices !== undefined &&
    typeof body.separate_utility_invoices !== "boolean"
  ) {
    throw validationError("separate_utility_invoices must be a boolean.");
  }
  contract.separate_utility_invoices = true;
  if (contract.start_date && contract.end_date && contract.end_date < contract.start_date) {
    throw validationError("end_date must be on or after start_date.");
  }
  if (
    contract.start_date &&
    contract.end_date &&
    contractMonthCount(contract.start_date, contract.end_date) < 1
  ) {
    throw validationError("Durasi kontrak harus mencakup minimal satu bulan kalender penuh.");
  }
  if (!contract.tenant) throw validationError("Nama tenant wajib diisi.");
  if (!["occupied", "vacant", "in_progress"].includes(body.occupancy_status)) {
    throw validationError("Status okupansi tidak dikenal.");
  }
  if (!contract.start_date || !contract.end_date || !contract.contract_value) {
    throw validationError("Tanggal mulai, tanggal akhir, dan tarif sewa bulanan wajib diisi.");
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
  if (contract.rental_invoice_scheme === "TERMIN") {
    contract.installment_interval_months ??= 6;
    if (
      !contract.contract_value ||
      !contract.start_date ||
      !contract.end_date ||
      ![1, 3, 6, 12].includes(contract.installment_interval_months)
    ) {
      throw validationError("Nilai kontrak, tanggal kontrak, dan interval termin 1, 3, 6, atau 12 bulan wajib diisi.");
    }
    const monthCount = contractMonthCount(contract.start_date, contract.end_date);
    const totalRentCents = rentTotalCents(contract.contract_value, monthCount);
    const termCount = Math.ceil(
      contractMonthCount(contract.start_date, contract.end_date) /
      contract.installment_interval_months,
    );
    if (normalizedInstallments.some((item) => item.term > termCount)) {
      throw validationError("Nomor pembayaran termin melebihi jumlah termin kontrak.");
    }
    const amountPaidCents = normalizedInstallments.reduce(
      (total, item) => total + Math.round(item.amount * 100),
      0,
    );
    if (amountPaidCents > totalRentCents) {
      throw validationError("Total pembayaran termin melebihi nilai kontrak.");
    }
  }
  if (contract.rental_invoice_scheme === "PARTIAL") {
    if (
      !contract.contract_value ||
      !contract.start_date ||
      !contract.end_date ||
      contract.initial_payment_amount === null ||
      !contract.partial_balance_due_date
    ) {
      throw validationError("Nilai kontrak, tanggal kontrak, nominal DP, dan tanggal jatuh tempo pelunasan sisa wajib diisi untuk skema Partial.");
    }
    if (contract.partial_balance_due_date < contract.start_date) {
      throw validationError("Jatuh tempo pelunasan sisa tidak boleh sebelum tanggal mulai kontrak.");
    }
    const totalRentCents = rentTotalCents(
      contract.contract_value,
      contractMonthCount(contract.start_date, contract.end_date),
    );
    const initialPaymentCents = Math.round(contract.initial_payment_amount * 100);
    if (
      contract.initial_payment_amount <= 0 ||
      !Number.isSafeInteger(initialPaymentCents) ||
      initialPaymentCents > totalRentCents
    ) {
      throw validationError("Nominal DP harus lebih dari Rp0 dan tidak melebihi total sewa kontrak.");
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

async function syncUtilityPayments(client, contractId, contract) {
  const schedule = buildUtilitySchedule(contract);
  for (const payment of schedule) {
    await client.query(
      `INSERT INTO utility_payments (
        id, contract_id, utility_type, billing_month, due_date, amount
      ) VALUES ($1::uuid, $2::uuid, $3, $4::date, $5::date, $6)
      ON CONFLICT (contract_id, utility_type, billing_month) DO UPDATE SET
        due_date = CASE
          WHEN utility_payments.status = 'LUNAS' THEN utility_payments.due_date
          ELSE EXCLUDED.due_date
        END,
        amount = CASE
          WHEN utility_payments.status = 'LUNAS' THEN utility_payments.amount
          ELSE EXCLUDED.amount
        END,
        updated_at = NOW()`,
      [
        randomUUID(),
        contractId,
        payment.utility_type,
        payment.billing_month,
        payment.due_date,
        payment.amount,
      ],
    );
  }

  await client.query(
    `DELETE FROM utility_payments AS saved
     WHERE saved.contract_id = $1::uuid
       AND saved.status <> 'LUNAS'
       AND NOT EXISTS (
         SELECT 1
         FROM unnest($2::text[], $3::date[]) AS expected(utility_type, billing_month)
         WHERE expected.utility_type = saved.utility_type
           AND expected.billing_month = saved.billing_month
       )`,
    [
      contractId,
      schedule.map((payment) => payment.utility_type),
      schedule.map((payment) => payment.billing_month),
    ],
  );
}

async function syncInvoices(client, tenantId, contractId, contract) {
  const schedule = buildInvoiceSchedule(contract);
  for (const invoice of schedule) {
    await client.query(
      `INSERT INTO tenant_invoices (
        id, invoice_number, tenant_id, contract_id, category, invoice_label,
        billing_month, billing_date, due_date, period_start, period_end, rent_amount,
        electricity_amount, telephone_amount, paid_amount, status, paid_at
      ) VALUES (
        $1::uuid,
        'INV-' || to_char($6::date, 'YYYY-MM') || '-' ||
          lpad(nextval('invoice_number_seq')::text, 3, '0'),
        $2::uuid, $3::uuid, $4, $5, $6::date, $7::date, $8::date,
        $9::date, $10::date, $11, $12, $13, $14,
        CASE
          WHEN $14::numeric > 0
            AND $14::numeric >= $11::numeric + $12::numeric + $13::numeric THEN 'LUNAS'
          WHEN $14::numeric > 0 THEN 'SEBAGIAN'
          ELSE 'BELUM_DIBAYAR'
        END,
        CASE
          WHEN $14::numeric > 0
            AND $14::numeric >= $11::numeric + $12::numeric + $13::numeric THEN NOW()
          ELSE NULL
        END
      )
      ON CONFLICT (contract_id, billing_month, category, invoice_label) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        billing_date = EXCLUDED.billing_date,
        due_date = EXCLUDED.due_date,
        period_start = EXCLUDED.period_start,
        period_end = EXCLUDED.period_end,
        rent_amount = EXCLUDED.rent_amount,
        electricity_amount = EXCLUDED.electricity_amount,
        telephone_amount = EXCLUDED.telephone_amount,
        paid_amount = LEAST(
          tenant_invoices.paid_amount,
          EXCLUDED.rent_amount + EXCLUDED.electricity_amount + EXCLUDED.telephone_amount
        ),
        status = CASE
          WHEN LEAST(
            tenant_invoices.paid_amount,
            EXCLUDED.rent_amount + EXCLUDED.electricity_amount + EXCLUDED.telephone_amount
          ) > 0
            AND LEAST(
              tenant_invoices.paid_amount,
              EXCLUDED.rent_amount + EXCLUDED.electricity_amount + EXCLUDED.telephone_amount
            ) >=
            EXCLUDED.rent_amount + EXCLUDED.electricity_amount + EXCLUDED.telephone_amount
            THEN 'LUNAS'
          WHEN LEAST(
            tenant_invoices.paid_amount,
            EXCLUDED.rent_amount + EXCLUDED.electricity_amount + EXCLUDED.telephone_amount
          ) > 0 THEN 'SEBAGIAN'
          ELSE 'BELUM_DIBAYAR'
        END,
        paid_at = CASE
          WHEN LEAST(
            tenant_invoices.paid_amount,
            EXCLUDED.rent_amount + EXCLUDED.electricity_amount + EXCLUDED.telephone_amount
          ) > 0
            AND LEAST(
              tenant_invoices.paid_amount,
              EXCLUDED.rent_amount + EXCLUDED.electricity_amount + EXCLUDED.telephone_amount
            ) >=
            EXCLUDED.rent_amount + EXCLUDED.electricity_amount + EXCLUDED.telephone_amount
            THEN COALESCE(tenant_invoices.paid_at, NOW())
          ELSE NULL
        END,
        updated_at = NOW()`,
      [
        randomUUID(),
        tenantId,
        contractId,
        invoice.category,
        invoice.invoice_label,
        invoice.billing_month,
        invoice.billing_date,
        invoice.due_date,
        invoice.period_start,
        invoice.period_end,
        invoice.rent_amount,
        invoice.electricity_amount,
        invoice.telephone_amount,
        invoice.paid_amount,
      ],
    );
  }

  await client.query(
    `DELETE FROM tenant_invoices AS saved
     WHERE saved.contract_id = $1::uuid
       AND saved.paid_amount = 0
       AND NOT EXISTS (
         SELECT 1
         FROM unnest($2::date[], $3::text[], $4::text[])
           AS expected(billing_month, category, invoice_label)
         WHERE expected.billing_month = saved.billing_month
           AND expected.category = saved.category
           AND expected.invoice_label = saved.invoice_label
       )`,
    [
      contractId,
      schedule.map((invoice) => invoice.billing_month),
      schedule.map((invoice) => invoice.category),
      schedule.map((invoice) => invoice.invoice_label),
    ],
  );
}

async function ensureClientAccount(client, tenantId, tenantName) {
  const { rows: currentAccounts } = await client.query(
    `SELECT username FROM client_users WHERE tenant_id = $1::uuid FOR UPDATE`,
    [tenantId],
  );
  if (currentAccounts.length) {
    return {
      username: currentAccounts[0].username,
      password: CLIENT_DEFAULT_PASSWORD,
      created: false,
    };
  }

  const username = tenantName.trim();
  const { rows: conflictingAccounts } = await client.query(
    `SELECT username FROM client_users WHERE lower(username) = lower($1)`,
    [username],
  );
  if (conflictingAccounts.length) {
    throw Object.assign(
      new Error("Nama tenant ini sudah digunakan sebagai username akun client lain."),
      { status: 409 },
    );
  }

  const passwordHash = await hashClientPassword(CLIENT_DEFAULT_PASSWORD);
  await client.query(
    `INSERT INTO client_users (id, tenant_id, username, password_hash)
     VALUES ($1::uuid, $2::uuid, $3, $4)`,
    [randomUUID(), tenantId, username, passwordHash],
  );
  return { username, password: CLIENT_DEFAULT_PASSWORD, created: true };
}

function mapRoomRecord(row) {
  return {
    tenant_id: row.tenant_id,
    building: row.building,
    floor: row.floor,
    room_id: row.room_id,
    contract_id: row.contract_id,
    occupancy_status: row.occupancy_status,
    area_m2: row.area_m2 === null ? "" : Number(row.area_m2),
    tenant: row.tenant ?? "",
    payment_status: row.payment_status ?? "",
    rental_invoice_scheme: row.rental_invoice_scheme ?? "LUNAS",
    separate_utility_invoices: true,
    start_date: row.start_date ?? "",
    end_date: row.end_date ?? "",
    contract_value: row.contract_value === null ? "" : Number(row.contract_value),
    billing_period: row.billing_period ?? "",
    installment_interval_months: row.installment_interval_months ?? "",
    initial_payment_amount: row.initial_payment_amount === null ? "" : Number(row.initial_payment_amount),
    partial_balance_due_date: row.partial_balance_due_date ?? "",
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
    utility_payments: row.utility_payments ?? [],
    invoices: row.invoices ?? [],
    custom_area_geometry: row.custom_area_geometry ?? null,
    custom_area_usage_type: row.custom_area_usage_type ?? null,
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
    ...(record.custom_area_geometry
      ? {
        custom_area_geometry: record.custom_area_geometry,
        custom_area_usage_type: record.custom_area_usage_type,
      }
      : {}),
  };
}

tenantsRouter.get("/rooms", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.tenant_id, r.building, r.floor, r.room_id, r.contract_id,
        r.occupancy_status, r.area_m2, c.tenant, c.payment_status,
        custom_area.geometry AS custom_area_geometry,
        custom_area.usage_type AS custom_area_usage_type,
        c.start_date::text, c.end_date::text, c.contract_value,
        c.rental_invoice_scheme, c.separate_utility_invoices,
        c.billing_period, c.installment_interval_months,
        c.initial_payment_amount, c.partial_balance_due_date::text,
        c.partial_payment_schedule,
        c.installment_payments, c.last_payment_date::text,
        c.electricity_cost_rp, c.electricity_kwh, c.phone_cost_rp,
        c.pic, c.contact, c.notes,
        COALESCE(utilities.payments, '[]'::json) AS utility_payments,
        COALESCE(invoices.records, '[]'::json) AS invoices
      FROM contract_rooms r
      JOIN tenant_contracts c ON c.id = r.contract_id
      LEFT JOIN custom_tenant_areas custom_area
        ON custom_area.contract_id = c.id
        AND custom_area.room_id = r.room_id
        AND custom_area.building_id = r.building
        AND custom_area.floor_id = 'Lantai 11'
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
          'id', payment.id,
          'utility_type', payment.utility_type,
          'billing_month', payment.billing_month::text,
          'due_date', payment.due_date::text,
          'amount', payment.amount,
          'status', CASE
            WHEN payment.status = 'LUNAS' THEN 'LUNAS'
            WHEN payment.due_date < (NOW() AT TIME ZONE 'Asia/Jakarta')::date THEN 'MENUNGGAK'
            ELSE 'BELUM_BAYAR'
          END,
          'paid_at', payment.paid_at
        ) ORDER BY payment.billing_month, payment.utility_type) AS payments
        FROM utility_payments payment
        WHERE payment.contract_id = c.id
      ) utilities ON TRUE
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
          'id', invoice.id,
          'invoice_id', invoice.invoice_number,
          'category', invoice.category,
          'invoice_label', invoice.invoice_label,
          'billing_month', invoice.billing_month::text,
          'billing_date', invoice.billing_date::text,
          'due_date', invoice.due_date::text,
          'period_start', invoice.period_start::text,
          'period_end', invoice.period_end::text,
          'rent_amount', invoice.rent_amount,
          'electricity_amount', invoice.electricity_amount,
          'telephone_amount', invoice.telephone_amount,
          'total_amount', invoice.rent_amount + invoice.electricity_amount + invoice.telephone_amount,
          'paid_amount', invoice.paid_amount,
          'remaining_amount', invoice.rent_amount + invoice.electricity_amount + invoice.telephone_amount - invoice.paid_amount,
          'status', CASE
            WHEN invoice.status = 'LUNAS' THEN 'LUNAS'
            WHEN invoice.due_date < (NOW() AT TIME ZONE 'Asia/Jakarta')::date
              THEN 'MENUNGGAK'
            ELSE invoice.status
          END,
          'recorded_status', invoice.status
        ) ORDER BY invoice.billing_month, invoice.category, invoice.invoice_label) AS records
        FROM tenant_invoices invoice
        WHERE invoice.contract_id = c.id
      ) invoices ON TRUE
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

tenantsRouter.patch("/utility-payments/:id", allowRoles("admin"), async (req, res, next) => {
  try {
    const paymentId = req.params.id;
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(paymentId)) {
      throw validationError("Utility payment id must be a UUID.");
    }
    const status = req.body?.status;
    if (!["LUNAS", "BELUM_BAYAR"].includes(status)) {
      throw validationError("Utility payment status must be LUNAS or BELUM_BAYAR.");
    }
    const { rows } = await pool.query(
      `UPDATE utility_payments
       SET status = $2,
           paid_at = CASE WHEN $2 = 'LUNAS' THEN NOW() ELSE NULL END,
           updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING id, utility_type, billing_month::text, due_date::text,
         amount, status, paid_at`,
      [paymentId, status],
    );
    if (!rows.length) {
      res.status(404).json({ error: "Utility payment was not found." });
      return;
    }
    res.json({ success: true, payment: rows[0] });
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
    if (req.user.role === "client" && req.user.tenantId) {
      params.push(req.user.tenantId);
      filters.push(`c.tenant_id = $${params.length}::uuid`);
    } else if (req.user.role === "client") {
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
      `SELECT c.id, c.tenant_id, c.tenant, c.contact, c.pic, c.notes, c.payment_status,
       c.start_date::text, c.end_date::text, c.contract_value, c.billing_period,
       c.installment_interval_months, c.initial_payment_amount,
       c.partial_balance_due_date::text, c.partial_payment_schedule, c.installment_payments,
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
        tenantId: row.tenant_id,
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
        partialBalanceDueDate: row.partial_balance_due_date,
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

tenantsRouter.get("/invoices", async (req, res, next) => {
  if (req.user.role === "client" && !req.user.tenantId) {
    res.json({ records: invoicesForUser(req.user) });
    return;
  }
  try {
    const { rows } = await pool.query(
      `SELECT invoice.id, invoice.contract_id, invoice.tenant_id,
        invoice.invoice_number, invoice.category, invoice.invoice_label,
        tenant.name AS tenant_name, invoice.billing_month::text,
        invoice.billing_date::text, invoice.due_date::text,
        invoice.period_start::text, invoice.period_end::text,
        invoice.rent_amount, invoice.electricity_amount, invoice.telephone_amount,
        invoice.paid_amount,
        CASE
          WHEN invoice.status = 'LUNAS' THEN 'LUNAS'
          WHEN invoice.due_date < (NOW() AT TIME ZONE 'Asia/Jakarta')::date
            THEN 'MENUNGGAK'
          ELSE invoice.status
        END AS status
       FROM tenant_invoices invoice
       JOIN tenants tenant ON tenant.id = invoice.tenant_id
       WHERE ($1::uuid IS NULL OR invoice.tenant_id = $1::uuid)
       ORDER BY invoice.billing_month DESC, invoice.category,
         invoice.invoice_label, invoice.invoice_number`,
      [req.user.role === "client" ? req.user.tenantId : null],
    );
    res.json({
      records: rows.map((row) => ({
        id: row.id,
        contractId: row.contract_id,
        tenantId: row.tenant_id,
        invoiceId: row.invoice_number,
        category: row.category,
        invoiceLabel: row.invoice_label,
        tenantName: row.tenant_name,
        period: row.billing_month.slice(0, 7),
        billingDate: row.billing_date,
        dueDate: row.due_date,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        rentAmountRp: Number(row.rent_amount),
        electricityAmountRp: Number(row.electricity_amount),
        phoneAmountRp: Number(row.telephone_amount),
        amountRp:
          Number(row.rent_amount) +
          Number(row.electricity_amount) +
          Number(row.telephone_amount),
        paidAmountRp: Number(row.paid_amount),
        remainingAmountRp: Number(row.rent_amount) +
          Number(row.electricity_amount) +
          Number(row.telephone_amount) -
          Number(row.paid_amount),
        status: row.status,
      })),
    });
  } catch (error) {
    next(error);
  }
});

tenantsRouter.patch("/invoices/:id", allowRoles("admin"), async (req, res, next) => {
  const invoiceId = req.params.id;
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(invoiceId)) {
    next(validationError("Invoice id must be a UUID."));
    return;
  }

  const status = req.body?.status;
  if (!["LUNAS", "BELUM_DIBAYAR", "SEBAGIAN"].includes(status)) {
    next(validationError("Status invoice harus LUNAS, BELUM_DIBAYAR, atau SEBAGIAN."));
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT rent_amount + electricity_amount + telephone_amount AS total
       FROM tenant_invoices
       WHERE id = $1::uuid
       FOR UPDATE`,
      [invoiceId],
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Invoice tidak ditemukan." });
      return;
    }

    const total = Number(rows[0].total);
    const requestedPaidAmount = status === "LUNAS"
      ? total
      : status === "BELUM_DIBAYAR"
        ? 0
        : readNumber(req.body?.paid_amount, "paid_amount");
    if (
      requestedPaidAmount === null ||
      requestedPaidAmount <= 0 ||
      requestedPaidAmount >= total
    ) {
      if (status === "SEBAGIAN") {
        throw validationError("Nominal pembayaran sebagian harus lebih dari Rp0 dan kurang dari total invoice.");
      }
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE tenant_invoices
       SET status = $2,
           paid_amount = $3,
           paid_at = CASE WHEN $2 = 'LUNAS' THEN NOW() ELSE NULL END,
           updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING id, status, paid_amount,
         rent_amount + electricity_amount + telephone_amount AS total_amount`,
      [invoiceId, status, requestedPaidAmount],
    );
    await client.query("COMMIT");
    res.json({
      success: true,
      invoice: {
        id: updatedRows[0].id,
        status: updatedRows[0].status,
        paidAmountRp: Number(updatedRows[0].paid_amount),
        totalAmountRp: Number(updatedRows[0].total_amount),
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

tenantsRouter.post("/contracts", allowRoles("admin"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const contract = normalizeContract(req.body);
    const rooms = normalizeRooms(req.body, contract);
    const customArea = req.body?.custom_area
      ? normalizeCustomTenantArea(req.body.custom_area, {
        building: req.body.building,
        floor: req.body.floor,
        contract,
        rooms,
      })
      : null;
    const hasCustomRooftopRoom = rooms.some((room) =>
      /^L11_CUSTOM_/i.test(room.room_id),
    );
    if (hasCustomRooftopRoom && !customArea && !req.body.contract_id) {
      throw validationError("Custom rooftop units must be registered with their drawn polygon.");
    }
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

    const { rows: tenantRows } = await client.query(
      `INSERT INTO tenants (id, name, name_key)
       VALUES ($1::uuid, $2, lower(trim($2)))
       ON CONFLICT (name_key) DO UPDATE SET name = tenants.name
       RETURNING id, name`,
      [randomUUID(), contract.tenant],
    );
    const tenantId = tenantRows[0].id;

    await client.query(
      `INSERT INTO tenant_contracts (
        id, tenant_id, tenant, payment_status, rental_invoice_scheme,
        separate_utility_invoices, start_date, end_date, contract_value,
        billing_period, installment_interval_months, initial_payment_amount,
        partial_balance_due_date, partial_payment_schedule, installment_payments,
        last_payment_date,
        electricity_cost_rp, electricity_kwh, phone_cost_rp, pic, contact, notes,
        updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4, $5, $6, $7::date, $8::date, $9, $10,
        $11, $12, $13::date, $14, $15::jsonb, $16::date, $17, $18, $19, $20,
        $21, $22, NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        tenant = EXCLUDED.tenant,
        payment_status = EXCLUDED.payment_status,
        rental_invoice_scheme = EXCLUDED.rental_invoice_scheme,
        separate_utility_invoices = EXCLUDED.separate_utility_invoices,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        contract_value = EXCLUDED.contract_value,
        billing_period = EXCLUDED.billing_period,
        installment_interval_months = EXCLUDED.installment_interval_months,
        initial_payment_amount = EXCLUDED.initial_payment_amount,
        partial_balance_due_date = EXCLUDED.partial_balance_due_date,
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
        tenantId,
        contract.tenant,
        contract.payment_status,
        contract.rental_invoice_scheme,
        contract.separate_utility_invoices,
        contract.start_date,
        contract.end_date,
        contract.contract_value,
        contract.billing_period,
        contract.installment_interval_months,
        contract.initial_payment_amount,
        contract.partial_balance_due_date,
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

    await syncUtilityPayments(client, contractId, contract);
    await syncInvoices(client, tenantId, contractId, contract);
    const clientAccount = await ensureClientAccount(
      client,
      tenantId,
      tenantRows[0].name,
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

    await client.query(
      `DELETE FROM custom_tenant_areas
       WHERE contract_id = $1::uuid
         AND room_id <> ALL($2::text[])`,
      [contractId, roomIds],
    );
    if (customArea) {
      await client.query(
        `INSERT INTO custom_tenant_areas (
          id, building_id, floor_id, room_id, contract_id, geometry, area_sqm,
          tenant_name, usage_type, status, rent_price
        ) VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::jsonb, $7, $8, $9, $10, $11)`,
        [
          randomUUID(),
          customArea.buildingId,
          customArea.floorId,
          customArea.roomId,
          contractId,
          JSON.stringify(customArea.geometry),
          customArea.areaSqm,
          customArea.tenantName,
          customArea.usageType,
          customArea.status,
          customArea.rentPrice,
        ],
      );
    } else if (hasCustomRooftopRoom) {
      const customRoom = rooms.find((room) => /^L11_CUSTOM_/i.test(room.room_id));
      const result = await client.query(
        `UPDATE custom_tenant_areas
         SET area_sqm = $3,
             tenant_name = $4,
             status = $5,
             rent_price = $6
         WHERE contract_id = $1::uuid AND room_id = $2`,
        [
          contractId,
          customRoom.room_id,
          customRoom.area_m2,
          contract.tenant,
          contract.occupancy_status === "in_progress" ? "NEGOSIASI" : "DISEWA",
          contract.contract_value,
        ],
      );
      if (!result.rowCount) {
        throw validationError("Custom rooftop area is no longer linked to this tenant contract.");
      }
    }

    await client.query("COMMIT");
    res.status(200).json({
      success: true,
      contract_id: contractId,
      tenant_id: tenantId,
      client_account: clientAccount,
      rooms,
    });
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
      `DELETE FROM custom_tenant_areas
       WHERE contract_id = $1::uuid AND room_id = $2`,
      [result.rows[0].contract_id, roomId],
    );
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
