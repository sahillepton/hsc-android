import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import DeckGL from "@deck.gl/react";
import { OrthographicView } from "@deck.gl/core";
import { BitmapLayer, PathLayer, PolygonLayer } from "@deck.gl/layers";
import { TileLayer, _Tileset2D as Tileset2D } from "@deck.gl/geo-layers";
import {
  fillMinZoom,
  mercatorRasterTilesInView,
  mercZoomForOrtho,
  orthoZoomToMapbox,
  tilesInView,
  tileZoomForOrtho,
  viewBounds,
} from "@/lib/basemap/tileGrid";
import type { TilesConfig } from "@/lib/basemap/tileConfig";
import { DEFAULT_LAYER_MAX_ZOOM } from "@/lib/constants";

/** A tiled raster (uploaded GeoTIFF etc.) to also draw in the geodetic view. */
export interface GeodeticRasterLayer {
  id: string;
  /** Web-Mercator XYZ template, e.g. http://localhost:PORT/layers/<id>/{z}/{x}/{y}.webp */
  tilesUrl: string;
  /** PHYSICAL tile availability from the probe — which levels the server can serve. */
  tileMinZoom?: number;
  tileMaxZoom?: number;
  /**
   * The USER's Min/Max Zoom from the layer settings panel (`layer.minzoom` /
   * `layer.maxzoom`), in mapbox-zoom units like the on-screen readout.
   *
   * Distinct from tileMinZoom/tileMaxZoom above, and previously absent entirely —
   * which is why the Min Zoom slider did nothing to a raster while a 4326 basemap
   * was active. The mapbox path applies the same values via
   * `resolveLayerZoomRange` in lib/tiling/render.ts; both must agree.
   */
  userMinZoom?: number;
  userMaxZoom?: number;
  /** [west, south, east, north] WGS84 extent of the raster. */
  tileBoundsWgs84?: [number, number, number, number];
  opacity: number;
}

/**
 * EPSG:4326 / plate-carrée base map surface.
 *
 * Renders a geodetic raster tile pyramid together with the app's existing deck.gl
 * overlay layers in a deck.gl OrthographicView. Because the view is
 * non-geospatial, deck.gl draws everything in CARTESIAN, so raw [longitude,
 * latitude] plots as [x, y] — reaching the FULL ±90° (incl. 85–90°, which
 * Web-Mercator / mapbox-gl physically cannot show).
 *
 * Tiles: plain `image: <url>` BitmapLayers in a CONTIGUOUS pyramid (coarse→detail),
 * with the visible tiles computed by our own EPSG:4326 grid math (tilesInView).
 * deck.gl caches the textures by layer id, so zooming only loads the newly-added
 * top level while every coarser level stays put and covers instantly.
 *
 * Camera: the view is UNCONTROLLED (`initialViewState`, not `viewState`), so deck
 * drives pan/zoom in its own render loop with NO React re-render per frame — the
 * camera stays smooth even when React is busy (important on low-end Android). The
 * `onViewStateChange` callback is used only to clamp to world bounds, mirror the
 * live camera into a ref (for the tooltip projection / rubber-band unproject /
 * throttled tile selection) and notify the parent; its returned clamped state is
 * what deck adopts, so bounds/min-zoom limits behave exactly as before.
 */

interface GeodeticBasemapViewProps {
  baseUrl: string;
  config: TilesConfig;
  /** Stable per-folder token appended as ?v= so immutable tile caching is safe
   *  across basemap switches (same /basemap/ path, different folder content). */
  cacheKey?: string;
  layers: unknown[];
  /** Tiled rasters (mapbox raster sources in Mercator mode) to also draw here. */
  rasterLayers?: GeodeticRasterLayer[];
  initialCenter: [number, number];
  initialZoom: number;
  minZoom?: number;
  maxZoom?: number;
  onViewStateChange?: (center: [number, number], zoom: number) => void;
  onMapClick?: (pick: {
    coordinate: [number, number];
    x: number;
    y: number;
    object?: unknown;
    /** The composite deck layer that owns the picked object (id matches a store
     *  layer), so the shared Tooltip can resolve layerInfo — see handleMapClick. */
    layer?: unknown;
  }) => void;
  onHover?: (info: unknown) => void;
  /** When true, a left-drag draws a zoom rectangle instead of panning the view. */
  rubberBandMode?: boolean;
  /** Fired after a rubber-band zoom completes, so the parent can exit the mode. */
  onRubberBandComplete?: () => void;
  /** A one-shot commanded view (center + ortho zoom). Bumping `nonce` jumps this
   *  camera — used by the parent's "focus layer" while a geodetic basemap is
   *  active, since the covered mapbox map underneath is inert. */
  commandView?: { center: [number, number]; zoom: number; nonce: number } | null;
}

const GEO_VIEW = new OrthographicView({ id: "geodetic", flipY: false });

/**
 * Colour behind the plate-carrée world.
 *
 * Sampled from the basemap tiles rather than picked by eye: #f2efe9 is the land
 * tone used by the tile sets (79.9% of the pixels in a typical land tile; ocean is
 * #b9d7e8). Matching it means the few places the backdrop can still be seen — the
 * single pre-clamp frame after a resize, or a tile that has not decoded yet — read
 * as map instead of as a hole. The previous #000000 was accurate as "nothing here"
 * but far too harsh against a light basemap, which is what made every momentary gap
 * register as a flash.
 */
const BASEMAP_VOID_COLOR = "#f2efe9";

// ── Tiled-raster levels in the geodetic view ────────────────────────────────
// Rasters used to be drawn at ONE fixed level sized so the whole extent fit a
// 256-tile budget. That never reloaded on zoom/pan, but it pinned a state-wide
// raster at ~z9 (≈270 m/px) however far you zoomed in — 8–32× coarser than the
// mapbox path's view-following pyramid — which shredded CLASSIFIED rasters:
// nearest-neighbour subsampling at that ratio turns class polygons into
// per-pixel speckle and breaks 1–2 px linear features into dotted lines.
//
// Now the detail level follows the camera and is viewport-culled, exactly like
// the basemap pyramid above, so a raster is pixel-sharp at every zoom.
//
// Geometric floor for the level. These are Mercator tiles placed at plate-carrée
// bounds as RECTANGLES, so each tile's vertical mapping is only correct in the
// limit of a small latitude span — the reason the old code refused to go coarse.
// Measured worst-case mis-placement inside one tile (around 26°N), expressed
// against a tile drawn 256 px tall:
//     z1 73 px · z2 30 px · z3 9.2 px · z4 6.6 px · z5 2.9 px
//     z6 1.3 px · z7 0.7 px · z8 0.3 px · z9 0.2 px
// So z6 and up is visually exact, and below it the error explodes. Flooring here
// (instead of at the extent-fit level, which is z9 for a state-wide raster) is
// what lets LOW zoom draw a handful of coarse tiles — ~6 for a state raster
// instead of 182 — so it actually appears instead of waiting on 182 gdal warps
// only to squeeze each 256 px tile into about one screen pixel.
const RASTER_MIN_SAFE_Z = 6;
// Budget for the DETAIL level. It is culled to the viewport, so this only has to
// cover one screen: a 2880×1620 canvas (devicePixelRatio capped at 1.5) needs
// ~12×7 tiles at 1:1, so this leaves generous headroom before it steps down.
const MAX_RASTER_TILES_IN_VIEW = 192;
// Cap for the view-INDEPENDENT underlay at the floor level. Its tile ids never
// change, so deck keeps those textures for the session and they stay visible
// while a sharper level is still fetching — that is what stops a blank flash when
// the detail level changes. Skipped entirely for a raster so large that even the
// floor level exceeds this, where detail-only is the cheaper trade.
const MAX_RASTER_UNDERLAY_TILES = 256;
// The underlay is only drawn beneath a sharper level when the raster is
// effectively opaque. Under a SEMI-TRANSPARENT raster both levels would blend
// through, showing the coarser one as a misaligned blocky copy — the original
// reason only a single level was ever drawn.
const RASTER_STACK_MIN_OPACITY = 0.99;

