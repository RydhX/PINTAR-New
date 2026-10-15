import { readFile } from "node:fs/promises";
import { pool } from "./db.js";

try {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(schema);
  console.info("PostgreSQL schema initialized.");
} catch (error) {
  console.error("Could not initialize PostgreSQL schema:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
