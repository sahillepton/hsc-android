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
export const MAP_MAX_ZOOM = 18; // camera zoom limit (you can zoom this far in)
export const MAP_MAX_PITCH = 85;
/**
 * FALLBACK native max zoom for a vector source, used ONLY when the tileset's
 * style.json omits `maxzoom`. Normally the source's own `maxzoom` is preserved (the
 * tile server declares it correctly per tileset). In mapbox-gl the source `maxzoom`
 * is the native max — beyond it mapbox OVERZOOMS (scales the last real tiles) and
 * requests no further tiles. Setting it HIGHER than what exists makes mapbox 404 the
 * missing zooms → blank. (mapbox ignores `maxNativeZoom`, a Leaflet prop, so only
 * `maxzoom` matters.) The built-in tileset is z0–14.
 */
export const TILE_SOURCE_MAX_NATIVE_ZOOM = 14;
/**
 * Web Mercator (EPSG:3857) valid latitude limit. Latitudes beyond this are off-world:
 * when the map is rotated/pitched, screen pixels in the surrounding whitespace void
 * still `unproject` to coordinates (lat up to ±90°), which must be rejected for drawing.
 */
export const MAX_MERCATOR_LATITUDE = 85.0511287798066;

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

/**
 * Character cap for a user-entered layer name.
 *
 * Sized to the UI rather than picked arbitrarily: the layer cards render the name
 * at 16px inside `max-w-[200px]` with `truncate`, which shows roughly 25-28
 * characters. 50 leaves comfortable headroom for a descriptive name (nothing
 * legitimate gets blocked) while stopping the field from accepting unbounded
 * input that is then persisted to the session manifest and re-read on every load.
 */
export const MAX_LAYER_NAME_LENGTH = 50;

/**
 * Resolution factor for the altitude in a topology info message (HSC, 17 Aug).
 *
 * The wire value is a UINT16 in units of 4 feet, so metres = raw x 1.2192
 * (4 x 0.3048). Displayed to 2 decimal places per the same spec.
 *
 * Applied at DISPLAY time, not in the parser: the parser stays a faithful decoder
 * of the wire format, so the stored value keeps the protocol's own units and
 * cannot end up double-converted by a second consumer.
 */
export const TOPOLOGY_ALTITUDE_RESOLUTION_M = 1.2192;

// ── Tooltip ──────────────────────────────────────────────────────────────────
/** How many feature attributes a tooltip shows by DEFAULT (before the user picks
 *  fields in the layer settings). Keeps big-schema features compact and reliably
 *  positioned; the same number seeds the initial selection so the settings panel
 *  and the tooltip always agree. */
export const TOOLTIP_DEFAULT_ATTR_LIMIT = 10;
