import {
  createHash,
  randomUUID,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { Router } from "express";
import { pool } from "./db.js";

export const authRouter = Router();

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const scrypt = promisify(scryptCallback);
export const CLIENT_DEFAULT_PASSWORD = "123456";
const adminPassword = process.env.ADMIN_PASSWORD ||
  (process.env.NODE_ENV === "production" ? "" : "admin123");
if (!adminPassword) {
  throw new Error("ADMIN_PASSWORD must be configured in production.");
}
const demoUsers = Object.freeze([
  {
    username: process.env.ADMIN_USERNAME || "admin",
    password: adminPassword,
    role: "admin",
    displayName: "Admin",
  },
  ...(process.env.NODE_ENV === "production"
    ? []
    : [
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
      ]),
]);
function sessionTokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

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

export async function authenticate(req, res, next) {
  const authorization = req.get("authorization") || "";
  const match = /^Bearer ([0-9a-f-]{36})$/i.exec(authorization);
  if (!match) return unauthorized(res);
  try {
    const { rows } = await pool.query(
      `SELECT user_data
       FROM app_sessions
       WHERE token_hash = $1 AND expires_at > NOW()`,
      [sessionTokenHash(match[1])],
    );
    if (!rows[0]) return unauthorized(res);
    req.user = rows[0].user_data;
    next();
  } catch (error) {
    next(error);
  }
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
    if (!user) {
      return res.status(401).json({ error: "Username atau password tidak sesuai." });
    }

    const token = randomUUID();
    await pool.query("DELETE FROM app_sessions WHERE expires_at <= NOW()");
    await pool.query(
      `INSERT INTO app_sessions (token_hash, user_data, expires_at)
       VALUES ($1, $2, NOW() + ($3::double precision * INTERVAL '1 millisecond'))`,
      [sessionTokenHash(token), JSON.stringify(user), SESSION_TTL_MS],
    );
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

authRouter.post("/logout", authenticate, async (req, res, next) => {
  try {
    const token = req.get("authorization").slice("Bearer ".length);
    await pool.query("DELETE FROM app_sessions WHERE token_hash = $1", [
      sessionTokenHash(token),
    ]);
    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
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
