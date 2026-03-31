/**
 * Copies GIS web build + Capacitor metadata into the integration Android app module.
 *
 * From mcsa-gis-android/:
 *   dist/*                    -> ../app/src/main/assets/public/
 *   android/.../capacitor.plugins.json
 *   android/.../capacitor.config.json  -> ../app/src/main/assets/
 *
 * Run after: yarn build && npx cap sync
 * Usage:     node scripts/sync-integration-assets.mjs
 *            yarn sync:integration-app
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const CAP_ASSETS = path.join(
  ROOT,
  "android",
  "app",
  "src",
  "main",
  "assets",
);
const APP_ASSETS = path.join(ROOT, "..", "app", "src", "main", "assets");
const APP_PUBLIC = path.join(APP_ASSETS, "public");

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await fs.mkdir(APP_ASSETS, { recursive: true });

  if (!(await pathExists(DIST))) {
    console.error(`[sync-integration-assets] Missing folder: ${DIST}`);
    console.error("  Run: yarn build");
    process.exit(1);
  }

  await fs.rm(APP_PUBLIC, { recursive: true, force: true });
  await fs.mkdir(path.dirname(APP_PUBLIC), { recursive: true });
  await fs.cp(DIST, APP_PUBLIC, { recursive: true });
  console.log(`[sync-integration-assets] ${DIST} -> ${APP_PUBLIC}`);

  const files = ["capacitor.plugins.json", "capacitor.config.json"];
  for (const name of files) {
    const src = path.join(CAP_ASSETS, name);
    const dest = path.join(APP_ASSETS, name);
    if (!(await pathExists(src))) {
      console.error(`[sync-integration-assets] Missing: ${src}`);
      console.error("  Run: npx cap sync");
      process.exit(1);
    }
    await fs.copyFile(src, dest);
    console.log(`[sync-integration-assets] ${src} -> ${dest}`);
  }

  console.log("[sync-integration-assets] Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
