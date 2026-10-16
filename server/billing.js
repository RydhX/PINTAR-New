const RENTAL_SCHEMES = Object.freeze({
  LUNAS: 0,
  TERMIN: null,
  PARTIAL: 0,
});

function asMonthStart(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(value));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, 1);
}

function monthDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function nextMonthDueDate(monthCountFromStart, startTimestamp) {
  const nextMonth = new Date(startTimestamp);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + monthCountFromStart);
  nextMonth.setUTCDate(5);
  return nextMonth.toISOString().slice(0, 10);
}

function amount(value) {
  const result = Number(value || 0);
  return Number.isFinite(result) && result >= 0 ? result : 0;
}

export function contractMonthCount(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const calendarMonthDifference =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() -
    start.getUTCMonth();
  return Math.max(
    1,
    calendarMonthDifference + (end.getUTCDate() > start.getUTCDate() ? 1 : 0),
  );
}

export function buildInvoiceSchedule(contract) {
  const startTimestamp = asMonthStart(contract.start_date);
  const endTimestamp = asMonthStart(contract.end_date);
  if (startTimestamp === null || endTimestamp === null || endTimestamp < startTimestamp) {
    return [];
  }

  const monthCount = contractMonthCount(contract.start_date, contract.end_date);
  const scheme = contract.rental_invoice_scheme || "LUNAS";
  if (!Object.hasOwn(RENTAL_SCHEMES, scheme)) {
    throw new Error(`Skema invoice sewa tidak dikenal: ${scheme}.`);
  }

  const monthlyRent = amount(contract.contract_value);
  const monthlyElectricity = amount(contract.electricity_cost_rp);
  const monthlyTelephone = amount(contract.phone_cost_rp);
  const separateUtilities = contract.separate_utility_invoices !== false;
  const schedules = [];
  const interval = scheme === "TERMIN"
    ? Number(contract.installment_interval_months || 6)
    : monthCount;
  if (
    scheme === "TERMIN" &&
    (!Number.isInteger(interval) || interval < 1 || interval > 12)
  ) {
    throw new Error("Interval termin harus berupa bilangan bulat dari 1 sampai 12 bulan.");
  }

  if (scheme !== "TERMIN") {
    const initialPaidAmount = scheme === "PARTIAL"
      ? amount(contract.initial_payment_amount)
      : 0;
    const contractRent = monthlyRent * monthCount;
    if (initialPaidAmount > contractRent) {
      throw new Error("Nominal DP melebihi total sewa kontrak.");
    }
    schedules.push({
      category: "SEWA",
      billing_month: monthDate(startTimestamp),
      billing_date: contract.start_date,
      due_date: nextMonthDueDate(1, startTimestamp),
      period_start: monthDate(startTimestamp),
      period_end: monthDate(endTimestamp),
      rent_amount: contractRent,
      electricity_amount: separateUtilities ? 0 : monthlyElectricity * monthCount,
      telephone_amount: separateUtilities ? 0 : monthlyTelephone * monthCount,
      paid_amount: initialPaidAmount,
    });
  } else {
    for (let offset = 0; offset < monthCount; offset += interval) {
      const billedMonths = Math.min(interval, monthCount - offset);
      const periodStart = new Date(startTimestamp);
      periodStart.setUTCMonth(periodStart.getUTCMonth() + offset);
      const periodEnd = new Date(periodStart);
      periodEnd.setUTCMonth(periodEnd.getUTCMonth() + billedMonths - 1);
      schedules.push({
        category: "SEWA",
        billing_month: monthDate(periodStart.getTime()),
        billing_date: offset === 0 ? contract.start_date : monthDate(periodStart.getTime()),
        due_date: nextMonthDueDate(offset + billedMonths, startTimestamp),
        period_start: monthDate(periodStart.getTime()),
        period_end: monthDate(periodEnd.getTime()),
        rent_amount: monthlyRent * billedMonths,
        electricity_amount: separateUtilities ? 0 : monthlyElectricity * billedMonths,
        telephone_amount: separateUtilities ? 0 : monthlyTelephone * billedMonths,
        paid_amount: 0,
      });
    }
  }

  if (separateUtilities && (monthlyElectricity > 0 || monthlyTelephone > 0)) {
    for (let offset = 0; offset < monthCount; offset += 1) {
      const billingMonth = new Date(startTimestamp);
      billingMonth.setUTCMonth(billingMonth.getUTCMonth() + offset);
      schedules.push({
        category: "UTILITAS",
        billing_month: monthDate(billingMonth.getTime()),
        billing_date: offset === 0 ? contract.start_date : monthDate(billingMonth.getTime()),
        due_date: nextMonthDueDate(offset + 1, startTimestamp),
        period_start: monthDate(billingMonth.getTime()),
        period_end: monthDate(billingMonth.getTime()),
        rent_amount: 0,
        electricity_amount: monthlyElectricity,
        telephone_amount: monthlyTelephone,
        paid_amount: 0,
      });
    }
  }

  return schedules.sort((left, right) =>
    left.billing_month.localeCompare(right.billing_month) ||
    left.category.localeCompare(right.category),
  );
}

export function invoiceStatusLabel(status) {
  if (status === "LUNAS") return "Lunas";
  if (status === "SEBAGIAN") return "Sebagian";
  if (status === "MENUNGGAK") return "Menunggak";
  return "Belum dibayar";
}
