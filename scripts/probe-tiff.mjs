// One-shot TIFF inspector. Reads a .tif file's headers via geotiff.js
// (already in node_modules) and prints dimensions, dtype, bands,
// compression, and storage layout. No GDAL required.
//
// Usage:
//   node scripts/probe-tiff.mjs "<path-to.tif>" ["<path2.tif>" ...]

import { fromFile } from "geotiff";
import { promises as fs } from "fs";
import path from "path";

// TIFF compression code → human label (TIFF 6 spec + GDAL extensions).
const COMPRESSION = {
  1: "None (uncompressed)",
  2: "CCITT 1D",
  3: "Group 3 Fax",
  4: "Group 4 Fax",
  5: "LZW",
  6: "JPEG (old)",
  7: "JPEG",
  8: "Deflate (zlib)",
  9: "T.85 JBIG",
  10: "T.43 JBIG",
  32773: "PackBits",
  32946: "Deflate (legacy)",
  34712: "JPEG 2000",
  34925: "LZMA",
  50000: "ZSTD",
  50001: "WebP",
};

const PHOTOMETRIC = {
  0: "WhiteIsZero (grayscale)",
  1: "BlackIsZero (grayscale)",
  2: "RGB",
  3: "Palette (indexed color)",
  4: "Transparency mask",
  5: "CMYK",
  6: "YCbCr",
  8: "CIELab",
};

const SAMPLE_FORMAT = {
  1: "UnsignedInt",
  2: "SignedInt",
  3: "Float",
  4: "Undefined",
};

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

