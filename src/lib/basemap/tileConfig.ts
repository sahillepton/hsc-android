/**
 * Basemap tile-set descriptor: how to read a `{z}/{x}/{y}.{ext}` tiles folder.
 *
 * The two things that cannot be worked out from the tiles themselves — the
 * PROJECTION and the FORMAT — are asked of the user in the Map Tiles dialog and
 * stored on the source; everything else is discovered from the served folder (see
 * `resolveTilesConfig` below). A `config.txt` descriptor is no longer read: it
 * carried only these same fields, and a second source of truth meant the same pack
 * could render differently depending on whether someone had dropped a descriptor
 * beside the tiles.
 *
 * For reference, the descriptor the `generate_wgs84_tiles.py` tool emits looks
 * like this — the first two lines are what the dialog now asks for:
 *
 *     projection = EPSG:4326     # EPSG:4326 (geodetic) | EPSG:3857 (web mercator)
 *     format     = png           # png | jpg | jpeg | webp | pbf
 *     scheme     = xyz           # xyz (y=0 at NORTH) | tms (y=0 at SOUTH)
 *     tileSize   = 256
 *     minZoom    = 0
 *     maxZoom    = 10
 *     tilesAtZ0  = 2             # 4326 only: columns at zoom 0 (1 = square, 2 = 2:1)
 *
 * Supported grids:
 *   - EPSG:4326, 2 cols @ z0  → cols 2^(z+1) × rows 2^z  (generated 2:1 set)
 *   - EPSG:4326, 1 col  @ z0  → cols 2^z     × rows 2^z  (square / "squished" set)
 *   - EPSG:3857 (Mercator)    → cols 2^z     × rows 2^z, clipped to ±85.0511°
 *
 * NOTE: EPSG:4326 reaches the full ±90° (incl. 85–90°); EPSG:3857 physically
 * cannot. Rendering a 4326 set therefore requires the plate-carrée basemap path,
 * not mapbox-gl (which is Mercator-only). This module is pure — parsing and grid
 * geometry only — so it is shared by both the Mercator and 4326 render paths.
 */

export type Projection = "epsg4326" | "epsg3857";

export interface TilesConfig {
  projection: Projection;
  /** File extension used by the tiles: png | jpg | jpeg | webp | pbf. */
  format: string;
  /** Row order: xyz = y0 at north (default), tms = y0 at south. */
  scheme: "xyz" | "tms";
  tileSize: number;
  /** Shallowest zoom level present in the pack. */
  minZoom: number;
  /**
   * MAX NATIVE ZOOM: the deepest level that actually has tiles.
   *
   * NOT a camera limit — how far the user may zoom stays MAP_MAX_ZOOM. This is the
   * level past which no deeper tile is requested and the renderer upscales the last
   * real one instead (deck: `TileLayer.maxZoom`; mapbox: a source's `maxzoom`).
   * Overstating it means 404s and a blank map; understating it means blur.
   */
  maxZoom: number;
  /** Columns at zoom 0. 4326: 1 (square) or 2 (2:1). 3857: always 1. */
  cols0: number;
  /** True when format is a vector format (pbf) — needs the vector renderer. */
  vector: boolean;
}

/**
 * The choices offered in the Map Tiles setup dialog.
 *
 * Kept here, beside the model they feed, so the dialog can never offer a value the
 * renderer does not understand. `value` is stored verbatim on the basemap source:
 * a Projection for the grid, and for the format the literal FILE EXTENSION the
 * tiles use — which is why jpg and jpeg are separate entries rather than aliases.
 *
 * `label` is the plain name, used in prose (see `projectionLabel`). `code` is the
 * EPSG identifier, shown alongside it in the dropdown so someone who knows the
 * tiles by their code can still recognise the entry.
 */
export const PROJECTION_OPTIONS: ReadonlyArray<{
  value: Projection;
  label: string;
  code: string;
}> = [
  { value: "epsg4326", label: "WGS 84", code: "EPSG:4326" },
  { value: "epsg3857", label: "Web Mercator", code: "EPSG:3857" },
];

/**
 * Display name for a projection.
 *
 * Everything user-facing goes through this, so a warning about a wrong pick uses
 * the same words as the dropdown that offered it.
 */
export function projectionLabel(p: Projection): string {
  return PROJECTION_OPTIONS.find((o) => o.value === p)?.label ?? p;
}

export const TILE_FORMAT_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: "png", label: "PNG (.png)" },
  { value: "jpg", label: "JPG (.jpg)" },
  { value: "jpeg", label: "JPEG (.jpeg)" },
  { value: "webp", label: "WEBP (.webp)" },
  // The one format that changes which renderer runs, so it says so.
  { value: "pbf", label: "PBF (.pbf) — vector" },
];

/** Mercator's exact valid-latitude edge — a 3857 set has no data beyond this. */
export const MERCATOR_MAX_LAT = 85.0511287798066;

export const DEFAULT_TILES_CONFIG: TilesConfig = {
  projection: "epsg3857",
  format: "png",
  scheme: "xyz",
  tileSize: 256,
  minZoom: 0,
  maxZoom: 14,
  cols0: 1,
  vector: false,
};

