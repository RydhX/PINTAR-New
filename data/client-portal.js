const ClientPortal = (() => {
  const statusEl = document.getElementById("clientPortalStatus");
  const tenantEl = document.getElementById("clientPortalTenant");
  const detailsEl = document.getElementById("clientTenantDetails");
  const invoicesEl = document.getElementById("clientInvoiceRows");
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
  let refreshSequence = 0;

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
    if (invoice.rentAmountRp !== undefined) {
      return readAmount(invoice.amountRp, "total tagihan");
    }
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
    const rentAmount = readAmount(
      invoice.rentAmountRp ?? invoice.amountRp,
      "tagihan sewa",
    );
    const electricityAmount = invoice.electricityAmountRp === undefined
      ? associatedRecords.reduce(
        (total, record) => total + readAmount(record.electricityCostRp, "listrik"),
        0,
      )
      : readAmount(invoice.electricityAmountRp, "listrik");
    const phoneAmount = invoice.phoneAmountRp === undefined
      ? associatedRecords.reduce(
        (total, record) => total + readAmount(record.phoneCostRp, "telepon"),
        0,
      )
      : readAmount(invoice.phoneAmountRp, "telepon");
    const electricityUsage = associatedRecords.reduce(
      (total, record) => total + readAmount(record.electricityKwh, "pemakaian listrik"),
      0,
    );
    const subtotal = rentAmount + electricityAmount + phoneAmount;
    const rooms = associatedRecords.flatMap((record) => record.rooms || []);

    invoiceItemRowsEl.replaceChildren();
    if (rentAmount > 0) {
      addInvoiceItem(`Biaya sewa ruangan — ${period}`, "1 periode", rentAmount);
    }
    if (electricityAmount > 0) {
      addInvoiceItem(
        `Biaya listrik${electricityUsage ? ` (${new Intl.NumberFormat("id-ID").format(electricityUsage)} kWh)` : ""}`,
        "1 layanan",
        electricityAmount,
      );
    }
    if (phoneAmount > 0) addInvoiceItem("Biaya telepon", "1 layanan", phoneAmount);
    if (!invoiceItemRowsEl.childElementCount) {
      addInvoiceItem("Tagihan", "1 item", invoiceTotal(invoice));
    }

    setInvoiceText("invoiceNumber", invoice.invoiceId);
    setInvoiceText(
      "invoiceDate",
      invoice.billingDate ? formatDate(invoice.billingDate) : dateFormatter.format(new Date()),
    );
    setInvoiceText("invoiceDueDate", formatDate(invoice.dueDate));
    setInvoiceText("invoiceTenantName", tenant.tenantName || tenantName);
    setInvoiceText("invoiceTenantPic", tenant.pic ? `PIC: ${tenant.pic}` : "");
    setInvoiceText("invoiceTenantContact", tenant.contact ? `Kontak: ${tenant.contact}` : "");
    setInvoiceText("invoicePeriod", period);
    setInvoiceText(
      "invoiceCategory",
      invoice.category === "UTILITAS" ? "Utilitas (Listrik & Telepon)" : "Sewa Ruangan",
    );
    setInvoiceText("invoiceRoomDetails", rooms.length ? `Lokasi / ruang: ${rooms.join(", ")}` : "");
    const normalizedStatus = String(invoice.status).toLocaleUpperCase("id-ID");
    const invoiceStatusEl = document.getElementById("invoiceStatus");
    setInvoiceText(
      "invoiceStatus",
      normalizedStatus === "LUNAS"
        ? "Lunas"
        : normalizedStatus === "SEBAGIAN"
          ? "Sebagian"
        : normalizedStatus === "MENUNGGAK"
          ? "Menunggak"
          : "Belum dibayar",
    );
    invoiceStatusEl.classList.toggle("is-paid", normalizedStatus === "LUNAS");
    invoiceStatusEl.classList.toggle("is-overdue", normalizedStatus === "MENUNGGAK");
    invoiceStatusEl.classList.toggle("is-partial", normalizedStatus === "SEBAGIAN");
    setInvoiceText("invoiceSubtotal", currency.format(subtotal));
    setInvoiceText("invoiceTax", currency.format(0));
    setInvoiceText("invoiceGrandTotal", currency.format(subtotal));

    lastInvoiceAction = actionButton;
    invoicePageEl.scrollTop = 0;
    invoicePageEl.showModal();
    window.scrollTo({ top: 0, behavior: "auto" });
    document.getElementById("invoiceBackButton").focus();
  }

  function closeInvoice() {
    if (invoicePageEl.open) invoicePageEl.close();
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
  invoicePageEl.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeInvoice();
  });
  printButton.addEventListener("click", () => {
    document.body.classList.add("printing-invoice");
    window.print();
  });
  window.addEventListener("afterprint", () => {
    document.body.classList.remove("printing-invoice");
  });

  function addDetail(parent, label, value) {
    if (value === null || value === undefined || value === "") return;
    const item = document.createElement("div");
    const term = document.createElement("span");
    term.textContent = label;
    const description = document.createElement("strong");
    description.textContent = String(value);
    item.append(term, description);
    parent.appendChild(item);
  }

  async function refresh() {
    const sequence = ++refreshSequence;
    const requestedUser = Auth.currentUser;
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
      if (
        sequence !== refreshSequence ||
        Auth.currentUser?.username !== requestedUser?.username
      ) return;

      const user = requestedUser;
      tenantRecords = tenantPayload.records;
      invoiceRecords = invoicePayload.records;
      tenantEl.textContent = user?.tenantName ? `Akun terhubung ke ${user.tenantName}` : "";
      tenantPayload.records.forEach((record) => {
        const card = document.createElement("article");
        card.className = "client-tenant-card";
        const heading = document.createElement("h3");
        heading.textContent = record.tenantName;
        card.appendChild(heading);
        addDetail(card, "PIC", record.pic);
        addDetail(card, "Kontak client", record.contact);
        addDetail(card, "Ruang", record.rooms.join(", "));
        addDetail(card, "Status pembayaran", record.paymentScheme);
        addDetail(card, "Tanggal mulai", record.startDate);
        addDetail(card, "Tanggal akhir", record.endDate);
        addDetail(card, "Nilai kontrak", record.contractValue == null ? null : currency.format(record.contractValue));
        addDetail(card, "Biaya listrik / bulan", record.electricityCostRp == null ? null : currency.format(record.electricityCostRp));
        addDetail(card, "Pemakaian listrik", record.electricityKwh == null ? null : `${record.electricityKwh} kWh`);
        addDetail(card, "Biaya telepon / bulan", record.phoneCostRp == null ? null : currency.format(record.phoneCostRp));
        addDetail(card, "Catatan", record.notes);
        detailsEl.appendChild(card);
      });
      invoicePayload.records.forEach((invoice) => {
        const row = document.createElement("tr");
        [
          invoice.invoiceId,
          invoice.category === "UTILITAS" ? "Utilitas (Listrik & Telepon)" : "Sewa Ruangan",
          formatPeriod(invoice.period),
          formatDate(invoice.dueDate),
          currency.format(invoiceTotal(invoice)),
        ]
          .forEach((value) => {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.appendChild(cell);
        });
        const statusCell = document.createElement("td");
        const statusBadge = document.createElement("span");
        const normalizedStatus = String(invoice.status).toLocaleUpperCase("id-ID");
        statusBadge.className = `invoice-table-status ${
          normalizedStatus === "LUNAS"
            ? "is-paid"
            : normalizedStatus === "MENUNGGAK"
              ? "is-overdue"
              : normalizedStatus === "SEBAGIAN"
                ? "is-partial"
              : "is-pending"
        }`;
        statusBadge.textContent = normalizedStatus === "LUNAS"
          ? "Lunas"
          : normalizedStatus === "MENUNGGAK"
            ? "Menunggak"
            : normalizedStatus === "SEBAGIAN"
              ? "Sebagian"
            : "Belum dibayar";
        statusCell.appendChild(statusBadge);
        row.appendChild(statusCell);
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
        cell.colSpan = 7;
        cell.textContent = "Belum ada invoice.";
        row.appendChild(cell);
        invoicesEl.appendChild(row);
      }
    } catch (error) {
      if (
        sequence !== refreshSequence ||
        Auth.currentUser?.username !== requestedUser?.username
      ) return;
      statusEl.textContent = `Gagal memuat portal client: ${error.message}`;
      statusEl.className = "tenant-table-status is-error";
    }
  }

  return Object.freeze({ refresh, closeInvoice });
})();
