/**
 * Basemap tile-set descriptor: the `config.txt` a tiles folder carries, plus the
 * projection/grid model derived from it.
 *
 * A tiles folder holds a `{z}/{x}/{y}.{ext}` pyramid and an optional `config.txt`
 * describing how to read it. This mirrors the descriptor produced by the
 * `generate_wgs84_tiles.py` tool and consumed by the reference COP viewer, so the
 * same tile sets are portable between the two apps.
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
  minZoom: number;
  maxZoom: number;
  /** Columns at zoom 0. 4326: 1 (square) or 2 (2:1). 3857: always 1. */
  cols0: number;
  /** True when format is a vector format (pbf) — needs the vector renderer. */
  vector: boolean;
}

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
// config.txt parsing
// ---------------------------------------------------------------------------
function normProjection(v: string): Projection | null {
  const s = v.toLowerCase().replace(/[\s_:-]/g, "");
  if (
    ["epsg4326", "4326", "wgs84", "geodetic", "platecarree", "platecarrée"].includes(
      s,
    )
  )
    return "epsg4326";
  if (
    [
      "epsg3857",
      "3857",
      "epsg900913",
      "900913",
      "webmercator",
      "mercator",
      "pseudomercator",
      "wgs84pseudomercator",
    ].includes(s)
  )
    return "epsg3857";
  return null;
}

function normFormat(v: string): string | null {
  const s = v.toLowerCase().replace(/^\./, "").trim();
  if (["png", "jpg", "jpeg", "webp", "pbf", "mvt"].includes(s)) {
    return s === "mvt" ? "pbf" : s;
  }
  return null;
}

/**
 * Parse a tiles `config.txt`. Unknown/missing keys fall back to `base` (the
 * auto-detected defaults). Returns a fully-resolved config. Keys are
 * case-insensitive; `=` or `:` both separate key/value; `#` starts a comment.
 */
export function parseTilesConfig(
  text: string,
  base: TilesConfig = DEFAULT_TILES_CONFIG,
): TilesConfig {
  const cfg: TilesConfig = { ...base };
  const kv: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    const sep = eq >= 0 ? eq : line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const val = line.slice(sep + 1).trim();
    if (key) kv[key] = val;
  }

  if (kv.projection || kv.proj || kv.crs || kv.srs) {
    const p = normProjection(kv.projection ?? kv.proj ?? kv.crs ?? kv.srs);
    if (p) cfg.projection = p;
  }
  if (kv.format || kv.ext || kv.extension) {
    const f = normFormat(kv.format ?? kv.ext ?? kv.extension);
    if (f) cfg.format = f;
  }
  if (kv.scheme || kv.tiling || kv.origin) {
    const s = (kv.scheme ?? kv.tiling ?? kv.origin).toLowerCase();
    if (s.includes("tms")) cfg.scheme = "tms";
    else if (s.includes("xyz") || s.includes("google") || s.includes("slippy"))
      cfg.scheme = "xyz";
  }
  const num = (v: string | undefined) => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const ts = num(kv.tilesize ?? kv.tile_size);
  if (ts && ts > 0) cfg.tileSize = ts;
  const mn = num(kv.minzoom ?? kv.min_zoom ?? kv.minz);
  if (mn != null) cfg.minZoom = mn;
  const mx = num(kv.maxzoom ?? kv.max_zoom ?? kv.maxz);
  if (mx != null) cfg.maxZoom = mx;
  const c0 = num(kv.tilesatz0 ?? kv.cols0 ?? kv.tilesacross ?? kv.gridwidth);
  if (c0 === 1 || c0 === 2) cfg.cols0 = c0;

  // Mercator is inherently a single square grid at z0.
  if (cfg.projection === "epsg3857") cfg.cols0 = 1;
  cfg.vector = cfg.format === "pbf";
  return cfg;
}

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

/** Best-effort format probe when config.txt omits it: try 0/0/0.<ext>. */
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
 * Resolve a tiles folder's config from its HTTP base URL (served by the local
 * tile server). Precedence: hard defaults → probe-detected format/grid → the
 * folder's own `config.txt` (authoritative). Always resolves — falls back to
 * defaults if nothing is reachable.
 */
export async function resolveTilesConfig(baseUrl: string): Promise<TilesConfig> {
  const url = baseUrl.replace(/\/+$/, "");
  const base: TilesConfig = { ...DEFAULT_TILES_CONFIG };

  const fmt = await detectFormat(url);
  if (fmt) {
    base.format = fmt;
    base.vector = fmt === "pbf";
    if (!base.vector) {
      // Assume geodetic-square until config.txt says otherwise; refine cols0.
      base.cols0 = await probeCols0(url, fmt);
    }
  }

  let text: string | null = null;
  try {
    const res = await fetch(`${url}/config.txt`, { cache: "no-store" });
    if (res.ok) text = await res.text();
  } catch {
    text = null;
  }
  return text ? parseTilesConfig(text, base) : base;
}