// ---------------------------------------------------------------------------
// Classification helpers — which render path a set needs
// ---------------------------------------------------------------------------
export type BasemapKind =
  | "vector-mercator" // .pbf 3857 — current mapbox-gl vector style path
  | "raster-mercator" // .png/.jpg 3857 — mapbox-gl raster source
  | "raster-geodetic"; // .png/.jpg 4326 — plate-carrée path (reaches 85–90°)

export function classifyTiles(cfg: TilesConfig): BasemapKind {
  if (cfg.vector) return "vector-mercator";
  return cfg.projection === "epsg4326" ? "raster-geodetic" : "raster-mercator";
}

/** True when this set needs the 4326 plate-carrée renderer (mapbox-gl can't show it). */
export function needsGeodeticRenderer(cfg: TilesConfig): boolean {
  return classifyTiles(cfg) === "raster-geodetic";
}

/** Human label for the descriptor, e.g. "EPSG:4326 · JPG · 2:1 grid". */
export function describeTilesConfig(cfg: TilesConfig): string {
  const proj = cfg.projection === "epsg4326" ? "EPSG:4326" : "EPSG:3857";
  const fmt = cfg.format.toUpperCase();
  if (cfg.vector) return `${proj} · ${fmt} (vector)`;
  const grid =
    cfg.projection === "epsg4326"
      ? cfg.cols0 === 2
        ? "2:1 grid"
        : "square grid"
      : "mercator grid";
  return `${proj} · ${fmt} · ${grid}`;
}

// ---------------------------------------------------------------------------
// Grid geometry (used by the plate-carrée renderer)
// ---------------------------------------------------------------------------
export function colsAt(cfg: TilesConfig, z: number): number {
  return cfg.cols0 * 2 ** z;
}
export function rowsAt(_cfg: TilesConfig, z: number): number {
  return 2 ** z;
}

// ---------------------------------------------------------------------------
// Resolve a folder's config over HTTP (served by the local tile server)
// ---------------------------------------------------------------------------
const RASTER_EXTS = ["png", "jpg", "jpeg", "webp"] as const;

async function urlExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    // Drain nothing large — a tile HEAD isn't universally supported by the
    // local server, so a GET on the top tile (tiny) is the reliable probe.
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Best-effort format probe, for a source stored before the Map Tiles dialog asked
 * for the format: try 0/0/0.<ext>. Inconclusive for a pack that has no 0/0 tile.
 */
async function detectFormat(baseUrl: string): Promise<string | null> {
  for (const ext of [...RASTER_EXTS, "pbf"]) {
    if (await urlExists(`${baseUrl}/0/0/0.${ext}`)) return ext;
  }
  return null;
}

/** Best-effort 4326 grid probe: a 2:1 set has column x=2 present at z1. */
async function probeCols0(baseUrl: string, ext: string): Promise<1 | 2> {
  return (await urlExists(`${baseUrl}/1/2/0.${ext}`)) ? 2 : 1;
}

/**
 * A single zoom level from the __levels payload, or null if it is not one.
 *
 * Strict on purpose. `Number(null)` is 0 and `Number([])` is 0, so a lenient
 * `map(Number).filter(isFinite)` turns a malformed payload into the level list
 * `[0]` — min 0, max 0 — which reads as a one-level pack and renders the entire
 * map as the single upscaled z0 tile. Rejecting the entry instead falls back to
 * the defaults, which is the honest outcome.
 */
function parseZoomLevel(v: unknown): number | null {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && /^\d{1,2}$/.test(v.trim())
        ? Number(v)
        : NaN;
  // 30 is far past any real pyramid (z30 is ~centimetre tiles) — a value above
  // it is corruption, not a deep pack.
  return Number.isInteger(n) && n >= 0 && n <= 30 ? n : null;
}

/** What the tile server can tell us about the folder it is serving. */
export interface PackInfo {
  minZoom: number;
  /** Deepest level with real tiles — the pack's max native zoom. */
  maxZoom: number;
  /** Extension of a tile actually on disk, when the server reported one. */
  sampleExt?: string;
  /** Level the column count below was measured at. */
  probeZ?: number;
  /** Widest column index present at `probeZ`. */
  maxX?: number;
}

/**
 * Ask the tile server what the active pack actually contains.
 *
 * The deepest level found becomes the pack's MAX NATIVE ZOOM (see TilesConfig) and
 * the shallowest its minZoom. The server owns the folder, so it lists the numeric
 * z subdirectories directly (see the /basemap/__levels route in
 * OfflineTileServerPlugin.kt and electron/main.ts) — no descriptor file to keep in
 * sync, and no guessing by probing tiles, which misreads a pack whose 0/0 tile is
 * absent at deeper levels. The same listing carries the sample extension and
 * column count that `validateTileChoice` checks the user's picks against.
 *
 * Returns null when the endpoint is unavailable (older native build), so the
 * caller can fall back rather than render nothing.
 */
