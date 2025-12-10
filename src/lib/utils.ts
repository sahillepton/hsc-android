import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import * as turf from "@turf/turf";
import Papa from "papaparse";
import shp from "shpjs";
import proj4 from "proj4";
// geotiff is optional; we will dynamic import when needed

// --- LCC projection helpers ---
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

  // Try PROJ.4 style
  const pLat1 = projectionString.match(/\+lat_1=([\d.+-]+)/i);
  const pLat2 = projectionString.match(/\+lat_2=([\d.+-]+)/i);
  const pLon0 = projectionString.match(/\+lon_0=([\d.+-]+)/i);
  const pLat0 = projectionString.match(/\+lat_0=([\d.+-]+)/i);
  const pX0 = projectionString.match(/\+x_0=([\d.+-]+)/i);
  const pY0 = projectionString.match(/\+y_0=([\d.+-]+)/i);
  const pDatum = projectionString.match(/\+datum=([a-zA-Z0-9_]+)/i);
  if (pLat1 && pLat2 && pLon0 && pLat0) {
    return {
      standardParallel1: parseFloat(pLat1[1]),
      standardParallel2: parseFloat(pLat2[1]),
      centralMeridian: parseFloat(pLon0[1]),
      latitudeOfOrigin: parseFloat(pLat0[1]),
      falseEasting: pX0 ? parseFloat(pX0[1]) : 0,
      falseNorthing: pY0 ? parseFloat(pY0[1]) : 0,
      datum: pDatum ? pDatum[1].toUpperCase() : datum,
    };
  }

  return null;
};

// Detect LCC from GeoTIFF geoKeys (ProjCoordTransGeoKey + parameter keys)
const detectLCCFromGeoKeys = (image: any): LCCProjectionParams | null => {
  if (!image || typeof image.getGeoKeys !== "function") return null;
  const geoKeys = image.getGeoKeys?.();
  if (!geoKeys) return null;

  // GeoTIFF constants: 8 = CT_LambertConfConic_2SP, 9 = CT_LambertConfConic_1SP
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

  const stdPar1 = stdPar1Raw;
  const stdPar2 = stdPar2Raw;
  const lon0 = lon0Raw;
  const lat0 = lat0Raw;
  const falseEasting =
    geoKeys.ProjFalseEastingGeoKey ??
    geoKeys.FalseEasting ??
    geoKeys.ProjFalseOriginEastingGeoKey ??
    0;
  const falseNorthing =
    geoKeys.ProjFalseNorthingGeoKey ??
    geoKeys.FalseNorthing ??
    geoKeys.ProjFalseOriginNorthingGeoKey ??
    0;

  // Units: 9001=m, 9002=ft, 9003=us-ft
  let units: "m" | "ft" | "us-ft" = "m";
  const projLinearUnits = geoKeys.ProjLinearUnitsGeoKey;
  if (projLinearUnits === 9002) units = "ft";
  if (projLinearUnits === 9003) units = "us-ft";

  if (stdPar1 === null || stdPar2 === null || lon0 === null || lat0 === null) {
    return null;
  }

  return {
    standardParallel1: Number(stdPar1),
    standardParallel2: Number(stdPar2),
    centralMeridian: Number(lon0),
    latitudeOfOrigin: Number(lat0),
    falseEasting: Number(falseEasting) || 0,
    falseNorthing: Number(falseNorthing) || 0,
    datum: "WGS84",
    units,
  };
};

const convertLCCToWGS84 = (
  x: number,
  y: number,
  lcc: LCCProjectionParams
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

const convertGeoJSONCoordinates = (
  coords: any,
  lcc: LCCProjectionParams
): any => {
  if (Array.isArray(coords)) {
    if (
      coords.length >= 2 &&
      typeof coords[0] === "number" &&
      typeof coords[1] === "number"
    ) {
      const [lng, lat] = convertLCCToWGS84(coords[0], coords[1], lcc);
      return [lng, lat, ...coords.slice(2)];
    }
    return coords.map((c) => convertGeoJSONCoordinates(c, lcc));
  }
  return coords;
};

const convertGeoJSONFromLCC = (
  fc: GeoJSON.FeatureCollection,
  lcc: LCCProjectionParams
): GeoJSON.FeatureCollection => ({
  ...fc,
  features: fc.features.map((f) => {
    if (f.geometry.type === "GeometryCollection") {
      return f; // skip GeometryCollection to avoid type issues
    }
    return {
      ...f,
      geometry: {
        ...f.geometry,
        coordinates: convertGeoJSONCoordinates(
          (f.geometry as any).coordinates,
          lcc
        ),
      },
    };
  }),
});

// Minimal WKT parser for basic geometry types
const parseWKTGeometry = (wkt: string): GeoJSON.Geometry | null => {
  if (!wkt) return null;
  const trimmed = wkt.trim();
  const point = trimmed.match(/^POINT\s*\(\s*([-\d.+]+)\s+([-\d.+]+)\s*\)/i);
  if (point) {
    return {
      type: "Point",
      coordinates: [parseFloat(point[1]), parseFloat(point[2])],
    };
  }
  const linestring = trimmed.match(/^LINESTRING\s*\((.+)\)/i);
  if (linestring) {
    const coords = linestring[1]
      .split(",")
      .map((p) => p.trim().split(/\s+/).map(Number))
      .filter((c) => c.length >= 2) as [number, number][];
    if (coords.length >= 2)
      return {
        type: "LineString",
        coordinates: coords,
      };
  }
  const polygon = trimmed.match(/^POLYGON\s*\(\((.+)\)\)/i);
  if (polygon) {
    const ring = polygon[1]
      .split(",")
      .map((p) => p.trim().split(/\s+/).map(Number))
      .filter((c) => c.length >= 2) as [number, number][];
    if (ring.length >= 3)
      return {
        type: "Polygon",
        coordinates: [ring],
      };
  }
  return null;
};

const wktToGeoJSON = (text: string): GeoJSON.FeatureCollection => {
  const geom = parseWKTGeometry(text);
  if (!geom) {
    throw new Error("Invalid or unsupported WKT geometry");
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: geom,
        properties: {},
      },
    ],
  };
};

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const base64ToFile = (
  base64Data: string,
  fileName: string,
  mimeType: string
): File => {
  const byteString = atob(base64Data);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([ab], { type: mimeType });
  return new File([blob], fileName, { type: mimeType });
};

