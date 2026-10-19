import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { tenantsRouter } from "./tenants.js";
import { authRouter, authenticate } from "./auth.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

app.use("/api/auth", authRouter);
app.get("/api/config", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  });
});
app.get("/api/health", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    next(error);
  }
});
app.use("/api", authenticate, tenantsRouter);
app.use(["/server", "/node_modules"], (_req, res) => {
  res.sendStatus(404);
});
app.get(["/login", "/dashboard"], (_req, res, next) => {
  res.sendFile(path.join(root, "index.html"), (error) => {
    if (error) next(error);
  });
});
app.use(express.static(root, { index: "index.html" }));

app.use((error, _req, res, _next) => {
  console.error("API request failed:", error);
  if (res.headersSent) return;
  res.status(error.status || 500).json({
    error: error.status ? error.message : "An unexpected server error occurred.",
  });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.info(`PINTAR server listening on port ${port}`);
});

async function shutdown() {
  server.close();
  await pool.end();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
