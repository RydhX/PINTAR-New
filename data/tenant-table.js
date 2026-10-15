const TenantTable = (() => {
  const state = {
    page: 1,
    pageSize: 25,
    sortBy: "tenantName",
    sortDir: "asc",
    paymentScheme: "",
    totalPages: 0,
    controller: null,
    requestId: 0,
  };
  const rowsEl = document.getElementById("tenantTableRows");
  const statusEl = document.getElementById("tenantTableStatus");
  const pageLabelEl = document.getElementById("tenantTablePage");
  const previousButton = document.getElementById("tenantPreviousPage");
  const nextButton = document.getElementById("tenantNextPage");
  const paymentFilter = document.getElementById("tenantPaymentFilter");
  const sortSelect = document.getElementById("tenantSort");
  const currency = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  });
  const decimal = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
  const mockFinancialDetails = {
    contractValue: 100_000_000,
    remainingBalance: 30_000_000,
  };

  function addCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = value ?? "-";
    row.appendChild(cell);
    return cell;
  }

  function addPaymentSchemeCell(row, paymentScheme) {
    const cell = document.createElement("td");
    const badge = document.createElement("span");
    const scheme = paymentScheme || "-";
    const schemeClass = {
      lunas: "is-paid",
      tunggakan: "is-overdue",
      termin: "is-installment",
      "partial paid": "is-installment",
    }[scheme.toLocaleLowerCase("id-ID")];

    badge.className = `tenant-payment-badge${schemeClass ? ` ${schemeClass}` : ""}`;
    badge.textContent = scheme;
    cell.appendChild(badge);
    row.appendChild(cell);
  }

  function getFinancialDetails(record) {
    const contractValue = Number.isFinite(record.contractValue)
      ? record.contractValue
      : mockFinancialDetails.contractValue;
    const paidAmount = record.paymentScheme === "Termin"
      ? (record.installmentPayments || []).reduce(
        (total, installment) => total + (Number(installment.amount) || 0),
        0,
      )
      : Number(record.initialPaymentAmount) || 0;
    const remainingBalance = record.paymentScheme === "Lunas"
      ? 0
      : Number.isFinite(record.contractValue)
        ? Math.max(0, contractValue - paidAmount)
        : mockFinancialDetails.remainingBalance;

    return { contractValue, remainingBalance };
  }

  function renderRows(records) {
    rowsEl.replaceChildren();
    records.forEach((record) => {
      const row = document.createElement("tr");
      const financialDetails = getFinancialDetails(record);
      addCell(row, record.tenantName);
      addCell(row, record.contact);
      addPaymentSchemeCell(row, record.paymentScheme);
      addCell(row, currency.format(financialDetails.contractValue));
      addCell(
        row,
        financialDetails.remainingBalance > 0
          ? `${currency.format(financialDetails.remainingBalance)} (Sisa tagihan)`
          : currency.format(0),
      );
      addCell(row, record.electricityCostRp == null ? "-" : currency.format(record.electricityCostRp));
      addCell(row, record.electricityKwh == null ? "-" : decimal.format(record.electricityKwh));
      addCell(row, record.phoneCostRp == null ? "-" : currency.format(record.phoneCostRp));
      addCell(row, record.endDate || "-");
      const actionCell = addCell(row, "");
      const button = document.createElement("button");
      button.className = "tenant-table-action";
      button.type = "button";
      button.textContent = "Lihat";
      button.disabled = !record.firstRoom;
      button.addEventListener("click", () => {
        document.dispatchEvent(
          new CustomEvent("pintar:open-room", {
            detail: { ...record.firstRoom },
          }),
        );
      });
      actionCell.appendChild(button);
      rowsEl.appendChild(row);
    });
  }

  function queryString(page = state.page, pageSize = state.pageSize) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortBy: state.sortBy,
      sortDir: state.sortDir,
    });
    if (state.paymentScheme) params.set("paymentScheme", state.paymentScheme);
    return params;
  }

  async function refresh() {
    const requestId = ++state.requestId;
    state.controller?.abort();
    state.controller = new AbortController();
    rowsEl.replaceChildren();
    statusEl.textContent = "Memuat data tenant…";
    statusEl.className = "tenant-table-status is-loading";
    try {
      const response = await fetch(`/api/tenants?${queryString()}`, {
        signal: state.controller.signal,
        headers: Auth.headers(),
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Gagal memuat data tenant.");
      if (requestId !== state.requestId) return;

      renderRows(payload.records);
      state.totalPages = payload.meta.totalPages;
      statusEl.textContent = payload.records.length
        ? `${payload.meta.totalRecords} tenant ditemukan.`
        : "Belum ada data tenant yang sesuai.";
      statusEl.className = "tenant-table-status";
      pageLabelEl.textContent =
        `Halaman ${payload.meta.totalPages ? payload.meta.page : 0} dari ${payload.meta.totalPages}`;
      previousButton.disabled = state.page <= 1 || !state.totalPages;
      nextButton.disabled = state.page >= state.totalPages || !state.totalPages;
    } catch (error) {
      if (error.name === "AbortError" || requestId !== state.requestId) return;
      rowsEl.replaceChildren();
      statusEl.textContent = `Gagal memuat data tenant: ${error.message}`;
      statusEl.className = "tenant-table-status is-error";
      pageLabelEl.textContent = "Data tidak tersedia";
      previousButton.disabled = true;
      nextButton.disabled = true;
    } finally {
      if (requestId === state.requestId) state.controller = null;
    }
  }

  async function getAllFilteredRecords() {
    const pageSize = 100;
    const firstParams = queryString(1, pageSize);
    const firstResponse = await fetch(`/api/tenants?${firstParams}`, {
      headers: Auth.headers(),
      cache: "no-store",
    });
    const firstPayload = await firstResponse.json();
    if (!firstResponse.ok) throw new Error(firstPayload.error || "Gagal mengambil data ekspor.");
    const records = [...firstPayload.records];

    for (let page = 2; page <= firstPayload.meta.totalPages; page += 1) {
      const response = await fetch(`/api/tenants?${queryString(page, pageSize)}`, {
        headers: Auth.headers(),
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Gagal mengambil halaman ${page}.`);
      records.push(...payload.records);
    }
    return records;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportCsv() {
    const records = await getAllFilteredRecords();
    const headers = [
      "Nama Tenant", "Kontak Client", "Skema Pembayaran", "Nilai Kontrak (Rp)",
      "Sisa Tagihan (Rp)", "Biaya Listrik (Rp)", "Listrik (kWh)",
      "Biaya Telepon (Rp)", "Akhir Kontrak", "Ruangan",
    ];
    const quote = (value) => {
      let text = value == null ? "" : String(value);
      if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const lines = [
      headers.map(quote).join(","),
      ...records.map((record) => {
        const financialDetails = getFinancialDetails(record);
        return [
          record.tenantName,
          record.contact,
          record.paymentScheme,
          financialDetails.contractValue,
          financialDetails.remainingBalance,
          record.electricityCostRp,
          record.electricityKwh,
          record.phoneCostRp,
          record.endDate,
          record.rooms.join(", "),
        ].map(quote).join(",");
      }),
    ];
    downloadBlob(new Blob(["\uFEFF", lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }), "data-tenant.csv");
  }

  async function exportXlsx() {
    if (!globalThis.XLSX) throw new Error("Library XLSX belum berhasil dimuat.");
    const records = await getAllFilteredRecords();
    const headers = [
      "Nama Tenant", "Kontak Client", "Skema Pembayaran", "Nilai Kontrak (Rp)",
      "Sisa Tagihan (Rp)", "Biaya Listrik (Rp)", "Listrik (kWh)",
      "Biaya Telepon (Rp)", "Akhir Kontrak", "Ruangan",
    ];
    const rows = records.map((record) => {
      const financialDetails = getFinancialDetails(record);
      return [
        record.tenantName,
        record.contact,
        record.paymentScheme,
        financialDetails.contractValue,
        financialDetails.remainingBalance,
        record.electricityCostRp,
        record.electricityKwh,
        record.phoneCostRp,
        record.endDate ? new Date(`${record.endDate}T00:00:00`) : null,
        record.rooms.join(", "),
      ];
    });
    const worksheet = globalThis.XLSX.utils.aoa_to_sheet([headers, ...rows], {
      cellDates: true,
    });
    for (let row = 2; row <= rows.length + 1; row += 1) {
      for (const column of ["D", "E", "F", "H"]) {
        const cell = worksheet[`${column}${row}`];
        if (cell && typeof cell.v === "number") cell.z = '"Rp" #,##0.00';
      }
      const kwhCell = worksheet[`G${row}`];
      if (kwhCell && typeof kwhCell.v === "number") kwhCell.z = "#,##0.000";
      const dateCell = worksheet[`I${row}`];
      if (dateCell?.t === "d") dateCell.z = "dd/mm/yyyy";
    }
    const workbook = globalThis.XLSX.utils.book_new();
    globalThis.XLSX.utils.book_append_sheet(workbook, worksheet, "Tenant");
    globalThis.XLSX.writeFile(workbook, "data-tenant.xlsx");
  }

  async function runExport(exporter) {
    const buttons = [
      document.getElementById("tenantExportCsv"),
      document.getElementById("tenantExportXlsx"),
    ];
    buttons.forEach((button) => { button.disabled = true; });
    statusEl.textContent = "Menyiapkan file ekspor…";
    try {
      await exporter();
      statusEl.textContent = "File berhasil diekspor.";
    } catch (error) {
      statusEl.textContent = `Ekspor gagal: ${error.message}`;
      statusEl.className = "tenant-table-status is-error";
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  paymentFilter.addEventListener("change", () => {
    state.paymentScheme = paymentFilter.value;
    state.page = 1;
    void refresh();
  });
  sortSelect.addEventListener("change", () => {
    [state.sortBy, state.sortDir] = sortSelect.value.split(":");
    state.page = 1;
    void refresh();
  });
  previousButton.addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      void refresh();
    }
  });
  nextButton.addEventListener("click", () => {
    if (state.page < state.totalPages) {
      state.page += 1;
      void refresh();
    }
  });
  document.getElementById("tenantExportCsv").addEventListener("click", () => {
    void runExport(exportCsv);
  });
  document.getElementById("tenantExportXlsx").addEventListener("click", () => {
    void runExport(exportXlsx);
  });
  window.addEventListener("pintar:data-changed", () => void refresh());

  return Object.freeze({ refresh });
})();
