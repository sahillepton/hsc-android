/**
 * Tile-grid geometry for the plate-carrée (OrthographicView) base map.
 *
 * The geodetic base map is drawn in a deck.gl OrthographicView whose world
 * coordinates are raw [longitude, latitude]. This module turns a folder's
 * `TilesConfig` (see tileConfig.ts) into on-screen tile placement, and provides
 * the screen↔degree helpers the view needs. Ported from the reference COP
 * viewer so both apps read the same tile sets identically.
 *
 * Grids:
 *   - EPSG:4326, 2 cols @ z0  → cols 2^(z+1) × rows 2^z  (generated 2:1 set)
 *   - EPSG:4326, 1 col  @ z0  → cols 2^z     × rows 2^z  (square set)
 *   - EPSG:3857 (Mercator)    → cols 2^z     × rows 2^z, ±85.0511°
 */

import {
  MERCATOR_MAX_LAT,
  colsAt,
  rowsAt,
  type TilesConfig,
} from "@/lib/basemap/tileConfig";

export interface TileSpec {
  z: number;
  /** Wrapped column index for the tile FILE. */
  x: number;
  /** Wrapped row index for the tile FILE. */
  y: number;
  /** Unwrapped column across world copies — unique per on-screen tile. */
  worldX: number;
  /** Unwrapped row across world copies — unique per on-screen tile. */
  worldY: number;
  /** deck.gl BitmapLayer bounds: [west, south, east, north] in lng/lat. */
  bounds: [number, number, number, number];
}

// ---------------------------------------------------------------------------
// View-space helpers (screen ↔ degrees) — projection independent
// ---------------------------------------------------------------------------
/** OrthographicView: at zoom Z, 1 degree = 2^Z screen pixels. */
export function pixelsPerDegree(orthoZoom: number): number {
  return 2 ** orthoZoom;
}

/**
 * Smallest OrthographicView zoom at which the world (360°×180°) still COVERS the
 * container (fills it, cropping the over-long axis) — so there is never black
 * margin. pixels-per-degree (2^zoom) must cover the tighter of the two axes.
 */
export function fillMinZoom(widthPx: number, heightPx: number): number {
  const needed = Math.max(widthPx / 360, heightPx / 180, 1e-6);
  return Math.log2(needed);
}

/** Geographic bounds (lng/lat deg) currently visible in an OrthographicView. */
export function viewBounds(
  longitude: number,
  latitude: number,
  orthoZoom: number,
  widthPx: number,
  heightPx: number,
): { west: number; south: number; east: number; north: number } {
  const ppd = pixelsPerDegree(orthoZoom);
  const halfW = widthPx / 2 / ppd;
  const halfH = heightPx / 2 / ppd;
  return {
    west: longitude - halfW,
    east: longitude + halfW,
    south: latitude - halfH,
    north: latitude + halfH,
  };
}

// ---------------------------------------------------------------------------
// Mercator vertical placement (for 3857 sets rendered in the plate-carrée view)
// ---------------------------------------------------------------------------
function mercRowToLat(ny: number, rows: number): number {
  const t = Math.PI * (1 - (2 * ny) / rows);
  return (Math.atan(Math.sinh(t)) * 180) / Math.PI;
}
function mercLatToRow(lat: number, rows: number): number {
  const clamped = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));
  const r = (clamped * Math.PI) / 180;
  const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
  return y * rows;
}
const MERC_STRIP_DEG = 2 * MERCATOR_MAX_LAT;
function mercWorldNy(lat: number, rows: number): number {
  const k = Math.floor((MERCATOR_MAX_LAT - lat) / MERC_STRIP_DEG);
  const local = lat + k * MERC_STRIP_DEG;
  return k * rows + mercLatToRow(local, rows);
}

/**
 * Pick the tile level whose tiles render closest to `tileSize` px for the given
 * OrthographicView zoom, clamped to the pyramid's [minZoom, maxZoom].
 */
export function tileZoomForOrtho(cfg: TilesConfig, orthoZoom: number): number {
  const lonSpanZ0 = 360 / cfg.cols0; // degrees a z0 tile spans in longitude
  let level = Math.round(orthoZoom + Math.log2(lonSpanZ0 / cfg.tileSize));
  // Square 4326 grids (cols0=1) pack the world into 256×256 tiles that are
  // vertically squished (each tile covers a 2:1 geographic area), so their
  // effective detail is ~1 level below the on-screen-width heuristic. Dropping a
  // level cuts the visible-tile count ~4× with negligible visual loss — much
  // lighter to pan/zoom.
  if (cfg.cols0 === 1) level -= 1;
  return Math.max(cfg.minZoom, Math.min(cfg.maxZoom, level));
}

/**
 * Enumerate the tiles covering [west,south,east,north] at level z, honouring the
 * config's projection, grid and row scheme.
 *
 * When `wrap` is true both axes repeat as world copies so the view is never left
 * with black. When false (the default here) only the single primary world is
 * emitted — no repetition — so panning past ±180°/±90° shows background, not a
 * repeated map, and far fewer tiles are drawn.
 */