/**
 * Every level from a coarse base up to the detail level, CONTIGUOUS.
 *
 * This is the hsc-cop-viewer approach (WgsMapView.tsx, MAX_STACK_DEPTH = 12) and it
 * is the reason zoom transitions there never flash black. The two rules that make
 * it work:
 *   • the coarse levels are already loaded and cached, so any hole at the detail
 *     level is covered by a coarser level underneath — there is no frame where
 *     nothing is drawn; and
 *   • the tiles are opaque and drawn coarse-first, so the finest available tile
 *     always wins. Stacking costs fill, never correctness.
 *
 * What this replaced: `{ minZoom } ∪ { detailZ-1 … detailZ }`, i.e. two levels, with
 * the world backstop dropped above a gap of 3 to save fill. That saving was paid for
 * with exactly the symptom being fixed — zoom in by more than one level and
 * `detailZ-1` has never been fetched either, so nothing covers the gap and the
 * backdrop shows through. A contiguous stack cannot have that hole.
 *
 * Depth is bounded so a set with a very high maxZoom cannot stack unboundedly; 12
 * always reaches the coarse global levels (z0–z5) of any real set.
 *
 * ── Superseded: RESIDENT is not the same as DRAWN ──────────────────────────────
 * The contiguous stack conflated two things. Keeping every level from the backstop
 * up to detailZ RESIDENT is what makes a zoom land sharp — whatever level you
 * arrive on has already been fetched. But it also DREW all of them, every frame,
 * and each one covers the whole viewport, so 9 levels meant 9 full screens of
 * textured fill (~1.13 Gpix/s at 60fps on this pack, at the limit of a tablet GPU)
 * of which ~85% was overwritten immediately.
 *
 * Thinning the level array was tried and reverted: it drops the textures along with
 * the draws, so a zoom falls back to a heavily magnified coarse tile and the map
 * visibly BLURS mid-gesture. Cheaper on paper (56% less fill), worse to use. If you
 * are reading this considering a fixed ladder / gap rule / detailZ-relative window:
 * that is the same idea again, and it fails the same way.
 *
 * What actually separates the two is per-tile LOAD STATE, and deck already has it.
 * Tileset2D keeps a 5×-viewport cache of tiles (so ancestors stay resident) while
 * `updateTileStateDefault` marks visible only the NEAREST LOADED ancestor of each
 * pending tile and stops there (tileset-2d.js `getPlaceholderInAncestors`);
 * TileLayer.filterSubLayer → isTileVisible then skips drawing everything else. So a
 * coarse level is drawn only where and while a finer tile has not landed:
 *   • settled  → detail level only (plus the backstop) = 2 passes, not 9
 *   • mid-jump → the nearest loaded ancestor covers the gap, exactly as before
 * Sharpness is unchanged because nothing is evicted; only the redundant draws go.
 *
 * `basemapLevels` and BASEMAP_STACK_DEPTH are therefore gone. What remains below is
 * the world backstop, which stays a plain always-mounted BitmapLayer OUTSIDE the
 * TileLayer — `_getNearestAncestor` returns null when no ancestor is cached (cold
 * start, or a commandView jump into a region never visited), and that is the one
 * case Tileset2D cannot cover by itself.
 */

/** Tile index carrying the file coords + bounds our 4326 grid already computed. */
type GeoTileIndex = {
  x: number;
  y: number;
  z: number;
  /** Wrapped column of the tile FILE (differs from x once worlds repeat). */
  fileX: number;
  fileY: number;
  bounds: [number, number, number, number];
};

/** The subset of deck's Viewport this tileset reads. */
type OrthoViewportLike = {
  zoom: number;
  width: number;
  height: number;
  unproject: (xy: number[]) => number[];
};

/**
 * Tileset2D driving deck's TileLayer from OUR plate-carrée grid.
 *
 * Everything about which tiles exist stays in tileGrid.ts — this only adapts it to
 * the four methods Tileset2D asks subclasses to supply. Built per-config by a
 * factory because Tileset2D is constructed by TileLayer with a fixed option set,
 * so there is no way to pass the config in as an option.
 */
function makeGeodeticTilesetClass(cfg: TilesConfig) {
  return class GeodeticTileset extends Tileset2D {
    /**
     * deck calls this with its own viewport every time the camera changes, INSIDE
     * its render loop — which is why the basemap no longer needs the throttled
     * `tileView` React state at all.
     */
    getTileIndices({ viewport }: { viewport: OrthoViewportLike }) {
      // Screen corners → world degrees. The ortho view's world coords ARE lng/lat,
      // and with flipY:false screen y=0 is the NORTH edge.
      const [west, north] = viewport.unproject([0, 0]);
      const [east, south] = viewport.unproject([viewport.width, viewport.height]);
      const z = tileZoomForOrtho(cfg, viewport.zoom);
      // Extra fields ride along on the index object: deck only reads x/y/z, and it
      // passes this exact object through to the Tile2DHeader, so getTileMetadata
      // and getTileData can read them back without recomputing the grid.
      return tilesInView(cfg, z, west, south, east, north).map(
        (t): GeoTileIndex => ({
          x: t.worldX,
          y: t.worldY,
          z,
          fileX: t.x,
          fileY: t.y,
          bounds: t.bounds,
        }),
      );
    }

    /** Keyed on the UNWRAPPED world position, so repeated worlds stay distinct. */
    getTileId(index: GeoTileIndex) {
      return `${index.z}-${index.x}-${index.y}`;
    }

    getTileZoom(index: GeoTileIndex) {
      return index.z;
    }

    /**
     * Both 4326 schemes halve in each axis per level (cols 2^(z+1)×rows 2^z for a
     * 2:1 set, 2^z×2^z for a square one), so the standard halving parent is correct
     * for both. Only `getTileId` is ever called on the result — it is a cache
     * lookup for the ancestor walk, never a tile that gets created — so it does not
     * need the file coords or bounds.
     */
    getParentIndex(index: GeoTileIndex) {
      return {
        x: Math.floor(index.x / 2),
        y: Math.floor(index.y / 2),
        z: index.z - 1,
      };
    }

    /**
     * Non-geospatial bbox. `isTileVisible` branches on `'west' in bbox`, and an
     * OrthographicView is not geospatial, so it must be the {left,top,right,bottom}
     * shape — it normalises top/bottom itself, so the north-up order is fine.
     */
    getTileMetadata(index: GeoTileIndex) {
      const b = index.bounds;
      if (!b) {
        // Only reachable if deck ever creates a tile from a synthesised index.
        // A world-sized bbox keeps it visible rather than silently culled.
        return { bbox: { left: -180, top: 90, right: 180, bottom: -90 } };
      }
      return { bbox: { left: b[0], top: b[3], right: b[2], bottom: b[1] } };
    }
  };
}