export const collectCoordinates = (coordinates: any): [number, number][] => {
  if (!coordinates) return [];

  if (Array.isArray(coordinates)) {
    if (
      coordinates.length >= 2 &&
      typeof coordinates[0] === "number" &&
      typeof coordinates[1] === "number"
    ) {
      return [[coordinates[0], coordinates[1]]];
    }

    return coordinates.flatMap((coord) => collectCoordinates(coord));
  }

  return [];
};

export const extractGeometryCoordinates = (
  geometry: GeoJSON.Geometry
): [number, number][] => {
  if (!geometry) return [];

  switch (geometry.type) {
    case "Point":
      return collectCoordinates(geometry.coordinates);
    case "MultiPoint":
    case "LineString":
      return collectCoordinates(geometry.coordinates);
    case "MultiLineString":
    case "Polygon":
      return collectCoordinates(geometry.coordinates);
    case "MultiPolygon":
      return collectCoordinates(geometry.coordinates);
    case "GeometryCollection":
      return geometry.geometries.flatMap((child) =>
        extractGeometryCoordinates(child)
      );
    default:
      return [];
  }
};

export function rgbToHex(
  rgb: [number, number, number] | [number, number, number, number]
): string {
  const [r, g, b, a] = rgb;

  const toHex = (n: number) => {
    const hex = Math.max(0, Math.min(255, n)).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  let hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;

  if (a !== undefined) {
    const alphaValue = a <= 1 ? Math.round(a * 255) : a;
    hex += toHex(alphaValue);
  }

  return hex;
}

/**
 * Generate a random RGB color from a predefined palette
 * Colors: Red, Pink, Purple, Orange, Yellow
 */
export function generateRandomColor(): [number, number, number] {
  const colors: [number, number, number][] = [
    [255, 0, 0], // Red: #FF0000
    [255, 192, 203], // Pink: #FFC0CB
    [128, 0, 128], // Purple: #800080
    [255, 165, 0], // Orange: #FFA500
    [255, 255, 0], // Yellow: #FFFF00
  ];

  // Randomly select one of the predefined colors
  const randomIndex = Math.floor(Math.random() * colors.length);
  return colors[randomIndex];
}

export function hexToRgb(hex: string): [number, number, number] | null {
  hex = hex.replace(/^#/, "");

  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }

  if (hex.length !== 6) return null;

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  return [r, g, b];
}

export function formatDistance(kilometers: number): string {
  if (kilometers < 1) {
    const meters = kilometers * 1000;
    return `${meters.toFixed(1)} m`;
  }

  if (kilometers >= 10000) {
    const megameters = kilometers / 1000; // 1 Mm = 1000 km
    return `${megameters.toFixed(2)} Mm`;
  }

  return `${kilometers.toFixed(2)} km`;
}

export function formatArea(squareMeters: number): string {
  if (squareMeters < 10000) {
    return `${squareMeters.toFixed(1)} m²`;
  } else if (squareMeters < 1000000) {
    return `${(squareMeters / 10000).toFixed(2)} ha`;
  } else {
    return `${(squareMeters / 1000000).toFixed(2)} km²`;
  }
}

export function getPolygonArea(polygon: [number, number][][]) {
  if (!Array.isArray(polygon) || polygon.length === 0) {
    return "0.00";
  }

  const EARTH_RADIUS = 6378137; // meters (WGS84 semimajor axis)
  const toRadians = (deg: number) => (deg * Math.PI) / 180;

  const ringArea = (ring: [number, number][]) => {
    if (!ring || ring.length < 3) return 0;

    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const [lon1, lat1] = ring[i];
      const [lon2, lat2] = ring[(i + 1) % ring.length];

      const lon1Rad = toRadians(lon1);
      const lon2Rad = toRadians(lon2);
      const lat1Rad = toRadians(lat1);
      const lat2Rad = toRadians(lat2);

      area += (lon2Rad - lon1Rad) * (Math.sin(lat1Rad) + Math.sin(lat2Rad));
    }

    return (area * EARTH_RADIUS * EARTH_RADIUS) / 2;
  };

  let totalArea = 0;

  polygon.forEach((ring, index) => {
    const ringAreaMeters = ringArea(ring);
    if (index === 0) {
      totalArea += Math.abs(ringAreaMeters); // outer ring
    } else {
      totalArea -= Math.abs(ringAreaMeters); // holes
    }
  });

  const areaKm2 = Math.abs(totalArea) / 1_000_000;
  return areaKm2.toFixed(2);
}

export function getDistance(
  point1: [number, number],
  point2: [number, number]
) {
  const from = turf.point([point1[0], point1[1]]);
  const to = turf.point([point2[0], point2[1]]);
  return turf.distance(from, to, { units: "kilometers" }).toFixed(2);
}

