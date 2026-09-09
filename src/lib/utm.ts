import proj4 from "proj4";

/**
 * WGS 84 → UTM (Universal Transverse Mercator), the standard 6°-zone grid.
 *
 * The projection maths is proj4's (already a dependency; the LCC tile import
 * uses it too). What this file adds is the grid bookkeeping proj4 leaves to the
 * caller — which zone a point falls in, the latitude-band letter, hemisphere —
 * and one display string, so every tooltip and panel prints UTM the same way,
 * mirroring `calculateIgrs`:
 *
 *   "43R 716094 E 3167096 N"   → zone 43, band R, easting / northing in metres
 *
 * UTM is defined between 80°S and 84°N. Outside that (the polar UPS grids) this
 * returns null, exactly like IGRS does outside its window, so callers show
 * "Not available" rather than a misleading number.
 */

const UTM_MIN_LAT = -80;
const UTM_MAX_LAT = 84;

/** Latitude bands C…X (I and O skipped), 8° each from 80°S; X stretches to 84°N. */
const LATITUDE_BANDS = "CDEFGHJKLMNPQRSTUVWX";

/**
 * Zone number 1–60 for a longitude, with the two standard irregularities:
 * south-west Norway is folded into zone 32 (32V), and Svalbard uses the
 * widened zones 31, 33, 35, 37 (band X).
 */
export function utmZoneNumber(lon: number, lat: number): number {
  // Normalise into [-180, 180); +180 exactly belongs to zone 60.
  const l = lon >= 180 ? 179.999999 : lon;
  let zone = Math.floor((l + 180) / 6) + 1;
  if (lat >= 56 && lat < 64 && l >= 3 && l < 12) zone = 32;
  if (lat >= 72 && lat < 84) {
    if (l >= 0 && l < 9) zone = 31;
    else if (l >= 9 && l < 21) zone = 33;
    else if (l >= 21 && l < 33) zone = 35;
    else if (l >= 33 && l < 42) zone = 37;
  }
  return Math.min(60, Math.max(1, zone));
}

/** Latitude band letter, or null outside UTM's 80°S–84°N coverage. */
export function utmLatitudeBand(lat: number): string | null {
  if (!Number.isFinite(lat) || lat < UTM_MIN_LAT || lat > UTM_MAX_LAT) return null;
  if (lat >= 72) return "X";
  return LATITUDE_BANDS[Math.floor((lat + 80) / 8)] ?? null;
}

export type UtmCoordinate = {
  zone: number;
  band: string;
  /** True south of the equator: northing is measured with the 10 000 km false northing. */
  south: boolean;
  easting: number;
  northing: number;
};

/** Raw UTM components, or null when the point is outside UTM coverage / invalid. */
export function toUtm(lon: number, lat: number): UtmCoordinate | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180) return null;
  const band = utmLatitudeBand(lat);
  if (!band) return null;
  const zone = utmZoneNumber(lon, lat);
  const south = lat < 0;
  const def = `+proj=utm +zone=${zone}${south ? " +south" : ""} +datum=WGS84 +units=m +no_defs`;
  const [easting, northing] = proj4("EPSG:4326", def, [lon, lat]);
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) return null;
  return { zone, band, south, easting, northing };
}

/**
 * Display string for a lon/lat, e.g. "43R 716094 E 3167096 N" (whole metres,
 * the usual field precision). Argument order matches `calculateIgrs`:
 * (longitude, latitude). Null outside UTM coverage.
 */
export function calculateUtm(lon: number, lat: number): string | null {
  const u = toUtm(lon, lat);
  if (!u) return null;
  return `${u.zone}${u.band} ${Math.round(u.easting)} E ${Math.round(u.northing)} N`;
}