// Throttle interval for recomputing the tile set during interaction. A THROTTLE
// (not a debounce) so a slow continuous zoom keeps updating tiles mid-gesture
// instead of freezing until the gesture ends.
//
// 80 ms, down from 180 ms. This interval is how long the DETAIL LEVEL can lag the
// camera: at 180 ms a zoom spent up to a fifth of a second showing a coarser level
// than the camera warranted, which now reads as "briefly soft" (it used to read as
// black, before the pyramid became contiguous). hsc-cop-viewer has no throttle at
// all — it drives a CONTROLLED camera and recomputes tiles every frame — but that
// costs a React re-render per frame, which this view deliberately avoids to keep
// pan/zoom smooth on low-end Android.
//
// 80 ms is affordable now for two reasons that were not true when 180 was chosen:
// the overlay clones are memoised on `layers` alone, so a tick no longer re-clones
// every layer; and the tiles come from 127.0.0.1, so the "cap network churn"
// argument for a long interval barely applies. Per tick the real work is
// viewBounds + mercatorRasterTilesInView per raster plus a signature compare, and
// an unchanged signature returns the cached layer array without allocating.
//
// Since the basemap moved to a TileLayer this tick drives ONLY the uploaded
// rasters, and is not scheduled at all when none are loaded.
const TILE_THROTTLE_MS = 80;

// Cap the render resolution by TOTAL CANVAS PIXELS, not by a device-pixel-ratio
// multiplier.
//
// This used to be `min(devicePixelRatio, 1.5)`. Fill cost is the thing worth
// bounding, but a flat ratio bounds the wrong quantity, and it is silently
// platform-asymmetric: Windows runs at DPR 1.0–1.5, so the cap never applied and
// the map rendered at full resolution — while Android runs at DPR 2.0–3.0, so the
// canvas was rendered at 25–56% of the screen's pixels and upscaled back, i.e.
// permanently blurry. That is why a 4326 pack looked sharp on desktop and soft on
// Android; only 4326 packs reach this deck path, and the mapbox path (every
// Mercator basemap) caps nothing at all, so the two were never comparable.
// It shows up worst past a pack's own maxZoom — there the tiles are ALREADY being
// upsampled, so the two softenings multiply.
//
// A pixel budget scales the right way: a phone's small CSS viewport fits full DPR
// inside the budget, while a genuinely huge canvas is still reined in.
const MAX_CANVAS_PIXELS = 4.2e6; // ≈ a 1600×2560 tablet panel at full DPR

// Budget used only WHILE THE CAMERA IS MOVING.
//
// Panning and zooming is where this path is fill-bound: two full-screen basemap
// levels plus any uploaded raster, redrawn every frame. Detail nobody can resolve
// mid-gesture is the cheapest thing to give up, so the canvas drops to ~half the
// pixels while moving and returns to the full budget the moment the camera settles
// (see `interacting` below). The FINISHED image is therefore identical — this trades
// only transient sharpness, unlike lowering MAX_CANVAS_PIXELS itself, which would
// re-blur the map permanently and undo the Android sharpness fix.
const MAX_CANVAS_PIXELS_INTERACTING = 2.1e6;

// How long the camera must be still before going back to the full budget. Long
// enough not to flip during a flick or a pinch's inertia, short enough that the
// sharp frame feels immediate.
const INTERACTION_IDLE_MS = 220;

const budgetedDevicePixels = (
  cssWidth: number,
  cssHeight: number,
  interacting: boolean,
) => {
  const dpr =
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const cssPixels = cssWidth * cssHeight;
  // Unknown/degenerate size (deck mounts at 1×1) — don't downscale on a guess.
  if (!Number.isFinite(cssPixels) || cssPixels <= 1) return dpr;
  const budget = interacting
    ? MAX_CANVAS_PIXELS_INTERACTING
    : MAX_CANVAS_PIXELS;
  // Never below 1: rendering under CSS resolution is always visibly soft.
  const affordable = Math.max(1, Math.sqrt(budget / cssPixels));
  return Math.min(dpr, affordable);
};

function clampView(
  target: [number, number, number],
  zoom: number,
  width: number,
  height: number,
): { target: [number, number, number]; zoom: number } {
  const z = Math.max(zoom, fillMinZoom(width, height));
  const ppd = 2 ** z;
  const halfW = width / 2 / ppd;
  const halfH = height / 2 / ppd;
  const lng =
    halfW >= 180 ? 0 : Math.max(-180 + halfW, Math.min(180 - halfW, target[0]));
  const lat =
    halfH >= 90 ? 0 : Math.max(-90 + halfH, Math.min(90 - halfH, target[1]));
  return { target: [lng, lat, 0], zoom: z };
}

