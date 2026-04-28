// Lightweight DEM worker: parse GeoTIFF/HGT into elevation + grayscale (no DOM).
// Returns plain data buffers. Main thread builds canvas.
// Timeout is enforced by caller.

import {
  DEM_NO_DATA_VALUE,
  DEM_MIN_VALID_ELEVATION,
  DEM_MAX_VALID_ELEVATION,
} from "@/lib/constants";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const ctx: any = self as any;

type DemWorkerRequest = {
  type: "parse-dem";
  name: string;
  buffer: ArrayBuffer;
};

type DemWorkerResponse = {
  type: "parse-dem-result";
  name: string;
  kind: "dem" | "color";
  width: number;
  height: number;
  min: number;
  max: number;
  bounds: [number, number, number, number];
  // DEM path only
  elevationBuffer: ArrayBuffer;
  grayscaleBuffer: ArrayBuffer;
  // Color path only
  rgbaBuffer?: ArrayBuffer;
  error?: string;
};

// Minimal LCC helpers (parity with utils)
type LCCProjectionParams = {
  standardParallel1: number;
  standardParallel2: number;
  centralMeridian: number;
  latitudeOfOrigin: number;
  falseEasting?: number;
  falseNorthing?: number;
  datum?: string;
  units?: "m" | "ft" | "us-ft";
};

