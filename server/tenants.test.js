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
  assert.deepEqual(JSON.parse(contract.installment_payments), [
    { term: 1, amount: 250000 },
  ]);
});

test("rejects invalid calendar dates and payment states", () => {
  assert.throws(
    () => normalizeContract(validContract({ end_date: "2026-02-30" })),
    /valid calendar date/,
  );
  assert.throws(
    () => normalizeContract(validContract({ payment_status: "Unknown" })),
    /Skema pembayaran/,
  );
  assert.throws(
    () => normalizeContract(validContract({
      contract_value: 300000,
      installment_payments: '[{"term":1,"amount":250000},{"term":2,"amount":100000}]',
    })),
    /melebihi nilai kontrak/,
  );
  assert.throws(
    () => normalizeContract(validContract({
      installment_payments: '[{"term":1,"amount":100000},{"term":1,"amount":100000}]',
    })),
    /duplicated/,
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
