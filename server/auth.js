import { randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Router } from "express";
import { pool } from "./db.js";

export const authRouter = Router();

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const scrypt = promisify(scryptCallback);
export const CLIENT_DEFAULT_PASSWORD = "123456";
const demoUsers = Object.freeze([
  {
    username: "admin",
    password: "admin123",
    role: "admin",
    displayName: "Admin",
  },
  {
    username: "internal",
    password: "internal123",
    role: "internal",
    displayName: "Finance Internal",
  },
  {
    username: "client",
    password: "client123",
    role: "client",
    displayName: "Client PT Coba",
    tenantName: "PT Coba",
  },
]);
const sessions = new Map();

function publicUser(user) {
  return {
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    ...(user.tenantName ? { tenantName: user.tenantName } : {}),
    ...(user.tenantId ? { tenantId: user.tenantId } : {}),
  };
}

export async function hashClientPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${derivedKey.toString("base64")}`;
}

async function verifyClientPassword(password, encodedHash) {
  const [algorithm, saltValue, hashValue] = String(encodedHash).split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const salt = Buffer.from(saltValue, "base64");
  const expected = Buffer.from(hashValue, "base64");
  const actual = await scrypt(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function clientUserForCredentials(username, password) {
  if (typeof username !== "string" || typeof password !== "string") return null;
  const { rows } = await pool.query(
    `SELECT client.id, client.username, client.password_hash, tenant.id AS tenant_id,
      tenant.name AS tenant_name
     FROM client_users client
     JOIN tenants tenant ON tenant.id = client.tenant_id
     WHERE lower(client.username) = lower($1)
     LIMIT 1`,
    [username.trim()],
  );
  const row = rows[0];
  if (!row || !(await verifyClientPassword(password, row.password_hash))) return null;
  return publicUser({
    username: row.username,
    role: "client",
    displayName: `Client ${row.tenant_name}`,
    tenantName: row.tenant_name,
    tenantId: row.tenant_id,
  });
}

function unauthorized(res) {
  return res.status(401).json({ error: "Login diperlukan atau sesi telah berakhir." });
}

export function authenticate(req, res, next) {
  const authorization = req.get("authorization") || "";
  const match = /^Bearer ([0-9a-f-]{36})$/i.exec(authorization);
  const session = match ? sessions.get(match[1]) : null;
  if (!session || session.expiresAt <= Date.now()) {
    if (match) sessions.delete(match[1]);
    return unauthorized(res);
  }
  req.user = session.user;
  next();
}

export function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Akses ditolak untuk peran akun ini." });
    }
    next();
  };
}

export function authenticateCredentials(username, password) {
  if (typeof username !== "string" || typeof password !== "string") return null;
  const user = demoUsers.find(
    (item) => item.username === username.trim() && item.password === password,
  );
  return user ? publicUser(user) : null;
}

authRouter.post("/login", async (req, res, next) => {
  try {
  const user = authenticateCredentials(req.body?.username, req.body?.password) ||
    await clientUserForCredentials(req.body?.username, req.body?.password);
  if (!user) return res.status(401).json({ error: "Username atau password tidak sesuai." });

  const token = randomUUID();
  sessions.set(token, {
    user,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  res.json({ token, user });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/client-accounts", authenticate, allowRoles("admin"), async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT client.username, tenant.name AS tenant_name
       FROM client_users client
       JOIN tenants tenant ON tenant.id = client.tenant_id
       ORDER BY tenant.name`,
    );
    res.json({ records: rows.map((row) => ({
      username: row.username,
      tenantName: row.tenant_name,
    })) });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});

authRouter.post("/logout", authenticate, (req, res) => {
  sessions.delete(req.get("authorization").slice("Bearer ".length));
  res.sendStatus(204);
});

export const demoInvoices = Object.freeze([
  Object.freeze({
    invoiceId: "INV-DEMO-001",
    tenantName: "PT Coba",
    period: "2026-10",
    dueDate: "2026-10-31",
    amountRp: 1250000,
    status: "Belum dibayar",
  }),
  Object.freeze({
    invoiceId: "INV-DEMO-002",
    tenantName: "PT Coba",
    period: "2026-09",
    dueDate: "2026-09-30",
    amountRp: 850000,
    status: "Lunas",
  }),
]);

export function invoicesForUser(user) {
  return demoInvoices
    .filter((invoice) => user.role !== "client" || invoice.tenantName === user.tenantName)
    .map(({ tenantName: _tenantName, ...invoice }) => invoice);
}
