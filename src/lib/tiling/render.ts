// Mapbox GL helpers for tiled raster layers. Each tiled layer becomes a
// `raster` source + `raster` layer named `raster-<layerId>`, fetching from
// the local Electron tile server (`/layers/<id>/{z}/{x}/{y}.png`).

import type { LayerProps } from "@/lib/definitions";
import { DEFAULT_LAYER_MAX_ZOOM } from "@/lib/constants";

type MapboxMap = {
  getSource: (id: string) => unknown;
  getLayer: (id: string) => unknown;
  addSource: (id: string, src: unknown) => void;
  removeSource: (id: string) => void;
  addLayer: (layer: unknown, beforeId?: string) => void;
  removeLayer: (id: string) => void;
  setPaintProperty: (id: string, prop: string, val: unknown) => void;
  setLayoutProperty: (id: string, prop: string, val: unknown) => void;
  getLayoutProperty?: (id: string, prop: string) => unknown;
  getPaintProperty?: (id: string, prop: string) => unknown;
  setLayerZoomRange?: (
    id: string,
    minzoom: number,
    maxzoom: number,
  ) => void;
  isStyleLoaded?: () => boolean;
  once?: (ev: string, cb: () => void) => void;
};

// Per-layer cache of the last zoom range we set via setLayerZoomRange.
// Mapbox doesn't expose getLayerZoomRange, so we mirror what we set
// here to avoid redundant calls (each redundant call dirties the style
// and forces a re-evaluation on the next frame).
const lastSetZoomRange = new Map<string, [number, number]>();

// Mapbox layer.minzoom is INCLUSIVE (visible at zooms >= minzoom);
// layer.maxzoom is EXCLUSIVE (hidden at zooms >= maxzoom). To match the
// inclusive semantics used everywhere else in the app (e.g. tooltip's
// `mapZoom <= layerInfo.maxzoom`), we pass `userMax + 1` to Mapbox so the
// layer remains visible at the user-set max zoom.
const MAPBOX_MAX_LAYER_ZOOM = 24;
function resolveLayerZoomRange(layer: LayerProps): [number, number] {
  const min = typeof layer.minzoom === "number" ? layer.minzoom : 0;
  const userMax =
    typeof layer.maxzoom === "number" ? layer.maxzoom : DEFAULT_LAYER_MAX_ZOOM;
  const max = Math.min(MAPBOX_MAX_LAYER_ZOOM, userMax + 1);
  return [min, max];
}

const RASTER_PREFIX = "raster-";

function rasterSourceId(layerId: string): string {
  return `${RASTER_PREFIX}${layerId}`;
}
function rasterLayerId(layerId: string): string {
  return `${RASTER_PREFIX}${layerId}`;
}

export function buildTilesUrl(baseUrl: string, layerId: string): string {
  return `${baseUrl}/layers/${encodeURIComponent(layerId)}/{z}/{x}/{y}.webp`;
}

export interface AddTiledRasterOpts {
  /** Mapbox layer to insert the raster *before* (e.g. label layer). */
  beforeId?: string;
}

/**
 * Add (or update opacity of) a Mapbox raster source/layer for a tiled raster.
 * Idempotent — safe to call repeatedly when layer props change.
 */
