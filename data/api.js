/* REST API client for the PINTAR PostgreSQL backend. */
const TenantApi = (() => {
  const refreshIntervalMs = 45_000;
  let intervalId = null;
  let recordsHandler = null;
  let statusHandler = null;
  let activeController = null;
  let isWriting = false;

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...Auth.headers(),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      cache: "no-store",
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Server returned an invalid response (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      throw new Error(payload.error || `Request failed (HTTP ${response.status}).`);
    }
    return payload;
  }

  async function refresh() {
    if (!recordsHandler || isWriting) return false;
    activeController?.abort();
    activeController = new AbortController();
    statusHandler?.("loading", "Memuat database");
    try {
      const snapshot = await request("/api/rooms", { signal: activeController.signal });
      recordsHandler(snapshot.records, snapshot.diagnostics);
      statusHandler?.("connected", "Database terhubung", new Date());
      return true;
    } catch (error) {
      if (error.name === "AbortError") return false;
      console.error("Gagal memuat data PostgreSQL:", error);
      statusHandler?.("error", "Gagal memuat database");
      return false;
    } finally {
      activeController = null;
    }
  }

  async function commit(path, method, body) {
    if (isWriting) throw new Error("Penyimpanan lain sedang berlangsung.");
    isWriting = true;
    activeController?.abort();
    try {
      const payload = await request(path, {
        method,
        body: JSON.stringify(body),
      });
      window.dispatchEvent(new CustomEvent("pintar:data-changed"));
      return payload;
    } finally {
      isWriting = false;
      await refresh();
    }
  }

  function init({ onRecords, onStatus }) {
    if (intervalId !== null) window.clearInterval(intervalId);
    recordsHandler = onRecords;
    statusHandler = onStatus;
    void refresh();
    intervalId = window.setInterval(() => void refresh(), refreshIntervalMs);
  }

  function stop() {
    if (intervalId !== null) window.clearInterval(intervalId);
    intervalId = null;
    activeController?.abort();
    activeController = null;
    recordsHandler = null;
    statusHandler = null;
  }

  function saveContract(record, rooms) {
    return commit("/api/contracts", "POST", { ...record, rooms });
  }

  function createContract(record, rooms) {
    return saveContract(
      { ...record, contract_id: undefined, occupancy_status: "occupied" },
      rooms,
    );
  }

  function deleteRecord(identity) {
    return commit("/api/rooms", "DELETE", identity);
  }

  return Object.freeze({ init, stop, refresh, saveContract, createContract, deleteRecord });
})();
