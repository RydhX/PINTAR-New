const RENTAL_SCHEMES = Object.freeze({
  LUNAS: true,
  TERMIN: true,
  PARTIAL: true,
});

const MONTH_NAMES_ID = Object.freeze([
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
]);

function asMonthStart(value) {
  const text = String(value ?? "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (
    month < 1 ||
    month > 12 ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== text
  ) return null;
  return Date.UTC(year, month - 1, 1);
}

function monthDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function nextMonthDueDate(monthCountFromStart, startTimestamp) {
  const dueDate = new Date(startTimestamp);
  dueDate.setUTCMonth(dueDate.getUTCMonth() + monthCountFromStart);
  dueDate.setUTCDate(5);
  return dueDate.toISOString().slice(0, 10);
}

function moneyCents(value) {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error("Nominal invoice harus berupa angka non-negatif yang valid.");
  }
  const cents = Math.round(numeric * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new Error("Nominal invoice melebihi batas presisi yang didukung.");
  }
  return cents;
}

function fromMoneyCents(cents) {
  if (!Number.isSafeInteger(cents)) {
    throw new Error("Total invoice melebihi batas presisi yang didukung.");
  }
  return cents / 100;
}

function totalCents(monthlyRentCents, monthCount) {
  const total = monthlyRentCents * monthCount;
  if (!Number.isSafeInteger(total)) {
    throw new Error("Total sewa kontrak melebihi batas presisi yang didukung.");
  }
  return total;
}

function addMonths(timestamp, months) {
  const result = new Date(timestamp);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result.getTime();
}