const detectLCCProjection = (
  projectionString: string | undefined | null,
): LCCProjectionParams | null => {
  if (!projectionString) return null;
  const upper = projectionString.toUpperCase();
  const isLcc =
    upper.includes("LAMBERT_CONFORMAL_CONIC") ||
    upper.includes("LAMBERT CONFORMAL CONIC") ||
    upper.includes("LAMBERT_CONFORMAL_CONIC_2SP") ||
    upper.includes("+PROJ=LCC") ||
    (upper.includes("PROJCS") && upper.includes("LAMBERT"));
  if (!isLcc) return null;

  const stdPar1Match = projectionString.match(
    /standard_parallel_1["\s]*([\d.+-]+)/i,
  );
  const stdPar2Match = projectionString.match(
    /standard_parallel_2["\s]*([\d.+-]+)/i,
  );
  const centralMeridianMatch = projectionString.match(
    /central_meridian["\s]*([\d.+-]+)/i,
  );
  const latOriginMatch = projectionString.match(
    /latitude_of_origin["\s]*([\d.+-]+)/i,
  );
  const falseEastingMatch = projectionString.match(
    /false_easting["\s]*([\d.+-]+)/i,
  );
  const falseNorthingMatch = projectionString.match(
    /false_northing["\s]*([\d.+-]+)/i,
  );

  let datum = "WGS84";
  const geogcsMatch = projectionString.match(
    /GEOGCS\["[^"]*",\s*DATUM\["([^"]+)"/i,
  );
  if (geogcsMatch) {
    const d = geogcsMatch[1].toUpperCase();
    if (d.includes("NAD83")) datum = "NAD83";
  }

  if (stdPar1Match && stdPar2Match && centralMeridianMatch && latOriginMatch) {
    return {
      standardParallel1: parseFloat(stdPar1Match[1]),
      standardParallel2: parseFloat(stdPar2Match[1]),
      centralMeridian: parseFloat(centralMeridianMatch[1]),
      latitudeOfOrigin: parseFloat(latOriginMatch[1]),
      falseEasting: falseEastingMatch ? parseFloat(falseEastingMatch[1]) : 0,
      falseNorthing: falseNorthingMatch ? parseFloat(falseNorthingMatch[1]) : 0,
      datum,
    };
  }
  return null;
};

const detectLCCFromGeoKeys = (image: any): LCCProjectionParams | null => {
  if (!image || typeof image.getGeoKeys !== "function") return null;
  const geoKeys = image.getGeoKeys?.();
  if (!geoKeys) return null;
  const trans = geoKeys.ProjCoordTransGeoKey;
  const hasLambertCitation =
    (typeof geoKeys.GTCitationGeoKey === "string" &&
      geoKeys.GTCitationGeoKey.toLowerCase().includes("lambert")) ||
    (typeof geoKeys.PCSCitationGeoKey === "string" &&
      geoKeys.PCSCitationGeoKey.toLowerCase().includes("lambert"));
  const stdPar1Raw =
    geoKeys.ProjStdParallel1GeoKey ??
    geoKeys.StdParallel1 ??
    geoKeys.StandardParallel1 ??
    null;
  const stdPar2Raw =
    geoKeys.ProjStdParallel2GeoKey ??
    geoKeys.StdParallel2 ??
    geoKeys.StandardParallel2 ??
    null;
  const lon0Raw =
    geoKeys.ProjNatOriginLongGeoKey ??
    geoKeys.LongitudeOfOrigin ??
    geoKeys.ProjFalseOriginLongGeoKey ??
    null;
  const lat0Raw =
    geoKeys.ProjNatOriginLatGeoKey ??
    geoKeys.LatitudeOfOrigin ??
    geoKeys.ProjFalseOriginLatGeoKey ??
    null;
  const isLcc =
    trans === 8 ||
    trans === 9 ||
    hasLambertCitation ||
    (stdPar1Raw !== null &&
      stdPar2Raw !== null &&
      lon0Raw !== null &&
      lat0Raw !== null);
  if (!isLcc) return null;
  return {
    standardParallel1: Number(stdPar1Raw),
    standardParallel2: Number(stdPar2Raw),
    centralMeridian: Number(lon0Raw),
    latitudeOfOrigin: Number(lat0Raw),
    falseEasting:
      geoKeys.ProjFalseEastingGeoKey ??
      geoKeys.FalseEasting ??
      geoKeys.ProjFalseOriginEastingGeoKey ??
      0,
    falseNorthing:
      geoKeys.ProjFalseNorthingGeoKey ??
      geoKeys.FalseNorthing ??
      geoKeys.ProjFalseOriginNorthingGeoKey ??
      0,
    datum: "WGS84",
    units:
      geoKeys.ProjLinearUnitsGeoKey === 9002
        ? "ft"
        : geoKeys.ProjLinearUnitsGeoKey === 9003
          ? "us-ft"
          : "m",
  };
};

const convertLCCToWGS84 = (
  x: number,
  y: number,
  lcc: LCCProjectionParams,
  proj4: any,
): [number, number] => {
  const units = lcc.units || "m";
  const def = `+proj=lcc +lat_1=${lcc.standardParallel1} +lat_2=${
    lcc.standardParallel2
  } +lon_0=${lcc.centralMeridian} +lat_0=${lcc.latitudeOfOrigin} +x_0=${
    lcc.falseEasting || 0
  } +y_0=${lcc.falseNorthing || 0} +datum=${lcc.datum || "WGS84"} +units=${
    units === "us-ft" ? "us-ft" : units
  } +no_defs`;
  proj4.defs("LCC_SRC", def);
  const [lng, lat] = proj4("LCC_SRC", "EPSG:4326", [x, y]);
  return [lng, lat];
};

// HGT parser
const parseHGT = async (buffer: ArrayBuffer) => {
  const dataView = new DataView(buffer);
  const fileSize = buffer.byteLength;
  const pixelCount = fileSize / 2;
  const size = Math.sqrt(pixelCount);
  let width: number;
  let height: number;
  if (size === 1201) {
    width = 1201;
    height = 1201;
  } else if (size === 3601) {
    width = 3601;
    height = 3601;
  } else {
    width = Math.round(size);
    height = Math.round(size);
    if (width * height * 2 !== fileSize) {
      throw new Error(
        `Invalid HGT file size: ${fileSize} bytes. Expected size for 1201x1201 or 3601x3601 grid.`,
      );
    }
  }
  const safeName = typeof name === "string" ? name : "";
  const fileName = safeName.toUpperCase().replace(/\.HGT$/, "");
  let minLat = 6.0;
  let minLng = 68.0;
  let maxLat = 37.0;
  let maxLng = 97.0;
  const coordMatch = fileName.match(/([NS])(\d+)([EW])(\d+)/);
  if (coordMatch) {
    const latDir = coordMatch[1];
    const latVal = parseInt(coordMatch[2], 10);
    const lngDir = coordMatch[3];
    const lngVal = parseInt(coordMatch[4], 10);
    minLat = latDir === "N" ? latVal : -latVal;
    minLng = lngDir === "E" ? lngVal : -lngVal;
    maxLat = minLat + 1;
    maxLng = minLng + 1;
  }
  const elevationData = new Float32Array(width * height);
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let i = 0; i < width * height; i++) {
    const elevation = dataView.getInt16(i * 2, false);
    if (
      elevation === DEM_NO_DATA_VALUE ||
      elevation < DEM_MIN_VALID_ELEVATION ||
      elevation > DEM_MAX_VALID_ELEVATION
    ) {
      elevationData[i] = minVal !== Infinity ? minVal : 0;
    } else {
      elevationData[i] = elevation;
      if (elevation < minVal) minVal = elevation;
      if (elevation > maxVal) maxVal = elevation;
    }
  }
  if (
    !Number.isFinite(minVal) ||
    !Number.isFinite(maxVal) ||
    minVal === maxVal
  ) {
    minVal = 0;
    maxVal = 1;
  }
  const grayscale = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const elevation = elevationData[i];
    const t = (elevation - minVal) / (maxVal - minVal);
    const shade = Math.max(0, Math.min(255, Math.round(t * 255)));
    const idx = i * 4;
    grayscale[idx] = shade;
    grayscale[idx + 1] = shade;
    grayscale[idx + 2] = shade;
    grayscale[idx + 3] = 255;
  }
  return {
    kind: "dem" as const,
    bounds: [minLng, minLat, maxLng, maxLat] as [
      number,
      number,
      number,
      number,
    ],
    width,
    height,
    data: elevationData,
    min: minVal,
    max: maxVal,
    grayscale,
  };
};

// Classify a TIFF image as DEM (single-band numeric) vs. color (RGB/RGBA/Palette).
// Uses only already-parsed tags — O(1), no raster pass.
type TiffClassification = {
  kind: "dem" | "color";
  mode: "rgb" | "rgba" | "palette" | "dem";
  samplesPerPixel: number;
  bitsPerSample: number[];
  sampleFormats: number[];
  photometric: number;
  hasAlpha: boolean;
  colorMap?: number[] | Uint16Array | null;
};

type TiffImageShape = {
  fileDirectory?: Record<string, unknown>;
  getSamplesPerPixel?: () => number;
};

const toNum = (v: unknown): number => Number(v);

const classifyTiff = (image: TiffImageShape): TiffClassification => {
  const fd = (image.fileDirectory ?? {}) as Record<string, unknown>;
  const sppRaw =
    typeof image.getSamplesPerPixel === "function"
      ? image.getSamplesPerPixel()
      : fd.SamplesPerPixel;
  const samplesPerPixel: number = Number.isFinite(sppRaw as number)
    ? Number(sppRaw)
    : 1;

  const bitsRaw = fd.BitsPerSample;
  const bitsPerSample: number[] = Array.isArray(bitsRaw)
    ? (bitsRaw as unknown[]).map(toNum)
    : bitsRaw != null
      ? [Number(bitsRaw)]
      : [8];

  const fmtRaw = fd.SampleFormat;
  const sampleFormats: number[] = Array.isArray(fmtRaw)
    ? (fmtRaw as unknown[]).map(toNum)
    : fmtRaw != null
      ? [Number(fmtRaw)]
      : [1];

  const photoRaw = fd.PhotometricInterpretation;
  const photometric: number = Array.isArray(photoRaw)
    ? Number((photoRaw as unknown[])[0])
    : photoRaw != null
      ? Number(photoRaw)
      : 1;

  const extraRaw = fd.ExtraSamples;
  const extraSamples: number[] = Array.isArray(extraRaw)
    ? (extraRaw as unknown[]).map(toNum)
    : extraRaw != null
      ? [Number(extraRaw)]
      : [];
  const hasAlpha =
    (samplesPerPixel === 4 && photometric === 2) ||
    extraSamples.some((v) => v === 1 || v === 2);

  const colorMap = (fd.ColorMap as number[] | Uint16Array | undefined) ?? null;

  const fmt0 = sampleFormats[0] ?? 1;
  const isFloatOrIntDem = samplesPerPixel === 1 && (fmt0 === 2 || fmt0 === 3);
  const is16BitSingleUint =
    samplesPerPixel === 1 && fmt0 === 1 && (bitsPerSample[0] ?? 8) >= 16;

  if (photometric === 3 && colorMap) {
    return {
      kind: "color",
      mode: "palette",
      samplesPerPixel,
      bitsPerSample,
      sampleFormats,
      photometric,
      hasAlpha: false,
      colorMap,
    };
  }

  if (photometric === 2 && samplesPerPixel >= 3) {
    return {
      kind: "color",
      mode: hasAlpha || samplesPerPixel >= 4 ? "rgba" : "rgb",
      samplesPerPixel,
      bitsPerSample,
      sampleFormats,
      photometric,
      hasAlpha: hasAlpha || samplesPerPixel >= 4,
      colorMap: null,
    };
  }

  // YCbCr (6), CIELab (8), ICCLab (9), ITULab (10), CMYK (5) — geotiff can
  // decode-and-convert these to sRGB via readRGB(), so treat them as color.
  // Common case: JPEG-compressed TIFFs are YCbCr.
  if (
    photometric === 5 ||
    photometric === 6 ||
    photometric === 8 ||
    photometric === 9 ||
    photometric === 10
  ) {
    return {
      kind: "color",
      mode: "rgb",
      samplesPerPixel,
      bitsPerSample,
      sampleFormats,
      photometric,
      hasAlpha: false,
      colorMap: null,
    };
  }

  // Single-band numeric rasters (elevation DEMs, including 16-bit integer grayscale
  // datasets that the pipeline has always treated as DEMs) stay on the DEM path.
  if (isFloatOrIntDem || is16BitSingleUint || samplesPerPixel === 1) {
    return {
      kind: "dem",
      mode: "dem",
      samplesPerPixel,
      bitsPerSample,
      sampleFormats,
      photometric,
      hasAlpha: false,
      colorMap: null,
    };
  }

  // Unknown multi-sample config — treat as color to at least show something sane.
  return {
    kind: "color",
    mode: samplesPerPixel >= 4 ? "rgba" : "rgb",
    samplesPerPixel,
    bitsPerSample,
    sampleFormats,
    photometric,
    hasAlpha: samplesPerPixel >= 4,
    colorMap: null,
  };
};

// Convert an arbitrary typed-array sample value to an 8-bit channel using the
// tag-declared BitsPerSample. Avoids per-pixel branching and extra passes.
const makeTo8 = (bits: number) => {
  if (bits <= 8) return (v: number) => v & 0xff;
  if (bits === 16) return (v: number) => (v >> 8) & 0xff;
  const shift = Math.max(0, bits - 8);
  return (v: number) => (v >> shift) & 0xff;
};

// GPU-safe ceiling. deck.gl BitmapLayer uploads the canvas as a WebGL texture.
// 4096 is the minimum guaranteed MAX_TEXTURE_SIZE across devices (WebGL1/2 spec).
// Anything larger causes "Desired resource size is greater than max texture size"
// and the texture silently becomes black. Downsampling at decode time (via
// geotiff's width/height options) is far cheaper than reading full-res and
// downscaling in JS afterwards.
const MAX_TEXTURE_DIM = 4096;

const computeTexSize = (width: number, height: number) => {
  const maxDim = Math.max(width, height);
  if (maxDim <= MAX_TEXTURE_DIM) return { texWidth: width, texHeight: height };
  const scale = MAX_TEXTURE_DIM / maxDim;
  return {
    texWidth: Math.max(1, Math.round(width * scale)),
    texHeight: Math.max(1, Math.round(height * scale)),
  };
};

// GeoTIFF parser
const parseGeoTIFF = async (buffer: ArrayBuffer) => {
  const geotiff = await import("geotiff");
  const proj4 = (await import("proj4")).default;
  const tiff = await geotiff.fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();

  const classification = classifyTiff(image);

  // Log a concise diagnostic — critical for troubleshooting "black" / "wrong
  // place" TIFFs. Shows photometric, samples, bits, dimensions, and any GeoKeys
  // the file actually carries.
  try {
    const fd: Record<string, unknown> =
      (image as unknown as { fileDirectory?: Record<string, unknown> })
        .fileDirectory ?? {};
    const geoKeys =
      typeof (image as unknown as { getGeoKeys?: () => unknown }).getGeoKeys ===
      "function"
        ? (image as unknown as { getGeoKeys: () => unknown }).getGeoKeys()
        : undefined;
    console.log("[dem-worker] GeoTIFF diagnostic", {
      width,
      height,
      classification: {
        kind: classification.kind,
        mode: classification.mode,
        samplesPerPixel: classification.samplesPerPixel,
        bitsPerSample: classification.bitsPerSample,
        photometric: classification.photometric,
      },
      compression: fd.Compression,
      hasModelTiepoint: Array.isArray(fd.ModelTiepointTag),
      hasModelPixelScale: Array.isArray(fd.ModelPixelScaleTag),
      hasTransformationMatrix: Array.isArray(fd.GeoTransformationMatrix),
      geoAsciiParams: fd.GeoAsciiParamsTag,
      geoKeys,
    });
  } catch {
    // ignore diagnostic failures
  }

  let bounds: [number, number, number, number];
  let lccParams: LCCProjectionParams | null = null;

  const origin =
    typeof image.getOrigin === "function" ? image.getOrigin() : null;
  const resolution =
    typeof image.getResolution === "function" ? image.getResolution() : null;

  if (
    origin &&
    resolution &&
    origin.length >= 2 &&
    resolution.length >= 2 &&
    origin.every((v: any) => Number.isFinite(v)) &&
    resolution.every((v: any) => Number.isFinite(v))
  ) {
    const [originX, originY] = origin;
    const [resX, resY] = resolution;
    const minX = originX;
    const maxX = originX + width * resX;
    const maxY = originY;
    const minY = originY + height * resY;
    bounds = [
      Math.min(minX, maxX),
      Math.min(minY, maxY),
      Math.max(minX, maxX),
      Math.max(minY, maxY),
    ];
  } else {
    try {
      const bbox = image.getBoundingBox();
      if (
        bbox &&
        bbox.length === 4 &&
        bbox.every((v: any) => Number.isFinite(v))
      ) {
        bounds = bbox as [number, number, number, number];
      } else {
        throw new Error("No valid bounding box");
      }
    } catch {
      try {
        const fileDirectory = image.fileDirectory;
        const modelPixelScaleTag = fileDirectory.ModelPixelScaleTag;
        const modelTiepointTag = fileDirectory.ModelTiepointTag;
        const geoAsciiParamsTag = fileDirectory.GeoAsciiParamsTag;

        if (
          modelTiepointTag &&
          modelPixelScaleTag &&
          modelTiepointTag.length >= 6
        ) {
          const [tieI, tieJ, worldX, worldY] = modelTiepointTag;
          const [scaleX, scaleY] = modelPixelScaleTag;
          const originX = worldX - tieI * scaleX;
          const originY = worldY - tieJ * scaleY;
          const minX = originX;
          const maxX = originX + width * scaleX;
          const minY = originY;
          const maxY = originY + height * scaleY;
          bounds = [
            Math.min(minX, maxX),
            Math.min(minY, maxY),
            Math.max(minX, maxX),
            Math.max(minY, maxY),
          ];
        } else if (
          fileDirectory.GeoTransformationMatrix &&
          fileDirectory.GeoTransformationMatrix.length === 16
        ) {
          const m = fileDirectory.GeoTransformationMatrix;
          const originX = m[12];
          const originY = m[13];
          const scaleX = m[0];
          const scaleY = m[5];

          // Guard against invalid / zero scales that can cause affine errors downstream
          if (
            !Number.isFinite(originX) ||
            !Number.isFinite(originY) ||
            !Number.isFinite(scaleX) ||
            !Number.isFinite(scaleY) ||
            scaleX === 0 ||
            scaleY === 0
          ) {
            throw new Error("Invalid GeoTransformationMatrix");
          }

          const minX = originX;
          const maxX = originX + width * scaleX;
          const minY = originY;
          const maxY = originY + height * scaleY;
          bounds = [
            Math.min(minX, maxX),
            Math.min(minY, maxY),
            Math.max(minX, maxX),
            Math.max(minY, maxY),
          ];
        } else {
          throw new Error("No georeferencing tags found");
        }
        if (geoAsciiParamsTag && typeof geoAsciiParamsTag === "string") {
          lccParams = detectLCCProjection(geoAsciiParamsTag);
        }
      } catch {
        console.warn(
          "[dem-worker] GeoTIFF has no usable georeferencing (no tiepoints, pixel-scale, or transform matrix) — falling back to India bounds.",
        );
        bounds = [68.0, 6.0, 97.0, 37.0];
      }
    }
  }

  // LCC detection via GeoKeys
  if (!lccParams) {
    lccParams = detectLCCFromGeoKeys(image);
  }
  if (!lccParams) {
    const fileDirectory = image.fileDirectory;
    const geoAsciiParamsTag = fileDirectory?.GeoAsciiParamsTag;
    if (geoAsciiParamsTag && typeof geoAsciiParamsTag === "string") {
      lccParams = detectLCCProjection(geoAsciiParamsTag);
    }
  }
  if (lccParams) {
    const [minX, minY, maxX, maxY] = bounds;
    const c1 = convertLCCToWGS84(minX, minY, lccParams, proj4);
    const c2 = convertLCCToWGS84(maxX, minY, lccParams, proj4);
    const c3 = convertLCCToWGS84(minX, maxY, lccParams, proj4);
    const c4 = convertLCCToWGS84(maxX, maxY, lccParams, proj4);
    const lngs = [c1[0], c2[0], c3[0], c4[0]];
    const lats = [c1[1], c2[1], c3[1], c4[1]];
    bounds = [
      Math.min(...lngs),
      Math.min(...lats),
      Math.max(...lngs),
      Math.max(...lats),
    ];
  }

  // Generic projected reprojection if EPSG code present
  try {
    const geoKeys =
      typeof image.getGeoKeys === "function" ? image.getGeoKeys() : undefined;
    if (geoKeys && !lccParams) {
      let projCode: string | null = null;
      if (
        geoKeys.ProjectedCSTypeGeoKey &&
        Number.isInteger(geoKeys.ProjectedCSTypeGeoKey)
      ) {
        projCode = `EPSG:${geoKeys.ProjectedCSTypeGeoKey}`;
      } else if (typeof geoKeys.GTCitationGeoKey === "string") {
        const match = geoKeys.GTCitationGeoKey.match(/EPSG[:\s]?(\d{3,6})/i);
        if (match) projCode = `EPSG:${match[1]}`;
      } else if (typeof geoKeys.PCSCitationGeoKey === "string") {
        const match = geoKeys.PCSCitationGeoKey.match(/EPSG[:\s]?(\d{3,6})/i);
        if (match) projCode = `EPSG:${match[1]}`;
      }
      const geoCodes = new Set([
        "EPSG:4326",
        "EPSG:4258",
        "EPSG:4269",
        "EPSG:4979",
      ]);
      const isGeographic = projCode ? geoCodes.has(projCode) : false;
      if (projCode && !isGeographic) {
        try {
          const corners: [number, number][] = [
            [bounds[0], bounds[1]],
            [bounds[0], bounds[3]],
            [bounds[2], bounds[1]],
            [bounds[2], bounds[3]],
          ];
          const converted = corners.map(([x, y]) =>
            proj4(projCode as string, "EPSG:4326", [x, y]),
          );
          const lngs = converted.map((c) => c[0]);
          const lats = converted.map((c) => c[1]);
          bounds = [
            Math.min(...lngs),
            Math.min(...lats),
            Math.max(...lngs),
            Math.max(...lats),
          ];
          console.log(
            `[dem-worker] Reprojected bounds from ${projCode} to EPSG:4326.`,
            bounds,
          );
        } catch (reprojErr) {
          console.warn(
            `[dem-worker] Could not reproject from ${projCode} — proj4 has no definition for this CRS. Bounds remain in source CRS.`,
            reprojErr,
          );
        }
      } else if (!projCode) {
        console.warn(
          "[dem-worker] TIFF has GeoKeys but no detectable ProjectedCSTypeGeoKey/GTCitationGeoKey/PCSCitationGeoKey — cannot reproject. Bounds will be checked against WGS84 range as-is.",
        );
      }
    } else if (!geoKeys) {
      console.warn(
        "[dem-worker] TIFF has no GeoKeys at all — likely not a GeoTIFF. Bounds will be checked against WGS84 range as-is.",
      );
    }
  } catch (geoErr) {
    console.warn("[dem-worker] GeoKeys reprojection step failed:", geoErr);
  }

  const boundsAreFinite =
    Array.isArray(bounds) &&
    bounds.length === 4 &&
    bounds.every((v) => Number.isFinite(v));
  const boundsInRange =
    boundsAreFinite &&
    bounds[0] >= -180 &&
    bounds[2] <= 180 &&
    bounds[1] >= -90 &&
    bounds[3] <= 90;
  if (!boundsAreFinite || !boundsInRange) {
    console.warn(
      "[dem-worker] Computed TIFF bounds are invalid or out of WGS84 range — falling back to India bounds.",
      bounds,
    );
    bounds = [68.0, 6.0, 97.0, 37.0];
  }

  // Read GDAL_NODATA once — tools like Atoll/Planet/GDAL export RSRP/coverage
  // TIFFs with a sentinel value for "outside study area". When the palette at
  // that index happens to be opaque black (extremely common for index 0), the
  // raster renders as a pure black rectangle. We detect this sentinel and map
  // matching pixels to alpha=0 so the nodata region is transparent on the map.
  const gdalNoDataRaw = (
    image as unknown as { fileDirectory?: { GDAL_NODATA?: unknown } }
  ).fileDirectory?.GDAL_NODATA;
  const gdalNoDataValue: number | null = (() => {
    if (gdalNoDataRaw == null) return null;
    if (typeof gdalNoDataRaw === "number") {
      return Number.isFinite(gdalNoDataRaw) ? gdalNoDataRaw : null;
    }
    if (typeof gdalNoDataRaw === "string") {
      // GDAL writes the tag as a NUL-terminated ASCII string, e.g. "255\0".
      const parsed = parseFloat(gdalNoDataRaw.replace(/\0/g, "").trim());
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  })();
  if (gdalNoDataValue !== null) {
    console.log(
      `[dem-worker] GDAL_NODATA sentinel = ${gdalNoDataValue} — pixels matching this value will be rendered transparent.`,
    );
  }

  // Color branch. We prefer MANUAL decoding so we can honor GDAL_NODATA and
  // control alpha per-pixel. readRGB() is used only for photometrics we can't
  // trivially decode ourselves (YCbCr JPEG, CMYK, CIELab), where nodata is
  // uncommon anyway. readRGB/readRasters both subsample at decode time via the
  // width/height options, so huge TIFFs never allocate a full-res buffer and
  // the deck.gl BitmapLayer never hits the WebGL MAX_TEXTURE_SIZE limit.
  if (classification.kind === "color") {
    const { texWidth, texHeight } = computeTexSize(width, height);
    const texPixelCount = texWidth * texHeight;
    const rgba = new Uint8ClampedArray(texPixelCount * 4);
    const elevation = new Float32Array(texPixelCount);
    let minVal = Infinity;
    let maxVal = -Infinity;
    let nodataPixels = 0;
    let decoded = false;

    if (texWidth !== width || texHeight !== height) {
      console.log(
        `[dem-worker] Downsampling color TIFF ${width}x${height} -> ${texWidth}x${texHeight} (GPU max-texture-dim cap ${MAX_TEXTURE_DIM}).`,
      );
    }

    // Branch 1: Palette (PhotometricInterpretation=3). Decode ourselves so we
    // can mark GDAL_NODATA pixels transparent instead of letting the palette
    // colour them black.
    if (
      !decoded &&
      classification.mode === "palette" &&
      classification.colorMap
    ) {
      const idxRaster = (await image.readRasters({
        interleave: true,
        samples: [0],
        width: texWidth,
        height: texHeight,
      } as unknown as Parameters<typeof image.readRasters>[0])) as unknown as
        | Uint8Array
        | Uint16Array;
      if (!idxRaster || idxRaster.length !== texPixelCount) {
        throw new Error("Invalid palette raster data");
      }
      const cm = classification.colorMap as number[] | Uint16Array;
      const cmLength = (cm as { length: number }).length;
      const paletteSize = Math.floor(cmLength / 3);
      for (let i = 0; i < texPixelCount; i++) {
        const index = idxRaster[i] as number;
        const isNodata = gdalNoDataValue !== null && index === gdalNoDataValue;
        const o = i * 4;
        if (isNodata) {
          rgba[o] = 0;
          rgba[o + 1] = 0;
          rgba[o + 2] = 0;
          rgba[o + 3] = 0;
          nodataPixels++;
        } else {
          const safeIdx = index >= 0 && index < paletteSize ? index : 0;
          rgba[o] = ((cm[safeIdx] as number) >> 8) & 0xff;
          rgba[o + 1] = ((cm[safeIdx + paletteSize] as number) >> 8) & 0xff;
          rgba[o + 2] = ((cm[safeIdx + 2 * paletteSize] as number) >> 8) & 0xff;
          rgba[o + 3] = 255;
        }
        elevation[i] = index;
        if (!isNodata) {
          if (index < minVal) minVal = index;
          if (index > maxVal) maxVal = index;
        }
      }
      decoded = true;
    }

    // Branch 2: plain RGB / RGBA. Decode manually and honor nodata on sample 0.
    if (
      !decoded &&
      (classification.mode === "rgb" || classification.mode === "rgba") &&
      (classification.photometric === 2 ||
        classification.photometric === 1 ||
        classification.photometric === 0)
    ) {
      const wantAlpha = classification.mode === "rgba";
      const samples = wantAlpha ? [0, 1, 2, 3] : [0, 1, 2];
      const raw = (await image.readRasters({
        interleave: true,
        samples,
        width: texWidth,
        height: texHeight,
      } as unknown as Parameters<typeof image.readRasters>[0])) as unknown as
        | Uint8Array
        | Uint8ClampedArray
        | Uint16Array
        | Int16Array
        | Float32Array;
      const channels = samples.length;
      if (!raw || raw.length !== texPixelCount * channels) {
        throw new Error("Invalid color raster data");
      }
      const bits = classification.bitsPerSample[0] ?? 8;
      const to8 = makeTo8(bits);
      for (let i = 0; i < texPixelCount; i++) {
        const s = i * channels;
        const o = i * 4;
        const r0 = raw[s] as number;
        const isNodata = gdalNoDataValue !== null && r0 === gdalNoDataValue;
        if (isNodata) {
          rgba[o] = 0;
          rgba[o + 1] = 0;
          rgba[o + 2] = 0;
          rgba[o + 3] = 0;
          nodataPixels++;
        } else if (bits <= 8) {
          rgba[o] = r0;
          rgba[o + 1] = raw[s + 1] as number;
          rgba[o + 2] = raw[s + 2] as number;
          rgba[o + 3] = channels === 4 ? (raw[s + 3] as number) : 255;
        } else {
          rgba[o] = to8(r0);
          rgba[o + 1] = to8(raw[s + 1] as number);
          rgba[o + 2] = to8(raw[s + 2] as number);
          rgba[o + 3] = channels === 4 ? to8(raw[s + 3] as number) : 255;
        }
        elevation[i] = r0;
        if (!isNodata) {
          if (r0 < minVal) minVal = r0;
          if (r0 > maxVal) maxVal = r0;
        }
      }
      decoded = true;
    }

    // Branch 3: exotic photometrics (YCbCr JPEG, CMYK, CIELab, WhiteIsZero,
    // BlackIsZero fallback). readRGB handles the colour-space math internally.
    // Nodata in these files is rare — if present, the caller sees opaque
    // pixels, which is acceptable.
    if (!decoded) {
      const imageAny = image as unknown as {
        readRGB?: (opts?: {
          interleave?: boolean;
          enableAlpha?: boolean;
          width?: number;
          height?: number;
        }) => Promise<ArrayLike<number>>;
      };
      if (typeof imageAny.readRGB !== "function") {
        throw new Error(
          "Unsupported TIFF photometric and readRGB unavailable in geotiff.js",
        );
      }
      const rgb = (await imageAny.readRGB({
        interleave: true,
        enableAlpha: true,
        width: texWidth,
        height: texHeight,
      })) as ArrayLike<number>;
      const total = rgb.length;
      const channels = total === texPixelCount * 4 ? 4 : 3;
      if (total !== texPixelCount * channels) {
        throw new Error(
          `readRGB returned unexpected length ${total} (expected ${texPixelCount * 3} or ${texPixelCount * 4})`,
        );
      }
      for (let i = 0; i < texPixelCount; i++) {
        const s = i * channels;
        const o = i * 4;
        const r = rgb[s] as number;
        rgba[o] = r;
        rgba[o + 1] = rgb[s + 1] as number;
        rgba[o + 2] = rgb[s + 2] as number;
        rgba[o + 3] = channels === 4 ? (rgb[s + 3] as number) : 255;
        elevation[i] = r;
        if (r < minVal) minVal = r;
        if (r > maxVal) maxVal = r;
      }
      decoded = true;
    }

    // Post-decode sanity check. If the produced RGBA buffer is essentially
    // empty (fully transparent or fully black) we log a loud warning so we
    // know the render will appear blank — vs. a silent black box the user has
    // to debug from screenshots.
    let nonZeroRGB = 0;
    const sampleStride = Math.max(1, Math.floor(texPixelCount / 10000));
    for (let i = 0; i < texPixelCount; i += sampleStride) {
      const o = i * 4;
      if ((rgba[o] | rgba[o + 1] | rgba[o + 2]) !== 0 && rgba[o + 3] !== 0) {
        nonZeroRGB++;
      }
    }
    console.log(
      `[dem-worker] Color decode complete: ${texWidth}x${texHeight}, nodata pixels = ${nodataPixels} (${((nodataPixels / texPixelCount) * 100).toFixed(1)}%), non-zero sampled = ${nonZeroRGB}.`,
    );
    if (nonZeroRGB === 0 && nodataPixels < texPixelCount) {
      console.warn(
        "[dem-worker] Decoded RGBA buffer has no visible pixels (all zeros) despite the raster not being fully nodata. Check palette entries or photometric interpretation — the source file may encode visible pixels as black or require a different decoder path.",
      );
    }

    if (
      !Number.isFinite(minVal) ||
      !Number.isFinite(maxVal) ||
      minVal === maxVal
    ) {
      minVal = 0;
      maxVal = 1;
    }

    return {
      kind: "color" as const,
      bounds,
      width: texWidth,
      height: texHeight,
      rgba,
      elevation,
      min: minVal,
      max: maxVal,
    };
  }

  // DEM branch: single numeric band → elevation + grayscale hillshade.
  // Same GPU-safe texture cap as the color branch: huge single-band rasters
  // (e.g. 20k×20k coverage grids exported as grayscale GeoTIFF) would allocate
  // ~1.6 GB Float32 + ~1.6 GB Uint8 buffers AND create a texture bigger than
  // the WebGL MAX_TEXTURE_SIZE, which crashes the Chromium GPU process
  // (symptom: shader-source printed on the map, "GPU process exited
  // unexpectedly: exit_code=34"). geotiff subsamples at decode time via the
  // width/height options, so the worker never materialises the full-res array.
  const { texWidth: demTexWidth, texHeight: demTexHeight } = computeTexSize(
    width,
    height,
  );
  const demPixelCount = demTexWidth * demTexHeight;
  if (demTexWidth !== width || demTexHeight !== height) {
    console.log(
      `[dem-worker] Downsampling DEM TIFF ${width}x${height} -> ${demTexWidth}x${demTexHeight} (GPU max-texture-dim cap ${MAX_TEXTURE_DIM}).`,
    );
  }

  const raster = (await image.readRasters({
    interleave: true,
    samples: [0],
    width: demTexWidth,
    height: demTexHeight,
  } as unknown as Parameters<
    typeof image.readRasters
  >[0])) as unknown as ArrayLike<number>;
  if (!raster || raster.length !== demPixelCount) {
    throw new Error("Invalid raster data");
  }

  // Also honour GDAL_NODATA in the DEM branch: pixels carrying the sentinel
  // value must not contribute to the grayscale min/max range (otherwise the
  // sentinel pulls the normalisation window to ±9999 and the real data
  // collapses to nearly-black) and should render transparent.
  const demGdalNoDataRaw = (
    image as unknown as { fileDirectory?: { GDAL_NODATA?: unknown } }
  ).fileDirectory?.GDAL_NODATA;
  let demNoData: number | null = (() => {
    if (demGdalNoDataRaw == null) return null;
    if (typeof demGdalNoDataRaw === "number") {
      return Number.isFinite(demGdalNoDataRaw) ? demGdalNoDataRaw : null;
    }
    if (typeof demGdalNoDataRaw === "string") {
      const parsed = parseFloat(demGdalNoDataRaw.replace(/\0/g, "").trim());
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  })();
  if (demNoData !== null) {
    console.log(
      `[dem-worker] DEM GDAL_NODATA sentinel = ${demNoData} — excluded from range and rendered transparent.`,
    );
  }

  let minVal = Infinity;
  let maxVal = -Infinity;
  let validCount = 0;
  for (let i = 0; i < raster.length; i++) {
    const v = raster[i] as number;
    if (!Number.isFinite(v)) continue;
    if (demNoData !== null && v === demNoData) continue;
    validCount++;
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }

  // Safety: if NoData==0 and the filter would erase a meaningful fraction
  // of the image (>=50 %), the declared NoData is almost certainly wrong
  // for this file — e.g. SAR amplitude tiles where 0 is actually a valid
  // "no-signal" reading, or coverage maps where most pixels are zero by
  // design. Re-include those pixels as data so the user sees *something*
  // instead of an all-transparent texture. Only auto-disable for the
  // common "0" pitfall — a sentinel like -32767 or 9999 is almost
  // certainly an actual NoData value and must be honoured.
  if (
    demNoData === 0 &&
    validCount < raster.length * 0.5
  ) {
    console.warn(
      `[dem-worker] NoData=0 would render ${(100 * (1 - validCount / raster.length)).toFixed(1)}% of pixels transparent — likely misset, disabling NoData treatment.`,
    );
    demNoData = null;
    minVal = Infinity;
    maxVal = -Infinity;
    for (let i = 0; i < raster.length; i++) {
      const v = raster[i] as number;
      if (!Number.isFinite(v)) continue;
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
  }

  if (
    !Number.isFinite(minVal) ||
    !Number.isFinite(maxVal) ||
    minVal === maxVal
  ) {
    minVal = 0;
    maxVal = 1;
  }

  const elevationData = new Float32Array(demPixelCount);
  const grayscale = new Uint8ClampedArray(demPixelCount * 4);
  for (let i = 0; i < demPixelCount; i++) {
    const v = raster[i] as number;
    const isNodata = demNoData !== null && v === demNoData;
    const val = Number.isFinite(v) && !isNodata ? v : minVal;
    elevationData[i] = val;
    const idx = i * 4;
    if (isNodata) {
      grayscale[idx] = 0;
      grayscale[idx + 1] = 0;
      grayscale[idx + 2] = 0;
      grayscale[idx + 3] = 0;
    } else {
      const t = (val - minVal) / (maxVal - minVal);
      const shade = Math.max(0, Math.min(255, Math.round(t * 255)));
      grayscale[idx] = shade;
      grayscale[idx + 1] = shade;
      grayscale[idx + 2] = shade;
      grayscale[idx + 3] = 255;
    }
  }

  return {
    kind: "dem" as const,
    bounds,
    width: demTexWidth,
    height: demTexHeight,
    data: elevationData,
    min: minVal,
    max: maxVal,
    grayscale,
  };
};

const parseDem = async (
  name: string,
  buffer: ArrayBuffer,
): Promise<DemWorkerResponse> => {
  try {
    const lower = typeof name === "string" ? name.toLowerCase() : "";
    const isHgt = lower.endsWith(".hgt");
    const result = isHgt ? await parseHGT(buffer) : await parseGeoTIFF(buffer);

    if (result.kind === "color") {
      return {
        type: "parse-dem-result",
        name,
        kind: "color",
        width: result.width,
        height: result.height,
        min: result.min,
        max: result.max,
        bounds: result.bounds,
        // Elevation buffer carries sample-0 values so tooltip shows the same
        // fields as a DEM raster (Elevation, Pixel Index, Elevation Range).
        elevationBuffer: result.elevation.buffer,
        grayscaleBuffer: new ArrayBuffer(0),
        rgbaBuffer: result.rgba.buffer,
      };
    }

    return {
      type: "parse-dem-result",
      name,
      kind: "dem",
      width: result.width,
      height: result.height,
      min: result.min,
      max: result.max,
      bounds: result.bounds,
      elevationBuffer: result.data.buffer,
      grayscaleBuffer: result.grayscale.buffer,
    };
  } catch (error: any) {
    return {
      type: "parse-dem-result",
      name,
      kind: "dem",
      width: 0,
      height: 0,
      min: 0,
      max: 0,
      bounds: [68.0, 6.0, 97.0, 37.0],
      elevationBuffer: new ArrayBuffer(0),
      grayscaleBuffer: new ArrayBuffer(0),
      error: error?.message || "Unknown error",
    };
  }
};

ctx.onmessage = async (ev: MessageEvent<DemWorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === "parse-dem") {
    const result = await parseDem(msg.name, msg.buffer);
    const transfers: ArrayBuffer[] = [];
    if (result.elevationBuffer && result.elevationBuffer.byteLength > 0) {
      transfers.push(result.elevationBuffer);
    }
    if (result.grayscaleBuffer && result.grayscaleBuffer.byteLength > 0) {
      transfers.push(result.grayscaleBuffer);
    }
    if (result.rgbaBuffer && result.rgbaBuffer.byteLength > 0) {
      transfers.push(result.rgbaBuffer);
    }
    ctx.postMessage(result, transfers);
  }
};
