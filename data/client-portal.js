const ClientPortal = (() => {
  const statusEl = document.getElementById("clientPortalStatus");
  const tenantEl = document.getElementById("clientPortalTenant");
  const detailsEl = document.getElementById("clientTenantDetails");
  const invoicesEl = document.getElementById("clientInvoiceRows");
  const workspaceEl = document.getElementById("workspaceLayout");
  const invoicePageEl = document.getElementById("invoicePage");
  const invoiceItemRowsEl = document.getElementById("invoiceItemRows");
  const printButton = document.getElementById("invoicePrintButton");
  const backButton = document.getElementById("invoiceBackButton");
  const currency = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  });
  const dateFormatter = new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const periodFormatter = new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
  });
  let tenantRecords = [];
  let invoiceRecords = [];
  let lastInvoiceAction = null;

  function readAmount(value, label) {
    const amount = value == null ? 0 : Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`Nilai ${label} pada invoice tidak valid.`);
    }
    return amount;
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : dateFormatter.format(date);
  }

  function formatPeriod(value) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(value));
    if (!match) return String(value || "-");
    const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    return periodFormatter.format(date);
  }

  function recordsForInvoice() {
    const tenantName = Auth.currentUser?.tenantName;
    return tenantRecords.filter((record) => record.tenantName === tenantName);
  }

  function invoiceTotal(invoice) {
    const records = recordsForInvoice();
    const utilitiesTotal = records.reduce(
      (total, record) =>
        total +
        readAmount(record.electricityCostRp, "listrik") +
        readAmount(record.phoneCostRp, "telepon"),
      0,
    );
    return readAmount(invoice.amountRp, "tagihan sewa") + utilitiesTotal;
  }

  function setInvoiceText(id, value) {
    document.getElementById(id).textContent = value == null || value === "" ? "-" : String(value);
  }

  function addInvoiceItem(description, quantity, unitPrice) {
    const row = document.createElement("tr");
    [description, quantity, currency.format(unitPrice), currency.format(unitPrice)].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    invoiceItemRowsEl.appendChild(row);
  }

  function showInvoice(invoice, actionButton) {
    const tenantName = Auth.currentUser?.tenantName;
    const associatedRecords = recordsForInvoice();
    const tenant = associatedRecords[0];
    if (!tenant) {
      throw new Error("Data tenant untuk invoice ini tidak tersedia.");
    }

    const period = formatPeriod(invoice.period);
    const rentAmount = readAmount(invoice.amountRp, "tagihan sewa");
    const electricityAmount = associatedRecords.reduce(
      (total, record) => total + readAmount(record.electricityCostRp, "listrik"),
      0,
    );
    const phoneAmount = associatedRecords.reduce(
      (total, record) => total + readAmount(record.phoneCostRp, "telepon"),
      0,
    );
    const electricityUsage = associatedRecords.reduce(
      (total, record) => total + readAmount(record.electricityKwh, "pemakaian listrik"),
      0,
    );
    const subtotal = rentAmount + electricityAmount + phoneAmount;
    const rooms = associatedRecords.flatMap((record) => record.rooms || []);

    invoiceItemRowsEl.replaceChildren();
    addInvoiceItem(`Biaya sewa / angsuran kontrak — ${period}`, "1 periode", rentAmount);
    addInvoiceItem(`Biaya listrik (${new Intl.NumberFormat("id-ID").format(electricityUsage)} kWh)`, "1 layanan", electricityAmount);
    addInvoiceItem("Biaya telepon", "1 layanan", phoneAmount);

    setInvoiceText("invoiceNumber", invoice.invoiceId);
    setInvoiceText("invoiceDate", dateFormatter.format(new Date()));
    setInvoiceText("invoiceDueDate", formatDate(invoice.dueDate));
    setInvoiceText("invoiceTenantName", tenant.tenantName || tenantName);
    setInvoiceText("invoiceTenantPic", tenant.pic ? `PIC: ${tenant.pic}` : "");
    setInvoiceText("invoiceTenantContact", tenant.contact ? `Kontak: ${tenant.contact}` : "");
    setInvoiceText("invoicePeriod", period);
    setInvoiceText("invoiceRoomDetails", rooms.length ? `Lokasi / ruang: ${rooms.join(", ")}` : "");
    setInvoiceText("invoiceStatus", invoice.status);
    document.getElementById("invoiceStatus").classList.toggle(
      "is-paid",
      String(invoice.status).toLocaleLowerCase("id-ID") === "lunas",
    );
    setInvoiceText("invoiceSubtotal", currency.format(subtotal));
    setInvoiceText("invoiceTax", currency.format(0));
    setInvoiceText("invoiceGrandTotal", currency.format(subtotal));

    lastInvoiceAction = actionButton;
    workspaceEl.hidden = true;
    document.getElementById("clientPortalView").hidden = true;
    invoicePageEl.hidden = false;
    invoicePageEl.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: "auto" });
    document.getElementById("invoiceBackButton").focus();
  }

  function closeInvoice() {
    workspaceEl.hidden = false;
    invoicePageEl.hidden = true;
    document.getElementById("clientPortalView").hidden = false;
    document.body.classList.remove("printing-invoice");
    if (lastInvoiceAction?.isConnected) lastInvoiceAction.focus();
  }

  invoicesEl.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-invoice-id]");
    if (!actionButton || actionButton.disabled) return;
    const invoice = invoiceRecords.find((record) => record.invoiceId === actionButton.dataset.invoiceId);
    if (!invoice) {
      statusEl.textContent = "Invoice yang dipilih tidak lagi tersedia. Muat ulang portal untuk mencoba kembali.";
      statusEl.className = "tenant-table-status is-error";
      return;
    }
    try {
      showInvoice(invoice, actionButton);
    } catch (error) {
      statusEl.textContent = `Gagal menampilkan invoice: ${error.message}`;
      statusEl.className = "tenant-table-status is-error";
    }
  });

  backButton.addEventListener("click", closeInvoice);
  printButton.addEventListener("click", () => {
    document.body.classList.add("printing-invoice");
    window.print();
  });
  window.addEventListener("afterprint", () => {
    document.body.classList.remove("printing-invoice");
  });

  function addDetail(label, value) {
    if (value === null || value === undefined || value === "") return;
    const item = document.createElement("div");
    const term = document.createElement("span");
    term.textContent = label;
    const description = document.createElement("strong");
    description.textContent = String(value);
    item.append(term, description);
    detailsEl.appendChild(item);
  }

  async function refresh() {
    statusEl.textContent = "Memuat data akun…";
    statusEl.className = "tenant-table-status is-loading";
    detailsEl.replaceChildren();
    invoicesEl.replaceChildren();
    tenantRecords = [];
    invoiceRecords = [];
    try {
      const headers = Auth.headers();
      const [tenantResponse, invoiceResponse] = await Promise.all([
        fetch("/api/tenants?page=1&pageSize=100", { headers, cache: "no-store" }),
        fetch("/api/invoices", { headers, cache: "no-store" }),
      ]);
      const [tenantPayload, invoicePayload] = await Promise.all([
        tenantResponse.json(),
        invoiceResponse.json(),
      ]);
      if (!tenantResponse.ok) throw new Error(tenantPayload.error || "Gagal memuat data tenant.");
      if (!invoiceResponse.ok) throw new Error(invoicePayload.error || "Gagal memuat invoice.");

      const user = Auth.currentUser;
      tenantRecords = tenantPayload.records;
      invoiceRecords = invoicePayload.records;
      tenantEl.textContent = user?.tenantName ? `Akun terhubung ke ${user.tenantName}` : "";
      tenantPayload.records.forEach((record) => {
        addDetail("Nama tenant", record.tenantName);
        addDetail("PIC", record.pic);
        addDetail("Kontak client", record.contact);
        addDetail("Ruang", record.rooms.join(", "));
        addDetail("Status pembayaran", record.paymentScheme);
        addDetail("Tanggal mulai", record.startDate);
        addDetail("Tanggal akhir", record.endDate);
        addDetail("Nilai kontrak", record.contractValue == null ? null : currency.format(record.contractValue));
        addDetail("Biaya listrik", record.electricityCostRp == null ? null : currency.format(record.electricityCostRp));
        addDetail("Pemakaian listrik", record.electricityKwh == null ? null : `${record.electricityKwh} kWh`);
        addDetail("Biaya telepon", record.phoneCostRp == null ? null : currency.format(record.phoneCostRp));
        addDetail("Catatan", record.notes);
      });
      invoicePayload.records.forEach((invoice) => {
        const row = document.createElement("tr");
        [
          invoice.invoiceId,
          invoice.period,
          invoice.dueDate,
          currency.format(invoiceTotal(invoice)),
          invoice.status,
        ].forEach((value) => {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.appendChild(cell);
        });
        const actionCell = document.createElement("td");
        const actionButton = document.createElement("button");
        actionButton.type = "button";
        actionButton.className = "tenant-table-action invoice-view-action";
        actionButton.dataset.invoiceId = invoice.invoiceId;
        actionButton.textContent = "Lihat invoice";
        actionButton.disabled = !tenantPayload.records.some(
          (record) => record.tenantName === user?.tenantName,
        );
        if (actionButton.disabled) {
          actionButton.title = "Data tenant untuk invoice ini belum tersedia.";
        }
        actionCell.appendChild(actionButton);
        row.appendChild(actionCell);
        invoicesEl.appendChild(row);
      });
      statusEl.textContent = tenantPayload.records.length
        ? "Data dan invoice hanya menampilkan milik akun Anda."
        : "Belum ada data tenant yang terhubung ke akun ini.";
      statusEl.className = "tenant-table-status";
      if (!invoicePayload.records.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 6;
        cell.textContent = "Belum ada invoice.";
        row.appendChild(cell);
        invoicesEl.appendChild(row);
      }
    } catch (error) {
      statusEl.textContent = `Gagal memuat portal client: ${error.message}`;
      statusEl.className = "tenant-table-status is-error";
    }
  }

  return Object.freeze({ refresh, closeInvoice });
})();