async function probe(filePath) {
  const stat = await fs.stat(filePath);

  const tiff = await fromFile(filePath);
  const imageCount = await tiff.getImageCount();
  const image = await tiff.getImage(0);
  const fd = image.fileDirectory;

  const width = image.getWidth();
  const height = image.getHeight();
  const samples = image.getSamplesPerPixel();
  const bitsPerSample = fd.BitsPerSample
    ? Array.from(fd.BitsPerSample).join(", ")
    : "?";
  const compressionCode = fd.Compression || 1;
  const compressionName =
    COMPRESSION[compressionCode] || `Unknown(${compressionCode})`;
  const photometricCode = fd.PhotometricInterpretation;
  const photometricName =
    PHOTOMETRIC[photometricCode] || `Unknown(${photometricCode})`;
  const sampleFormatCode = fd.SampleFormat ? fd.SampleFormat[0] : 1;
  const sampleFormatName = SAMPLE_FORMAT[sampleFormatCode] || "?";

  // BigTIFF detection — geotiff.js exposes this on the source.
  const isBigTiff = !!tiff.bigTiff;

  // Tile vs strip storage.
  const isTiled = !!fd.TileWidth;
  const layout = isTiled
    ? `Tiled ${fd.TileWidth}×${fd.TileLength}`
    : `Stripped (RowsPerStrip=${fd.RowsPerStrip ?? "?"})`;

  // Theoretical uncompressed size (assuming primary IFD only).
  const bitsTotal = (fd.BitsPerSample || [8])
    .slice(0, samples)
    .reduce((a, b) => a + b, 0);
  const uncompressedBytes = (width * height * bitsTotal) / 8;
  const ratio = uncompressedBytes / stat.size;

  // Geo info (best-effort).
  let crs = "Unknown";
  try {
    const geoKeys = image.getGeoKeys();
    if (geoKeys?.ProjectedCSTypeGeoKey) {
      crs = `EPSG:${geoKeys.ProjectedCSTypeGeoKey} (projected)`;
    } else if (geoKeys?.GeographicTypeGeoKey) {
      crs = `EPSG:${geoKeys.GeographicTypeGeoKey} (geographic)`;
    }
  } catch {
    /* noop */
  }

  // Pixel size from geotransform.
  let pixelSize = "?";
  try {
    const [sx, sy] = image.getResolution();
    pixelSize = `${Math.abs(sx).toFixed(4)} × ${Math.abs(sy).toFixed(4)} (CRS units)`;
  } catch {
    /* noop */
  }

  // Bounding box.
  let bbox = "?";
  try {
    const [w, s, e, n] = image.getBoundingBox();
    bbox = `[${w.toFixed(2)}, ${s.toFixed(2)}, ${e.toFixed(2)}, ${n.toFixed(2)}]`;
  } catch {
    /* noop */
  }

  // Mirror what dem-worker does: chunked decimated read at 4096-cap.
  const MAX = 4096;
  const maxDim = Math.max(width, height);
  const scale = maxDim > MAX ? MAX / maxDim : 1;
  const tw = Math.max(1, Math.round(width * scale));
  const th = Math.max(1, Math.round(height * scale));

  // Inline a JS port of src/lib/geotiff-decimated.ts for the standalone probe.
  async function readRasterDecimated(img, opts) {
    const sW = img.getWidth();
    const sH = img.getHeight();
    const sLen = opts.interleave !== false ? opts.samples.length : 1;
    if (sW * sH < 100_000_000) {
      const r = await img.readRasters({
        samples: opts.samples,
        width: opts.width,
        height: opts.height,
        interleave: opts.interleave !== false,
      });
      return Array.isArray(r) ? r[0] : r;
    }
    const bps = (img.fileDirectory && img.fileDirectory.BitsPerSample) || [8];
    const bytesPerSample = Math.max(
      1,
      Math.ceil((bps[opts.samples[0]] || 8) / 8),
    );
    const bytesPerRow = sW * bytesPerSample * sLen;
    const cap = opts.maxChunkBytes || 32 * 1024 * 1024;
    const chunkH = Math.max(1, Math.min(sH, Math.floor(cap / bytesPerRow)));
    const totalChunks = Math.ceil(sH / chunkH);
    let output = null;
    let idx = 0;
    for (let y0 = 0; y0 < sH; y0 += chunkH) {
      const y1 = Math.min(y0 + chunkH, sH);
      const tY0 = Math.floor((y0 * opts.height) / sH);
      const tY1 = Math.min(opts.height, Math.ceil((y1 * opts.height) / sH));
      if (tY1 <= tY0) continue;
      const chunk = await img.readRasters({
        window: [0, y0, sW, y1],
        samples: opts.samples,
        width: opts.width,
        height: tY1 - tY0,
        interleave: opts.interleave !== false,
      });
      const arr = Array.isArray(chunk) ? chunk[0] : chunk;
      if (output === null)
        output = new arr.constructor(opts.width * opts.height * sLen);
      output.set(arr, tY0 * opts.width * sLen);
      idx++;
      if (opts.onChunkProgress) opts.onChunkProgress(idx, totalChunks);
    }
    return output;
  }

  const t0 = Date.now();
  const memBefore = process.memoryUsage();
  let lastPrint = 0;
  try {
    const raster = await readRasterDecimated(image, {
      interleave: true,
      samples: [0],
      width: tw,
      height: th,
      onChunkProgress: (done, total) => {
        const now = Date.now();
        if (now - lastPrint > 5000 || done === total) {
          lastPrint = now;
          process.stdout.write(
            `     chunk ${done}/${total} (${Math.round((done / total) * 100)}%) heap=${fmtBytes(process.memoryUsage().heapUsed)}\n`,
          );
        }
      },
    });
    const ms = Date.now() - t0;
    const memAfter = process.memoryUsage();
  } catch (err) {
    const ms = Date.now() - t0;
  }
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error(
    "Usage: node scripts/probe-tiff.mjs <file1.tif> [file2.tif ...]",
  );
  process.exit(1);
}

for (const f of files) {
  try {
    await probe(f);
  } catch (err) {
    console.error(`\n✗ ${f}: ${err.message}`);
  }
}