export const calculateIgrs = (lon: number, lat: number): string | null => {
  if (
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    lon < 68 ||
    lon > 104 ||
    lat < 8 ||
    lat > 39.5
  ) {
    return null;
  }

  let cm: number | undefined;
  let origin: number | undefined;

  if (lon <= 68 && lat <= 32.5) {
    cm = 68;
    origin = 32.5;
  } else if (lon <= 68 && lat <= 39.5) {
    cm = 68;
    origin = 39.5;
  } else if (lon <= 74 && lat <= 26) {
    cm = 74;
    origin = 26;
  } else if (lon <= 80 && lat <= 8) {
    cm = 80;
    origin = 12;
  } else if (lon <= 80 && lat <= 19) {
    cm = 80;
    origin = 19;
  } else if (lon < 90 && lat < 26) {
    cm = 90;
    origin = 26;
  } else if (lon <= 90 && lat <= 32.5) {
    cm = 90;
    origin = 32.5;
  } else if (lon <= 100 && lat <= 19) {
    cm = 100;
    origin = 19;
  } else if (lon <= 104 && lat <= 8.0) {
    // Note: The C++ code has "lon >= 39.5 && lat >= 8.0" but these are redundant
    // given the outer boundary check (lon >= 68, lat >= 8.0)
    // Using lat <= 8.0 to match C++ behavior
    cm = 104;
    origin = 8.0;
  }

  if (cm === undefined || origin === undefined) {
    return null;
  }

  const grid = [
    ["A", "B", "C", "D", "E"],
    ["F", "G", "H", "J", "K"],
    ["L", "M", "N", "O", "P"],
    ["Q", "R", "S", "T", "U"],
    ["V", "W", "X", "Y", "Z"],
  ];

  const PI = Math.PI;
  const inverseFlattening = 300.17255;
  const num5 = 6377301.243;
  const scaleFactor = 1;
  const num10 = 2743195.5;
  const num11 = 914398.5;
  const flattening = 1 / inverseFlattening;
  const num8 = 0.3861;
  const num9 = 0.785166;
  const num7 = (cm * PI) / 180;
  const a2 = (origin * PI) / 180;
  const num6 = Math.sqrt(2 * flattening - flattening * flattening);
  const a1 = (lat * PI) / 180;
  const num4 = (lon * PI) / 180;
  const a3 = Math.cos(num8) / Math.sqrt(1 - num6 * num6 * Math.sin(num8) ** 2);
  const a4 = Math.cos(num9) / Math.sqrt(1 - num6 * num6 * Math.sin(num9) ** 2);
  const num12 =
    Math.tan(PI / 4 - num8 / 2) /
    Math.pow(
      (1 - num6 * Math.sin(num8)) / (1 + num6 * Math.sin(num8)),
      num6 / 2
    );
  const a5 =
    Math.tan(PI / 4 - num9 / 2) /
    Math.pow(
      (1 - num6 * Math.sin(num9)) / (1 + num6 * Math.sin(num9)),
      num6 / 2
    );
  const x1 =
    Math.tan(PI / 4 - a1 / 2) /
    Math.pow((1 - num6 * Math.sin(a1)) / (1 + num6 * Math.sin(a1)), num6 / 2);
  const x2 =
    Math.tan(PI / 4 - a2 / 2) /
    Math.pow((1 - num6 * Math.sin(a2)) / (1 + num6 * Math.sin(a2)), num6 / 2);
  const y = (Math.log(a3) - Math.log(a4)) / (Math.log(num12) - Math.log(a5));
  const num13 = a3 / (y * Math.pow(num12, y));
  const num14 = num5 * num13 * Math.pow(x1, y);
  const num15 = num5 * num13 * Math.pow(x2, y);
  const num16 = y * (num4 - num7);
  let tempX = Math.round(num10 + num14 * Math.sin(num16));
  let tempY = Math.round(num11 + num15 - num14 * Math.cos(num16));
  tempX = Math.round(tempX * scaleFactor);
  tempY = Math.round(tempY * scaleFactor);

  let X = Math.floor(tempX / 100000);
  let Y = Math.floor(tempY / 100000);

  // Match C++ do-while logic: do { c = c / 5; } while (c > 5);
  const reduceToGrid = (value: number) => {
    let result = Math.floor(value);
    do {
      result = Math.floor(result / 5);
    } while (result > 5);
    // C++ code can result in 5, which is out of bounds (0-4), so clamp it
    if (result > 4) {
      result = result % 5;
    }
    if (result < 0) {
      result = ((result % 5) + 5) % 5;
    }
    return result;
  };

  let c = reduceToGrid(X);
  let r = reduceToGrid(Y);
  if (r < 0 || r > 4 || c < 0 || c > 4) {
    return null;
  }

  const A1 = grid[r][c];

  c = ((Math.floor(X) % 5) + 5) % 5;
  r = ((Math.floor(Y) % 5) + 5) % 5;
  const A2 = grid[r][c];

  // C++ code: temp_gr_x %= 100000; temp_gr_y %= 100000;
  // Using defensive modulo to handle potential negatives (TypeScript improvement)
  tempX = ((tempX % 100000) + 100000) % 100000;
  tempY = ((tempY % 100000) + 100000) % 100000;

  // Match C++ format exactly: QString("%1, %2 %3 %4").arg(A1).arg(A2).arg(temp_gr_x).arg(temp_gr_y)
  return `${A1}, ${A2} ${tempX} ${tempY}`;
};

/**
 * Formats a key/label into a human-readable format
 * Examples:
 * - "globalId" -> "Global ID"
 * - "userId" -> "User ID"
 * - "hopCount" -> "Hop Count"
 * - "connectedNodeIds" -> "Connected Node IDs"
 * - "groundSpeed" -> "Ground Speed"
 */
export function formatLabel(key: string): string {
  if (!key) return key;

  // Handle camelCase, PascalCase, snake_case, and kebab-case
  let formatted = key
    // Split by camelCase/PascalCase (before uppercase letters)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    // Split by underscores
    .replace(/_/g, " ")
    // Split by hyphens
    .replace(/-/g, " ")
    // Split by numbers (e.g., "ID123" -> "ID 123")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2");

  // Capitalize first letter of each word, but keep common acronyms uppercase
  const acronyms = ["ID", "IDs", "SNR", "RSSI", "FTP", "GPS", "URL", "API"];
  const words = formatted.split(" ").map((word) => {
    const upperWord = word.toUpperCase();
    if (acronyms.includes(upperWord)) {
      return upperWord;
    }
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });

  return words.join(" ");
}

