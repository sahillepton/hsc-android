/**
 * Copies GIS web build + Capacitor metadata + raster-tiling native artifacts
 * into the integration Android app module. Run by the client after every
 * Lepton drop so they don't have to copy files manually.
 *
 * From mcsa-gis-android/:
 *   dist/*                                       -> ../app/src/main/assets/public/
 *   android/.../capacitor.plugins.json           -> ../app/src/main/assets/
 *   android/.../capacitor.config.json            -> ../app/src/main/assets/
 *
 *   kt-msca-plugins/jniLibs/arm64-v8a/*.so       -> ../app/src/main/jniLibs/arm64-v8a/
 *   kt-msca-plugins/jniLibs/armeabi-v7a/*.so     -> ../app/src/main/jniLibs/armeabi-v7a/
 *   kt-msca-plugins/libs/gdal.jar                -> ../app/libs/gdal.jar
 *   kt-msca-plugins/assets/proj/proj.db          -> ../app/src/main/assets/proj/proj.db
 *
 * Run after: yarn build && npx cap sync
 * Usage:     node scripts/sync-integration-assets.mjs
 *            yarn sync:mcsa-gis-android-sync
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
const KT_PLUGINS = path.join(ROOT, "kt-msca-plugins");

const APP_ROOT = path.join(ROOT, "..", "app");
const APP_ASSETS = path.join(APP_ROOT, "src", "main", "assets");
const APP_PUBLIC = path.join(APP_ASSETS, "public");
const APP_JNILIBS = path.join(APP_ROOT, "src", "main", "jniLibs");
const APP_LIBS = path.join(APP_ROOT, "libs");
const APP_PROJ_DIR = path.join(APP_ASSETS, "proj");

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Mirror an entire directory tree (used for jniLibs/<abi>/). */
async function syncDir(srcDir, destDir, label) {
  if (!(await pathExists(srcDir))) {
    console.error(`[sync-integration-assets] Missing folder: ${srcDir}`);
    console.error(`  Required for ${label}.`);
    process.exit(1);
  }
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destDir), { recursive: true });
  await fs.cp(srcDir, destDir, { recursive: true });
  console.log(`[sync-integration-assets] ${srcDir} -> ${destDir}`);
}

/** Copy a single file, creating the parent dir if needed. */
async function syncFile(src, dest, label) {
  if (!(await pathExists(src))) {
    console.error(`[sync-integration-assets] Missing: ${src}`);
    console.error(`  Required for ${label}.`);
    process.exit(1);
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
  console.log(`[sync-integration-assets] ${src} -> ${dest}`);
}

async function main() {
  await fs.mkdir(APP_ASSETS, { recursive: true });

  // ── 1. Web bundle (dist → assets/public) ────────────────────────────
  if (!(await pathExists(DIST))) {
    console.error(`[sync-integration-assets] Missing folder: ${DIST}`);
    console.error("  Run: yarn build");
    process.exit(1);
  }

  await fs.rm(APP_PUBLIC, { recursive: true, force: true });
  await fs.mkdir(path.dirname(APP_PUBLIC), { recursive: true });
  await fs.cp(DIST, APP_PUBLIC, { recursive: true });
  console.log(`[sync-integration-assets] ${DIST} -> ${APP_PUBLIC}`);

  // ── 2. Capacitor metadata (plugins.json, config.json) ───────────────
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

  // ── 3. Raster-tiling native artifacts ───────────────────────────────
  // GDAL .so libs (per ABI) — each is ~25 MB total per ABI.
  await syncDir(
    path.join(KT_PLUGINS, "jniLibs", "arm64-v8a"),
    path.join(APP_JNILIBS, "arm64-v8a"),
    "GDAL native libs (arm64-v8a)",
  );
  await syncDir(
    path.join(KT_PLUGINS, "jniLibs", "armeabi-v7a"),
    path.join(APP_JNILIBS, "armeabi-v7a"),
    "GDAL native libs (armeabi-v7a)",
  );

  // GDAL Java SWIG bindings jar (ABI-independent, ~2 MB).
  await syncFile(
    path.join(KT_PLUGINS, "libs", "gdal.jar"),
    path.join(APP_LIBS, "gdal.jar"),
    "GDAL Java jar",
  );

  // PROJ datum database (~9 MB).
  await syncFile(
    path.join(KT_PLUGINS, "assets", "proj", "proj.db"),
    path.join(APP_PROJ_DIR, "proj.db"),
    "PROJ datum database",
  );

  console.log("[sync-integration-assets] Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
