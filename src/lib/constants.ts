// ── Networking ───────────────────────────────────────────────────────────────
export const UDP_PORT = 40074;
export const ANDROID_TILE_SERVER_PORT = 8080;

// ── Mapbox ───────────────────────────────────────────────────────────────────
export const MAPBOX_ACCESS_TOKEN =
  "pk.eyJ1IjoibmlraGlsc2FyYWYiLCJhIjoiY2xlc296YjRjMDA5dDNzcXphZjlzamFmeSJ9.7ZDaMZKecY3-70p9pX9-GQ";

// ── Map view defaults ────────────────────────────────────────────────────────
export const DEFAULT_CENTER: [number, number] = [81.5, 20.5]; // India center
export const DEFAULT_ZOOM = 3;
export const INITIAL_MAP_ZOOM = 4;
export const GEOLOCATION_ZOOM = 14;
export const MAP_MIN_ZOOM = 0;
export const MAP_MAX_ZOOM = 18;
export const MAP_MAX_PITCH = 85;
export const TILE_SOURCE_MAX_NATIVE_ZOOM = 5;

// ── Tile paths ───────────────────────────────────────────────────────────────
export const TILES_FOLDER_NAME = "tiles";
export const ANDROID_TILES_PATH = "Internal Storage/Documents/tiles";
export const ANDROID_SCREENSHOTS_PATH = "Internal Storage/Pictures/HSC Maps";

// ── Geodesy ──────────────────────────────────────────────────────────────────
export const EARTH_RADIUS_M = 6371000;
export const METERS_PER_DEGREE_LAT = 111320;

// ── DEM / Elevation ──────────────────────────────────────────────────────────
export const DEM_NO_DATA_VALUE = -32768;
export const DEM_MIN_VALID_ELEVATION = -1000;
export const DEM_MAX_VALID_ELEVATION = 9000;

// ── Route analysis ───────────────────────────────────────────────────────────
/** Bounds for graph-build snap tolerance (see `computeRouteSnapToleranceMeters`). */
export const ROUTE_SNAP_TOLERANCE_M_MIN = 1;
/** National-scale line layers; city / district stays at {@link ROUTE_SNAP_TOLERANCE_M_MIN}. */
export const ROUTE_SNAP_TOLERANCE_M_MAX = 30;
/** Fallback when snap tolerance is not passed (worker default). */
export const ROUTE_SNAP_TOLERANCE_M = ROUTE_SNAP_TOLERANCE_M_MIN;

/** Floor (m) for zoom-scaled click snap when zoomed in. */
export const ROUTE_MAX_SNAP_DIST_M = 500;
/** Screen pixels of click slack → scales max snap distance at low zoom. */
export const ROUTE_SNAP_TOLERANCE_PIXELS = 28;
/** Upper bound (m) for zoom-scaled click snap. */
export const ROUTE_MAX_SNAP_DIST_CAP_M = 400_000;

export const ROUTE_BRIDGE_TOLERANCE_MULTIPLIER = 2;

// ── UDP timeouts ─────────────────────────────────────────────────────────────
export const UDP_NO_DATA_TIMEOUT_MS = 5000;
export const UDP_STALE_CHECK_INTERVAL_MS = 2000;
export const UDP_STALE_THRESHOLD_MS = 5000;

// ── Permissions ──────────────────────────────────────────────────────────────
export const STORAGE_PERMISSION_TIMEOUT_MS = 5000;

// ── Zoom visibility ──────────────────────────────────────────────────────────
export const DEFAULT_LAYER_MAX_ZOOM = 20;
