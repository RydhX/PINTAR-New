import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authenticateCredentials,
  invoicesForUser,
} from "./auth.js";

test("accepts only the configured mock login credentials", () => {
  assert.equal(authenticateCredentials("admin", "admin123")?.role, "admin");
  assert.equal(authenticateCredentials("internal", "internal123")?.role, "internal");
  assert.equal(authenticateCredentials("client", "client123")?.tenantName, "PT Coba");
  assert.equal(authenticateCredentials("admin", "wrong-password"), null);
  assert.equal(authenticateCredentials("client", 123), null);
});

test("limits client mock invoices to its own tenant", () => {
  const clientInvoices = invoicesForUser({ role: "client", tenantName: "PT Coba" });
  const internalInvoices = invoicesForUser({ role: "internal" });
  assert.equal(clientInvoices.length, 2);
  assert.equal(internalInvoices.length, 2);
  assert.ok(clientInvoices.every((invoice) => !Object.hasOwn(invoice, "tenantName")));
  assert.deepEqual(invoicesForUser({ role: "client", tenantName: "Tenant Lain" }), []);
});
