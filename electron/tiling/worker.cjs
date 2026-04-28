// Long-running Node child process that holds the gdal-async session.
// Speaks line-delimited JSON over stdin/stdout to the Electron main
// process. ONE process for the whole app lifetime; reuses open datasets.
//
// Why a separate process?
// gdal-async's prebuilt binaries target Node ABI (modules version 127),
// not Electron's patched V8 (modules version 133). Loading directly in
// Electron fails ("DLL initialization routine failed"). Running gdal-async
// in a real Node child sidesteps the ABI mismatch with zero rebuild cost.
//
// Wire protocol:
//   request:  {"id": <number>, "cmd": "<verb>", ...args}
//   response: {"id": <number>, "ok": true, ...result}     // success
//             {"id": <number>, "ok": false, "error": "..."}  // failure
// Each message is a single JSON object terminated by \n.
//
// Verbs:
//   ping      → {pong: true, version: <gdal>}
//   probe     → {bounds, srs, dtype, bands, palette, ...}
//   renderTile→ {png: <base64>}
//   sampleAt  → {value, dtype}
//   close     → {closed: true}   (release any cached datasets)

"use strict";

const readline = require("readline");
const gdal = require("gdal-async");
const sharp = require("sharp");

// ── Dataset cache ────────────────────────────────────────────────────────
// Open + read-headers is a few hundred ms for big files; cache by path so
// every tile/sample request reuses the open Dataset and pre-computed
// metadata (palette, ramp, dtype).
const datasetCache = new Map();
const MAX_OPEN_DATASETS = 16;
const accessOrder = [];

function loadPalette(band) {
  try {
    const ct = band.colorTable;
    if (!ct) return null;
    const n = ct.count();
    const arr = new Array(n);
    for (let i = 0; i < n; i++) {
      const c = ct.get(i);
      arr[i] = [c.c1, c.c2, c.c3, c.c4 ?? 255];
    }
    return arr;
  } catch {
    return null;
  }
}

function buildEntry(path) {
  const ds = gdal.open(path);
  const band = ds.bands.get(1);
  const palette = loadPalette(band);
  const noData = band.noDataValue;

  // Computed band stats — needed for Float ramps. allowApproximation=true so
  // we don't scan the entire raster (uses overviews if present, else samples).
  let min = 0,
    max = 0;
  try {
    const stats = band.getStatistics(true, true);
    min = stats.min;
    max = stats.max;
  } catch {
    /* leave 0 */
  }

  // GDAL's stats functions don't always honor the band's NoData value
  // (e.g. AP_4G.tif uses NoData=-32767 for the void pixels around the
  // state polygon, but getStatistics returns min=-32767, polluting the
  // colour ramp). Detect the case and recompute min/max from a downsampled
  // read with NoData filtered out.
  if (
    Number.isFinite(noData) &&
    (min === noData || max === noData || min < noData * 0.999)
  ) {
    try {
      const W = ds.rasterSize.x;
      const H = ds.rasterSize.y;
      const sw = Math.min(512, W);
      const sh = Math.min(512, H);
      const sample = band.pixels.read(0, 0, W, H, undefined, {
        buffer_width: sw,
        buffer_height: sh,
      });
      let realMin = Infinity;
      let realMax = -Infinity;
      for (let i = 0; i < sample.length; i++) {
        const v = sample[i];
        if (Number.isFinite(v) && v !== noData) {
          if (v < realMin) realMin = v;
          if (v > realMax) realMax = v;
        }
      }
      if (Number.isFinite(realMin) && Number.isFinite(realMax)) {
        min = realMin;
        max = realMax;
      }
    } catch {
      /* fall back to whatever stats gave us */
    }
  }

  return {
    ds,
    palette,
    dtype: band.dataType,
    bandCount: ds.bands.count(),
    colorInterp: band.colorInterpretation,
    min,
    max,
    noData: Number.isFinite(noData) ? noData : null,
    fileName: require("path").basename(path),
  };
}

