const Auth = (() => {
  const tokenKey = "pintar.mockSession";
  const loginDialog = document.getElementById("loginDialog");
  const loginForm = document.getElementById("loginForm");
  const loginError = document.getElementById("loginError");
  const appShell = document.getElementById("appShell");
  const logoutButton = document.getElementById("logoutButton");
  const userAvatar = document.getElementById("userAvatar");
  const userMenuDropdown = document.getElementById("userMenuDropdown");
  const clientAccountSwitcher = document.getElementById("clientAccountSwitcher");
  const clientAccountSelect = document.getElementById("clientAccountSelect");
  const switchClientAccountButton = document.getElementById("switchClientAccount");
  const clientAccountSwitcherStatus = document.getElementById("clientAccountSwitcherStatus");
  let session = null;

  function setUserMenuOpen(open) {
    userMenuDropdown.hidden = !open;
    userAvatar.setAttribute("aria-expanded", String(open));
  }

  function navigate(path, replace = false) {
    if (window.location.pathname === path) return;
    const method = replace ? "replaceState" : "pushState";
    window.history[method]({}, "", path);
  }

  function setAuthenticated(value) {
    document.body.dataset.authenticated = String(value);
    appShell.hidden = !value;
    loginDialog.hidden = value;
    if (!value) setUserMenuOpen(false);
  }

  function announce(name) {
    window.dispatchEvent(new CustomEvent(name, {
      detail: { user: session?.user ?? null },
    }));
  }

  function showLogin(message = "") {
    navigate("/login", true);
    setAuthenticated(false);
    loginError.textContent = message;
    loginError.hidden = !message;
    if (!loginDialog.open) loginDialog.showModal();
    loginForm.elements.namedItem("username").focus();
  }

  async function login(username, password) {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Login gagal.");
    sessionStorage.setItem(tokenKey, payload.token);
    session = { token: payload.token, user: payload.user };
    loginForm.elements.namedItem("password").value = "";
    navigate("/dashboard");
    setAuthenticated(true);
    loginDialog.close();
    announce("pintar:authenticated");
  }

  async function restore() {
    const token = sessionStorage.getItem(tokenKey);
    if (!token) {
      showLogin();
      return;
    }
    let response;
    let payload;
    try {
      response = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      payload = await response.json();
    } catch (error) {
      showLogin(`Tidak dapat memeriksa sesi: ${error.message}`);
      return;
    }
    if (response.status === 401) {
      sessionStorage.removeItem(tokenKey);
      session = null;
      announce("pintar:logged-out");
      showLogin("Sesi berakhir. Silakan masuk kembali.");
      return;
    }
    if (!response.ok) {
      showLogin(payload.error || `Tidak dapat memeriksa sesi (HTTP ${response.status}).`);
      return;
    }
    session = { token, user: payload.user };
    navigate("/dashboard", true);
    setAuthenticated(true);
    loginDialog.close();
    announce("pintar:authenticated");
  }

  async function logout() {
    const token = session?.token;
    sessionStorage.removeItem(tokenKey);
    session = null;
    navigate("/login", true);
    setAuthenticated(false);
    announce("pintar:logged-out");
    if (token) {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok && response.status !== 401) {
        throw new Error(`Logout gagal (HTTP ${response.status}).`);
      }
    }
    showLogin();
  }

  function expireSession(message = "Sesi berakhir. Silakan masuk kembali.") {
    if (!session) return;
    sessionStorage.removeItem(tokenKey);
    session = null;
    announce("pintar:logged-out");
    showLogin(message);
  }

  async function refreshClientAccounts() {
    clientAccountSwitcherStatus.textContent = "Memuat akun tenant…";
    switchClientAccountButton.disabled = true;
    try {
      const response = await fetch("/api/auth/client-accounts", {
        headers: headers(),
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Tidak dapat memuat akun client.");

      clientAccountSelect.replaceChildren(new Option("Pilih akun client", ""));
      payload.records.forEach((record) => {
        clientAccountSelect.add(new Option(
          `${record.tenantName} · ${record.username}`,
          record.username,
        ));
      });
      clientAccountSwitcherStatus.textContent = payload.records.length
        ? `Password demo: ${"123456"}`
        : "Belum ada akun client tenant.";
    } catch (error) {
      clientAccountSwitcherStatus.textContent = error.message;
      console.error("Gagal memuat akun demo client:", error);
    }
  }

  async function switchToClient(username) {
    if (typeof username !== "string" || !username) {
      throw new Error("Pilih akun client tenant terlebih dahulu.");
    }
    const previousToken = session?.token;
    await login(username, "123456");
    setUserMenuOpen(false);
    if (!previousToken) return;
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${previousToken}` },
      cache: "no-store",
    });
    if (!response.ok && response.status !== 401) {
      throw new Error(`Sesi admin sebelumnya gagal ditutup (HTTP ${response.status}).`);
    }
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = loginForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    loginError.hidden = true;
    try {
      const values = new FormData(loginForm);
      await login(String(values.get("username") || ""), String(values.get("password") || ""));
    } catch (error) {
      loginError.textContent = error.message;
      loginError.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
  });

  document.querySelectorAll(".login-role-option").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".login-role-option").forEach((option) => {
        option.classList.toggle("is-selected", option === button);
        option.setAttribute("aria-pressed", String(option === button));
      });
      loginForm.elements.namedItem("username").value = button.dataset.username;
      loginForm.elements.namedItem("password").value = button.dataset.password;
      loginError.hidden = true;
    });
  });
  document.querySelector(".login-role-option.is-selected")?.click();

  window.addEventListener("popstate", () => {
    if (!session) {
      showLogin();
      return;
    }
    navigate("/dashboard", true);
  });

  logoutButton.addEventListener("click", () => {
    setUserMenuOpen(false);
    void logout().catch((error) => {
      console.error("Gagal keluar dari sesi PINTAR:", error);
      showLogin(error.message);
    });
  });

  userAvatar.addEventListener("click", () => {
    const open = userMenuDropdown.hidden;
    setUserMenuOpen(open);
    if (open && session?.user.role === "admin") void refreshClientAccounts();
  });

  clientAccountSelect.addEventListener("change", () => {
    switchClientAccountButton.disabled = !clientAccountSelect.value;
  });
  switchClientAccountButton.addEventListener("click", () => {
    switchClientAccountButton.disabled = true;
    clientAccountSwitcherStatus.textContent = "Mengganti akun…";
    void switchToClient(clientAccountSelect.value).catch((error) => {
      clientAccountSwitcherStatus.textContent = error.message;
      console.error("Gagal beralih ke akun client:", error);
      switchClientAccountButton.disabled = !clientAccountSelect.value;
    });
  });

  document.addEventListener("click", (event) => {
    if (!userMenuDropdown.parentElement.contains(event.target)) setUserMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !userMenuDropdown.hidden) {
      setUserMenuOpen(false);
      userAvatar.focus();
    }
  });

  function headers() {
    if (!session?.token) throw new Error("Sesi login tidak tersedia.");
    return { Authorization: `Bearer ${session.token}` };
  }

  return Object.freeze({
    restore,
    headers,
    expireSession,
    switchToClient,
    get currentUser() { return session?.user ?? null; },
  });
})();
