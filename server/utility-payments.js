const UTILITY_TYPES = Object.freeze([
  { type: "LISTRIK", amountField: "electricity_cost_rp" },
  { type: "TELEPON", amountField: "phone_cost_rp" },
]);

function monthStart(date) {
  return `${date.slice(0, 7)}-01`;
}

function touchedMonthCount(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const difference =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() -
    start.getUTCMonth();
  return Math.max(1, difference + (end.getUTCDate() === start.getUTCDate() ? 0 : 1));
}

export function buildUtilitySchedule(contract, dueDay = 5) {
  const { start_date: startDate, end_date: endDate } = contract;
  if (!startDate || !endDate || endDate < startDate) return [];

  const firstMonth = monthStart(startDate);
  const monthCount = touchedMonthCount(startDate, endDate);
  const schedule = [];
  const cursor = new Date(`${firstMonth}T00:00:00.000Z`);

  for (let offset = 0; offset < monthCount; offset += 1) {
    const billingMonth = cursor.toISOString().slice(0, 10);
    const dueDateValue = new Date(`${billingMonth}T00:00:00.000Z`);
    dueDateValue.setUTCMonth(dueDateValue.getUTCMonth() + 1);
    dueDateValue.setUTCDate(dueDay);
    const dueDate = dueDateValue.toISOString().slice(0, 10);
    for (const { type, amountField } of UTILITY_TYPES) {
      const amount = contract[amountField];
      if (amount === null || amount === undefined || amount === "") continue;
      schedule.push({ utility_type: type, billing_month: billingMonth, due_date: dueDate, amount });
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return schedule;
}
