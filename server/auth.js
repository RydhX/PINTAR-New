import { randomUUID } from "node:crypto";
import { Router } from "express";

export const authRouter = Router();

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
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
  };
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

authRouter.post("/login", (req, res) => {
  const user = authenticateCredentials(req.body?.username, req.body?.password);
  if (!user) return res.status(401).json({ error: "Username atau password tidak sesuai." });

  const token = randomUUID();
  sessions.set(token, {
    user,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  res.json({ token, user });
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
