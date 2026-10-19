import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
process.env.DATABASE_URL ??= "postgresql://pintar:pintar_dev@localhost:5433/pintar";
process.env.ADMIN_PASSWORD = "admin123";
const {
  authenticate,
  authenticateCredentials,
  invoicesForUser,
} = await import("./auth.js");
const { pool } = await import("./db.js");

test("accepts only the configured mock login credentials", () => {
  assert.equal(authenticateCredentials("admin", "admin123")?.role, "admin");
  assert.equal(authenticateCredentials("internal", "internal123")?.role, "internal");
  assert.equal(authenticateCredentials("client", "client123")?.tenantName, "PT Coba");
  assert.equal(authenticateCredentials("admin", "wrong-password"), null);
  assert.equal(authenticateCredentials("client", 123), null);
});

test("requires an admin password in production", () => {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", "await import('./server/auth.js')"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://localhost/pintar",
        ADMIN_PASSWORD: "",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ADMIN_PASSWORD must be configured in production/);
});

test("disables hard-coded demo accounts in production", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const { authenticateCredentials } = await import('./server/auth.js'); console.log(JSON.stringify(['admin', 'internal', 'client'].map((username) => authenticateCredentials(username, username === 'admin' ? 'production-secret' : `${username}123`)?.role ?? null)))",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://localhost/pintar",
        ADMIN_PASSWORD: "production-secret",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ["admin", null, null]);
});

test("restores sessions from PostgreSQL using only a hash of the bearer token", async () => {
  const originalQuery = pool.query;
  const token = "00000000-0000-4000-8000-000000000000";
  const user = { username: "admin", role: "admin" };
  let queryValues;
  try {
    pool.query = async (_query, values) => {
      queryValues = values;
      return { rows: [{ user_data: user }] };
    };
    const req = { get: () => `Bearer ${token}` };
    let nextCalled = false;
    await authenticate(req, {}, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.deepEqual(req.user, user);
    assert.notEqual(queryValues[0], token);

    pool.query = async () => ({ rows: [] });
    let status;
    let body;
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json(value) {
        body = value;
      },
    };
    await authenticate(req, res, () => assert.fail("expired session was accepted"));
    assert.equal(status, 401);
    assert.match(body.error, /sesi telah berakhir/);
  } finally {
    pool.query = originalQuery;
  }
});

test("limits client mock invoices to its own tenant", () => {
  const clientInvoices = invoicesForUser({ role: "client", tenantName: "PT Coba" });
  const internalInvoices = invoicesForUser({ role: "internal" });
  assert.equal(clientInvoices.length, 2);
  assert.equal(internalInvoices.length, 2);
  assert.ok(clientInvoices.every((invoice) => !Object.hasOwn(invoice, "tenantName")));
  assert.deepEqual(invoicesForUser({ role: "client", tenantName: "Tenant Lain" }), []);
});
