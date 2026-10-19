import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "dist");
const publicDirectory = path.join(projectRoot, "public");
const publicFiles = [
  "index.html",
  "style.css",
  "app.js",
  "data.js",
  "mapView.js",
  "data",
  "assets",
];

await rm(outputDirectory, { recursive: true, force: true });
await rm(publicDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await mkdir(publicDirectory, { recursive: true });

for (const file of publicFiles) {
  await Promise.all([
    cp(path.join(projectRoot, file), path.join(outputDirectory, file), {
      recursive: true,
    }),
    cp(path.join(projectRoot, file), path.join(publicDirectory, file), {
      recursive: true,
    }),
  ]);
}

await build({
  entryPoints: [path.join(projectRoot, "data/supabase-client.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  outfile: path.join(outputDirectory, "supabase-client.js"),
});

await cp(
  path.join(outputDirectory, "supabase-client.js"),
  path.join(publicDirectory, "supabase-client.js"),
);
await cp(path.join(projectRoot, "server"), path.join(outputDirectory, "server"), {
  recursive: true,
});
await cp(path.join(projectRoot, "index.js"), path.join(outputDirectory, "index.js"));

console.info(`Production build created at ${outputDirectory}`);