export function addOrUpdateTiledRaster(
  map: MapboxMap,
  layer: LayerProps,
  opts: AddTiledRasterOpts = {},
): void {
  if (!layer.tilesUrl) return;
  const sid = rasterSourceId(layer.id);
  const lid = rasterLayerId(layer.id);

  if (!map.getSource(sid)) {
    const src: Record<string, unknown> = {
      type: "raster",
      tiles: [layer.tilesUrl],
      tileSize: 256,
      scheme: "xyz",
    };
    if (typeof layer.tileMinZoom === "number") src.minzoom = layer.tileMinZoom;
    if (typeof layer.tileMaxZoom === "number") src.maxzoom = layer.tileMaxZoom;
    if (layer.tileBoundsWgs84) src.bounds = layer.tileBoundsWgs84;
    map.addSource(sid, src);
  }

  const opacity = computeOpacity(layer);
  // Honour layer.visible from the layers panel toggle — without this, the
  // raster keeps painting even after the user turns the layer off.
  const visibilityValue = layer.visible === false ? "none" : "visible";
  const [layerMinZoom, layerMaxZoom] = resolveLayerZoomRange(layer);
  if (!map.getLayer(lid)) {
    map.addLayer(
      {
        id: lid,
        type: "raster",
        source: sid,
        // Per-layer zoom range from the settings panel. Distinct from the
        // source-level minzoom/maxzoom (which describe physical tile
        // availability). Without these the raster paints at every zoom,
        // ignoring the user's slider.
        minzoom: layerMinZoom,
        maxzoom: layerMaxZoom,
        layout: {
          visibility: visibilityValue,
        },
        paint: {
          "raster-opacity": opacity,
          "raster-fade-duration": 0,
          "raster-resampling": "linear",
        },
      },
      opts.beforeId,
    );
  } else {
    try {
      // Skip-if-equal guards. Each setX dirties Mapbox's style → forces
      // a style re-evaluation across all raster layers next frame.
      // With N=153 raster layers and an apply() that runs all of them
      // on every layer-store change, blindly calling setX produces
      // 459 dirty marks per change even when nothing about the rasters
      // actually changed. Comparing against current value first turns
      // the unchanged ones into pure-read no-ops.
      const currentOpacity = map.getPaintProperty?.(lid, "raster-opacity");
      if (currentOpacity !== opacity) {
        map.setPaintProperty(lid, "raster-opacity", opacity);
      }
      const currentVisibility = map.getLayoutProperty?.(lid, "visibility");
      if (currentVisibility !== visibilityValue) {
        map.setLayoutProperty(lid, "visibility", visibilityValue);
      }
      // Mapbox doesn't expose getLayerZoomRange; mirror via
      // lastSetZoomRange. Idempotent zoom-range update so slider
      // changes still take effect live (any change in min OR max
      // triggers the set).
      const lastZ = lastSetZoomRange.get(lid);
      if (
        !lastZ ||
        lastZ[0] !== layerMinZoom ||
        lastZ[1] !== layerMaxZoom
      ) {
        map.setLayerZoomRange?.(lid, layerMinZoom, layerMaxZoom);
        lastSetZoomRange.set(lid, [layerMinZoom, layerMaxZoom]);
      }
    } catch {
      // Style may not be loaded yet; safe to ignore.
    }
  }
}

/**
 * Toggle Mapbox raster-layer visibility based on viewport intersection.
 *
 * Why: with N tiled raster layers, Mapbox iterates ALL of them every
 * frame for style evaluation, tile-state checks, etc., even though only
 * the layers whose bounds overlap the current viewport actually paint.
 * Setting `visibility: "none"` on the off-screen layers tells Mapbox to
 * skip them entirely. Tile fetches were already culled by
 * `source.bounds`, but the per-layer style overhead remained.
 *
 * Cost: O(N) rect-intersection on every map move/zoom — sub-millisecond
 * for N=200, no GPU work, no allocations beyond the diff check.
 *
 * Honours per-layer user toggles: a layer the user has explicitly
 * hidden (`layer.visible === false`) stays hidden regardless of
 * viewport. Cull only flips visibility for layers the user wants
 * shown, but which the camera isn't currently looking at.
 *
 * Bounds format: [west, south, east, north] in WGS84 (matches
 * `tileBoundsWgs84` and Mapbox's `LngLatBoundsLike` ordering).
 */
export function applyTiledRasterViewportCulling(
  map: MapboxMap,
  layers: LayerProps[],
  viewport: [number, number, number, number],
): void {
  const [vw, vs, ve, vn] = viewport;
  for (const l of layers) {
    if (!l.tilesUrl || !l.tileBoundsWgs84) continue;
    const lid = rasterLayerId(l.id);
    try {
      if (!map.getLayer(lid)) continue;
    } catch {
      continue;
    }
    const [lw, ls, le, ln] = l.tileBoundsWgs84;
    // AABB intersection: layers DON'T intersect when one is fully
    // east, west, north, or south of the other.
    const intersects = !(le < vw || lw > ve || ln < vs || ls > vn);
    const userVisible = l.visible !== false;
    const desired = userVisible && intersects ? "visible" : "none";
    try {
      const current = map.getLayoutProperty?.(lid, "visibility");
      if (current !== desired) {
        map.setLayoutProperty(lid, "visibility", desired);
      }
    } catch {
      /* style not loaded; safe to skip */
    }
  }
}

/** Remove the Mapbox raster source/layer for a tiled raster. */
export function removeTiledRaster(map: MapboxMap, layerId: string): void {
  const sid = rasterSourceId(layerId);
  const lid = rasterLayerId(layerId);
  try {
    if (map.getLayer(lid)) map.removeLayer(lid);
  } catch {
    /* noop */
  }
  try {
    if (map.getSource(sid)) map.removeSource(sid);
  } catch {
    /* noop */
  }
  // Drop the cached zoom-range mirror — re-add of a same-id layer
  // should always trigger a fresh setLayerZoomRange.
  lastSetZoomRange.delete(lid);
}

function computeOpacity(layer: LayerProps): number {
  if (Array.isArray(layer.color) && layer.color.length === 4) {
    return Math.max(0, Math.min(1, (layer.color[3] as number) / 255));
  }
  return 1;
}
