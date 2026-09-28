import {
  METERS_PER_DEGREE_LAT,
  ROUTE_MAX_SNAP_DIST_CAP_M,
  ROUTE_MAX_SNAP_DIST_M,
  ROUTE_SNAP_TOLERANCE_M_MAX,
  ROUTE_SNAP_TOLERANCE_M_MIN,
  ROUTE_SNAP_TOLERANCE_PIXELS,
} from "@/lib/constants";

/**
 * Web Mercator: meters per pixel at latitude `latDeg` for zoom level `zoom`.
 */
export function metersPerPixelWebMercator(zoom: number, latDeg: number): number {
  return (
    (156543.03392 * Math.cos((latDeg * Math.PI) / 180)) / Math.pow(2, zoom)
  );
}

/**
 * Max distance (m) from click to graph that still counts as “on the layer”.
 * Scales with zoom so low-zoom clicks (large m/px) are not rejected.
 */
export function routeMaxSnapDistanceMeters(
  zoom: number,
  latDeg: number,
): number {
  const mpp = metersPerPixelWebMercator(zoom, latDeg);
  const scaled = mpp * ROUTE_SNAP_TOLERANCE_PIXELS;
  return Math.min(
    ROUTE_MAX_SNAP_DIST_CAP_M,
    Math.max(ROUTE_MAX_SNAP_DIST_M, scaled),
  );
}

function extendBoundsFromPositions(
  positions: GeoJSON.Position[],
  bounds: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  },
): void {
  for (const p of positions) {
    const lng = p[0];
    const lat = p[1];
    bounds.minLng = Math.min(bounds.minLng, lng);
    bounds.maxLng = Math.max(bounds.maxLng, lng);
    bounds.minLat = Math.min(bounds.minLat, lat);
    bounds.maxLat = Math.max(bounds.maxLat, lat);
  }
}

/**
 * Graph-build vertex snap tolerance (m) from line layer geographic span + feature count.
 * Large extents → coarser tolerance (fewer grid cells / stable routing on big extracts).
 */
export function computeRouteSnapToleranceMeters(
  fc: GeoJSON.FeatureCollection,
): number {
  const bounds = {
    minLng: Infinity,
    maxLng: -Infinity,
    minLat: Infinity,
    maxLat: -Infinity,
  };
  let has = false;

  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "LineString") {
      has = true;
      extendBoundsFromPositions(g.coordinates, bounds);
    } else if (g.type === "MultiLineString") {
      for (const line of g.coordinates) {
        has = true;
        extendBoundsFromPositions(line, bounds);
      }
    }
  }

  if (!has || !Number.isFinite(bounds.minLng)) {
    return ROUTE_SNAP_TOLERANCE_M_MIN;
  }

  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const widthM =
    (bounds.maxLng - bounds.minLng) * METERS_PER_DEGREE_LAT * cosLat;
  const heightM = (bounds.maxLat - bounds.minLat) * METERS_PER_DEGREE_LAT;
  const diagM = Math.hypot(widthM, heightM);

  /**
   * Local / city / district extracts (e.g. Dehradun): tight graph, stay at 1 m.
   * Ramping only starts above this diagonal so many small features don't inflate tolerance.
   */
  const localExtentMaxM = 150_000;

  if (diagM <= localExtentMaxM) {
    return ROUTE_SNAP_TOLERANCE_M_MIN;
  }

  // National / multi-state: interpolate in log-space from ~150 km diagonal toward ~5000 km cap.
  const logMin = Math.log10(localExtentMaxM);
  const logMax = Math.log10(5_000_000);
  const u = Math.min(
    1,
    Math.max(0, (Math.log10(diagM) - logMin) / (logMax - logMin)),
  );
  const spanT =
    ROUTE_SNAP_TOLERANCE_M_MIN +
    (ROUTE_SNAP_TOLERANCE_M_MAX - ROUTE_SNAP_TOLERANCE_M_MIN) * u;

  return Math.round(
    Math.min(
      ROUTE_SNAP_TOLERANCE_M_MAX,
      Math.max(ROUTE_SNAP_TOLERANCE_M_MIN, spanT),
    ),
  );
}