export function GeodeticBasemapView({
  baseUrl,
  config,
  cacheKey = "",
  layers,
  rasterLayers,
  initialCenter,
  initialZoom,
  minZoom = 0,
  // ORTHO zoom units, not the mapbox zoom the readout shows. The two differ by
  // log2(512/360) = 0.508, so a default of 20 here let touch/pinch reach an ortho
  // 20 that the readout printed as 19.49 — above MAP_MAX_ZOOM (18). The parent now
  // passes mapboxZoomToOrtho(MAP_MAX_ZOOM); this default is the same value so the
  // component is correct even if a caller forgets. Every zoom ceiling in this file
  // (view-state clamp, resize clamp, commandView, rubber band) reads this one prop.
  maxZoom = 18 + Math.log2(512 / 360),
  onViewStateChange,
  onMapClick,
  onHover,
  rubberBandMode = false,
  onRubberBandComplete,
  commandView,
}: GeodeticBasemapViewProps) {
  const [size, setSize] = useState({ width: 1, height: 1 });
  // Synchronous mirror of `size`, read inside deck callbacks (which close over a
  // stale render's `size`); the state copy still drives the tile useMemos below.
  const sizeRef = useRef(size);

  // The LIVE clamped camera. In uncontrolled mode deck owns the camera and runs
  // it in its own loop WITHOUT a React re-render per frame, so React state can't
  // hold it. Everything that needs the current view (forward projection for the
  // tooltip, rubber-band unproject, throttled tile selection) reads this ref,
  // which the view-state callback below keeps current.
  const liveViewRef = useRef({
    lng: initialCenter[0],
    lat: initialCenter[1],
    zoom: initialZoom,
  });

  // Uncontrolled base camera. Passing `initialViewState` (NOT `viewState`) makes
  // deck manage the camera internally — pan/zoom no longer round-trips through
  // React, removing the per-frame re-render. deck only re-applies this when it
  // deep-changes, so it stays STABLE during interaction and is bumped ONLY for
  // programmatic jumps (rubber-band) and initial/resize clamping — each such bump
  // overwrites deck's internal camera exactly once.
  const [baseView, setBaseView] = useState(() => ({
    target: [initialCenter[0], initialCenter[1], 0] as [number, number, number],
    zoom: initialZoom,
    minZoom,
    maxZoom,
  }));

  // Rubber-band selection corners in world [lng, lat]; null when not drawing.
  const [rubberBand, setRubberBand] = useState<{
    start: [number, number];
    end: [number, number];
  } | null>(null);
  const rubberBandActiveRef = useRef(false);
  // Mirror of the corners so drag-end can read them synchronously (state is async).
  const rbCornersRef = useRef<{
    start: [number, number];
    end: [number, number];
  } | null>(null);

  // Throttled tile selection for ALL raster geodetic sets (png / webp / jpg). A
  // debounce resets its timer on every frame, so during a SLOW continuous zoom
  // (e.g. z2 → z10 dragged slowly) it never fires until you stop — the map stays
  // frozen on the start level's tiles the whole way. A throttle instead recomputes
  // the tile set at most once per interval but KEEPS firing mid-gesture, so the
  // detail level tracks the camera as you go while capping network churn to ~one
  // request round per interval. (vector/pbf renders via mapbox and is never here.)
  const [tileView, setTileView] = useState({
    lng: initialCenter[0],
    lat: initialCenter[1],
    zoom: initialZoom,
  });
  const tileViewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // True while the camera is moving, so the canvas can render at the cheaper
  // interaction budget and go back to full resolution once it settles.
  //
  // State (deck needs the new `useDevicePixels` prop) but guarded by a ref so the
  // per-frame view-state callback triggers at most ONE re-render at the start of a
  // gesture and one at the end — never per frame.
  const [interacting, setInteracting] = useState(false);
  const interactingRef = useRef(false);
  const interactionIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const noteInteraction = useCallback(() => {
    if (!interactingRef.current) {
      interactingRef.current = true;
      setInteracting(true);
    }
    if (interactionIdleTimerRef.current) {
      clearTimeout(interactionIdleTimerRef.current);
    }
    interactionIdleTimerRef.current = setTimeout(() => {
      interactionIdleTimerRef.current = null;
      interactingRef.current = false;
      setInteracting(false);
    }, INTERACTION_IDLE_MS);
  }, []);
  useEffect(
    () => () => {
      if (interactionIdleTimerRef.current) {
        clearTimeout(interactionIdleTimerRef.current);
      }
    },
    [],
  );

  // Only the RASTER layers still ride this throttle — the basemap's TileLayer
  // selects tiles from deck's own viewport, inside deck's loop. So with no raster
  // loaded (the common case) a pan or pinch now triggers ZERO React renders from
  // here, instead of ~12.5 per second.
  const hasRasterLayers = (rasterLayers?.length ?? 0) > 0;
  const scheduleTileTick = useCallback(() => {
    if (config.vector || !hasRasterLayers) return;
    if (tileViewTimerRef.current !== null) return; // a tick is already pending
    tileViewTimerRef.current = setTimeout(() => {
      tileViewTimerRef.current = null;
      const v = liveViewRef.current;
      setTileView({ lng: v.lng, lat: v.lat, zoom: v.zoom });
    }, TILE_THROTTLE_MS);
  }, [config.vector, hasRasterLayers]);

  // deck's view-state callback. In uncontrolled mode deck applies the RETURNED
  // (clamped) view state to its own internal camera — no React re-render. We use
  // the callback purely to (a) clamp to world bounds / min-fill zoom exactly as the
  // old per-render clampView did, (b) mirror the live camera into a ref for the
  // projection / unproject / tile throttle, and (c) notify the parent.
  const handleViewStateChange = useCallback(
    (params: { viewState: Record<string, unknown> }) => {
      const vs = params.viewState as {
        target: [number, number, number];
        zoom: number;
      };
      const s = sizeRef.current;
      const c = clampView(vs.target, vs.zoom, s.width, s.height);
      liveViewRef.current = { lng: c.target[0], lat: c.target[1], zoom: c.zoom };
      // Let the shared Tooltip re-anchor to its feature as the camera moves.
      window.dispatchEvent(new Event("geodetic-view-change"));
      // Mark the camera as moving so the canvas drops to the interaction budget.
      noteInteraction();
      scheduleTileTick();
      onViewStateChange?.([c.target[0], c.target[1]], c.zoom);
      // The returned value becomes deck's new internal camera (clamped) — this is
      // the bounds/min-zoom constraint, applied without touching React.
      return {
        ...vs,
        target: c.target,
        zoom: c.zoom,
        minZoom: fillMinZoom(s.width, s.height),
        maxZoom,
      };
    },
    [scheduleTileTick, onViewStateChange, maxZoom, noteInteraction],
  );

  // Expose this view's live forward projection so the shared Tooltip (which lives
  // outside this component and can't use the covered mapbox map's project()) can
  // anchor to a feature's lng/lat and follow it on pan/zoom. The function reads the
  // live refs, so it is installed ONCE and stays correct as the camera moves;
  // movement is signalled by the "geodetic-view-change" event dispatched above.
  useEffect(() => {
    const project = (plng: number, plat: number) => {
      const { lng, lat, zoom } = liveViewRef.current;
      const s = sizeRef.current;
      const ppd = 2 ** zoom;
      return {
        x: s.width / 2 + (plng - lng) * ppd,
        y: s.height / 2 - (plat - lat) * ppd,
      };
    };
    const w = window as unknown as {
      __geodeticProject?: (lng: number, lat: number) => { x: number; y: number };
    };
    w.__geodeticProject = project;
    window.dispatchEvent(new Event("geodetic-view-change"));
    return () => {
      if (w.__geodeticProject === project) w.__geodeticProject = undefined;
    };
  }, []);

  // Keep the size mirror current, and clamp the camera to world bounds / min-fill
  // zoom whenever the container resizes (and once initially, when the real size
  // first arrives — deck mounts at 1×1). A clamp that actually changes the view is
  // pushed as a new `initialViewState`, which deck applies to its camera once.
  useEffect(() => {
    sizeRef.current = size;
    const { lng, lat, zoom } = liveViewRef.current;
    const c = clampView([lng, lat, 0], zoom, size.width, size.height);
    if (c.target[0] !== lng || c.target[1] !== lat || c.zoom !== zoom) {
      liveViewRef.current = { lng: c.target[0], lat: c.target[1], zoom: c.zoom };
      setBaseView({
        target: c.target,
        zoom: c.zoom,
        minZoom: fillMinZoom(size.width, size.height),
        maxZoom,
      });
      setTileView({ lng: c.target[0], lat: c.target[1], zoom: c.zoom });
    }
    window.dispatchEvent(new Event("geodetic-view-change"));
  }, [size, maxZoom]);

  // Clear any pending throttle tick on unmount.
  useEffect(
    () => () => {
      if (tileViewTimerRef.current !== null) {
        clearTimeout(tileViewTimerRef.current);
        tileViewTimerRef.current = null;
      }
    },
    [],
  );

  // Apply a view commanded by the parent. In geodetic mode a "focus layer" must
  // drive THIS view (the covered mapbox camera underneath is inert), so the parent
  // pushes a center + ortho zoom and bumps `nonce`. Each bump triggers exactly one
  // programmatic jump, reusing the same path as the rubber-band zoom.
  const commandNonce = commandView?.nonce ?? 0;
  useEffect(() => {
    if (!commandView) return;
    const s = sizeRef.current;
    const c = clampView(
      [commandView.center[0], commandView.center[1], 0],
      commandView.zoom,
      s.width,
      s.height,
    );
    // ── Force deck to actually adopt the jump ─────────────────────────────────
    //
    // deck only overwrites its internal camera when the initialViewState PROP
    // deep-changes (@deck.gl/core lib/deck.js:268-272):
    //     if (props.initialViewState &&
    //         !deepEqual(this.props.initialViewState, props.initialViewState, 3))
    //         this.viewState = props.initialViewState;
    // It compares the PROP, not the live camera. In uncontrolled mode the user's
    // pan/zoom moves deck's camera WITHOUT changing this prop, so commanding the
    // same view twice — focus a layer, pan away, focus it again — produces a
    // baseView identical to the previous one and deck silently ignores it.
    //
    // The camera then stays where the user left it while `liveViewRef` below says
    // it is at the commanded view. Everything projecting through the live camera —
    // `window.__geodeticProject`, i.e. the shared Tooltip's anchor — is offset by
    // exactly that difference, so an open tooltip jumps far from its feature. And
    // because deck does NOT call onViewStateChange for programmatic changes, the
    // mismatch persists until the next user interaction fires the callback and
    // re-syncs the ref, which is why it "comes back" as soon as you touch the map.
    //
    // An imperceptible nudge on the repeat case makes the prop always differ. 1e-9
    // of zoom is a scale factor of 2^1e-9 ≈ 1 + 7e-10 — far below one pixel at any
    // zoom, and below the precision of everything downstream — but it is enough for
    // deepEqual to see a change. Comparing against `baseView` is correct here: this
    // effect runs before the state update lands, so `baseView` is exactly what deck
    // currently holds as `props.initialViewState`.
    const sameAsCurrent =
      baseView.target[0] === c.target[0] &&
      baseView.target[1] === c.target[1] &&
      baseView.zoom === c.zoom;
    const nextZoom = sameAsCurrent ? c.zoom + 1e-9 : c.zoom;

    liveViewRef.current = { lng: c.target[0], lat: c.target[1], zoom: nextZoom };
    setBaseView({
      target: c.target,
      zoom: nextZoom,
      minZoom: fillMinZoom(s.width, s.height),
      maxZoom,
    });
    setTileView({ lng: c.target[0], lat: c.target[1], zoom: nextZoom });
    onViewStateChange?.([c.target[0], c.target[1]], nextZoom);
    window.dispatchEvent(new Event("geodetic-view-change"));
    // Keyed ONLY on the nonce so an unrelated re-render (e.g. a fresh inline
    // onViewStateChange from the parent) never re-applies a stale command.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandNonce]);

  // (The basemap's own BitmapLayer instance cache is gone — Tileset2D owns tile
  // lifetime now, and the backstop is a single view-independent memo.)
  const vparam = cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : "";

  // ── Kill the black flash on refresh, without changing the finished map ──
  //
  // On refresh this component does NOT mount until `basemapSetFolder` and
  // `resolveTilesConfig` have both resolved (see the basemap effect in
  // ../map/index.tsx), so it appears OVER an already-painted mapbox map. It used
  // to paint an opaque #000 backdrop the instant it mounted — before deck had
  // even created its GL device, let alone decoded a tile — so the sequence was:
  // previous map → full-screen black → new map. Hence "abrupt blackout".
  //
  // The fix is to keep the BACKDROP transparent until this surface has something
  // real to show, then make it opaque. Deliberately NOT done by fading the whole
  // canvas: that would also hide the vector/point overlays deck draws on top, and
  // it would have to guess when tiles arrive. And deliberately NOT done by
  // recolouring the backdrop: black is load-bearing on the resize path (deck
  // paints one frame at the new canvas size with the old camera before the clamp
  // effect lands, so a light colour would strobe as letterbox bars).
  //
  // "Something real to show" needs BOTH:
  //   • deck has rendered at its real size — it mounts at 1×1 and cannot fetch
  //     anything until its device exists and onResize has propagated; and
  //   • the coarse world tile has decoded — that is the permanently-mounted
  //     backstop level, so once it is in, the whole viewport is covered.
  // Waiting on only the tile would flip the backdrop opaque while deck was still
  // blank, which is the blackout again a few frames later.
  const [worldTileReady, setWorldTileReady] = useState(false);
  const [deckPainted, setDeckPainted] = useState(false);
  const deckPaintedRef = useRef(false);
  const noteDeckPainted = useCallback(() => {
    if (deckPaintedRef.current) return;
    // Ignore renders at the 1×1 mount size — nothing is really on screen yet.
    if (sizeRef.current.width <= 1 || sizeRef.current.height <= 1) return;
    deckPaintedRef.current = true;
    setDeckPainted(true);
  }, []);

  useEffect(() => {
    if (!baseUrl || config.vector) {
      setWorldTileReady(true);
      return;
    }
    setWorldTileReady(false);
    let settled = false;
    const ready = () => {
      if (!settled) {
        settled = true;
        setWorldTileReady(true);
      }
    };
    const img = new Image();
    // onerror also readies: a pack with no world tile must not leave the backdrop
    // transparent forever, or a broken 4326 basemap would keep showing the mapbox
    // map underneath and look like it worked. It has to go opaque so the blank
    // surface is visible and the "Map Data Not Found" flow can report it.
    img.onload = ready;
    img.onerror = ready;
    // Same URL + cache-buster deck requests for the world backstop level, so this
    // is served from the browser cache instead of costing an extra fetch.
    img.src = `${baseUrl}/${config.minZoom}/0/0.${config.format}${vparam}`;
    // Hard ceiling, whatever the tile server does.
    const timer = setTimeout(ready, 1200);
    return () => {
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
    };
  }, [baseUrl, config.vector, config.minZoom, config.format, vparam]);

  const backdropOpaque = worldTileReady && deckPainted;

  // ── World backstop ──────────────────────────────────────────────────────────
  // The coarsest level over the WHOLE world, mounted for the session and never
  // rebuilt: view-INDEPENDENT, so its ids never change, so deck keeps the textures
  // and it is always ready to cover a hole. This is deliberately OUTSIDE the
  // TileLayer — Tileset2D can only fall back to an ancestor it has already cached,
  // and on a cold start or a commandView jump into unvisited territory there is
  // none. It is 1–2 tiles (cols0·2^minZoom × 2^minZoom), so it costs one extra
  // full-screen pass and buys the entire anti-flash guarantee.
  const backstopLayers = useMemo(() => {
    if (!baseUrl || config.vector) return [];
    return tilesInView(config, config.minZoom, -180, -90, 180, 90).map(
      (t) =>
        new BitmapLayer({
          id: `geo-basemap-backstop-${config.minZoom}-${t.worldX}-${t.worldY}`,
          bounds: t.bounds,
          image: `${baseUrl}/${config.minZoom}/${t.x}/${t.y}.${config.format}${vparam}`,
          // Basemap tiles are FULLY OPAQUE (a pack has no alpha — the lipcy pngs
          // are colour-type 2, no tRNS) and drawn coarse-first at opacity 1, so
          // per-fragment blending buys nothing and costs a read-modify-write of
          // the framebuffer on a full-screen quad. Off, the sharper tile simply
          // overwrites this one — which is the result we already wanted.
          parameters: { blend: false },
        }),
    );
  }, [baseUrl, config, vparam]);

  // Rebuilt only when the basemap source changes; a stable class identity keeps
  // TileLayer from treating every render as a props change.
  const TilesetClass = useMemo(() => makeGeodeticTilesetClass(config), [config]);

  // ── The detail pyramid, as a TileLayer ──────────────────────────────────────
  // Tile selection now happens inside deck's own loop (TileLayer reads
  // `this.context.viewport` on every viewport change), so this does NOT depend on
  // the throttled `tileView` state and follows the camera with no React render.
  const basemapTileLayer = useMemo(() => {
    if (!baseUrl || config.vector) return [];
    return [
      new TileLayer({
        // Source in the id: a basemap switch must build a NEW tileset rather than
        // re-point the old one, since TileLayer only calls setOptions on an
        // existing tileset and would otherwise keep the previous pack's tiles.
        id: `geo-basemap-tiles|${baseUrl}|${vparam}`,
        TilesetClass,
        tileSize: config.tileSize,
        minZoom: config.minZoom,
        maxZoom: config.maxZoom,
        // 'best-available' → updateTileStateDefault: for each pending tile show the
        // nearest LOADED ancestor (else the loaded children), and nothing else.
        refinementStrategy: "best-available",
        // Fetch ourselves so the request is CANCELLED when a tile leaves view mid
        // zoom (tile.signal), instead of completing and decoding an image nobody
        // will draw. Returns an ImageBitmap, which BitmapLayer takes directly.
        // Params are typed with deck's base TileIndex (x/y/z only) so the callbacks
        // stay assignable to its prop types; the extra fields our getTileIndices
        // attached are read back through a cast.
        getTileData: async (tile: {
          index: { x: number; y: number; z: number };
          signal?: AbortSignal;
        }) => {
          const { z, fileX, fileY } = tile.index as GeoTileIndex;
          const url = `${baseUrl}/${z}/${fileX}/${fileY}.${config.format}${vparam}`;
          const res = await fetch(url, { signal: tile.signal });
          if (!res.ok) {
            throw new Error(`tile ${z}/${fileX}/${fileY}: ${res.status}`);
          }
          return createImageBitmap(await res.blob());
        },
        // A pack is not obliged to have every tile in its bounding box; a 404 at the
        // edge is normal and must stay as quiet as it was when these were plain
        // BitmapLayers, or the console fills up on every pan.
        onTileError: () => {},
        renderSubLayers: (props: {
          id: string;
          data: unknown;
          tile: { index: { x: number; y: number; z: number } };
        }) =>
          new BitmapLayer({
            id: props.id,
            image: props.data as ImageBitmap,
            bounds: (props.tile.index as GeoTileIndex).bounds,
            parameters: { blend: false },
          }),
      }),
    ];
  }, [baseUrl, config, vparam, TilesetClass]);

  const basemapLayers = useMemo(
    () => [...backstopLayers, ...basemapTileLayer],
    [backstopLayers, basemapTileLayer],
  );

  // Tiled rasters: their 3857 tiles placed at true lng/lat bounds (above the
  // basemap, below the vector/point overlay).
  //
  // Two levels per raster, mirroring how `basemapLayers` above builds its pyramid:
  //  • BACKSTOP — a tiny, view-INDEPENDENT set over the whole extent. Its tile ids
  //    never change, so deck keeps the textures for the session and something is
  //    always on screen while a new detail level fetches.
  //  • DETAIL  — the level whose 256 px Mercator tiles land ~1:1 on screen pixels
  //    (`mercZoomForOrtho`), culled to the viewport. This follows the camera on the
  //    same throttled `tileView` tick the basemap uses, so a raster is as sharp
  //    here as it is on a Mercator basemap instead of being frozen at one coarse
  //    level. Drawn AFTER the backstop, so it covers it.
  const rasterCacheRef = useRef<{
    sig: string;
    layers: BitmapLayer[];
    byId: Map<string, { layer: BitmapLayer; url: string; opacity: number }>;
  }>({ sig: "", layers: [], byId: new Map() });

  const rasterTileLayers = useMemo(() => {
    if (!rasterLayers?.length || !baseUrl) return [];
    const vb = viewBounds(
      tileView.lng,
      tileView.lat,
      tileView.zoom,
      size.width,
      size.height,
    );

    const specs: {
      id: string;
      url: string;
      bounds: [number, number, number, number];
      opacity: number;
    }[] = [];
    let sig = "";

    const push = (
      rl: GeodeticRasterLayer,
      z: number,
      t: { x: number; y: number; bounds: [number, number, number, number] },
    ) => {
      const id = `geo-raster-${rl.id}-${z}-${t.x}-${t.y}`;
      specs.push({
        id,
        url: rl.tilesUrl
          .replace("{z}", String(z))
          .replace("{x}", String(t.x))
          .replace("{y}", String(t.y)),
        bounds: t.bounds,
        opacity: rl.opacity,
      });
      sig += `;${id}@${rl.opacity}`;
    };

    // The settings panel's Min/Max Zoom, in MAPBOX zoom units (what the on-screen
    // readout shows), so the geodetic ortho zoom is converted before comparing.
    //
    // The test mirrors the mercator path in lib/tiling/render.ts EXACTLY, including
    // its off-by-one: mapbox's layer `maxzoom` is exclusive, so that path hands it
    // `userMax + 1` to keep the layer painting at the user's max — which also means
    // it keeps painting through the whole fractional level above it (max 14 stays
    // visible at 14.9). Testing `<= userMax` here instead would hide the raster on
    // the geodetic basemap at zooms where the mercator basemap still shows it.
    // Unset falls back to the same defaults: 0 and DEFAULT_LAYER_MAX_ZOOM.
    const mapboxEquivalentZoom = orthoZoomToMapbox(tileView.zoom);

    for (const rl of rasterLayers) {
      const userMin = typeof rl.userMinZoom === "number" ? rl.userMinZoom : 0;
      const userMax =
        typeof rl.userMaxZoom === "number"
          ? rl.userMaxZoom
          : DEFAULT_LAYER_MAX_ZOOM;
      if (
        mapboxEquivalentZoom < userMin ||
        mapboxEquivalentZoom >= userMax + 1
      ) {
        continue; // outside the user's zoom range — draw nothing for this raster
      }

      const rb = rl.tileBoundsWgs84;
      if (!rb) continue; // no extent → nothing to place
      const minZ = rl.tileMinZoom ?? 0;
      const maxZ = rl.tileMaxZoom ?? 22;

      // ── FLOOR level: coarsest level whose plate-carrée placement is exact ──
      // Clamped into the raster's served range, so a source that only publishes
      // coarse levels still works.
      const baseZ = Math.max(minZ, Math.min(maxZ, RASTER_MIN_SAFE_Z));

      // ── Skip rasters that are nowhere near the viewport ──────────────────
      // Without this, an off-screen raster still fell through to the `detailZ ===
      // baseZ` branch below and pushed its ENTIRE floor-level set over the whole
      // extent — 300–600 specs and a 15–31 KB signature rebuilt on every 80 ms
      // tick, for a layer contributing zero visible pixels. The margin is one
      // viewport in each direction, so a raster about to be panned into view is
      // already primed and does not pop in.
      const mLng = (vb.east - vb.west) / 2;
      const mLat = (vb.north - vb.south) / 2;
      if (
        rb[2] < vb.west - mLng ||
        rb[0] > vb.east + mLng ||
        rb[3] < vb.south - mLat ||
        rb[1] > vb.north + mLat
      ) {
        continue;
      }

      // ── DETAIL level: pixel-perfect, but never below the floor ──
      const west = Math.max(rb[0], vb.west);
      const east = Math.min(rb[2], vb.east);
      const south = Math.max(rb[1], vb.south);
      const north = Math.min(rb[3], vb.north);
      const onScreen = west < east && south < north;

      let detailZ = baseZ;
      let detailTiles: ReturnType<typeof mercatorRasterTilesInView> = [];
      if (onScreen) {
        detailZ = Math.max(
          baseZ,
          Math.min(maxZ, mercZoomForOrtho(tileView.zoom)),
        );
        detailTiles = mercatorRasterTilesInView(west, south, east, north, detailZ);
        // Step down if a very wide viewport would blow the per-frame budget.
        while (detailTiles.length > MAX_RASTER_TILES_IN_VIEW && detailZ > baseZ) {
          detailZ -= 1;
          detailTiles = mercatorRasterTilesInView(
            west,
            south,
            east,
            north,
            detailZ,
          );
        }
      }

      // The floor-level set over the WHOLE extent. Drawn when it IS the detail
      // level (low zoom — a single coarse set, which is what makes low zoom cheap),
      // and otherwise as the always-loaded underlay beneath a sharper level so
      // changing level never flashes blank. The underlay is skipped for a
      // translucent raster (both levels would blend through) and for a raster so
      // large that even the floor level busts the cap.
      const underlay = mercatorRasterTilesInView(
        rb[0],
        rb[1],
        rb[2],
        rb[3],
        baseZ,
      );
      const stack =
        detailZ > baseZ &&
        rl.opacity >= RASTER_STACK_MIN_OPACITY &&
        underlay.length <= MAX_RASTER_UNDERLAY_TILES;
      if (detailZ === baseZ || stack) {
        for (const t of underlay) push(rl, baseZ, t);
      }
      if (detailZ > baseZ) {
        for (const t of detailTiles) push(rl, detailZ, t);
      }
    }

    // Identical tile set → hand deck the SAME instances so it skips them entirely.
    const cache = rasterCacheRef.current;
    if (sig === cache.sig) return cache.layers;

    const byId = new Map<
      string,
      { layer: BitmapLayer; url: string; opacity: number }
    >();
    const layers = specs.map(({ id, url, bounds, opacity }) => {
      const prev = cache.byId.get(id);
      // Reuse only when the id, the source URL AND the opacity all match — deck
      // layers are immutable, so an opacity change needs a fresh instance.
      const layer =
        prev && prev.url === url && prev.opacity === opacity
          ? prev.layer
          : new BitmapLayer({ id, bounds, image: url, opacity });
      byId.set(id, { layer, url, opacity });
      return layer;
    });
    rasterCacheRef.current = { sig, layers, byId };
    return layers;
  }, [
    rasterLayers,
    baseUrl,
    tileView.lng,
    tileView.lat,
    tileView.zoom,
    size.width,
    size.height,
  ]);

  // Selection rectangle (fill + white outline) shown while dragging a zoom box.
  const rubberBandLayers = useMemo(() => {
    if (!rubberBand) return [];
    const minLng = Math.min(rubberBand.start[0], rubberBand.end[0]);
    const maxLng = Math.max(rubberBand.start[0], rubberBand.end[0]);
    const minLat = Math.min(rubberBand.start[1], rubberBand.end[1]);
    const maxLat = Math.max(rubberBand.start[1], rubberBand.end[1]);
    const ring: [number, number][] = [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ];
    return [
      new PolygonLayer({
        id: "geo-rubber-band-fill",
        data: [{ polygon: ring }],
        getPolygon: (d: { polygon: [number, number][] }) => d.polygon,
        getFillColor: [135, 206, 250, 80],
        stroked: false,
        filled: true,
        pickable: false,
        parameters: { depthTest: false },
      }),
      new PathLayer({
        id: "geo-rubber-band-outline",
        data: [{ path: ring }],
        getPath: (d: { path: [number, number][] }) => d.path,
        getColor: [255, 255, 255, 255],
        getWidth: 2,
        widthUnits: "pixels",
        widthMinPixels: 2,
        pickable: false,
        parameters: { depthTest: false },
      }),
    ];
  }, [rubberBand]);

  // Render CLONES of the shared overlay layers, never the originals: deck.gl stamps
  // internal state onto layer instances, so if this Deck used the same instances the
  // mapbox overlay uses, switching back to the mapbox (default) map would reuse
  // dirtied instances and render/perform worse. Clones keep the originals pristine.
  //
  // Memoised on `layers` ALONE. This used to be computed inside the `allLayers` memo,
  // whose deps included `basemapLayers` — which back then changed on every throttled
  // tile tick as tiles entered and left view. So every tick re-cloned EVERY overlay
  // layer: with a loaded session that is ~150 fresh instances several times a second,
  // and deck then has to run `_transferLayerState` plus a full prop diff on each one
  // (@deck.gl/core layer-manager.js:224-243) instead of matching identical instances
  // and diffing to nothing.
  //
  // `basemapLayers` no longer churns at all — the backstop is view-independent and
  // the TileLayer instance is stable, with tile churn handled inside it by deck —
  // so `allLayers` now only changes when the rasters, the overlays or the rubber
  // band really change. Keeping this memo separate anyway: it is the thing that
  // guarantees a raster tick cannot re-clone the overlays.
  const overlayClones = useMemo(
    () =>
      (layers as { clone?: (p: object) => unknown }[]).map((l) =>
        typeof l?.clone === "function" ? l.clone({}) : l,
      ),
    [layers],
  );

  const allLayers = useMemo(
    () => [
      ...basemapLayers,
      ...rasterTileLayers,
      ...overlayClones,
      ...rubberBandLayers,
    ],
    [basemapLayers, rasterTileLayers, overlayClones, rubberBandLayers],
  );

  const handleClick = useCallback(
    (info: {
      coordinate?: number[];
      x?: number;
      y?: number;
      object?: unknown;
      layer?: unknown;
    }) => {
      if (!onMapClick || !info?.coordinate) return;
      onMapClick({
        coordinate: [info.coordinate[0], info.coordinate[1]],
        x: info.x ?? 0,
        y: info.y ?? 0,
        object: info.object,
        layer: info.layer,
      });
    },
    [onMapClick],
  );

  const handleHover = useCallback(
    (info: unknown) => {
      onHover?.(info);
    },
    [onHover],
  );

  // ── Rubber-band zoom ──────────────────────────────────────────────────────
  // The parent's mapbox-based rubber band can't reach this cartesian
  // OrthographicView. Rather than deck's drag callbacks (which don't fire
  // reliably under a controller), a transparent capture surface is overlaid in
  // rubber-band mode (see JSX below); we unproject its screen pixels to world
  // [lng, lat] with the ortho camera's own math and fit the view to the box.
  //
  // ppd = 2**zoom pixels per world unit (a degree), the same relation clampView
  // uses. flipY:false means screen-y grows downward while latitude grows upward,
  // so the latitude term is subtracted. The camera is read from the live ref
  // (deck owns it now), which is static during a rubber-band drag anyway.
  const unproject = (px: number, py: number): [number, number] => {
    const { lng, lat, zoom } = liveViewRef.current;
    const s = sizeRef.current;
    const ppd = 2 ** zoom;
    return [lng + (px - s.width / 2) / ppd, lat - (py - s.height / 2) / ppd];
  };

  const rbPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!rubberBandMode) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const c = unproject(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    rubberBandActiveRef.current = true;
    rbCornersRef.current = { start: c, end: c };
    setRubberBand({ start: c, end: c });
  };

  const rbPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!rubberBandActiveRef.current) return;
    const start = rbCornersRef.current?.start;
    if (!start) return;
    const end = unproject(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    rbCornersRef.current = { start, end };
    setRubberBand({ start, end });
  };

  const rbPointerUp = () => {
    if (!rubberBandActiveRef.current) return;
    rubberBandActiveRef.current = false;
    const corners = rbCornersRef.current;
    rbCornersRef.current = null;
    setRubberBand(null);
    if (!corners) return;

    const minLng = Math.min(corners.start[0], corners.end[0]);
    const maxLng = Math.max(corners.start[0], corners.end[0]);
    const minLat = Math.min(corners.start[1], corners.end[1]);
    const maxLat = Math.max(corners.start[1], corners.end[1]);
    const lngSpan = maxLng - minLng;
    const latSpan = maxLat - minLat;
    // Ignore a click or a tiny box (a mis-drag) — leave the mode on so the user
    // can try again, matching the mercator rubber band.
    if (lngSpan <= 1e-4 || latSpan <= 1e-4) return;

    // The zoom that fits a span S degrees into P pixels is log2(P / S). Take the
    // tighter of the two axes and leave ~10% padding.
    const pad = 1.1;
    const s = sizeRef.current;
    const zX = Math.log2(s.width / (lngSpan * pad));
    const zY = Math.log2(s.height / (latSpan * pad));
    const z = Math.min(zX, zY, maxZoom);
    const c = clampView(
      [(minLng + maxLng) / 2, (minLat + maxLat) / 2, 0],
      z,
      s.width,
      s.height,
    );
    liveViewRef.current = { lng: c.target[0], lat: c.target[1], zoom: c.zoom };
    // Programmatic jump: a new initialViewState overwrites deck's internal camera
    // once, then normal uncontrolled interaction resumes from there.
    setBaseView({
      target: c.target,
      zoom: c.zoom,
      minZoom: fillMinZoom(s.width, s.height),
      maxZoom,
    });
    setTileView({ lng: c.target[0], lat: c.target[1], zoom: c.zoom });
    onViewStateChange?.([c.target[0], c.target[1]], c.zoom);
    window.dispatchEvent(new Event("geodetic-view-change"));
    onRubberBandComplete?.(); // exit the mode only after a real zoom
  };

  return (
    <>
      <DeckGL
        views={GEO_VIEW}
        initialViewState={baseView}
        // Full device resolution unless the canvas would exceed the pixel budget.
        // A flat DPR cap here was rendering Android (DPR 2–3) at a fraction of the
        // screen's pixels while leaving Windows (DPR ≤ 1.5) untouched — see
        // `budgetedDevicePixels`.
        useDevicePixels={budgetedDevicePixels(
          size.width,
          size.height,
          interacting,
        )}
        // Raise the pan gesture's start threshold from deck's default 1px to a
        // touch-slop of ~10px. Otherwise a tap with the slightest finger movement is
        // read as a 1px pan and the click is swallowed — so on touch, tapping to
        // place a line/polygon point (or open a tooltip) frequently did nothing.
        // Panning still works; it just needs a deliberate >10px drag to begin.
        eventRecognizerOptions={{ pan: { threshold: 10 } }}
        controller={
          rubberBandMode
            ? { dragPan: false, doubleClickZoom: false }
            : // doubleClickZoom OFF: while drawing, rapid taps to place points were
              // being merged into a double-click (zoom) by deck's controller, so the
              // first/rapid taps were "missed". Zoom is done via pinch / the zoom
              // controls, so losing double-tap-zoom here is harmless.
              { doubleClickZoom: false }
        }
        layers={allLayers as never}
        onViewStateChange={handleViewStateChange as never}
        onClick={handleClick as never}
        onHover={handleHover as never}
        onResize={({ width, height }: { width: number; height: number }) => {
          const next = { width: Math.max(1, width), height: Math.max(1, height) };
          sizeRef.current = next;
          setSize(next);
        }}
        onAfterRender={noteDeckPainted}
        style={{
          position: "absolute",
          inset: "0",
          // The colour behind the plate-carrée world. Sampled from the basemap
          // itself: #f2efe9 is the land tone of the tiles (79.9% of the pixels in a
          // typical land tile — ocean is #b9d7e8), so on the paths where the
          // backdrop can still show for a frame — the pre-clamp frame after a
          // resize, or a tile that has not decoded yet — it reads as map rather
          // than as a hole. Black was correct as a "nothing here" colour but far
          // too intense against a light basemap, which is what made every gap feel
          // like a flash.
          //
          // Still transparent until the surface has something real to show, so the
          // map already on screen holds through mount → GL device init → first tile
          // instead of being replaced by a flat fill (see `backdropOpaque`).
          background: backdropOpaque ? BASEMAP_VOID_COLOR : "transparent",
          transition: "background-color 200ms ease-out",
        }}
      />
      {rubberBandMode && (
        // Transparent surface that captures the drag so deck never pans; the
        // rectangle is rendered as deck layers underneath.
        <div
          onPointerDown={rbPointerDown}
          onPointerMove={rbPointerMove}
          onPointerUp={rbPointerUp}
          onPointerCancel={rbPointerUp}
          style={{
            position: "absolute",
            inset: 0,
            cursor: "crosshair",
            touchAction: "none",
          }}
        />
      )}
    </>
  );
}

export default GeodeticBasemapView;
