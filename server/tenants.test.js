import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://pintar:pintar_dev@localhost:5432/pintar";
const [{ normalizeContract, normalizeRooms, roomRecordForUser }, { pool }] = await Promise.all([
  import("./tenants.js"),
  import("./db.js"),
]);

after(() => pool.end());

function validContract(overrides = {}) {
  return {
    tenant: "Tenant Uji",
    occupancy_status: "occupied",
    payment_status: "Termin",
    contract_value: 1000000,
    installment_payments: '[{"term":1,"amount":250000}]',
    ...overrides,
  };
}

test("normalizes numeric and installment contract input", () => {
  const contract = normalizeContract(validContract({
    electricity_cost_rp: "1250000",
    electricity_kwh: "480.5",
    start_date: "2026-01-31",
  }));

  assert.equal(contract.electricity_cost_rp, 1250000);
  assert.equal(contract.electricity_kwh, 480.5);
  assert.equal(contract.start_date, "2026-01-31");
  assert.equal(contract.rental_invoice_scheme, "LUNAS");
  assert.equal(contract.payment_status, "Lunas");
  assert.equal(contract.separate_utility_invoices, true);
  assert.deepEqual(JSON.parse(contract.installment_payments), [
    { term: 1, amount: 250000 },
  ]);
});

test("normalizes the three rental invoice schemes and utility separation", () => {
  const contract = normalizeContract(validContract({
    rental_invoice_scheme: "TERMIN",
    installment_interval_months: 3,
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    separate_utility_invoices: false,
  }));

  assert.equal(contract.rental_invoice_scheme, "TERMIN");
  assert.equal(contract.payment_status, "Termin");
  assert.equal(contract.separate_utility_invoices, false);
});

test("rejects invalid calendar dates and payment states", () => {
  assert.throws(
    () => normalizeContract(validContract({ end_date: "2026-02-30" })),
    /valid calendar date/,
  );
  assert.throws(
    () => normalizeContract(validContract({ rental_invoice_scheme: "WEEKLY" })),
    /Skema invoice sewa/,
  );
  assert.throws(
    () => normalizeContract(validContract({ separate_utility_invoices: "false" })),
    /must be a boolean/,
  );
  assert.throws(
    () => normalizeContract(validContract({
      rental_invoice_scheme: "TERMIN",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
      installment_interval_months: 1,
      contract_value: 300000,
      installment_payments: '[{"term":1,"amount":2500000},{"term":2,"amount":1200000}]',
    })),
    /melebihi nilai kontrak/,
  );
  assert.throws(
    () => normalizeContract(validContract({
      installment_payments: '[{"term":1,"amount":100000},{"term":1,"amount":100000}]',
    })),
    /duplicated/,
  );
  assert.throws(
    () => normalizeContract(validContract({
      start_date: "2026-03-01",
      end_date: "2026-02-28",
    })),
    /on or after start_date/,
  );
  assert.equal(
    normalizeContract(validContract({ payment_status: "Unknown" })).payment_status,
    "Lunas",
  );
});

test("validates Partial down payment against full contract rent", () => {
  const contract = normalizeContract(validContract({
    rental_invoice_scheme: "PARTIAL",
    start_date: "2026-11-01",
    end_date: "2029-11-01",
    contract_value: 150000000,
    initial_payment_amount: 500000000,
    partial_payment_schedule: "Sisa dibayar dalam dua termin.",
  }));
  assert.equal(contract.payment_status, "Partial Paid");
  assert.equal(contract.initial_payment_amount, 500000000);
  assert.throws(
    () => normalizeContract(validContract({
      rental_invoice_scheme: "PARTIAL",
      start_date: "2026-11-01",
      end_date: "2029-11-01",
      contract_value: 150000000,
      initial_payment_amount: 5400000001,
      partial_payment_schedule: "Jadwal pelunasan.",
    })),
    /tidak melebihi total sewa kontrak/,
  );
});

test("validates unique selected rooms and per-room area", () => {
  const contract = normalizeContract(validContract());
  const rooms = normalizeRooms({
    building: "GKP",
    floor: "L2",
    rooms: [
      { room_id: "L2_R01", area_m2: "25.5" },
      { room_id: "L2_R02", area_m2: "30" },
    ],
  }, contract);

  assert.deepEqual(rooms.map((room) => room.area_m2), [25.5, 30]);
  assert.throws(
    () => normalizeRooms({
      building: "GKP",
      floor: "L2",
      rooms: [{ room_id: "L2_R01" }, { room_id: "L2_R01" }],
    }, contract),
    /duplicated/,
  );
});

test("redacts occupied room tenant details from other client accounts", () => {
  const record = {
    building: "GKP",
    floor: "L2",
    room_id: "L2_R02",
    contract_id: "contract-id",
    occupancy_status: "occupied",
    area_m2: 25,
    tenant: "Tenant Lain",
    payment_status: "Termin",
    contact: "private contact",
  };

  assert.deepEqual(
    roomRecordForUser(record, { role: "client", tenantName: "PT Coba" }),
    {
      building: "GKP",
      floor: "L2",
      room_id: "L2_R02",
      occupancy_status: "occupied",
      area_m2: 25,
    },
  );
  assert.equal(
    roomRecordForUser(record, { role: "client", tenantName: "Tenant Lain" }).tenant,
    "Tenant Lain",
  );
  assert.equal(roomRecordForUser(record, { role: "internal" }).contact, "private contact");
});
