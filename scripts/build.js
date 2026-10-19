import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "dist");
const staticFiles = [
  "index.html",
  "style.css",
  "app.js",
  "data.js",
  "mapView.js",
  "data",
  "assets",
  "server",
];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const file of staticFiles) {
  await cp(path.join(projectRoot, file), path.join(outputDirectory, file), {
    recursive: true,
  });
}

await build({
  entryPoints: [path.join(projectRoot, "data/supabase-client.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  outfile: path.join(outputDirectory, "supabase-client.js"),
});

console.info(`Production build created at ${outputDirectory}`);