export function tilesInView(
  cfg: TilesConfig,
  z: number,
  west: number,
  south: number,
  east: number,
  north: number,
  wrap = false,
): TileSpec[] {
  const cols = colsAt(cfg, z);
  const rows = rowsAt(cfg, z);
  const lonPerCol = 360 / cols;

  let x0 = Math.floor((west + 180) / lonPerCol);
  let x1 = Math.floor((east + 180) / lonPerCol);

  const is4326 = cfg.projection === "epsg4326";
  const latPerRow = 180 / rows; // 4326 only

  let ny0: number;
  let ny1: number;
  if (is4326) {
    ny0 = Math.floor((90 - north) / latPerRow);
    ny1 = Math.floor((90 - south) / latPerRow);
  } else {
    ny0 = Math.floor(mercWorldNy(north, rows));
    ny1 = Math.floor(mercWorldNy(south, rows));
  }

  // Single-world clamp: drop any wrapped copies outside the primary [0,cols)×[0,rows).
  if (!wrap) {
    x0 = Math.max(0, x0);
    x1 = Math.min(cols - 1, x1);
    ny0 = Math.max(0, ny0);
    ny1 = Math.min(rows - 1, ny1);
  }

  const out: TileSpec[] = [];
  for (let worldX = x0; worldX <= x1; worldX++) {
    const lonW = -180 + worldX * lonPerCol;
    const lonE = lonW + lonPerCol;
    const x = ((worldX % cols) + cols) % cols;
    for (let worldNy = ny0; worldNy <= ny1; worldNy++) {
      let latN: number;
      let latS: number;
      let fileRow: number;
      if (is4326) {
        latN = 90 - worldNy * latPerRow;
        latS = latN - latPerRow;
        fileRow = ((worldNy % rows) + rows) % rows;
      } else {
        const k = Math.floor(worldNy / rows);
        fileRow = worldNy - k * rows;
        latN = mercRowToLat(fileRow, rows) - k * MERC_STRIP_DEG;
        latS = mercRowToLat(fileRow + 1, rows) - k * MERC_STRIP_DEG;
      }
      const y = cfg.scheme === "tms" ? rows - 1 - fileRow : fileRow;
      out.push({
        z,
        x,
        y,
        worldX,
        worldY: worldNy,
        bounds: [lonW, latS, lonE, latN],
      });
    }
  }
  return out;
}

/**
 * Web-Mercator (EPSG:3857) XYZ raster tiles intersecting a lng/lat box, each with
 * its GEOGRAPHIC bounds — for overlaying a 3857-tiled raster (e.g. an uploaded
 * GeoTIFF, served at /layers/<id>/{z}/{x}/{y}) onto the plate-carrée view. Placing
 * a mercator tile at its true lng/lat bounds introduces only tiny within-tile
 * distortion (negligible per 256 px tile).
 */
export function mercatorRasterTilesInView(
  west: number,
  south: number,
  east: number,
  north: number,
  z: number,
): { x: number; y: number; bounds: [number, number, number, number] }[] {
  const n = 2 ** z;
  const lonPerCol = 360 / n;
  const x0 = Math.max(0, Math.floor((west + 180) / lonPerCol));
  const x1 = Math.min(n - 1, Math.floor((east + 180) / lonPerCol));
  const y0 = Math.max(0, Math.floor(mercLatToRow(north, n)));
  const y1 = Math.min(n - 1, Math.floor(mercLatToRow(south, n)));
  const out: {
    x: number;
    y: number;
    bounds: [number, number, number, number];
  }[] = [];
  for (let x = x0; x <= x1; x++) {
    const lonW = -180 + x * lonPerCol;
    for (let y = y0; y <= y1; y++) {
      const latN = mercRowToLat(y, n);
      const latS = mercRowToLat(y + 1, n);
      out.push({ x, y, bounds: [lonW, latS, lonW + lonPerCol, latN] });
    }
  }
  return out;
}

/** Mercator raster tile level (256 px tiles) for a given OrthographicView zoom. */
export function mercZoomForOrtho(orthoZoom: number, tileSize = 256): number {
  return Math.round(orthoZoom + Math.log2(360 / tileSize));
}

/**
 * Convert a mapbox-gl (Web-Mercator) zoom to the equivalent OrthographicView
 * zoom so the plate-carrée view opens at roughly the same on-screen scale.
 * mapbox: 360° spans 512·2^z px; ortho: 1° = 2^orthoZoom px.
 */
export function mapboxZoomToOrtho(mapboxZoom: number): number {
  return mapboxZoom + Math.log2(512 / 360);
}

/** Inverse of {@link mapboxZoomToOrtho}. */
export function orthoZoomToMapbox(orthoZoom: number): number {
  return orthoZoom - Math.log2(512 / 360);
}