function openDataset(path) {
  let entry = datasetCache.get(path);
  if (entry) {
    const idx = accessOrder.indexOf(path);
    if (idx >= 0) accessOrder.splice(idx, 1);
    accessOrder.push(path);
    return entry;
  }
  entry = buildEntry(path);
  datasetCache.set(path, entry);
  accessOrder.push(path);
  if (datasetCache.size > MAX_OPEN_DATASETS) {
    const evict = accessOrder.shift();
    if (evict) {
      try {
        datasetCache.get(evict)?.ds?.close();
      } catch {
        /* ignore */
      }
      datasetCache.delete(evict);
    }
  }
  return entry;
}

function closeAllDatasets() {
  for (const entry of datasetCache.values()) {
    try {
      entry.ds.close();
    } catch {
      /* ignore */
    }
  }
  datasetCache.clear();
  accessOrder.length = 0;
}

// ── Colormaps ────────────────────────────────────────────────────────────

/** Pick a Float-ramp kind from the file name + value range. */
function pickFloatRamp(fileName, min, max) {
  const n = (fileName || "").toLowerCase();
  if (/rsrp|rssi|sinr|rsrq|servingss|bestserver|gsm|lte|4g|5g/.test(n)) {
    return "signal";
  }
  if (min < -30 && max < 10 && min > -200) return "signal";
  return "dem";
}

