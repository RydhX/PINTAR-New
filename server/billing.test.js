import assert from "node:assert/strict";
import test from "node:test";
import { buildInvoiceSchedule, contractMonthCount } from "./billing.js";

const oneYear = {
  start_date: "2026-01-01",
  end_date: "2027-01-01",
  contract_value: 2500000,
  electricity_cost_rp: 150000,
  phone_cost_rp: 50000,
};

test("counts exact calendar-month durations without an anniversary extra month", () => {
  assert.equal(contractMonthCount("2026-11-01", "2029-11-01"), 36);
  assert.equal(contractMonthCount("2026-01-01", "2027-01-01"), 12);
  assert.equal(contractMonthCount("2026-01-15", "2026-12-31"), 11);
  assert.equal(contractMonthCount("2026-01-01", "2026-01-31"), 0);
  assert.equal(contractMonthCount("2026-03-01", "2026-02-28"), 0);
});

test("generates one full rental invoice and twelve separate utility invoices for LUNAS", () => {
  const schedule = buildInvoiceSchedule({
    ...oneYear,
    rental_invoice_scheme: "LUNAS",
  });
  const rentals = schedule.filter((invoice) => invoice.category === "SEWA");
  const utilities = schedule.filter((invoice) => invoice.category === "UTILITAS");

  assert.equal(rentals.length, 1);
  assert.equal(rentals[0].invoice_label, "Lunas di Awal");
  assert.equal(rentals[0].rent_amount, 30000000);
  assert.equal(rentals[0].electricity_amount, 0);
  assert.equal(rentals[0].paid_amount, 0);
  assert.equal(rentals[0].period_start, "2026-01-01");
  assert.equal(rentals[0].period_end, "2026-12-01");
  assert.equal(utilities.length, 12);
  assert.equal(utilities[0].electricity_amount, 150000);
  assert.equal(utilities[0].telephone_amount, 50000);
  assert.equal(utilities[0].due_date, "2026-02-05");
});

test("generates rental terms for the supported intervals and exact term amounts", () => {
  const expected = [
    [6, 2, 15000000],
    [3, 4, 7500000],
    [1, 12, 2500000],
    [12, 1, 30000000],
  ];
  for (const [interval, count, amount] of expected) {
    const schedule = buildInvoiceSchedule({
      ...oneYear,
      rental_invoice_scheme: "TERMIN",
      installment_interval_months: interval,
    });
    const rentals = schedule.filter((invoice) => invoice.category === "SEWA");
    const utilities = schedule.filter((invoice) => invoice.category === "UTILITAS");
    assert.equal(rentals.length, count, `${interval} month interval count`);
    assert.ok(rentals.every((invoice) => invoice.rent_amount === amount));
    assert.equal(utilities.length, 12);
  }
});

test("uses only remaining months for a final partial termin", () => {
  const rentals = buildInvoiceSchedule({
    start_date: "2026-01-01",
    end_date: "2027-03-01",
    contract_value: 2500000,
    rental_invoice_scheme: "TERMIN",
    installment_interval_months: 6,
  }).filter((invoice) => invoice.category === "SEWA");

  assert.deepEqual(rentals.map((invoice) => invoice.rent_amount), [
    15000000,
    15000000,
    5000000,
  ]);
  assert.deepEqual(rentals.map((invoice) => invoice.invoice_label), [
    "Termin 1: Jan 2026 - Jun 2026",
    "Termin 2: Jul 2026 - Des 2026",
    "Termin 3: Jan 2027 - Feb 2027",
  ]);
});

test("always creates separate monthly utility invoices even for legacy combined settings", () => {
  const schedule = buildInvoiceSchedule({
    ...oneYear,
    rental_invoice_scheme: "TERMIN",
    installment_interval_months: 3,
    separate_utility_invoices: false,
  });
  const rentals = schedule.filter((invoice) => invoice.category === "SEWA");
  const utilities = schedule.filter((invoice) => invoice.category === "UTILITAS");

  assert.equal(rentals.length, 4);
  assert.equal(rentals[0].electricity_amount, 0);
  assert.equal(rentals[0].telephone_amount, 0);
  assert.equal(utilities.length, 12);
});