function monthLabel(timestamp) {
  const date = new Date(timestamp);
  return `${MONTH_NAMES_ID[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function createInvoice({
  category,
  invoice_label,
  billing_month,
  billing_date,
  due_date,
  period_start,
  period_end,
  rent_amount = 0,
  electricity_amount = 0,
  telephone_amount = 0,
}) {
  return {
    category,
    invoice_label,
    billing_month,
    billing_date,
    due_date,
    period_start,
    period_end,
    rent_amount,
    electricity_amount,
    telephone_amount,
    paid_amount: 0,
  };
}

export function contractMonthCount(startDate, endDate) {
  const startTimestamp = asMonthStart(startDate);
  const endTimestamp = asMonthStart(endDate);
  if (startTimestamp === null || endTimestamp === null || endTimestamp < startTimestamp) {
    return 0;
  }
  const start = new Date(startTimestamp);
  const end = new Date(endTimestamp);
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() - start.getUTCMonth();
}

export function buildInvoiceSchedule(contract) {
  const startTimestamp = asMonthStart(contract.start_date);
  const endTimestamp = asMonthStart(contract.end_date);
  if (startTimestamp === null || endTimestamp === null || endTimestamp < startTimestamp) {
    return [];
  }

  const monthCount = contractMonthCount(contract.start_date, contract.end_date);
  if (monthCount < 1) return [];
  const scheme = contract.rental_invoice_scheme || "LUNAS";
  if (!Object.hasOwn(RENTAL_SCHEMES, scheme)) {
    throw new Error(`Skema invoice sewa tidak dikenal: ${scheme}.`);
  }

  const monthlyRentCents = moneyCents(contract.contract_value);
  const monthlyElectricityCents = moneyCents(contract.electricity_cost_rp);
  const monthlyTelephoneCents = moneyCents(contract.phone_cost_rp);
  const fullRentCents = totalCents(monthlyRentCents, monthCount);
  const startMonth = monthDate(startTimestamp);
  const endMonth = monthDate(addMonths(startTimestamp, monthCount - 1));
  const schedules = [];

  if (scheme === "LUNAS") {
    schedules.push(createInvoice({
      category: "SEWA",
      invoice_label: "Lunas di Awal",
      billing_month: startMonth,
      billing_date: contract.start_date,
      due_date: nextMonthDueDate(1, startTimestamp),
      period_start: startMonth,
      period_end: endMonth,
      rent_amount: fromMoneyCents(fullRentCents),
    }));
  } else if (scheme === "TERMIN") {
    const interval = Number(contract.installment_interval_months || 6);
    if (!Number.isInteger(interval) || ![1, 3, 6, 12].includes(interval)) {
      throw new Error("Interval termin harus 1, 3, 6, atau 12 bulan.");
    }

    for (let offset = 0, term = 1; offset < monthCount; offset += interval, term += 1) {
      const billedMonths = Math.min(interval, monthCount - offset);
      const periodStart = addMonths(startTimestamp, offset);
      const periodEnd = addMonths(periodStart, billedMonths - 1);
      const termRentCents = totalCents(monthlyRentCents, billedMonths);
      schedules.push(createInvoice({
        category: "SEWA",
        invoice_label: `Termin ${term}: ${monthLabel(periodStart)} - ${monthLabel(periodEnd)}`,
        billing_month: monthDate(periodStart),
        billing_date: offset === 0 ? contract.start_date : monthDate(periodStart),
        due_date: nextMonthDueDate(offset + billedMonths, startTimestamp),
        period_start: monthDate(periodStart),
        period_end: monthDate(periodEnd),
        rent_amount: fromMoneyCents(termRentCents),
      }));
    }
  } else {
    const initialPaymentCents = moneyCents(contract.initial_payment_amount);
    if (initialPaymentCents <= 0 || initialPaymentCents > fullRentCents) {
      throw new Error("Nominal DP harus lebih dari Rp0 dan tidak melebihi total sewa kontrak.");
    }
    if (asMonthStart(contract.partial_balance_due_date) === null) {
      throw new Error("Tanggal jatuh tempo pelunasan sisa wajib diisi.");
    }
    if (contract.partial_balance_due_date < contract.start_date) {
      throw new Error("Jatuh tempo pelunasan sisa tidak boleh sebelum tanggal mulai kontrak.");
    }

    schedules.push(createInvoice({
      category: "SEWA",
      invoice_label: "DP / Uang Muka",
      billing_month: startMonth,
      billing_date: contract.start_date,
      due_date: contract.start_date,
      period_start: startMonth,
      period_end: endMonth,
      rent_amount: fromMoneyCents(initialPaymentCents),
    }));
    schedules.push(createInvoice({
      category: "SEWA",
      invoice_label: "Pelunasan Sisa",
      billing_month: startMonth,
      billing_date: contract.start_date,
      due_date: contract.partial_balance_due_date,
      period_start: startMonth,
      period_end: endMonth,
      rent_amount: fromMoneyCents(fullRentCents - initialPaymentCents),
    }));
  }

  for (let offset = 0; offset < monthCount; offset += 1) {
    const billingTimestamp = addMonths(startTimestamp, offset);
    const billingMonth = monthDate(billingTimestamp);
    schedules.push(createInvoice({
      category: "UTILITAS",
      invoice_label: "Utilitas Bulanan",
      billing_month: billingMonth,
      billing_date: offset === 0 ? contract.start_date : billingMonth,
      due_date: nextMonthDueDate(offset + 1, startTimestamp),
      period_start: billingMonth,
      period_end: billingMonth,
      electricity_amount: fromMoneyCents(monthlyElectricityCents),
      telephone_amount: fromMoneyCents(monthlyTelephoneCents),
    }));
  }

  return schedules.sort((left, right) =>
    left.billing_month.localeCompare(right.billing_month) ||
    left.category.localeCompare(right.category) ||
    left.invoice_label.localeCompare(right.invoice_label),
  );
}

export function invoiceStatusLabel(status) {
  if (status === "LUNAS") return "Lunas";
  if (status === "SEBAGIAN") return "Sebagian";
  if (status === "MENUNGGAK") return "Menunggak";
  return "Belum dibayar";
}
