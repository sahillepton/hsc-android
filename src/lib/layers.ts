import * as turf from "@turf/turf";
import type { LayerProps } from "./definitions";
import {
  extractGeometryCoordinates,
  formatArea,
  formatDistance,
  calculateIgrs,
} from "./utils";
import { EARTH_RADIUS_M, METERS_PER_DEGREE_LAT } from "./constants";

export const computeLayerBounds = (layer: LayerProps) => {
  const points: [number, number][] = [];

  if (layer.type === "point" && layer.position) {
    points.push(layer.position);
  }

  if (layer.type === "line" && layer.path) {
    points.push(...layer.path);
  }

  if (layer.type === "polygon" && layer.polygon) {
    layer.polygon.forEach((ring) => {
      ring.forEach((coord) => {
        points.push(coord);
      });
    });
  }

  if (layer.type === "geojson" && layer.geojson) {
    layer.geojson.features.forEach((feature) => {
      if (feature.geometry) {
        points.push(...extractGeometryCoordinates(feature.geometry));
      }
    });
  }

  if (layer.type === "azimuth") {
    if (layer.azimuthCenter) points.push(layer.azimuthCenter);
    if (layer.azimuthTarget) points.push(layer.azimuthTarget);
    if (layer.azimuthNorth) points.push(layer.azimuthNorth);
  }

  if (layer.type === "nodes" && layer.nodes) {
    layer.nodes.forEach((node) => {
      points.push([node.longitude, node.latitude]);
    });
  }

  if (layer.bounds) {
    const [[minLng, minLat], [maxLng, maxLat]] = layer.bounds;
    points.push([minLng, minLat], [maxLng, maxLat]);
  }

  const validPoints = points.filter(
    (point) =>
      Array.isArray(point) &&
      point.length >= 2 &&
      typeof point[0] === "number" &&
      typeof point[1] === "number" &&
      !Number.isNaN(point[0]) &&
      !Number.isNaN(point[1])
  );

  if (validPoints.length === 0) {
    return null;
  }

  // Calculate min/max using loops instead of spread operator to avoid stack overflow
  // when dealing with layers that have many coordinates (e.g., large polygons)
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const point of validPoints) {
    const lng = point[0];
    const lat = point[1];
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  // If all values are still Infinity, return null (no valid points)
  if (
    !Number.isFinite(minLng) ||
    !Number.isFinite(maxLng) ||
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLat)
  ) {
    return null;
  }

  const isSinglePoint =
    Math.abs(maxLng - minLng) < 1e-6 && Math.abs(maxLat - minLat) < 1e-6;

  // Centre of the FEATURE, which is not always the centre of its bounding box.
  //
  // An azimuth's bounds include `azimuthNorth` — a reference tick placed
  // max(distance, 1000) m due NORTH of the centre (index.tsx, where the layer is
  // created). For a due-east azimuth the leg itself has almost no latitude extent,
  // so the leg becomes the bbox's south edge and the bbox midpoint sits roughly
  // half the azimuth's own length north of the line.
  //
  // That was invisible while focus always finished in fitBounds, which frames the
  // whole box regardless of where its centre is. It stops being invisible the
  // moment focus centres on this point directly — which it now does whenever the
  // layer's Min/Max Zoom clamps the zoom (see the focus effect in index.tsx) — and
  // the leg lands off screen at the very Min Zoom values that make the clamp fire.
  //
  // `bounds` deliberately still includes the tick: it IS drawn, so fitBounds should
  // keep framing it. Only the centre is corrected.
  const center: [number, number] =
    layer.type === "azimuth" && layer.azimuthCenter && layer.azimuthTarget
      ? [
          (layer.azimuthCenter[0] + layer.azimuthTarget[0]) / 2,
          (layer.azimuthCenter[1] + layer.azimuthTarget[1]) / 2,
        ]
      : [(minLng + maxLng) / 2, (minLat + maxLat) / 2];

  return {
    bounds: [minLng, minLat, maxLng, maxLat] as [
      number,
      number,
      number,
      number
    ],
    center,
    isSinglePoint,
  };
};