export async function fetchPackInfo(baseUrl: string): Promise<PackInfo | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/__levels`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      levels?: unknown;
      sampleExt?: unknown;
      probeZ?: unknown;
      maxX?: unknown;
    };
    const levels = Array.isArray(body.levels)
      ? body.levels.map(parseZoomLevel).filter((n): n is number => n !== null)
      : [];
    if (levels.length === 0) return null;

    const ext =
      typeof body.sampleExt === "string" &&
      /^[a-z0-9]{1,5}$/.test(body.sampleExt)
        ? body.sampleExt
        : undefined;
    const maxX =
      typeof body.maxX === "number" &&
      Number.isInteger(body.maxX) &&
      body.maxX >= 0
        ? body.maxX
        : undefined;

    return {
      minZoom: Math.min(...levels),
      maxZoom: Math.max(...levels),
      sampleExt: ext,
      probeZ: parseZoomLevel(body.probeZ) ?? undefined,
      maxX,
    };
  } catch {
    return null;
  }
}

/**
 * A pick from the Map Tiles dialog that the folder itself contradicts.
 *
 * `actual` is what the folder says it should be, so the warning can offer the fix
 * instead of only complaining.
 */
export type TileChoiceProblem =
  | { kind: "format"; chosen: string; actual: string }
  | { kind: "projection"; chosen: Projection; actual: Projection };

/**
 * Check the user's picks against what the folder actually holds.
 *
 * Pure, so the rules are testable without a server. Deliberately silent unless a
 * mismatch is PROVABLE — a false alarm on a perfectly good pack would teach people
 * to click straight through the warning:
 *
 *   format     — provable whenever the server reported a sample extension: the
 *                tiles either carry that extension or they do not.
 *   projection — provable in one direction only. A Mercator pyramid has at most
 *                2^z columns at level z, so a column index past that cannot be
 *                Mercator and must be the 2:1 EPSG:4326 grid. The reverse does not
 *                follow: a regional 4326 crop also fits inside 2^z columns, so
 *                picking 4326 is never flagged.
 */
export function validateTileChoice(
  info: PackInfo | null,
  chosen: { projection: Projection; format: string },
): TileChoiceProblem | null {
  if (!info) return null;

  // .jpg and .jpeg hold the same picture; only the filename differs, and that is
  // precisely what is being chosen. Flagging one for the other would be noise.
  const norm = (x: string) => (x === "jpeg" ? "jpg" : x);

  if (info.sampleExt && norm(info.sampleExt) !== norm(chosen.format)) {
    return { kind: "format", chosen: chosen.format, actual: info.sampleExt };
  }

  if (
    chosen.projection === "epsg3857" &&
    info.probeZ != null &&
    info.maxX != null &&
    info.maxX > Math.pow(2, info.probeZ) - 1
  ) {
    return { kind: "projection", chosen: chosen.projection, actual: "epsg4326" };
  }

  return null;
}

/**
 * Resolve the config for a served tiles folder.
 *
 * `chosen` is the projection/format the user picked in the settings dialog and is
 * AUTHORITATIVE — projection in particular cannot be detected from the tiles at
 * all, which is why it is asked for. Everything else is derived:
 *   • minZoom/maxZoom — from the server's folder listing (fetchPackInfo)
 *   • cols0           — probed (a 2:1 4326 set has column x=2 at z1)
 *   • tileSize/scheme — defaults; no pack in use sets them
 *
 * config.txt is deliberately NOT read any more. It only ever carried these same
 * fields, and keeping a second source of truth meant a pack could render one way
 * on one device and another way elsewhere depending on whether someone had
 * dropped a descriptor next to the tiles.
 */
export async function resolveTilesConfig(
  baseUrl: string,
  chosen?: { projection?: Projection; format?: string },
): Promise<TilesConfig> {
  const url = baseUrl.replace(/\/+$/, "");
  const base: TilesConfig = { ...DEFAULT_TILES_CONFIG };

  // Format: the user's choice wins; probe only as a fallback for a source saved
  // before the dialog existed.
  const fmt = chosen?.format ?? (await detectFormat(url));
  if (fmt) {
    base.format = fmt;
    base.vector = fmt === "pbf";
  }

  if (chosen?.projection) base.projection = chosen.projection;

  // Mercator is inherently a single square grid at z0; only 4326 has the 1-vs-2
  // column question, and only a raster set is laid out on our own grid.
  if (base.projection === "epsg4326" && !base.vector) {
    base.cols0 = await probeCols0(url, base.format);
  } else {
    base.cols0 = 1;
  }

  // Zoom range = the levels on disk. maxZoom here is the NATIVE ceiling only: the
  // camera still goes to MAP_MAX_ZOOM, and both renderers upscale the deepest real
  // level past it. Keeps DEFAULT_TILES_CONFIG's range if the endpoint is missing
  // (native build older than the __levels route).
  const info = await fetchPackInfo(url);
  if (info) {
    base.minZoom = info.minZoom;
    base.maxZoom = info.maxZoom;
  }

  return base;
}

