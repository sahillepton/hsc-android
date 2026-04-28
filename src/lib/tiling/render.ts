// Mapbox GL helpers for tiled raster layers. Each tiled layer becomes a
// `raster` source + `raster` layer named `raster-<layerId>`, fetching from
// the local Electron tile server (`/layers/<id>/{z}/{x}/{y}.png`).

import type { LayerProps } from "@/lib/definitions";

type MapboxMap = {
  getSource: (id: string) => unknown;
  getLayer: (id: string) => unknown;
  addSource: (id: string, src: unknown) => void;
  removeSource: (id: string) => void;
  addLayer: (layer: unknown, beforeId?: string) => void;
  removeLayer: (id: string) => void;
  setPaintProperty: (id: string, prop: string, val: unknown) => void;
  setLayoutProperty: (id: string, prop: string, val: unknown) => void;
  isStyleLoaded?: () => boolean;
  once?: (ev: string, cb: () => void) => void;
};

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
  if (!map.getLayer(lid)) {
    map.addLayer(
      {
        id: lid,
        type: "raster",
        source: sid,
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
      map.setPaintProperty(lid, "raster-opacity", opacity);
      map.setLayoutProperty(lid, "visibility", visibilityValue);
    } catch {
      // Style may not be loaded yet; safe to ignore.
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
}

function computeOpacity(layer: LayerProps): number {
  if (Array.isArray(layer.color) && layer.color.length === 4) {
    return Math.max(0, Math.min(1, (layer.color[3] as number) / 255));
  }
  return 1;
}