export function csvToGeoJSON(
  csvString: string,
  latField = "latitude",
  lonField = "longitude"
) {
  const result = Papa.parse(csvString, { header: true, skipEmptyLines: true });

  // Find case-insensitive column names
  const findColumn = (row: any, fieldName: string): string | null => {
    if (!row) return null;
    const lowerField = fieldName.toLowerCase();
    const actualKeys = Object.keys(row);

    // Try exact match first
    if (row[fieldName] !== undefined) return fieldName;

    // Try case-insensitive match
    for (const key of actualKeys) {
      if (key.toLowerCase() === lowerField) {
        return key;
      }
    }

    return null;
  };

  // Get first row to determine column names
  const firstRow = result.data[0] as any;
  if (!firstRow) {
    return {
      type: "FeatureCollection",
      features: [],
    };
  }

  const latColumn = findColumn(firstRow, latField);
  const lonColumn = findColumn(firstRow, lonField);

  if (!latColumn || !lonColumn) {
    throw new Error(
      `Could not find required columns "${latField}" and "${lonField}" (case-insensitive). ` +
        `Found columns: ${Object.keys(firstRow).join(", ")}`
    );
  }

  const features = result.data
    .map((row: any) => {
      const lat = parseFloat(row[latColumn]);
      const lon = parseFloat(row[lonColumn]);

      if (isNaN(lat) || isNaN(lon)) return null;

      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [lon, lat],
        },
        properties: { ...row },
      };
    })
    .filter((f) => f !== null);

  return {
    type: "FeatureCollection",
    features,
  };
}

export async function shpToGeoJSON(file: File) {
  try {
    const arrayBuffer = await file.arrayBuffer();

    // Check if file is a ZIP by checking magic bytes
    const uint8Array = new Uint8Array(arrayBuffer);
    const isZip = uint8Array[0] === 0x50 && uint8Array[1] === 0x4b; // PK (ZIP signature)

    if (!isZip && file.name.toLowerCase().endsWith(".shp")) {
      throw new Error(
        "Shapefiles require multiple component files (.shp, .shx, .dbf) to work properly. " +
          "Please compress all shapefile components (.shp, .shx, .dbf, and optionally .prj) into a ZIP file and upload that instead. " +
          "A standalone .shp file cannot be processed without its companion files."
      );
    }

    // If ZIP, attempt to read .prj for projection detection
    let prjContent: string | null = null;
    if (isZip) {
      try {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(arrayBuffer);
        const prjName = Object.keys(zip.files).find((n) =>
          n.toLowerCase().endsWith(".prj")
        );
        if (prjName) {
          prjContent = await zip.files[prjName].async("string");
        }
      } catch {
        // ignore prj read errors
      }
    }

    const geojson = await shp(arrayBuffer);

    // Ensure we return a FeatureCollection
    // shpjs can return FeatureCollection, Feature[], or Feature
    let featureCollection: GeoJSON.FeatureCollection | null = null;
    if (Array.isArray(geojson)) {
      featureCollection = {
        type: "FeatureCollection",
        features: geojson.map((f: any) => ({
          type: "Feature",
          geometry: f.geometry,
          properties: f.properties || {},
        })),
      } as GeoJSON.FeatureCollection;
    }

    if (typeof geojson === "object" && geojson !== null && "type" in geojson) {
      const typedGeojson = geojson as any;
      if (typedGeojson.type === "FeatureCollection") {
        featureCollection = {
          type: "FeatureCollection",
          features: (typedGeojson.features || []).map((f: any) => ({
            type: "Feature",
            geometry: f.geometry,
            properties: f.properties || {},
          })),
        } as GeoJSON.FeatureCollection;
      } else if (typedGeojson.type === "Feature") {
        featureCollection = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: typedGeojson.geometry,
              properties: typedGeojson.properties || {},
            },
          ],
        } as GeoJSON.FeatureCollection;
      }
    }

    // Fallback: try to convert whatever we got
    if (!featureCollection) {
      featureCollection = {
        type: "FeatureCollection",
        features: [],
      } as GeoJSON.FeatureCollection;
    }

    // Reproject if LCC detected from PRJ
    const lccParams = detectLCCProjection(prjContent);
    if (lccParams) {
      return convertGeoJSONFromLCC(featureCollection, lccParams);
    }

    return featureCollection;
  } catch (error) {
    if (error instanceof Error) {
      // Provide more helpful error messages
      if (
        error.message.includes("unzip") ||
        error.message.includes("but-unzip")
      ) {
        throw new Error(
          "Failed to process shapefile. Please ensure the file is a valid ZIP archive containing " +
            "all required shapefile components (.shp, .shx, .dbf). If uploading a single .shp file, " +
            "please compress all related files into a ZIP archive first."
        );
      }
      throw error;
    }
    throw new Error(
      "Failed to process shapefile. Please ensure it is a valid ZIP archive."
    );
  }
}