/** Build a 256-entry RGBA lookup for a Float ramp normalised to [min, max]. */
function buildFloatLut(kind, min, max) {
  const lut = new Uint8Array(256 * 4);
  const stops =
    kind === "signal"
      ? [
          [0.0, 165, 0, 38],
          [0.2, 215, 48, 39],
          [0.4, 244, 109, 67],
          [0.5, 253, 174, 97],
          [0.6, 254, 224, 139],
          [0.7, 217, 239, 139],
          [0.8, 166, 217, 106],
          [0.9, 102, 189, 99],
          [1.0, 26, 152, 80],
        ]
      : [
          [0.0, 3, 71, 117],
          [0.05, 16, 132, 169],
          [0.1, 80, 158, 47],
          [0.3, 165, 192, 64],
          [0.5, 217, 191, 121],
          [0.7, 171, 124, 68],
          [0.85, 122, 86, 58],
          [1.0, 255, 255, 255],
        ];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let s0 = stops[0],
      s1 = stops[stops.length - 1];
    for (let k = 1; k < stops.length; k++) {
      if (stops[k][0] >= t) {
        s0 = stops[k - 1];
        s1 = stops[k];
        break;
      }
    }
    const span = s1[0] - s0[0] || 1;
    const f = (t - s0[0]) / span;
    lut[i * 4] = Math.round(s0[1] + (s1[1] - s0[1]) * f);
    lut[i * 4 + 1] = Math.round(s0[2] + (s1[2] - s0[2]) * f);
    lut[i * 4 + 2] = Math.round(s0[3] + (s1[3] - s0[3]) * f);
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

/**
 * Map a 1-band Byte palette index buffer to RGBA bytes via the palette.
 * `mask` is the warp -dstalpha output: 0 = pixel outside source coverage
 * (must come back transparent so the basemap shows through), >0 = inside.
 */
function applyPalette(idxBuf, palette, mask) {
  const n = idxBuf.length;
  const rgba = new Uint8Array(n * 4);
  const fallback = [0, 0, 0, 0];
  const hasMask = mask && mask.length === n;
  for (let i = 0; i < n; i++) {
    if (hasMask && mask[i] === 0) {
      // outside source — leave fully transparent
      continue;
    }
    const c = palette[idxBuf[i]] || fallback;
    rgba[i * 4] = c[0];
    rgba[i * 4 + 1] = c[1];
    rgba[i * 4 + 2] = c[2];
    // Combine palette alpha with warp mask so partial-coverage edges fade.
    rgba[i * 4 + 3] = hasMask
      ? Math.min(c[3], mask[i])
      : c[3];
  }
  return rgba;
}

/** Map Float64 values [min..max] to RGBA via a precomputed 256-entry LUT.
 *  NoData pixels, non-finite values, and warp-mask=0 (outside source
 *  coverage) all come back fully transparent.
 */
function applyFloatRamp(floatBuf, min, max, lut, noData, mask) {
  const n = floatBuf.length;
  const rgba = new Uint8Array(n * 4);
  const span = max - min || 1;
  const hasNoData = Number.isFinite(noData);
  const hasMask = mask && mask.length === n;
  // Tolerance: warp's bilinear resampling can produce values *near* the
  // NoData sentinel even when -srcnodata is set, especially at the edges
  // of the data envelope. Anything that's clearly outside the real value
  // range (more than 5% of the span below min) is also treated as NoData.
  const noDataFloor = min - 0.05 * span;
  for (let i = 0; i < n; i++) {
    if (hasMask && mask[i] === 0) continue; // outside source — transparent
    const v = floatBuf[i];
    if (
      !Number.isFinite(v) ||
      (hasNoData && v === noData) ||
      v < noDataFloor
    ) {
      rgba[i * 4 + 3] = 0;
      continue;
    }
    let t = (v - min) / span;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const lutIdx = Math.min(255, Math.floor(t * 256));
    rgba[i * 4] = lut[lutIdx * 4];
    rgba[i * 4 + 1] = lut[lutIdx * 4 + 1];
    rgba[i * 4 + 2] = lut[lutIdx * 4 + 2];
    rgba[i * 4 + 3] = hasMask ? mask[i] : 255;
  }
  return rgba;
}

/** Map a single-band Byte (no palette) to grayscale RGBA.
 *  `mask` is the warp -dstalpha output: 0 = pixel outside source coverage. */
function applyGrayscale(buf, mask) {
  const n = buf.length;
  const rgba = new Uint8Array(n * 4);
  const hasMask = mask && mask.length === n;
  for (let i = 0; i < n; i++) {
    if (hasMask && mask[i] === 0) continue; // outside source — transparent
    const v = buf[i];
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = hasMask ? mask[i] : 255;
  }
  return rgba;
}

// ── Helpers ──────────────────────────────────────────────────────────────

// Web Mercator constants for the standard XYZ tile scheme (EPSG:3857).
const HALF_EXTENT = 20037508.342789244;
const FULL_EXTENT = HALF_EXTENT * 2;

/** Tile XYZ → bounding box in EPSG:3857 metres [minX, minY, maxX, maxY]. */
function tileBounds3857(z, x, y) {
  const tilesPerSide = 1 << z;
  const tileSize = FULL_EXTENT / tilesPerSide;
  const minX = -HALF_EXTENT + x * tileSize;
  const maxX = minX + tileSize;
  // XYZ tile Y is from the top; flip for metres-from-bottom math.
  const maxY = HALF_EXTENT - y * tileSize;
  const minY = maxY - tileSize;
  return [minX, minY, maxX, maxY];
}

/** EPSG:3857 metres → WGS84 [lon, lat]. */
function meters3857ToLonLat(x, y) {
  const lon = (x / HALF_EXTENT) * 180;
  const lat =
    (Math.atan(Math.exp((y / HALF_EXTENT) * Math.PI)) / Math.PI) * 360 - 90;
  return [lon, lat];
}

function srsAuthority(srs) {
  try {
    const code = srs?.getAuthorityCode?.();
    return code ? `EPSG:${code}` : srs?.toWKT?.() || null;
  } catch {
    return null;
  }
}

// ── Verbs ────────────────────────────────────────────────────────────────

function ping() {
  return { pong: true, version: gdal.version, lastError: gdal.lastError };
}

/**
 * Probe a raster: width/height, bands, dtype, source CRS, WGS84 bounds,
 * computed min/max for sample 0, palette (if present).
 */
function probe(args) {
  const entry = openDataset(args.path);
  const ds = entry.ds;
  const bands = ds.bands.count();
  const band = ds.bands.get(1);
  const dtype = band.dataType;
  const srs = ds.srs;
  const sourceCrs = srsAuthority(srs);

  // Geo-transform → corners in source CRS → reproject to WGS84
  const gt = ds.geoTransform;
  const w = ds.rasterSize.x;
  const h = ds.rasterSize.y;
  const corners = [
    [gt[0], gt[3]], // top-left
    [gt[0] + w * gt[1], gt[3]], // top-right
    [gt[0] + w * gt[1] + h * gt[2], gt[3] + w * gt[4] + h * gt[5]], // bot-right
    [gt[0] + h * gt[2], gt[3] + h * gt[5]], // bot-left
  ];

  let boundsWgs84 = null;
  try {
    const wgs84 = gdal.SpatialReference.fromEPSG(4326);
    const tx = new gdal.CoordinateTransformation(srs, wgs84);
    // Axis-order quirk in gdal-async (no setAxisMappingStrategy exposed):
    //   - Projected source (3857, UTM, …) → 4326: output is (lat, lon)
    //     because GDAL respects 4326's *official* axis order — swap.
    //   - Geographic source (4326, …) → 4326: transform short-circuits
    //     and preserves whatever order the input had (TIFFs encode
    //     geo-transform in traditional GIS (lon, lat) order) — no swap.
    const swap = srs.isProjected();
    let minLon = Infinity,
      minLat = Infinity,
      maxLon = -Infinity,
      maxLat = -Infinity;
    for (const [x, y] of corners) {
      const r = tx.transformPoint(x, y);
      const lon = swap ? r.y : r.x;
      const lat = swap ? r.x : r.y;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    boundsWgs84 = [minLon, minLat, maxLon, maxLat];
  } catch (e) {
    // CRS may be undefined or unsupported; bounds stay null.
  }

  // Pixel size in CRS units (usually metres for 3857/UTM).
  const pixelSize = Math.max(Math.abs(gt[1]), Math.abs(gt[5]));
  // Native max zoom: the zoom at which 1 web-mercator pixel ≈ 1 source pixel.
  const nativeZoom = Math.max(
    0,
    Math.min(22, Math.round(Math.log2(40075016.686 / (pixelSize * 256)))),
  );

  return {
    width: w,
    height: h,
    bands,
    dtype,
    sourceCrs,
    boundsWgs84,
    palette: entry.palette,
    min: entry.min,
    max: entry.max,
    pixelSize,
    nativeZoom,
    colorInterp: entry.colorInterp,
  };
}

/**
 * Render one 256×256 tile (z, x, y) from `path` as a WebP buffer (base64).
 * Pipeline:
 *   1. gdal.reprojectImageAsync → 256×256 MEM dataset in EPSG:3857
 *      - Palette/grayscale: 1-band Byte
 *      - Multi-band Byte:   3-4 band Byte (RGB / RGBA passthrough)
 *      - Float/Int:         1-band Float64
 *   2. Build a single 256×256 RGBA Buffer in JS
 *      (palette LUT / float ramp / grayscale → already interleaved;
 *       RGB passthrough → de-interleave the bands)
 *   3. sharp.webp({lossless:true}) — encode to WebP
 *
 * WebP buys ~25-35 % smaller bytes than PNG and lets us drop GDAL's PNG
 * driver + the intermediate `packRgbaIntoMem` 4-band MEM dataset, which
 * each held the GDAL global mutex during sync close()/createCopy/release.
 * Removing them cuts mutex contention dramatically — concurrent renders
 * actually run concurrently instead of serialising on cleanup.
 */
async function renderTile(args) {
  const entry = openDataset(args.path);
  const ds = entry.ds;
  const [minX, minY, maxX, maxY] = tileBounds3857(args.z, args.x, args.y);

  const inType = entry.dtype;
  const isPalette = !!entry.palette;
  const isByteRGB = inType === gdal.GDT_Byte && entry.bandCount >= 3;
  const isByteGray = inType === gdal.GDT_Byte && entry.bandCount < 3 && !isPalette;
  const isFloat = !isByteRGB && !isByteGray && !isPalette;

  // gdal.warpAsync is the CLI-equivalent (gdalwarp) — unlike reprojectImage
  // it auto-selects the closest overview level, which is what makes
  // low/mid-zoom tiles fast on rasters with a .ovr sidecar.
  // Output goes to /vsimem/ (in-memory virtual file). We must release it
  // ourselves once the bands have been read.
  const vsipath = `/vsimem/warp_${process.pid}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}.tif`;
  let warped;
  try {
    warped = await gdal.warpAsync(vsipath, null, [ds], [
      "-r", isPalette ? "near" : "bilinear",
      "-ts", "256", "256",
      "-te", String(minX), String(minY), String(maxX), String(maxY),
      "-t_srs", "EPSG:3857",
      "-ovr", "AUTO",
      // Always ask warp for an explicit alpha band. Without it, pixels
      // outside the source coverage are filled with 0 — and for palette
      // sources the LUT entry at index 0 is often opaque (commonly black),
      // creating an ugly opaque rectangle around the real data. The alpha
      // band tells us exactly which pixels were inside source coverage.
      "-dstalpha",
      // Tell warp about the source NoData so it doesn't average -32767
      // with -75 dBm into nonsense at tile edges. Both src+dst so the
      // warp output preserves the sentinel for our colour-ramp step.
      ...(entry.noData != null
        ? ["-srcnodata", String(entry.noData), "-dstnodata", String(entry.noData)]
        : []),
    ]);
  } catch (e) {
    try { gdal.vsimem.release(vsipath); } catch { /* nothing to free */ }
    throw new Error(`warp failed: ${e.message}`);
  }

  const warpBandCount = warped.bands.count();

  // With "-dstalpha" the last band is always the warp alpha mask
  // (255 = pixel inside source coverage, 0 = outside).
  const alphaBandIdx = warpBandCount;
  const alphaPromise = warped.bands
    .get(alphaBandIdx)
    .pixels.readAsync(0, 0, 256, 256);

  // Build a single 256×256 interleaved RGBA Uint8Array.
  let rgba;
  try {
    if (isByteRGB) {
      // Read R/G/B and the alpha mask in parallel.
      const [r, g, b, a] = await Promise.all([
        warped.bands.get(1).pixels.readAsync(0, 0, 256, 256),
        warped.bands.get(2).pixels.readAsync(0, 0, 256, 256),
        warped.bands.get(3).pixels.readAsync(0, 0, 256, 256),
        alphaPromise,
      ]);
      rgba = new Uint8Array(256 * 256 * 4);
      for (let i = 0; i < 256 * 256; i++) {
        rgba[i * 4] = r[i];
        rgba[i * 4 + 1] = g[i];
        rgba[i * 4 + 2] = b[i];
        rgba[i * 4 + 3] = a[i];
      }
    } else if (isPalette) {
      const [idx, a] = await Promise.all([
        warped.bands.get(1).pixels.readAsync(0, 0, 256, 256),
        alphaPromise,
      ]);
      rgba = applyPalette(idx, entry.palette, a);
    } else if (isFloat) {
      const [buf, a] = await Promise.all([
        warped.bands.get(1).pixels.readAsync(0, 0, 256, 256),
        alphaPromise,
      ]);
      const rampKind = pickFloatRamp(entry.fileName, entry.min, entry.max);
      const lut = buildFloatLut(rampKind, entry.min, entry.max);
      rgba = applyFloatRamp(buf, entry.min, entry.max, lut, entry.noData, a);
    } else {
      // Single-band Byte without a palette → grayscale RGBA.
      const [buf, a] = await Promise.all([
        warped.bands.get(1).pixels.readAsync(0, 0, 256, 256),
        alphaPromise,
      ]);
      rgba = applyGrayscale(buf, a);
    }
  } catch (e) {
    warped.close();
    try { gdal.vsimem.release(vsipath); } catch { /* noop */ }
    throw new Error(`colormap failed: ${e.message}`);
  }

  // Encode as lossless WebP via sharp (libvips). No GDAL involvement —
  // releases the global mutex immediately after the warp/reads above.
  let webpBuf;
  try {
    webpBuf = await sharp(
      Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength),
      { raw: { width: 256, height: 256, channels: 4 } },
    )
      .webp({ lossless: true, effort: 2 })
      .toBuffer();
  } catch (e) {
    warped.close();
    try { gdal.vsimem.release(vsipath); } catch { /* noop */ }
    throw new Error(`WebP encode failed: ${e.message}`);
  }

  warped.close();
  try { gdal.vsimem.release(vsipath); } catch { /* noop */ }
  return { image: webpBuf.toString("base64"), format: "webp" };
}

/**
 * Build internal overview pyramid for a raster, in place. Writes a `.ovr`
 * sidecar next to the source `.tif`. One-time cost; afterwards, every
 * low/mid-zoom tile is 10-100× faster because GDAL reads from a
 * pre-decimated pyramid level instead of scanning the full raster.
 *
 * Skips:
 *   - rasters that already have overviews
 *   - small rasters where overviews wouldn't help
 *
 * Resampling kind:
 *   - palette → NEAREST (preserves class indices; AVERAGE would smear)
 *   - everything else → AVERAGE
 */
async function buildOverviews(args) {
  const entry = openDataset(args.path);
  const ds = entry.ds;
  const band = ds.bands.get(1);

  let existingCount = 0;
  try {
    existingCount = band.overviews.count();
  } catch {
    /* assume zero */
  }
  if (existingCount > 0) {
    return { built: false, reason: "already-exists", count: existingCount };
  }

  const w = ds.rasterSize.x;
  const h = ds.rasterSize.y;
  if (Math.max(w, h) < 4096) {
    return { built: false, reason: "too-small", width: w, height: h };
  }

  const kind = entry.palette ? "NEAREST" : "AVERAGE";
  const levels = [2, 4, 8, 16, 32];

  await ds.buildOverviewsAsync(kind, levels);
  return { built: true, kind, levels, width: w, height: h };
}

/**
 * Sample one pixel from the source raster at (lon, lat) in WGS84.
 * Returns the underlying numeric value (Float for Float bands, Int for
 * integer bands, palette index for palette bands). Async so concurrent
 * hover samples don't block tile renders.
 */
async function sampleAt(args) {
  const entry = openDataset(args.path);
  const ds = entry.ds;
  const band = ds.bands.get(1);
  const srs = ds.srs;

  // Project lon/lat → source CRS coordinates. The axis-order quirk is the
  // mirror of probe(): when the destination is projected, gdal-async
  // expects EPSG:4326 input in *official* (lat, lon) order; when the
  // destination is geographic (no real transform), input passes through
  // and we keep traditional (lon, lat). Both produce p.x=lon-or-easting,
  // p.y=lat-or-northing, which lines up with the geo-transform below.
  const wgs84 = gdal.SpatialReference.fromEPSG(4326);
  const tx = new gdal.CoordinateTransformation(wgs84, srs);
  const p = srs.isProjected()
    ? tx.transformPoint(args.lat, args.lon)
    : tx.transformPoint(args.lon, args.lat);

  // Inverse geo-transform: source metres → pixel/line
  const gt = ds.geoTransform;
  const det = gt[1] * gt[5] - gt[2] * gt[4];
  if (det === 0) return { value: null, dtype: band.dataType };
  const px = Math.round(((p.x - gt[0]) * gt[5] - (p.y - gt[3]) * gt[2]) / det);
  const py = Math.round(((p.y - gt[3]) * gt[1] - (p.x - gt[0]) * gt[4]) / det);
  if (px < 0 || py < 0 || px >= ds.rasterSize.x || py >= ds.rasterSize.y) {
    return { value: null, dtype: band.dataType };
  }

  // Read 1×1 window
  const out = await band.pixels.readAsync(px, py, 1, 1);
  const value = out[0];
  return { value, dtype: band.dataType };
}

// ── Dispatch ─────────────────────────────────────────────────────────────

const handlers = {
  ping,
  probe,
  buildOverviews,
  renderTile,
  sampleAt,
  close: () => {
    closeAllDatasets();
    return { closed: true };
  },
};

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch (e) {
    process.stdout.write(
      JSON.stringify({ id: null, ok: false, error: `Bad JSON: ${e.message}` }) +
        "\n",
    );
    return;
  }
  const { id, cmd } = req;
  const handler = handlers[cmd];
  if (!handler) {
    process.stdout.write(
      JSON.stringify({ id, ok: false, error: `Unknown cmd: ${cmd}` }) + "\n",
    );
    return;
  }
  try {
    const result = handler(req);
    if (result && typeof result.then === "function") {
      result.then(
        (r) => process.stdout.write(JSON.stringify({ id, ok: true, ...r }) + "\n"),
        (e) =>
          process.stdout.write(
            JSON.stringify({ id, ok: false, error: e.message }) + "\n",
          ),
      );
    } else {
      process.stdout.write(JSON.stringify({ id, ok: true, ...result }) + "\n");
    }
  } catch (e) {
    process.stdout.write(
      JSON.stringify({ id, ok: false, error: e.message }) + "\n",
    );
  }
});

// Announce ready so main can confirm spawn succeeded.
process.stdout.write(
  JSON.stringify({ id: 0, ok: true, ready: true, gdal: gdal.version }) + "\n",
);

process.on("SIGTERM", () => {
  closeAllDatasets();
  process.exit(0);
});
