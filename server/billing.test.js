import assert from "node:assert/strict";
import test from "node:test";
import { buildInvoiceSchedule } from "./billing.js";

const oneYear = {
  start_date: "2026-01-15",
  end_date: "2026-12-31",
  contract_value: 2500000,
  electricity_cost_rp: 150000,
  phone_cost_rp: 50000,
  separate_utility_invoices: true,
};

test("generates one LUNAS invoice for the whole contract duration", () => {
  const schedule = buildInvoiceSchedule({
    ...oneYear,
    start_date: "2026-01-15",
    end_date: "2028-12-31",
    rental_invoice_scheme: "LUNAS",
  });
  const rentals = schedule.filter((invoice) => invoice.category === "SEWA");

  assert.equal(rentals.length, 1);
  assert.equal(rentals[0].rent_amount, 90000000);
  assert.equal(rentals[0].electricity_amount, 0);
  assert.equal(rentals[0].period_start, "2026-01-01");
  assert.equal(rentals[0].period_end, "2028-12-01");
  assert.equal(rentals[0].due_date, "2026-02-05");
});

test("creates termin invoices using the selected monthly interval", () => {
  const expected = [
    [6, 2, 15000000],
    [3, 4, 7500000],
    [1, 12, 2500000],
  ];
  for (const [interval, count, amount] of expected) {
    const rentals = buildInvoiceSchedule({
      ...oneYear,
      rental_invoice_scheme: "TERMIN",
      installment_interval_months: interval,
    }).filter((invoice) => invoice.category === "SEWA");
    assert.equal(rentals.length, count, `${interval} month interval count`);
    assert.ok(rentals.every((invoice) => invoice.rent_amount === amount));
  }
});

test("separates monthly utility invoices from rent invoices when enabled", () => {
  const schedule = buildInvoiceSchedule({
    ...oneYear,
    rental_invoice_scheme: "TERMIN",
    installment_interval_months: 3,
  });
  const utilities = schedule.filter((invoice) => invoice.category === "UTILITAS");
  assert.equal(utilities.length, 12);
  assert.equal(utilities[0].electricity_amount, 150000);
  assert.equal(utilities[0].telephone_amount, 50000);
  assert.equal(utilities[0].due_date, "2026-02-05");
});

test("combines monthly utility charges into each rental period when selected", () => {
  const schedule = buildInvoiceSchedule({
    ...oneYear,
    rental_invoice_scheme: "TERMIN",
    installment_interval_months: 3,
    separate_utility_invoices: false,
  });
  assert.equal(schedule.length, 4);
  assert.equal(schedule[0].rent_amount, 7500000);
  assert.equal(schedule[0].electricity_amount, 450000);
  assert.equal(schedule[0].telephone_amount, 150000);
  assert.equal(schedule[0].due_date, "2026-04-05");
});

test("uses a final partial billing interval and handles missing or invalid dates", () => {
  const schedule = buildInvoiceSchedule({
    ...oneYear,
    end_date: "2026-08-01",
    rental_invoice_scheme: "TERMIN",
    installment_interval_months: 3,
    separate_utility_invoices: false,
  });
  assert.deepEqual(schedule.map((invoice) => invoice.rent_amount), [
    7500000,
    7500000,
    2500000,
  ]);
  assert.deepEqual(buildInvoiceSchedule({ start_date: null, end_date: null }), []);
  assert.deepEqual(
    buildInvoiceSchedule({ start_date: "2026-02-01", end_date: "2026-01-31" }),
    [],
  );
  assert.throws(
    () => buildInvoiceSchedule({ ...oneYear, rental_invoice_scheme: "WEEKLY" }),
    /tidak dikenal/,
  );
});

test("uses contract anniversaries to avoid billing an extra month", () => {
  const schedule = buildInvoiceSchedule({
    start_date: "2026-11-01",
    end_date: "2029-11-01",
    contract_value: 150000000,
    rental_invoice_scheme: "TERMIN",
    installment_interval_months: 6,
  });
  const rentals = schedule.filter((invoice) => invoice.category === "SEWA");

  assert.equal(rentals.length, 6);
  assert.equal(rentals[0].rent_amount, 900000000);
  assert.equal(rentals.at(-1).period_end, "2029-10-01");
  assert.equal(buildInvoiceSchedule({
    start_date: "2026-11-01",
    end_date: "2029-11-01",
    contract_value: 150000000,
    rental_invoice_scheme: "LUNAS",
  })[0].rent_amount, 5400000000);
});

test("creates a single partial invoice and records the initial down payment", () => {
  const schedule = buildInvoiceSchedule({
    ...oneYear,
    rental_invoice_scheme: "PARTIAL",
    initial_payment_amount: 5000000,
  });
  const rentals = schedule.filter((invoice) => invoice.category === "SEWA");

  assert.equal(rentals.length, 1);
  assert.equal(rentals[0].rent_amount, 30000000);
  assert.equal(rentals[0].paid_amount, 5000000);
  assert.throws(
    () => buildInvoiceSchedule({
      ...oneYear,
      rental_invoice_scheme: "PARTIAL",
      initial_payment_amount: 31000000,
    }),
    /melebihi total sewa/,
  );
});