// Parse GPX to GeoJSON
export function gpxToGeoJSON(gpxText: string): GeoJSON.FeatureCollection {
  const parser = new DOMParser();
  const gpxDoc = parser.parseFromString(gpxText, "text/xml");
  const features: GeoJSON.Feature[] = [];

  // Parse waypoints (wpt)
  const waypoints = gpxDoc.getElementsByTagName("wpt");
  for (let i = 0; i < waypoints.length; i++) {
    const wpt = waypoints[i];
    const lat = parseFloat(wpt.getAttribute("lat") || "0");
    const lon = parseFloat(wpt.getAttribute("lon") || "0");
    const name = wpt.getElementsByTagName("name")[0]?.textContent || "";
    const ele = wpt.getElementsByTagName("ele")[0]?.textContent;

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [lon, lat],
      },
      properties: {
        name,
        elevation: ele ? parseFloat(ele) : undefined,
        type: "waypoint",
      },
    });
  }

  // Parse tracks (trk)
  const tracks = gpxDoc.getElementsByTagName("trk");
  for (let i = 0; i < tracks.length; i++) {
    const trk = tracks[i];
    const name = trk.getElementsByTagName("name")[0]?.textContent || "";
    const segments = trk.getElementsByTagName("trkseg");

    for (let j = 0; j < segments.length; j++) {
      const seg = segments[j];
      const points = seg.getElementsByTagName("trkpt");
      const coordinates: [number, number][] = [];

      for (let k = 0; k < points.length; k++) {
        const pt = points[k];
        const lat = parseFloat(pt.getAttribute("lat") || "0");
        const lon = parseFloat(pt.getAttribute("lon") || "0");
        coordinates.push([lon, lat]);
      }

      if (coordinates.length > 1) {
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates,
          },
          properties: {
            name: segments.length > 1 ? `${name} (segment ${j + 1})` : name,
            type: "track",
          },
        });
      }
    }
  }

  // Parse routes (rte)
  const routes = gpxDoc.getElementsByTagName("rte");
  for (let i = 0; i < routes.length; i++) {
    const rte = routes[i];
    const name = rte.getElementsByTagName("name")[0]?.textContent || "";
    const points = rte.getElementsByTagName("rtept");
    const coordinates: [number, number][] = [];

    for (let j = 0; j < points.length; j++) {
      const pt = points[j];
      const lat = parseFloat(pt.getAttribute("lat") || "0");
      const lon = parseFloat(pt.getAttribute("lon") || "0");
      coordinates.push([lon, lat]);
    }

    if (coordinates.length > 1) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates,
        },
        properties: {
          name,
          type: "route",
        },
      });
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

// Parse KML to GeoJSON
export async function kmlToGeoJSON(
  kmlText: string
): Promise<GeoJSON.FeatureCollection> {
  const parser = new DOMParser();
  const kmlDoc = parser.parseFromString(kmlText, "text/xml");
  const features: GeoJSON.Feature[] = [];

  // Helper to parse coordinate strings
  const parseCoordinates = (coordString: string): [number, number][] => {
    return coordString
      .trim()
      .split(/\s+/)
      .map((coord) => {
        const parts = coord.split(",");
        const lon = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        return [lon, lat] as [number, number];
      })
      .filter(([lon, lat]) => !isNaN(lon) && !isNaN(lat));
  };

  // Parse Placemarks
  const placemarks = kmlDoc.getElementsByTagName("Placemark");
  for (let i = 0; i < placemarks.length; i++) {
    const pm = placemarks[i];
    const name = pm.getElementsByTagName("name")[0]?.textContent || "";
    const description =
      pm.getElementsByTagName("description")[0]?.textContent || "";

    // Point
    const point = pm.getElementsByTagName("Point")[0];
    if (point) {
      const coord =
        point.getElementsByTagName("coordinates")[0]?.textContent || "";
      const coords = parseCoordinates(coord);
      if (coords.length > 0) {
        features.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: coords[0],
          },
          properties: {
            name,
            description,
            type: "point",
          },
        });
      }
    }

    // LineString
    const lineString = pm.getElementsByTagName("LineString")[0];
    if (lineString) {
      const coord =
        lineString.getElementsByTagName("coordinates")[0]?.textContent || "";
      const coords = parseCoordinates(coord);
      if (coords.length > 1) {
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: coords,
          },
          properties: {
            name,
            description,
            type: "linestring",
          },
        });
      }
    }

    // Polygon
    const polygon = pm.getElementsByTagName("Polygon")[0];
    if (polygon) {
      const outerBoundary = polygon.getElementsByTagName("outerBoundaryIs")[0];
      if (outerBoundary) {
        const linearRing = outerBoundary.getElementsByTagName("LinearRing")[0];
        if (linearRing) {
          const coord =
            linearRing.getElementsByTagName("coordinates")[0]?.textContent ||
            "";
          const coords = parseCoordinates(coord);
          if (coords.length > 2) {
            // Close the polygon
            if (
              coords[0][0] !== coords[coords.length - 1][0] ||
              coords[0][1] !== coords[coords.length - 1][1]
            ) {
              coords.push(coords[0]);
            }
            features.push({
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [coords],
              },
              properties: {
                name,
                description,
                type: "polygon",
              },
            });
          }
        }
      }
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

// Extract KMZ (ZIP containing KML)
export async function kmzToGeoJSON(
  file: File
): Promise<GeoJSON.FeatureCollection> {
  // Use JSZip-like approach or parse as ZIP
  // For now, try to read as text first (some KMZ files can be read as text)
  try {
    const text = await file.text();
    return await kmlToGeoJSON(text);
  } catch {
    // If that fails, it's a proper ZIP - would need JSZip library
    // For now, throw error suggesting to extract KML first
    throw new Error(
      "KMZ (compressed KML) files require extraction. Please extract the KML file from the KMZ archive and upload the .kml file instead."
    );
  }
}

