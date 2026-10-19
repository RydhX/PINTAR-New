import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUtilitySchedule } from "./utility-payments.js";

test("generates electricity and telephone schedules for exact contract months", () => {
  const schedule = buildUtilitySchedule({
    start_date: "2026-01-20",
    end_date: "2026-03-02",
    electricity_cost_rp: 125000,
    phone_cost_rp: 45000,
  });

  assert.equal(schedule.length, 4);
  assert.deepEqual(schedule.slice(0, 2), [
    {
      utility_type: "LISTRIK",
      billing_month: "2026-01-01",
      due_date: "2026-02-05",
      amount: 125000,
    },
    {
      utility_type: "TELEPON",
      billing_month: "2026-01-01",
      due_date: "2026-02-05",
      amount: 45000,
    },
  ]);
  assert.equal(schedule.at(-1).billing_month, "2026-02-01");
  assert.equal(schedule.at(-1).due_date, "2026-03-05");
});

test("creates only schedules for utility types with an entered monthly amount", () => {
  const schedule = buildUtilitySchedule({
    start_date: "2026-01-01",
    end_date: "2026-02-01",
    electricity_cost_rp: 0,
    phone_cost_rp: null,
  });

  assert.deepEqual(schedule, [{
    utility_type: "LISTRIK",
    billing_month: "2026-01-01",
    due_date: "2026-02-05",
    amount: 0,
  }]);
});

test("does not generate schedules without a valid contract duration", () => {
  assert.deepEqual(buildUtilitySchedule({
    start_date: "2026-03-01",
    end_date: "2026-02-28",
    electricity_cost_rp: 1,
    phone_cost_rp: 1,
  }), []);
  assert.deepEqual(buildUtilitySchedule({
    start_date: null,
    end_date: "2026-02-28",
    electricity_cost_rp: 1,
    phone_cost_rp: 1,
  }), []);
  assert.deepEqual(buildUtilitySchedule({
    start_date: "2026-01-01",
    end_date: "2026-01-31",
    electricity_cost_rp: 1,
    phone_cost_rp: 1,
  }), []);
});

test("does not add a utility month when a contract ends on its start-date anniversary", () => {
  const schedule = buildUtilitySchedule({
    start_date: "2026-11-01",
    end_date: "2029-11-01",
    electricity_cost_rp: 100000,
  });

  assert.equal(schedule.length, 36);
  assert.equal(schedule.at(-1).billing_month, "2029-10-01");
});
