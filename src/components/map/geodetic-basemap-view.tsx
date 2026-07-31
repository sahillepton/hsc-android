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
import {
  fillMinZoom,
  mercatorRasterTilesInView,
  tilesInView,
  tileZoomForOrtho,
  viewBounds,
} from "@/lib/basemap/tileGrid";
import type { TilesConfig } from "@/lib/basemap/tileConfig";

/** A tiled raster (uploaded GeoTIFF etc.) to also draw in the geodetic view. */
export interface GeodeticRasterLayer {
  id: string;
  /** Web-Mercator XYZ template, e.g. http://localhost:PORT/layers/<id>/{z}/{x}/{y}.webp */
  tilesUrl: string;
  tileMinZoom?: number;
  tileMaxZoom?: number;
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
// A raster is drawn as a SINGLE level (it's semi-transparent, so stacking coarser
// levels would blend through and — since coarse Mercator tiles distort at
// plate-carrée bounds — appear as a misaligned blocky copy). The level is the
// sharpest whose WHOLE extent fits this many tiles, giving a fixed, view-
// independent tile set that never reloads on zoom/pan.
const MAX_RASTER_TILES = 256;

// How many levels just BELOW the detail level to stack for a progressively-
// sharpening fallback while detail tiles load. A single coarse world backstop is
// added on top of these. The EXPENSIVE middle levels between the backstop and
// these near levels are intentionally skipped — once the detail level is in they
// are fully hidden behind it, so drawing the whole 0..detailZ pyramid every frame
// was pure overdraw. When everything is loaded the image is pixel-identical; only
// the transient loading fallback is marginally coarser. Sharpness is unchanged.
const BASEMAP_NEAR_LEVELS = 2;

function basemapLevels(minZoom: number, detailZ: number): number[] {
  const levels = new Set<number>();
  // Coarse world backstop — 1–2 tiles, loads instantly, so the view is never blank.
  levels.add(minZoom);
  // Detail level + the couple just below it (smooth, sharp fallback during zoom).
  for (let z = Math.max(minZoom, detailZ - BASEMAP_NEAR_LEVELS); z <= detailZ; z++) {
    levels.add(z);
  }
  return [...levels].sort((a, b) => a - b);
}

// Throttle interval for recomputing the raster tile set during interaction. A
// THROTTLE (not a debounce) so a slow continuous zoom keeps updating tiles
// mid-gesture instead of freezing until the gesture ends.
const TILE_THROTTLE_MS = 180;

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
  maxZoom = 20,
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
  const scheduleTileTick = useCallback(() => {
    if (config.vector) return;
    if (tileViewTimerRef.current !== null) return; // a tick is already pending
    tileViewTimerRef.current = setTimeout(() => {
      tileViewTimerRef.current = null;
      const v = liveViewRef.current;
      setTileView({ lng: v.lng, lat: v.lat, zoom: v.zoom });
    }, TILE_THROTTLE_MS);
  }, [config.vector]);

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
    [scheduleTileTick, onViewStateChange, maxZoom],
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
    liveViewRef.current = { lng: c.target[0], lat: c.target[1], zoom: c.zoom };
    setBaseView({
      target: c.target,
      zoom: c.zoom,
      minZoom: fillMinZoom(s.width, s.height),
      maxZoom,
    });
    setTileView({ lng: c.target[0], lat: c.target[1], zoom: c.zoom });
    onViewStateChange?.([c.target[0], c.target[1]], c.zoom);
    window.dispatchEvent(new Event("geodetic-view-change"));
    // Keyed ONLY on the nonce so an unrelated re-render (e.g. a fresh inline
    // onViewStateChange from the parent) never re-applies a stale command.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandNonce]);

  // Reuse BitmapLayer instances across renders. When the visible tile set is
  // unchanged (a small pan within the same tiles, or the camera merely moved) we
  // hand deck.gl the SAME instances, which it then skips entirely — no per-frame
  // allocation and no reconciliation of the whole pyramid. Only newly-entered
  // tiles are constructed; tiles that left view are dropped.
  const basemapCacheRef = useRef<{
    sig: string;
    layers: BitmapLayer[];
    byId: Map<string, { layer: BitmapLayer; url: string }>;
  }>({ sig: "", layers: [], byId: new Map() });