export const generateLayerId = () => {
  return `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * True when a deck.gl pick's `object` is a store layer (`LayerProps`) rather
 * than a picked GeoJSON feature.
 *
 * Several hover paths identify "the picked object IS the layer" by the shape
 * `object.id && object.type` — true for sketch point/line data items, which
 * carry the whole `LayerProps`. But it is ALSO true for a GeoJSON feature that
 * has a top-level `id`: QGIS/ogr2ogr routinely write one (`{"type":"Feature",
 * "id":1,...}`), so `type` is `"Feature"` and `id` is a feature id like `1`.
 * Those paths then looked up a layer with id `1`, found none, and concluded the
 * hovered layer was gone — which wiped the tooltip the instant it appeared.
 *
 * Store layer ids are always strings (`generateLayerId`) and `LayerProps` has
 * no `geometry`, so requiring a string id and rejecting anything Feature-shaped
 * separates the two cases cleanly.
 */
export const isStoreLayerPickObject = (object: unknown): boolean => {
  if (!object || typeof object !== "object") return false;
  const candidate = object as {
    id?: unknown;
    type?: unknown;
    geometry?: unknown;
  };
  if (typeof candidate.id !== "string" || !candidate.type) return false;
  // GeoJSON feature — never a store layer.
  if (candidate.type === "Feature" || candidate.type === "FeatureCollection") {
    return false;
  }
  return candidate.geometry === undefined || candidate.geometry === null;
};

export const toRadians = (deg: number) => (deg * Math.PI) / 180;
export const toDegrees = (rad: number) => (rad * 180) / Math.PI;

export const calculateDistanceMeters = (
  a: [number, number],
  b: [number, number]
) => {
  const R = EARTH_RADIUS_M;
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const dLat = toRadians(b[1] - a[1]);
  const dLon = toRadians(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return R * c;
};

/**
 * Calculate threshold in meters based on zoom level
 * At zoom 18: ~5 meters (very zoomed in, precise closing)
 * At zoom 10: ~20 meters (medium zoom)
 * At zoom 5: ~50 meters (zoomed out)
 */
export const getPolygonCloseThreshold = (zoom: number): number => {
  // Scale threshold based on zoom level
  // At zoom 18, use ~5 meters (approximately 8-10 pixels)
  // Formula: threshold decreases as zoom increases
  if (zoom >= 18) {
    return 5; // Very zoomed in - precise closing
  } else if (zoom >= 15) {
    return 10; // High zoom
  } else if (zoom >= 12) {
    return 15; // Medium-high zoom
  } else if (zoom >= 10) {
    return 20; // Medium zoom
  } else if (zoom >= 7) {
    return 30; // Medium-low zoom
  } else {
    return 50; // Low zoom - more forgiving
  }
};

export const isPointNearFirstPoint = (
  point: [number, number],
  firstPoint: [number, number],
  thresholdMeters?: number // Optional - if not provided, will use default based on zoom
) => {
  // Use actual distance in meters instead of degrees to avoid premature closure
  const threshold = thresholdMeters ?? 20; // Default fallback
  return calculateDistanceMeters(point, firstPoint) <= threshold;
};

export const calculateBearingDegrees = (
  a: [number, number],
  b: [number, number]
) => {
  // Azimuth = the angle the DRAWN straight line makes with true north, i.e. the
  // rhumb-line (loxodrome / constant-heading) bearing. This is a single fixed
  // heading — unlike the great-circle *initial* bearing, which changes along the
  // path and reads e.g. ~86.8° for a long due-east line that visually sits at 90°.
  // The rhumb bearing gives exactly 90° there, matching the line you see; for short
  // spans (antenna sectors) the two are indistinguishable.
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  // The FULL east-west run, deliberately NOT folded onto the shorter arc.
  //
  // The shorter arc is the right answer for navigation, but not for a measurement
  // label sitting on a drawn line. Nothing in this app draws a wrapped line — no
  // layer sets deck's `wrapLongitude` — so a segment spanning more than 180° of
  // longitude is drawn the long way round, and folding the run onto the short arc
  // described a line that is not on screen. An azimuth from (75°W, 50°S) to
  // (118°E, 37°N) spans 193° east and clearly rises to the north-east, yet read
  // −59.6° (north-WEST); as drawn it is +63.1°. Spans under 180° are identical
  // either way, which is why only very wide azimuths showed it.
  const dLon = toRadians(b[0] - a[0]);
  // Difference of "stretched" (Mercator) latitudes; 0 for an east-west line, which
  // is what makes a due-east segment come out as exactly 90°.
  const dPhi = Math.log(
    Math.tan(Math.PI / 4 + lat2 / 2) / Math.tan(Math.PI / 4 + lat1 / 2)
  );
  const brng = Math.atan2(dLon, dPhi);
  return (toDegrees(brng) + 360) % 360; // Normalize 0-360
};

export const makeSectorPolygon = (
  center: [number, number],
  radiusMeters: number,
  bearingDeg: number,
  sectorAngleDeg: number,
  segments = 64
): [number, number][] => {
  const [lng, lat] = center;
  const latRad = toRadians(lat);
  const metersPerDegLat = METERS_PER_DEGREE_LAT;
  const metersPerDegLng = METERS_PER_DEGREE_LAT * Math.cos(latRad);
  const dLat = radiusMeters / metersPerDegLat;
  const dLng = radiusMeters / metersPerDegLng;

  const half = sectorAngleDeg / 2;
  const start = toRadians(bearingDeg - half);
  const end = toRadians(bearingDeg + half);

  const points: [number, number][] = [];
  // start at center
  points.push([lng, lat]);

  // sample arc from start to end
  const steps = Math.max(8, Math.floor((segments * sectorAngleDeg) / 360));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const theta = start + t * (end - start);
    const x = dLng * Math.sin(theta); // east-west offset
    const y = dLat * Math.cos(theta); // north-south offset
    points.push([lng + x, lat + y]);
  }

  // close back to center
  points.push([lng, lat]);
  return points;
};

/**
 * Great-circle destination: `distanceMeters` from `center` along `bearingDeg`.
 *
 * NOTE: a path that walks over a pole comes back down the opposite meridian, so
 * the returned longitude flips by 180°. That is correct great-circle behaviour,
 * but it is not what a "point due north" wants — use `northReferencePoint` for
 * that. Its two former callers were both that mistake, so nothing calls this at
 * present; it is kept as the general bearing/distance projection, and is only
 * safe where the distance cannot reach a pole.
 */
export const destinationPoint = (
  center: [number, number],
  distanceMeters: number,
  bearingDeg: number
): [number, number] => {
  if (!center || !Number.isFinite(distanceMeters)) {
    return center;
  }

  const R = EARTH_RADIUS_M;
  const δ = distanceMeters / R;
  const θ = toRadians(bearingDeg);
  const φ1 = toRadians(center[1]);
  const λ1 = toRadians(center[0]);

  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);
  const sinθ = Math.sin(θ);
  const cosθ = Math.cos(θ);

  const φ2 = Math.asin(sinφ1 * cosδ + cosφ1 * sinδ * cosθ);
  const λ2 = λ1 + Math.atan2(sinθ * sinδ * cosφ1, cosδ - sinφ1 * Math.sin(φ2));

  return [toDegrees(λ2), toDegrees(φ2)];
};

/**
 * The north reference tick for an azimuth: `distanceMeters` due north of `center`.
 *
 * Must NOT be built with `destinationPoint(center, d, 0)`. That is the great-circle
 * destination, and its longitude term is
 *
 *     λ2 = λ1 + atan2(sinθ·sinδ·cosφ1, cosδ − sinφ1·sinφ2)
 *
 * With θ = 0 the numerator is 0, so λ2 = λ1 — until the path walks over the pole.
 * Past that point `cosδ − sinφ1·sinφ2` turns negative, `atan2(0, negative)` is π,
 * and the "north" point jumps to the OPPOSITE meridian while asin folds the
 * latitude back down. From (20°E, 35°S) that happens at ~13 900 km: a 15 125 km
 * azimuth put the tick at 160°W / 79°N, drawing a long diagonal across the Pacific
 * instead of a vertical line. Short legs were unaffected, which is why this only
 * showed up on very long azimuths.
 *
 * A north reference only has to be due north, so it is built directly: same
 * longitude, latitude walked north and stopped at the pole. Same longitude is what
 * makes it render vertical in both projections — a meridian is a straight vertical
 * line in plate carrée and in Mercator alike.
 *
 * The arc uses EARTH_RADIUS_M, matching `calculateDistanceMeters`, so the tick is
 * exactly as long as the leg it is measuring against.
 */
export const northReferencePoint = (
  center: [number, number],
  distanceMeters: number
): [number, number] => {
  if (!center || !Number.isFinite(distanceMeters)) return center;

  // Just short of 90: the pole itself is unprojectable in Mercator (y → ∞), and
  // the layer data is shared by both renderers. At this latitude the tick already
  // runs off the top of the view, which is all a north reference needs to do.
  const POLE_LIMIT = 89.9999;

  const arcDeg = toDegrees(Math.abs(distanceMeters) / EARTH_RADIUS_M);
  // `max` keeps the tick from ever pointing SOUTH for a centre that is already
  // north of the limit; there it collapses to nothing, which is honest — every
  // direction from the pole is south.
  const lat = Math.max(center[1], Math.min(center[1] + arcDeg, POLE_LIMIT));
  return [center[0], lat];
};

export const normalizeAngleSigned = (angleDeg: number) => {
  if (!Number.isFinite(angleDeg)) return angleDeg;
  // Floor-based modulo. JS `%` keeps the sign of the DIVIDEND, so the shorter
  // ((angleDeg + 540) % 360) - 180 returned -360 for -720 rather than 0: any
  // input below -540 fell straight out of the range this function exists to
  // enforce. Unreachable from calculateBearingDegrees, which returns 0-360, but
  // not something to leave sitting in a shared helper.
  const wrapped = (((angleDeg + 180) % 360) + 360) % 360;
  return wrapped - 180;
};

/**
 * An azimuth as it is shown to the user: measured from the north reference line,
 * CLOCKWISE POSITIVE 0…+180, anticlockwise 0…−179.
 *
 * `normalizeAngleSigned` alone lands on [−180, +180), which puts due south at
 * −180 — the wrong end of that range, since 180° of clockwise turn is what a
 * south-pointing line has. Hence the +180 correction.
 *
 * Every place that displays an azimuth goes through here: the on-map label, the
 * drawing preview, the tooltip, the sketch list and `formatLayerMeasurements`.
 * The correction used to be copy-pasted at three of those and missing at the
 * fourth, so a due-south azimuth read 180.0° on the map and −180.0° in the panel.
 *
 * Idempotent, so it is safe on a value that has already been through it.
 */
export const azimuthDisplayAngle = (angleDeg: number) => {
  if (!Number.isFinite(angleDeg)) return angleDeg;
  const signed = normalizeAngleSigned(angleDeg);
  return signed === -180 ? 180 : signed;
};

export type LayerMeasurement = {
  label: string;
  value: string;
  isIgrsUnavailable?: boolean; // true when IGRS was requested but not available
};

const formatCoordinate = (
  point?: [number, number] | null,
  addDegrees = false
) => {
  if (
    !point ||
    point.length < 2 ||
    !Number.isFinite(point[0]) ||
    !Number.isFinite(point[1])
  ) {
    return null;
  }

  const [lng, lat] = point;
  const degreeSymbol = addDegrees ? "°" : "";
  return `${lat.toFixed(6)}${degreeSymbol}, ${lng.toFixed(6)}${degreeSymbol}`;
};

const getPathLengthMeters = (path?: [number, number][]) => {
  if (!path || path.length < 2) return 0;
  return path.slice(0, -1).reduce((total, point, index) => {
    const next = path[index + 1];
    return total + calculateDistanceMeters(point, next);
  }, 0);
};

const ensureClosedRing = (ring: [number, number][]) => {
  if (!ring || ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) {
    return ring;
  }
  return [...ring, first];
};

export const computePolygonAreaMeters = (polygon?: [number, number][][]) => {
  if (!polygon || !polygon.length) return 0;
  const normalized = polygon
    .map((ring) => ensureClosedRing(ring))
    .filter((ring) => ring.length >= 4);
  if (!normalized.length) return 0;
  try {
    const poly = turf.polygon(normalized);
    return Math.abs(turf.area(poly));
  } catch {
    return 0;
  }
};

export const computePolygonPerimeterMeters = (
  polygon?: [number, number][][]
) => {
  if (!polygon || !polygon.length) return 0;
  const outerRing = ensureClosedRing(polygon[0] ?? []);
  if (outerRing.length < 2) return 0;
  return outerRing.slice(0, -1).reduce((total, point, index) => {
    const next = outerRing[index + 1];
    return total + calculateDistanceMeters(point, next);
  }, 0);
};

const formatCoordinateWithSystem = (
  point?: [number, number] | null,
  useIgrs?: boolean,
  addDegrees = false
) => {
  if (!point || point.length < 2)
    return formatCoordinate(point ?? null, addDegrees);
  if (useIgrs) {
    const igrsValue = calculateIgrs(point[0], point[1]);
    if (igrsValue) {
      return igrsValue;
    }
    // IGRS not available, fall back to lat/long with degrees
    return formatCoordinate(point, true);
  }
  return formatCoordinate(point, addDegrees);
};

export const formatLayerMeasurements = (
  layer: LayerProps,
  options?: { useIgrs?: boolean }
): LayerMeasurement[] => {
  const measurements: LayerMeasurement[] = [];
  const pushMeasurement = (label: string, value?: string | null) => {
    if (!value) return;
    measurements.push({ label, value });
  };

  const coordinateLabel = options?.useIgrs ? "IGRS" : "LAT/LONG";
  const addDegrees = !options?.useIgrs;

  // Helper to check if IGRS is available for a point
  const isIgrsAvailable = (point?: [number, number] | null): boolean => {
    if (!point || point.length < 2 || !options?.useIgrs) return true;
    return calculateIgrs(point[0], point[1]) !== null;
  };

  // Helper to push measurement with IGRS availability check
  const pushCoordinateMeasurement = (
    label: string,
    point?: [number, number] | null
  ) => {
    if (!point || point.length < 2) return;
    const value = formatCoordinateWithSystem(
      point,
      options?.useIgrs,
      addDegrees
    );
    if (!value) return;
    const isIgrsUnavailable = options?.useIgrs && !isIgrsAvailable(point);
    measurements.push({ label, value, isIgrsUnavailable });
  };

  if (layer.type === "point") {
    if (typeof layer.radius === "number") {
      pushMeasurement("Radius", `${layer.radius}px`);
    }
    pushCoordinateMeasurement(
      `Location (${coordinateLabel})`,
      layer.position ?? null
    );
  }

  if (layer.type === "line" && layer.path) {
    if (layer.path.length >= 2) {
      pushCoordinateMeasurement(`From (${coordinateLabel})`, layer.path[0]);
      pushCoordinateMeasurement(
        `To (${coordinateLabel})`,
        layer.path[layer.path.length - 1]
      );
    }

    const lengthMeters = getPathLengthMeters(layer.path);
    if (lengthMeters > 0) {
      pushMeasurement("Distance", formatDistance(lengthMeters / 1000));
    }

    if (layer.segmentDistancesKm && layer.segmentDistancesKm.length > 0) {
      const segments = layer.segmentDistancesKm.filter((dist) =>
        Number.isFinite(dist)
      );
      if (segments.length) {
        pushMeasurement("Total Segments", `${segments.length}`);
        const totalKm = segments.reduce((sum, dist) => sum + dist, 0);
        if (segments.length === 1) {
          pushMeasurement("Segment Length", formatDistance(segments[0]));
        } else {
          const maxSegment = Math.max(...segments);
          const minSegment = Math.min(...segments);
          const avgSegment = totalKm / segments.length;
          pushMeasurement("Max Segment", formatDistance(maxSegment));
          pushMeasurement("Min Segment", formatDistance(minSegment));
          pushMeasurement("Avg Segment", formatDistance(avgSegment));
        }
      }
    }

    if (typeof layer.lineWidth === "number") {
      pushMeasurement("Width", `${layer.lineWidth}px`);
    }
  }

  if (layer.type === "polygon" && layer.polygon?.length) {
    const perimeterMeters = computePolygonPerimeterMeters(layer.polygon);
    if (perimeterMeters > 0) {
      pushMeasurement("Perimeter", formatDistance(perimeterMeters / 1000));
    }

    const areaMeters = computePolygonAreaMeters(layer.polygon);
    if (areaMeters > 0) {
      pushMeasurement("Area", formatArea(areaMeters));
    }

    if (layer.polygon[0]?.length) {
      pushMeasurement("Vertices Drawn", `${layer.polygon[0].length - 1}`);
    }

    if (typeof layer.sectorAngleDeg === "number") {
      pushMeasurement("Sector Angle", `${layer.sectorAngleDeg}°`);
    }

    if (typeof layer.radiusMeters === "number") {
      pushMeasurement("Radius", formatDistance(layer.radiusMeters / 1000));
    }

    if (typeof layer.bearing === "number") {
      pushMeasurement("Bearing", `${layer.bearing.toFixed(1)}°`);
    }
  }

  if (layer.type === "azimuth") {
    if (typeof layer.azimuthAngleDeg === "number") {
      // Callers pass either the raw 0-360 bearing or an already-signed value;
      // azimuthDisplayAngle is idempotent, so both come out in the shown range.
      pushMeasurement(
        "Angle",
        `${azimuthDisplayAngle(layer.azimuthAngleDeg).toFixed(1)}°`
      );
    }
    if (typeof layer.distanceMeters === "number") {
      pushMeasurement("Distance", formatDistance(layer.distanceMeters / 1000));
    }
    if (layer.azimuthCenter) {
      pushCoordinateMeasurement(
        `Center (${coordinateLabel})`,
        layer.azimuthCenter
      );
    }
    if (layer.azimuthTarget) {
      pushCoordinateMeasurement(
        `Target (${coordinateLabel})`,
        layer.azimuthTarget
      );
    }
  }

  return measurements;
};

export const availableIcons = [
  "fighter1",
  "fighter2",
  "fighter3",
  "fighter4",
  "fighter5",
  "fighter6",
  "fighter7",
  "fighter8",
  "fighter9",
  "fighter10",
];

/**
 * Calculate the area covered by a layer's bounding box in square kilometers
 */
export const calculateLayerAreaSqKm = (layer: LayerProps): number | null => {
  try {
    let bbox: [number, number, number, number] | null = null;

    if (layer.bounds) {
      const [[minLng, minLat], [maxLng, maxLat]] = layer.bounds;
      bbox = [minLng, minLat, maxLng, maxLat];
    } else if (layer.type === "line" && layer.path && layer.path.length >= 2) {
      const lngs = layer.path.map((p) => p[0]);
      const lats = layer.path.map((p) => p[1]);
      bbox = [
        Math.min(...lngs),
        Math.min(...lats),
        Math.max(...lngs),
        Math.max(...lats),
      ];
    } else if (
      layer.type === "polygon" &&
      layer.polygon &&
      layer.polygon.length > 0 &&
      layer.polygon[0]
    ) {
      const ring = layer.polygon[0];
      const lngs = ring.map((p) => p[0]);
      const lats = ring.map((p) => p[1]);
      bbox = [
        Math.min(...lngs),
        Math.min(...lats),
        Math.max(...lngs),
        Math.max(...lats),
      ];
    } else if (layer.type === "geojson" && layer.geojson) {
      bbox = turf.bbox(layer.geojson) as [number, number, number, number];
    } else if (
      layer.type === "azimuth" &&
      layer.azimuthCenter &&
      layer.azimuthTarget
    ) {
      const points = [layer.azimuthCenter, layer.azimuthTarget];
      const lngs = points.map((p) => p[0]);
      const lats = points.map((p) => p[1]);
      bbox = [
        Math.min(...lngs),
        Math.min(...lats),
        Math.max(...lngs),
        Math.max(...lats),
      ];
    } else if (
      layer.type === "nodes" &&
      layer.nodes &&
      layer.nodes.length > 0
    ) {
      const lngs = layer.nodes.map((n) => n.longitude);
      const lats = layer.nodes.map((n) => n.latitude);
      bbox = [
        Math.min(...lngs),
        Math.min(...lats),
        Math.max(...lngs),
        Math.max(...lats),
      ];
    } else if (
      layer.type === "annotation" &&
      layer.annotations &&
      layer.annotations.length > 0
    ) {
      const lngs = layer.annotations.map((a) => a.position[0]);
      const lats = layer.annotations.map((a) => a.position[1]);
      bbox = [
        Math.min(...lngs),
        Math.min(...lats),
        Math.max(...lngs),
        Math.max(...lats),
      ];
    }

    if (!bbox) return null;

    // Create a polygon from bbox to calculate area
    const bboxPolygon = turf.bboxPolygon(bbox);
    const areaSqM = turf.area(bboxPolygon);
    const areaSqKm = areaSqM / 1000000; // Convert from square meters to square kilometers

    return areaSqKm;
  } catch (error) {
    console.error("Error calculating layer area:", error);
    return null;
  }
};

/**
 * Compute the zoom range based on the area covered by a layer
 * > 200 km²: minZoom = 1, maxZoom = 5 (very large area → show early)
 * 20–200 km²: minZoom = 4, maxZoom = 9 (medium features)
 * 1–20 km²: minZoom = 7, maxZoom = 11 (small features)
 * < 1 km²: minZoom = 10, maxZoom = 12 (very small area → show close up)
 */
export const computeZoomRange = (areaSqKm: number) => {
  let result;
  if (areaSqKm > 200) {
    result = { minZoom: 1, maxZoom: 20 };
  } else {
    result = { minZoom: 9, maxZoom: 20 };
  }
  return result;
};

/**
 * Calculate and return the zoom range (minZoom and maxZoom) for a layer based on its area
 * Returns undefined if calculation fails or for point layers
 */
export const calculateLayerZoomRange = (
  layer: LayerProps
): { minZoom: number; maxZoom: number } | undefined => {
  // Skip point layers
  if (layer.type === "point") {
    return undefined;
  }

  const areaSqKm = calculateLayerAreaSqKm(layer);
  if (areaSqKm === null || areaSqKm <= 0) {
    return undefined;
  }

  const result = computeZoomRange(areaSqKm);
  return result;
};

/**
 * Calculate and return the minzoom for a layer based on its area
 * Returns undefined if calculation fails or for point layers
 * @deprecated Use calculateLayerZoomRange instead
 */
export const calculateLayerMinZoom = (
  layer: LayerProps
): number | undefined => {
  const zoomRange = calculateLayerZoomRange(layer);
  return zoomRange?.minZoom;
};