test("creates one zero-valued utility invoice for every month when no utility charges are entered", () => {
  const utilities = buildInvoiceSchedule({
    start_date: "2026-11-01",
    end_date: "2027-11-01",
    contract_value: 150000000,
    rental_invoice_scheme: "LUNAS",
  }).filter((invoice) => invoice.category === "UTILITAS");

  assert.equal(utilities.length, 12);
  assert.ok(utilities.every((invoice) =>
    invoice.electricity_amount === 0 && invoice.telephone_amount === 0
  ));
});

test("generates exactly six rental and 36 utility invoices for a three-year six-month schedule", () => {
  const schedule = buildInvoiceSchedule({
    start_date: "2026-11-01",
    end_date: "2029-11-01",
    contract_value: 150000000,
    electricity_cost_rp: 175000,
    phone_cost_rp: 25000,
    rental_invoice_scheme: "TERMIN",
    installment_interval_months: 6,
  });
  const rentals = schedule.filter((invoice) => invoice.category === "SEWA");
  const utilities = schedule.filter((invoice) => invoice.category === "UTILITAS");

  assert.equal(schedule.length, 42);
  assert.equal(rentals.length, 6);
  assert.equal(utilities.length, 36);
  assert.equal(rentals[0].rent_amount, 900000000);
  assert.equal(rentals.at(-1).period_end, "2029-10-01");
  assert.equal(rentals.reduce((total, invoice) => total + invoice.rent_amount, 0), 5400000000);
  assert.equal(utilities.at(-1).billing_month, "2029-10-01");
});

test("creates separate unpaid DP and remaining-balance invoices with selected due dates", () => {
  const schedule = buildInvoiceSchedule({
    ...oneYear,
    rental_invoice_scheme: "PARTIAL",
    initial_payment_amount: 5000000,
    partial_balance_due_date: "2026-07-15",
  });
  const rentals = schedule.filter((invoice) => invoice.category === "SEWA");

  assert.equal(rentals.length, 2);
  assert.equal(rentals[0].invoice_label, "DP / Uang Muka");
  assert.equal(rentals[0].rent_amount, 5000000);
  assert.equal(rentals[0].due_date, "2026-01-01");
  assert.equal(rentals[0].paid_amount, 0);
  assert.equal(rentals[1].invoice_label, "Pelunasan Sisa");
  assert.equal(rentals[1].rent_amount, 25000000);
  assert.equal(rentals[1].due_date, "2026-07-15");
  assert.equal(rentals[1].paid_amount, 0);
});

test("rejects invalid scheme inputs and partial-payment dates or amounts", () => {
  assert.deepEqual(buildInvoiceSchedule({ start_date: null, end_date: null }), []);
  assert.deepEqual(
    buildInvoiceSchedule({ start_date: "2026-02-01", end_date: "2026-01-31" }),
    [],
  );
  assert.deepEqual(
    buildInvoiceSchedule({ start_date: "2026-01-01", end_date: "2026-01-31" }),
    [],
  );
  assert.throws(
    () => buildInvoiceSchedule({ ...oneYear, rental_invoice_scheme: "WEEKLY" }),
    /tidak dikenal/,
  );
  assert.throws(
    () => buildInvoiceSchedule({
      ...oneYear,
      rental_invoice_scheme: "TERMIN",
      installment_interval_months: 2,
    }),
    /1, 3, 6, atau 12/,
  );
  assert.throws(
    () => buildInvoiceSchedule({
      ...oneYear,
      rental_invoice_scheme: "PARTIAL",
      initial_payment_amount: 31000000,
      partial_balance_due_date: "2026-07-15",
    }),
    /tidak melebihi total sewa kontrak/,
  );
  assert.throws(
    () => buildInvoiceSchedule({
      ...oneYear,
      rental_invoice_scheme: "PARTIAL",
      initial_payment_amount: 5000000,
    }),
    /Tanggal jatuh tempo/,
  );
  assert.throws(
    () => buildInvoiceSchedule({
      ...oneYear,
      rental_invoice_scheme: "PARTIAL",
      initial_payment_amount: 5000000,
      partial_balance_due_date: "2025-12-31",
    }),
    /tidak boleh sebelum/,
  );
  assert.throws(
    () => buildInvoiceSchedule({
      ...oneYear,
      rental_invoice_scheme: "PARTIAL",
      initial_payment_amount: 5000000,
      partial_balance_due_date: "2026-02-30",
    }),
    /Tanggal jatuh tempo/,
  );
});
