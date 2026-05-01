/**
 * Bundle a Node.js runtime (`node.exe`) into the Electron installer.
 *
 * Why
 * ───
 * gdal-async@3.12.3 ships ONLY Node-ABI prebuilds (NODE_MODULE_VERSION
 * 115/127/137/141 for Node 20/22/24/25), NOT Electron-targeted prebuilds.
 * Electron 35.x's V8 reports ABI 133 — no published prebuild matches it,
 * so loading gdal-async inside Electron (even via ELECTRON_RUN_AS_NODE)
 * is impossible without rebuilding from source.
 *
 * Workaround: spawn the tiling worker in a real Node 22.x process whose
 * ABI 127 matches the already-downloaded `node-v127-win32-x64` prebuild.
 * To make that portable across end-user machines (which may not have
 * Node installed at all), we copy the build machine's own `node.exe`
 * into the installer via electron-builder's extraResources.
 *
 * Build-machine requirement: this script must run under Node 22.x.
 * We refuse to bundle anything else because gdal-async's available
 * prebuild list dictates the runtime.
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const TAG = "[bundle-node-runtime]";

function fail(msg) {
  console.error(`${TAG} ERROR: ${msg}`);
  process.exit(1);
}

// ── Sanity-check the build-machine Node version ──────────────────────────
// gdal-async/lib/binding/node-v127-win32-x64 corresponds to Node 22.x.
// Any Node 22 patch version is fine; ABI is determined by the major.
const localNodeVersion = process.versions.node; // e.g. "22.12.0"
const localMajor = Number(localNodeVersion.split(".")[0]);
if (localMajor !== 22) {
  fail(
    `This packaging step requires Node 22.x (matches gdal-async's node-v127 prebuild). ` +
      `Detected Node ${localNodeVersion}. Install Node 22 LTS, then re-run \`yarn package\`.`,
  );
}

// ── Pick a destination inside the repo (gitignored) ──────────────────────
const STAGING_DIR = path.join(REPO_ROOT, "bundled-runtime");
const STAGING_NODE = path.join(STAGING_DIR, "node.exe");
fs.mkdirSync(STAGING_DIR, { recursive: true });

// ── Idempotency: skip if already populated and current ──────────────────
if (fs.existsSync(STAGING_NODE)) {
  // Compare sizes against the build-machine node.exe; if identical, assume
  // it's already the right binary. Avoids unnecessary copies on incremental
  // package runs.
  const dstSz = fs.statSync(STAGING_NODE).size;
  const srcSz = fs.statSync(process.execPath).size;
  if (dstSz === srcSz && dstSz > 0) {
    console.log(
      `${TAG} OK — ${STAGING_NODE} already matches build-machine node.exe (${formatBytes(dstSz)}). Skipping copy.`,
    );
    process.exit(0);
  }
  console.log(`${TAG} ${STAGING_NODE} stale (size differs) — refreshing.`);
}

// ── Copy build-machine node.exe ─────────────────────────────────────────
console.log(
  `${TAG} bundling Node ${localNodeVersion} runtime from ${process.execPath}…`,
);
fs.copyFileSync(process.execPath, STAGING_NODE);

if (!fs.existsSync(STAGING_NODE) || fs.statSync(STAGING_NODE).size === 0) {
  fail(`Copy failed: ${STAGING_NODE} missing or empty.`);
}

console.log(
  `${TAG} OK — wrote ${STAGING_NODE} (${formatBytes(fs.statSync(STAGING_NODE).size)}).`,
);

// ── Sanity-check the bundled binary actually reports ABI 127 ────────────
// Spawning a quick `node -p process.versions.modules` would be ideal, but
// it adds ~200ms and the version check above is sufficient given Node
// guarantees ABI stability within a major version.

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
