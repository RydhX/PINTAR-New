const ClientPortal = (() => {
  const statusEl = document.getElementById("clientPortalStatus");
  const tenantEl = document.getElementById("clientPortalTenant");
  const detailsEl = document.getElementById("clientTenantDetails");
  const invoicesEl = document.getElementById("clientInvoiceRows");
  const unpaidTotalEl = document.getElementById("clientUnpaidTotal");
  const unpaidCountEl = document.getElementById("clientUnpaidCount");
  const nextDueDateEl = document.getElementById("clientNextDueDate");
  const nextDueAmountEl = document.getElementById("clientNextDueAmount");
  const yearFilterEl = document.getElementById("clientInvoiceYear");
  const pageSummaryEl = document.getElementById("clientInvoicePageSummary");
  const previousPageEl = document.getElementById("clientInvoicePrevious");
  const nextPageEl = document.getElementById("clientInvoiceNext");
  const invoiceTabsEl = document.querySelector(".client-invoice-tabs");
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
  let invoiceFilter = "unpaid";
  let invoiceYear = "all";
  let invoicePage = 1;
  const INVOICES_PER_PAGE = 5;

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

  function normalizedStatus(invoice) {
    return String(invoice.status || "").toLocaleUpperCase("id-ID");
  }

  function isPaid(invoice) {
    return normalizedStatus(invoice) === "LUNAS";
  }

  function invoiceCategory(invoice) {
    return invoice.category === "UTILITAS" ? "utility" : "rent";
  }

  function invoiceYearValue(invoice) {
    const match = /^(\d{4})/.exec(String(invoice.period || invoice.dueDate || ""));
    return match?.[1] || "";
  }

  function outstandingAmount(invoice) {
    if (invoice.remainingAmountRp !== undefined) {
      return readAmount(invoice.remainingAmountRp, "sisa tagihan");
    }
    return readAmount(invoice.amountRp, "total tagihan");
  }

  function updateInvoiceSummary() {
    const unpaid = invoiceRecords.filter((invoice) => !isPaid(invoice));
    const unpaidTotal = unpaid.reduce((total, invoice) => total + outstandingAmount(invoice), 0);
    unpaidTotalEl.textContent = currency.format(unpaidTotal);
    unpaidCountEl.textContent = `${unpaid.length} invoice`;

    const today = new Date();
    const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const upcoming = unpaid
      .filter((invoice) => invoice.dueDate && invoice.dueDate >= todayValue)
      .sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0];
    nextDueDateEl.textContent = upcoming ? formatDate(upcoming.dueDate) : "-";
    nextDueAmountEl.textContent = upcoming
      ? currency.format(outstandingAmount(upcoming))
      : "Tidak ada tagihan mendatang";
  }

  function updateInvoiceYears() {
    const years = [...new Set(invoiceRecords.map(invoiceYearValue).filter(Boolean))]
      .sort((left, right) => right.localeCompare(left));
    yearFilterEl.replaceChildren();
    const allYears = document.createElement("option");
    allYears.value = "all";
    allYears.textContent = "Semua Tahun";
    yearFilterEl.appendChild(allYears);
    years.forEach((year) => {
      const option = document.createElement("option");
      option.value = year;
      option.textContent = year;
      yearFilterEl.appendChild(option);
    });
    if (invoiceYear !== "all" && !years.includes(invoiceYear)) invoiceYear = "all";
    yearFilterEl.value = invoiceYear;
  }

  function filteredInvoices() {
    return invoiceRecords
      .filter((invoice) => {
        if (invoiceFilter === "unpaid" && isPaid(invoice)) return false;
        if (invoiceFilter === "paid" && !isPaid(invoice)) return false;
        if (invoiceFilter === "rent" && invoiceCategory(invoice) !== "rent") return false;
        if (invoiceFilter === "utility" && invoiceCategory(invoice) !== "utility") return false;
        return invoiceYear === "all" || invoiceYearValue(invoice) === invoiceYear;
      })
      .sort((left, right) => {
        const leftDueDate = left.dueDate || "";
        const rightDueDate = right.dueDate || "";
        return leftDueDate.localeCompare(rightDueDate) ||
          String(left.invoiceId).localeCompare(String(right.invoiceId));
      });
  }

  function renderInvoices() {
    const filtered = filteredInvoices();
    const pageCount = Math.ceil(filtered.length / INVOICES_PER_PAGE);
    invoicePage = Math.min(Math.max(invoicePage, 1), Math.max(pageCount, 1));
    const startIndex = (invoicePage - 1) * INVOICES_PER_PAGE;
    const pageInvoices = filtered.slice(startIndex, startIndex + INVOICES_PER_PAGE);
    invoicesEl.replaceChildren();

    pageInvoices.forEach((invoice) => {
      const row = document.createElement("tr");
      const category = invoiceCategory(invoice);
      const categoryCell = document.createElement("td");
      const categoryBadge = document.createElement("span");
      categoryBadge.className = `invoice-category-badge is-${category}`;
      categoryBadge.textContent = category === "utility"
        ? "Utilitas"
        : `Sewa Ruangan${invoice.invoiceLabel ? ` · ${invoice.invoiceLabel}` : ""}`;
      [
        invoice.invoiceId,
        categoryBadge,
        formatPeriod(invoice.period),
        formatDate(invoice.dueDate),
        currency.format(invoiceTotal(invoice)),
      ].forEach((value, index) => {
        const cell = index === 1 ? categoryCell : document.createElement("td");
        if (index === 1) cell.appendChild(value);
        else cell.textContent = value;
        row.appendChild(cell);
      });
      const statusCell = document.createElement("td");
      const statusBadge = document.createElement("span");
      const status = normalizedStatus(invoice);
      statusBadge.className = `invoice-table-status ${
        status === "LUNAS"
          ? "is-paid"
          : status === "MENUNGGAK"
            ? "is-overdue"
            : status === "SEBAGIAN"
              ? "is-partial"
              : "is-pending"
      }`;
      statusBadge.textContent = status === "LUNAS"
        ? "Lunas"
        : status === "MENUNGGAK"
          ? "Menunggak"
          : status === "SEBAGIAN"
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
      actionButton.disabled = !tenantRecords.some(
        (record) => record.tenantName === Auth.currentUser?.tenantName,
      );
      if (actionButton.disabled) {
        actionButton.title = "Data tenant untuk invoice ini belum tersedia.";
      }
      actionCell.appendChild(actionButton);
      row.appendChild(actionCell);
      invoicesEl.appendChild(row);
    });

    if (!pageInvoices.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 7;
      cell.textContent = invoiceRecords.length
        ? "Tidak ada invoice yang sesuai dengan filter."
        : "Belum ada invoice.";
      row.appendChild(cell);
      invoicesEl.appendChild(row);
    }

    const shownStart = filtered.length ? startIndex + 1 : 0;
    const shownEnd = Math.min(startIndex + pageInvoices.length, filtered.length);
    pageSummaryEl.textContent = `Menampilkan ${shownStart}-${shownEnd} dari ${filtered.length} invoice`;
    previousPageEl.disabled = invoicePage <= 1;
    nextPageEl.disabled = invoicePage >= pageCount;
    updateInvoiceSummary();
  }

  invoiceTabsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-invoice-filter]");
    if (!button) return;
    invoiceFilter = button.dataset.invoiceFilter;
    invoicePage = 1;
    invoiceTabsEl.querySelectorAll("[data-invoice-filter]").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-pressed", String(active));
    });
    renderInvoices();
  });
  yearFilterEl.addEventListener("change", () => {
    invoiceYear = yearFilterEl.value;
    invoicePage = 1;
    renderInvoices();
  });
  previousPageEl.addEventListener("click", () => {
    invoicePage -= 1;
    renderInvoices();
  });
  nextPageEl.addEventListener("click", () => {
    invoicePage += 1;
    renderInvoices();
  });

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
      invoice.category === "UTILITAS"
        ? "Utilitas (Listrik & Telepon)"
        : `Sewa Ruangan${invoice.invoiceLabel ? ` · ${invoice.invoiceLabel}` : ""}`,
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
    updateInvoiceSummary();
    updateInvoiceYears();
    renderInvoices();
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
      updateInvoiceYears();
      renderInvoices();
      statusEl.textContent = tenantPayload.records.length
        ? "Data dan invoice hanya menampilkan milik akun Anda."
        : "Belum ada data tenant yang terhubung ke akun ini.";
      statusEl.className = "tenant-table-status";
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