export async function fileToGeoJSON(file: File) {
  // Better extension detection (handle .geojson and multi-dot filenames)
  const fileName = file.name.toLowerCase();
  let ext = "";
  if (fileName.endsWith(".geojson")) {
    ext = "geojson";
  } else if (fileName.endsWith(".tiff")) {
    ext = "tiff";
  } else {
    const parts = fileName.split(".");
    ext = parts.length > 1 ? parts[parts.length - 1] : "";
  }

  if (ext === "csv") {
    const text = await file.text();
    return csvToGeoJSON(text, "latitude", "longitude");
  }

  if (ext === "shp" || ext === "zip") {
    // For shapefiles, try to process as shapefile first
    // If it fails and it's a ZIP, it might contain other formats
    try {
      return await shpToGeoJSON(file);
    } catch (error) {
      // If shapefile processing fails and it's a ZIP,
      // it might be a ZIP containing other formats (like TIFF for DEM)
      // Let the caller handle it
      if (ext === "zip") {
        throw error; // Re-throw to let handleFileImport check for TIFF
      }
      throw error;
    }
  }

  if (ext === "geojson" || ext === "json") {
    const text = await file.text();
    const geojson = JSON.parse(text);

    // Detect LCC via crs/projection metadata
    const crsString =
      (geojson?.crs && geojson.crs.properties?.name) ||
      geojson?.properties?.projection ||
      geojson?.properties?.crs;
    const lccParams = detectLCCProjection(crsString);
    if (lccParams && geojson.type === "FeatureCollection") {
      return convertGeoJSONFromLCC(geojson, lccParams);
    }
    return geojson;
  }

  if (ext === "gpx") {
    const text = await file.text();
    return gpxToGeoJSON(text);
  }

  if (ext === "kml") {
    const text = await file.text();
    return await kmlToGeoJSON(text);
  }

  if (ext === "kmz") {
    return await kmzToGeoJSON(file);
  }

  if (ext === "wkt") {
    const text = await file.text();
    return wktToGeoJSON(text);
  }

  if (ext === "prj") {
    // PRJ alone has no geometry; reject with a clear message
    throw new Error(
      "This file is a projection definition (.prj) without geometry. Upload it together with the geometry data (e.g., shapefile set or GeoJSON)."
    );
  }

  throw new Error(
    `Unsupported file type: .${ext}. Supported formats: GeoJSON, CSV, Shapefile, GPX, KML, WKT`
  );
}

export interface DemRasterResult {
  canvas: HTMLCanvasElement;
  bounds: [number, number, number, number];
  width: number;
  height: number;
  data: Float32Array;
  min: number;
  max: number;
}

// Parse HGT file (SRTM format)
async function parseHGTFile(file: File): Promise<DemRasterResult> {
  const arrayBuffer = await file.arrayBuffer();
  const dataView = new DataView(arrayBuffer);

  // HGT files are square, determine size from file size
  // File size = width * height * 2 bytes (16-bit integers)
  const fileSize = arrayBuffer.byteLength;
  const pixelCount = fileSize / 2;
  const size = Math.sqrt(pixelCount);

  // Common SRTM resolutions
  let width: number;
  let height: number;

  if (size === 1201) {
    width = 1201;
    height = 1201;
  } else if (size === 3601) {
    width = 3601;
    height = 3601;
  } else {
    // Try to determine from file size
    width = Math.round(size);
    height = Math.round(size);

    if (width * height * 2 !== fileSize) {
      throw new Error(
        `Invalid HGT file size: ${fileSize} bytes. Expected size for 1201x1201 or 3601x3601 grid.`
      );
    }
  }

  // Extract coordinates from filename if possible
  // Format: N37W122.hgt or S37E122.hgt (latitude, longitude)
  const fileName = file.name.toUpperCase().replace(/\.HGT$/, "");
  let minLat = 0;
  let minLng = 0;
  let maxLat = 1;
  let maxLng = 1;

  // Try to parse coordinates from filename
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
  } else {
    // Use default bounds (India) if coordinates can't be parsed
    minLat = 6.0;
    minLng = 68.0;
    maxLat = 37.0;
    maxLng = 97.0;
    console.warn(
      `Could not parse coordinates from HGT filename "${file.name}". Using default bounds.`
    );
  }

  // Read elevation data (16-bit signed integers, big-endian)
  const elevationData = new Float32Array(width * height);
  let minVal = Infinity;
  let maxVal = -Infinity;
  const NO_DATA_VALUE = -32768;

  for (let i = 0; i < width * height; i++) {
    // Read 16-bit signed integer (big-endian)
    const elevation = dataView.getInt16(i * 2, false); // false = big-endian

    if (elevation === NO_DATA_VALUE || elevation < -1000 || elevation > 9000) {
      // Invalid or no data
      elevationData[i] = minVal !== Infinity ? minVal : 0;
    } else {
      elevationData[i] = elevation;
      if (elevation < minVal) minVal = elevation;
      if (elevation > maxVal) maxVal = elevation;
    }
  }

  // If no valid data found, set defaults
  if (
    !Number.isFinite(minVal) ||
    !Number.isFinite(maxVal) ||
    minVal === maxVal
  ) {
    minVal = 0;
    maxVal = 1;
  }

  // Create canvas for visualization
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const imgData = ctx.createImageData(width, height);

  for (let i = 0; i < width * height; i++) {
    const elevation = elevationData[i];
    const t = (elevation - minVal) / (maxVal - minVal);
    const shade = Math.max(0, Math.min(255, Math.round(t * 255)));
    imgData.data[i * 4 + 0] = shade;
    imgData.data[i * 4 + 1] = shade;
    imgData.data[i * 4 + 2] = shade;
    imgData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  // Return bounds as [minLng, minLat, maxLng, maxLat]
  return {
    canvas,
    bounds: [minLng, minLat, maxLng, maxLat],
    width,
    height,
    data: elevationData,
    min: minVal,
    max: maxVal,
  };
}

