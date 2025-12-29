// Lightweight DEM worker: parse GeoTIFF/HGT into elevation + grayscale (no DOM).
// Returns plain data buffers. Main thread builds canvas.
// Timeout is enforced by caller.

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
  width: number;
  height: number;
  min: number;
  max: number;
  bounds: [number, number, number, number];
  elevationBuffer: ArrayBuffer;
  grayscaleBuffer: ArrayBuffer;
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
  projectionString: string | undefined | null
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
    /standard_parallel_1["\s]*([\d.+-]+)/i
  );
  const stdPar2Match = projectionString.match(
    /standard_parallel_2["\s]*([\d.+-]+)/i
  );
  const centralMeridianMatch = projectionString.match(
    /central_meridian["\s]*([\d.+-]+)/i
  );
  const latOriginMatch = projectionString.match(
    /latitude_of_origin["\s]*([\d.+-]+)/i
  );
  const falseEastingMatch = projectionString.match(
    /false_easting["\s]*([\d.+-]+)/i
  );
  const falseNorthingMatch = projectionString.match(
    /false_northing["\s]*([\d.+-]+)/i
  );

  let datum = "WGS84";
  const geogcsMatch = projectionString.match(
    /GEOGCS\["[^"]*",\s*DATUM\["([^"]+)"/i
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
  proj4: any
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
        `Invalid HGT file size: ${fileSize} bytes. Expected size for 1201x1201 or 3601x3601 grid.`
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
  const NO_DATA_VALUE = -32768;
  for (let i = 0; i < width * height; i++) {
    const elevation = dataView.getInt16(i * 2, false);
    if (elevation === NO_DATA_VALUE || elevation < -1000 || elevation > 9000) {
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
    bounds: [minLng, minLat, maxLng, maxLat] as [
      number,
      number,
      number,
      number
    ],
    width,
    height,
    data: elevationData,
    min: minVal,
    max: maxVal,
    grayscale,
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
  const raster = await image.readRasters({ interleave: true, samples: [0] });
  if (!raster || raster.length !== width * height) {
    throw new Error("Invalid raster data");
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
        const corners: [number, number][] = [
          [bounds[0], bounds[1]],
          [bounds[0], bounds[3]],
          [bounds[2], bounds[1]],
          [bounds[2], bounds[3]],
        ];
        const converted = corners.map(([x, y]) =>
          proj4(projCode as string, "EPSG:4326", [x, y])
        );
        const lngs = converted.map((c) => c[0]);
        const lats = converted.map((c) => c[1]);
        bounds = [
          Math.min(...lngs),
          Math.min(...lats),
          Math.max(...lngs),
          Math.max(...lats),
        ];
      }
    }
  } catch {
    // ignore
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
    bounds = [68.0, 6.0, 97.0, 37.0];
  }

  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let i = 0; i < raster.length; i++) {
    const v = raster[i] as number;
    if (Number.isFinite(v)) {
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

  const elevationData = new Float32Array(width * height);
  const grayscale = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = raster[i] as number;
    const val = Number.isFinite(v) ? v : minVal;
    elevationData[i] = val;
    const t = (val - minVal) / (maxVal - minVal);
    const shade = Math.max(0, Math.min(255, Math.round(t * 255)));
    const idx = i * 4;
    grayscale[idx] = shade;
    grayscale[idx + 1] = shade;
    grayscale[idx + 2] = shade;
    grayscale[idx + 3] = 255;
  }

  return {
    bounds,
    width,
    height,
    data: elevationData,
    min: minVal,
    max: maxVal,
    grayscale,
  };
};

const parseDem = async (
  name: string,
  buffer: ArrayBuffer
): Promise<DemWorkerResponse> => {
  try {
    const lower = typeof name === "string" ? name.toLowerCase() : "";
    const isHgt = lower.endsWith(".hgt");
    const dem = isHgt ? await parseHGT(buffer) : await parseGeoTIFF(buffer);
    return {
      type: "parse-dem-result",
      name,
      width: dem.width,
      height: dem.height,
      min: dem.min,
      max: dem.max,
      bounds: dem.bounds,
      elevationBuffer: dem.data.buffer,
      grayscaleBuffer: dem.grayscale.buffer,
    };
  } catch (error: any) {
    return {
      type: "parse-dem-result",
      name,
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
    ctx.postMessage(result, [result.elevationBuffer, result.grayscaleBuffer]);
  }
};
