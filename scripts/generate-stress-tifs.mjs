/**
 * Generate a stress-test fixture: subdivides a single large GeoTIFF into a
 * grid of small (~1 MB) TIFF tiles, then zips them.
 *
 * Use case: reproduce the "tooltip latency with 200+ small TIFF layers"
 * bug. Each tile is below the 2 MB tiling threshold (src/lib/tiling/
 * threshold.ts), so the renderer treats each as an in-memory BitmapLayer
 * — exactly the path that exhibits the slowdown.
 *
 * Usage:
 *   node scripts/generate-stress-tifs.mjs
 *   node scripts/generate-stress-tifs.mjs --src "D:/TIFF/clutter-india-25m.tif" --cols 20 --rows 15
 *
 * Defaults:
 *   --src   D:/TIFF/clutter-india-25m.tif
 *   --out   D:/TIFF/stress-300            (cleared and recreated)
 *   --zip   D:/TIFF/stress-300.zip        (overwritten)
 *   --cols  20
 *   --rows  15                            (cols × rows = total tile count)
 *
 * Requires: gdal-async (already in node_modules) and PowerShell on Windows
 * for the final zip step (avoids adding a JS zip dep).
 */

import gdal from "gdal-async";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

// ── Args ─────────────────────────────────────────────────────────────────
function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SRC = arg("--src", "D:/TIFF/clutter-india-25m.tif");
const OUT_DIR = arg("--out", "D:/TIFF/stress-300");
const OUT_ZIP = arg("--zip", "D:/TIFF/stress-300.zip");
const COLS = Number(arg("--cols", "20"));
const ROWS = Number(arg("--rows", "15"));

if (!fs.existsSync(SRC)) {
  console.error(`[generate-stress-tifs] source TIFF not found: ${SRC}`);
  process.exit(1);
}
if (!Number.isFinite(COLS) || !Number.isFinite(ROWS) || COLS < 1 || ROWS < 1) {
  console.error(`[generate-stress-tifs] cols/rows must be positive integers`);
  process.exit(1);
}

// ── Subdivide ────────────────────────────────────────────────────────────
const ds = gdal.open(SRC);
const W = ds.rasterSize.x;
const H = ds.rasterSize.y;

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const tw = Math.floor(W / COLS);
const th = Math.floor(H / ROWS);
const total = COLS * ROWS;

let done = 0;
const t0 = Date.now();
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const xoff = c * tw;
    const yoff = r * th;
    // Last column / last row absorb any remainder pixels so we don't lose
    // the right/bottom edges of the source raster.
    const w = c === COLS - 1 ? W - xoff : tw;
    const h = r === ROWS - 1 ? H - yoff : th;

    const out = path.join(OUT_DIR, `tile_r${r}_c${c}.tif`);

    // gdal.translate with -srcwin pulls a sub-window into a fresh GeoTIFF.
    // gdal-async expects a flat string-array of CLI-style flags as the
    // third arg (no TranslateOptions wrapper class in this version).
    // LZW + tiled keeps file size around ~1 MB for typical palette/byte
    // rasters; bump or drop these for other dtypes.
    const opts = [
      "-srcwin",
      String(xoff),
      String(yoff),
      String(w),
      String(h),
      "-co",
      "COMPRESS=LZW",
      "-co",
      "TILED=YES",
    ];

    let tile;
    try {
      tile = gdal.translate(out, ds, opts);
    } catch (e) {
      console.error(
        `[generate-stress-tifs] translate failed for r${r}_c${c}:`,
        e.message,
      );
      throw e;
    } finally {
      if (tile) tile.close();
    }

    done++;
    if (done % 25 === 0 || done === total) {
      const pct = ((done / total) * 100).toFixed(0);
    }
  }
}
ds.close();

const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

// ── Sanity check size distribution ───────────────────────────────────────
const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".tif"));
const sizes = files.map((f) => fs.statSync(path.join(OUT_DIR, f)).size);
const avgKB = (sizes.reduce((a, b) => a + b, 0) / sizes.length / 1024).toFixed(
  0,
);
const minKB = (Math.min(...sizes) / 1024).toFixed(0);
const maxKB = (Math.max(...sizes) / 1024).toFixed(0);

if (Math.max(...sizes) > 2 * 1024 * 1024) {
  console.warn(
    `[generate-stress-tifs] WARNING: at least one tile > 2 MB — those will route through the tiling pipeline, not the BitmapLayer path. Bump --cols / --rows to subdivide further.`,
  );
}

// ── Zip via PowerShell (avoids adding a JS zip dep) ──────────────────────
const psArgs = [
  "-NoProfile",
  "-Command",
  `Compress-Archive -Force -Path '${OUT_DIR.replace(/\\/g, "/")}/*' -DestinationPath '${OUT_ZIP.replace(/\\/g, "/")}'`,
];
const r = spawnSync("powershell", psArgs, { stdio: "inherit" });
if (r.status !== 0) {
  console.error(
    `[generate-stress-tifs] zip step failed (status=${r.status}). The unzipped tiles are still at ${OUT_DIR}; you can zip them manually.`,
  );
  process.exit(1);
}
const zipMB = (fs.statSync(OUT_ZIP).size / 1024 / 1024).toFixed(1);