export async function fileToDEMRaster(file: File): Promise<DemRasterResult> {
  // Better extension detection (handle .tiff and multi-dot filenames)
  const fileName = file.name.toLowerCase();
  let ext = "";
  if (fileName.endsWith(".tiff")) {
    ext = "tiff";
  } else if (fileName.endsWith(".dett")) {
    ext = "dett";
  } else if (fileName.endsWith(".hgt")) {
    ext = "hgt";
  } else {
    const parts = fileName.split(".");
    ext = parts.length > 1 ? parts[parts.length - 1] : "";
  }

  // Handle HGT files
  if (ext === "hgt") {
    return await parseHGTFile(file);
  }

  if (ext !== "tif" && ext !== "tiff" && ext !== "dett") {
    throw new Error(
      "Unsupported DEM format. Only GeoTIFF (.tif, .tiff, .dett) and SRTM HGT (.hgt) are supported."
    );
  }

  // Lazy-load geotiff to avoid bundling if unused
  let geotiff;
  let arrayBuffer;
  let tiff;
  let image;

  try {
    geotiff = await import("geotiff");
  } catch (error) {
    throw new Error(
      "Failed to load GeoTIFF library. Please ensure the file is a valid GeoTIFF format."
    );
  }

  try {
    arrayBuffer = await file.arrayBuffer();
  } catch (error) {
    throw new Error(
      `Failed to read file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }

  try {
    tiff = await geotiff.fromArrayBuffer(arrayBuffer);
  } catch (error) {
    throw new Error(
      `Invalid GeoTIFF file. The file may be corrupted or not a valid TIFF format: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }

  try {
    image = await tiff.getImage();
  } catch (error) {
    throw new Error(
      `Failed to read image from GeoTIFF: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }

  let width: number;
  let height: number;
  let raster: any;

  try {
    width = image.getWidth();
    height = image.getHeight();

    if (!width || !height || width <= 0 || height <= 0) {
      throw new Error("Invalid image dimensions");
    }
  } catch (error) {
    throw new Error(
      `Failed to get image dimensions: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }

  try {
    raster = await image.readRasters({ interleave: true, samples: [0] });
    if (!raster || !raster.length || raster.length !== width * height) {
      throw new Error("Invalid raster data");
    }
  } catch (error) {
    throw new Error(
      `Failed to read raster data from GeoTIFF: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }

  // Try to get bounding box using different methods
  let bounds: [number, number, number, number];
  let lccParams: LCCProjectionParams | null = null;

  // 1) Prefer origin + resolution (more explicit than bbox)
  const origin =
    typeof image.getOrigin === "function" ? image.getOrigin() : null;
  const resolution =
    typeof image.getResolution === "function" ? image.getResolution() : null;
  const debugInfo: any = {};

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
    debugInfo.source = "origin+resolution";
    debugInfo.origin = origin;
    debugInfo.resolution = resolution;
    debugInfo.boundsRaw = [minX, minY, maxX, maxY];
  } else {
    try {
      // 2) Try getBoundingBox (already applies tiepoints/resolution)
      const bbox = image.getBoundingBox();
      if (bbox && bbox.length === 4 && bbox.every((v) => Number.isFinite(v))) {
        bounds = bbox as [number, number, number, number];
        debugInfo.source = "getBoundingBox";
        debugInfo.boundsRaw = bbox;
      } else {
        throw new Error("No valid bounding box");
      }
    } catch (error) {
      // 3) Fallback to raw tags
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
          // GeoTIFF spec: tie point gives world coords of pixel (I,J,K)
          const [tieI, tieJ, worldX, worldY] = modelTiepointTag;
          const [scaleX, scaleY] = modelPixelScaleTag;

          // Pixel (0,0) world coords
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
          debugInfo.source = "ModelTiepoint+PixelScale";
          debugInfo.tie = modelTiepointTag;
          debugInfo.scale = modelPixelScaleTag;
          debugInfo.boundsRaw = [minX, minY, maxX, maxY];
        } else if (
          fileDirectory.GeoTransformationMatrix &&
          fileDirectory.GeoTransformationMatrix.length === 16
        ) {
          // GeoTransform: [ a0 a1 a2 ; b0 b1 b2 ] in row-major 4x4
          const m = fileDirectory.GeoTransformationMatrix;
          const originX = m[12];
          const originY = m[13];
          const scaleX = m[0];
          const scaleY = m[5];

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
          debugInfo.source = "GeoTransformationMatrix";
          debugInfo.matrix = fileDirectory.GeoTransformationMatrix;
          debugInfo.boundsRaw = [minX, minY, maxX, maxY];
        } else {
          throw new Error("No georeferencing tags found");
        }

        // Detect LCC from GeoAsciiParams if present
        if (geoAsciiParamsTag && typeof geoAsciiParamsTag === "string") {
          lccParams = detectLCCProjection(geoAsciiParamsTag);
        }
      } catch (error2) {
        // If no georeferencing is found, use default bounds (India - can be adjusted by user)
        const defaultBounds: [number, number, number, number] = [
          68.0, 6.0, 97.0, 37.0,
        ];
        bounds = defaultBounds;

        console.warn(
          "GeoTIFF file does not contain georeferencing information. Using default bounds (India). The DEM will be displayed but may not be correctly positioned. Please use a properly georeferenced GeoTIFF file for accurate positioning."
        );
      }
    }
  }

  // If LCC is detected (either from bounding-box path or tags), convert bounds to WGS84
  if (!lccParams) {
    // Try GeoKeys (Proj* keys) for LCC
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
    const c1 = convertLCCToWGS84(minX, minY, lccParams);
    const c2 = convertLCCToWGS84(maxX, minY, lccParams);
    const c3 = convertLCCToWGS84(minX, maxY, lccParams);
    const c4 = convertLCCToWGS84(maxX, maxY, lccParams);
    const lngs = [c1[0], c2[0], c3[0], c4[0]];
    const lats = [c1[1], c2[1], c3[1], c4[1]];
    bounds = [
      Math.min(...lngs),
      Math.min(...lats),
      Math.max(...lngs),
      Math.max(...lats),
    ];
    debugInfo.lcc = lccParams;
    debugInfo.boundsReprojected = bounds;
  }

  // Emit a one-time debug log per raster to help diagnose positioning
  try {
    // Include geoKeys when LCC not detected to help diagnose projection tags
    const geoKeys =
      typeof image.getGeoKeys === "function" ? image.getGeoKeys() : undefined;
    console.log("DEM LCC debug", {
      file: file.name,
      source: debugInfo.source,
      origin: debugInfo.origin,
      resolution: debugInfo.resolution,
      tie: debugInfo.tie,
      scale: debugInfo.scale,
      matrix: debugInfo.matrix,
      boundsRaw: debugInfo.boundsRaw,
      lcc: debugInfo.lcc,
      boundsReprojected: debugInfo.boundsReprojected,
      geoKeys,
    });
  } catch {
    // ignore logging errors
  }

  // Create a color ramp (simple grayscale)
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

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const imgData = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const v = raster[i] as number;
    const t = Number.isFinite(v) ? (v - minVal) / (maxVal - minVal) : 0;
    const shade = Math.max(0, Math.min(255, Math.round(t * 255)));
    imgData.data[i * 4 + 0] = shade;
    imgData.data[i * 4 + 1] = shade;
    imgData.data[i * 4 + 2] = shade;
    imgData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  // Convert bounds from LCC to WGS84 if detected
  if (lccParams) {
    try {
      const corners: [number, number][] = [
        [bounds[0], bounds[1]],
        [bounds[0], bounds[3]],
        [bounds[2], bounds[1]],
        [bounds[2], bounds[3]],
      ];
      const converted = corners.map(([x, y]) =>
        convertLCCToWGS84(x, y, lccParams!)
      );
      const lngs = converted.map((c) => c[0]);
      const lats = converted.map((c) => c[1]);
      bounds = [
        Math.min(...lngs),
        Math.min(...lats),
        Math.max(...lngs),
        Math.max(...lats),
      ];
    } catch (error) {
      console.warn("Failed to convert LCC bounds, using original:", error);
    }
  }

  // Return bounds as [minLng, minLat, maxLng, maxLat]
  // Note: GeoTIFF bounds might be in different coordinate systems
  // Ensure the order is correct for Mapbox (longitude, latitude)
  const elevationData = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const v = raster[i] as number;
    elevationData[i] = Number.isFinite(v) ? v : minVal;
  }

  return {
    canvas,
    bounds,
    width,
    height,
    data: elevationData,
    min: minVal,
    max: maxVal,
  };
}

// Generate mesh data from elevation data for SimpleMeshLayer
export function generateMeshFromElevation(
  elevationData: {
    data: Float32Array;
    width: number;
    height: number;
    min: number;
    max: number;
  },
  bounds: [[number, number], [number, number]],
  elevationScale: number = 1.0
): {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
} {
  const { data, width, height, min, max } = elevationData;
  const [minLng, minLat] = bounds[0];
  const [maxLng, maxLat] = bounds[1];

  // Calculate step sizes for longitude and latitude
  const lngStep = (maxLng - minLng) / (width - 1);
  const latStep = (maxLat - minLat) / (height - 1);

  // Generate vertices: [x, y, z] for each point
  const positions: number[] = [];
  const normals: number[] = [];

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const index = row * width + col;
      const elevation = data[index];

      // Calculate world coordinates
      const lng = minLng + col * lngStep;
      const lat = maxLat - row * latStep; // Y is inverted in image space
      const z = ((elevation - min) / (max - min)) * elevationScale;

      positions.push(lng, lat, z);

      // Calculate normal (simplified - will be improved with face normals)
      normals.push(0, 0, 1); // Default normal, will be recalculated
    }
  }

  // Generate indices for triangles (two triangles per quad)
  const indices: number[] = [];
  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const topLeft = row * width + col;
      const topRight = row * width + col + 1;
      const bottomLeft = (row + 1) * width + col;
      const bottomRight = (row + 1) * width + col + 1;

      // First triangle: topLeft -> topRight -> bottomLeft
      indices.push(topLeft, topRight, bottomLeft);
      // Second triangle: topRight -> bottomRight -> bottomLeft
      indices.push(topRight, bottomRight, bottomLeft);
    }
  }

  // Calculate proper normals from faces
  const positionArray = new Float32Array(positions);
  const normalArray = new Float32Array(normals.length);

  // Initialize normals to zero
  for (let i = 0; i < normalArray.length; i++) {
    normalArray[i] = 0;
  }

  // Calculate face normals and accumulate to vertex normals
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    const v0x = positionArray[i0];
    const v0y = positionArray[i0 + 1];
    const v0z = positionArray[i0 + 2];

    const v1x = positionArray[i1];
    const v1y = positionArray[i1 + 1];
    const v1z = positionArray[i1 + 2];

    const v2x = positionArray[i2];
    const v2y = positionArray[i2 + 1];
    const v2z = positionArray[i2 + 2];

    // Calculate edge vectors
    const edge1x = v1x - v0x;
    const edge1y = v1y - v0y;
    const edge1z = v1z - v0z;

    const edge2x = v2x - v0x;
    const edge2y = v2y - v0y;
    const edge2z = v2z - v0z;

    // Calculate cross product (normal)
    const nx = edge1y * edge2z - edge1z * edge2y;
    const ny = edge1z * edge2x - edge1x * edge2z;
    const nz = edge1x * edge2y - edge1y * edge2x;

    // Normalize
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length > 0) {
      const invLength = 1 / length;
      const normalX = nx * invLength;
      const normalY = ny * invLength;
      const normalZ = nz * invLength;

      // Accumulate to vertex normals
      normalArray[i0] += normalX;
      normalArray[i0 + 1] += normalY;
      normalArray[i0 + 2] += normalZ;

      normalArray[i1] += normalX;
      normalArray[i1 + 1] += normalY;
      normalArray[i1 + 2] += normalZ;

      normalArray[i2] += normalX;
      normalArray[i2 + 1] += normalY;
      normalArray[i2 + 2] += normalZ;
    }
  }

  // Normalize vertex normals
  for (let i = 0; i < normalArray.length; i += 3) {
    const length = Math.sqrt(
      normalArray[i] * normalArray[i] +
        normalArray[i + 1] * normalArray[i + 1] +
        normalArray[i + 2] * normalArray[i + 2]
    );
    if (length > 0) {
      const invLength = 1 / length;
      normalArray[i] *= invLength;
      normalArray[i + 1] *= invLength;
      normalArray[i + 2] *= invLength;
    }
  }

  return {
    positions: positionArray,
    normals: normalArray,
    indices: new Uint32Array(indices),
  };
}