  const vparam = cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : "";
  const basemapLayers = useMemo(() => {
    if (!baseUrl || config.vector) return [];
    const b = viewBounds(
      tileView.lng,
      tileView.lat,
      tileView.zoom,
      size.width,
      size.height,
    );
    const detailZ = tileZoomForOrtho(config, tileView.zoom);

    const specs: {
      id: string;
      url: string;
      bounds: [number, number, number, number];
    }[] = [];
    // Signature keyed on source + the exact tile id set, so it changes only when
    // tiles enter/leave view or the basemap folder switches.
    let sig = `${baseUrl}|${config.format}|${vparam}`;
    for (const z of basemapLevels(config.minZoom, detailZ)) {
      for (const t of tilesInView(config, z, b.west, b.south, b.east, b.north)) {
        const id = `geo-basemap-${z}-${t.worldX}-${t.worldY}`;
        specs.push({
          id,
          url: `${baseUrl}/${z}/${t.x}/${t.y}.${config.format}${vparam}`,
          bounds: t.bounds,
        });
        sig += `;${id}`;
      }
    }

    const cache = basemapCacheRef.current;
    if (sig === cache.sig) return cache.layers; // identical set → stable reference

    const byId = new Map<string, { layer: BitmapLayer; url: string }>();
    const layers = specs.map(({ id, url, bounds }) => {
      const prev = cache.byId.get(id);
      // Reuse only when both the id AND the source URL match (guards a basemap
      // switch that keeps tile ids but changes the underlying image).
      const layer =
        prev && prev.url === url
          ? prev.layer
          : new BitmapLayer({ id, bounds, image: url });
      byId.set(id, { layer, url });
      return layer;
    });
    basemapCacheRef.current = { sig, layers, byId };
    return layers;
  }, [
    baseUrl,
    config,
    tileView.lng,
    tileView.lat,
    tileView.zoom,
    size.width,
    size.height,
    vparam,
  ]);

  // Tiled rasters: their 3857 tiles placed at true lng/lat bounds (above the
  // basemap, below the vector/point overlay).
  //
  // Rendered at a FIXED level covering each raster's WHOLE extent, computed only
  // from the raster (NOT the view). This is the key to no reloads: the tile set
  // never changes as you zoom/pan, so deck.gl never drops a tile and re-fetches it
  // (that drop-and-refetch, showing blank meanwhile, was the "delete + render
  // again"). Trade-off: a fixed resolution — soft if you zoom in far past it.
  const rasterTileLayers = useMemo(() => {
    if (!rasterLayers?.length || !baseUrl) return [];
    const out: BitmapLayer[] = [];
    for (const rl of rasterLayers) {
      const rb = rl.tileBoundsWgs84;
      if (!rb) continue; // need an extent to render a fixed, view-independent set
      const minZ = rl.tileMinZoom ?? 0;
      const maxZ = rl.tileMaxZoom ?? 22;
      // Sharpest level whose whole extent still fits the tile budget.
      let z = minZ;
      for (let cz = minZ; cz <= maxZ; cz++) {
        const count = mercatorRasterTilesInView(
          rb[0],
          rb[1],
          rb[2],
          rb[3],
          cz,
        ).length;
        if (count <= MAX_RASTER_TILES) z = cz;
        else break;
      }
      for (const t of mercatorRasterTilesInView(rb[0], rb[1], rb[2], rb[3], z)) {
        out.push(
          new BitmapLayer({
            id: `geo-raster-${rl.id}-${z}-${t.x}-${t.y}`,
            bounds: t.bounds,
            image: rl.tilesUrl
              .replace("{z}", String(z))
              .replace("{x}", String(t.x))
              .replace("{y}", String(t.y)),
            opacity: rl.opacity,
          }),
        );
      }
    }
    return out;
  }, [rasterLayers, baseUrl]);

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

  const allLayers = useMemo(() => {
    // Render CLONES of the shared overlay layers, never the originals: deck.gl
    // stamps internal state onto layer instances, so if this Deck used the same
    // instances the mapbox overlay uses, switching back to the mapbox (default)
    // map would reuse dirtied instances and render/perform worse. Clones keep the
    // originals pristine for the mapbox overlay.
    const overlay = (layers as { clone?: (p: object) => unknown }[]).map((l) =>
      typeof l?.clone === "function" ? l.clone({}) : l,
    );
    return [...basemapLayers, ...rasterTileLayers, ...overlay, ...rubberBandLayers];
  }, [basemapLayers, rasterTileLayers, layers, rubberBandLayers]);

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
        style={{ position: "absolute", inset: "0", background: "#000000" }}
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
