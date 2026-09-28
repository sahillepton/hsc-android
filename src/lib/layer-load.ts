import type { LayerProps } from "./definitions";
import { getRasterTooltipKind } from "./raster-tooltip-attributes";
import { RECOMMENDED_VISIBLE_FEATURES } from "./constants";

/**
 * What the "GPU load" badge (top right, beside Storage Paths) reports.
 *
 * What strains the tablet is how many FEATURES are visible at once: every
 * visible feature is geometry to tessellate, upload and draw. Too much and the
 * app lags, and Android will kill the WebView outright when graphics memory runs
 * out. The badge counts the visible features, compares against the recommended
 * ceiling in constants.ts, and shows one of three stages — Low, Medium, High.
 * It never hides anything itself, and it does not depend on which basemap (Web
 * Mercator or WGS 84) is underneath: it reads the layer store, which both
 * renderers draw from.
 *
 * Layer counts are gathered for the chip's title only. A raster (TIFF, DEM,
 * image overlay) is one layer with no features.
 */
export type LoadStress = "low" | "medium" | "high";

export type LayerLoadSummary = {
  layers: number;
  visibleLayers: number;
  features: number;
  visibleFeatures: number;
  /** visibleFeatures / recommended; 1 means exactly at the ceiling. */
  ratio: number;
  stress: LoadStress;
};

/** A raster of any kind: tiled or in-memory TIFF / DEM, or an image overlay. */
export function isRasterLayer(layer: LayerProps): boolean {
  return (
    getRasterTooltipKind(layer) !== null ||
    !!layer.tilesUrl ||
    !!layer.texture ||
    !!layer.elevationData
  );
}

/**
 * How many drawable features a layer contributes. A raster has none (it is one
 * layer, one texture); a sketch is one feature.
 */
export function featureCountOf(layer: LayerProps): number {
  if (isRasterLayer(layer)) return 0;
  if (layer.geojson?.features) return layer.geojson.features.length;
  if (layer.nodes) return layer.nodes.length;
  if (layer.annotations) return layer.annotations.length;
  switch (layer.type) {
    case "point":
    case "line":
    case "polygon":
    case "azimuth":
      return 1;
    default:
      return 0;
  }
}

/** Low below 60 % of the ceiling, Medium up to it, High at or past it. */
export function loadStress(ratio: number): LoadStress {
  if (ratio >= 1) return "high";
  if (ratio >= 0.6) return "medium";
  return "low";
}

export function summarizeLayerLoad(
  layers: ReadonlyArray<LayerProps>,
): LayerLoadSummary {
  let visibleLayers = 0;
  let features = 0;
  let visibleFeatures = 0;
  for (const layer of layers) {
    const visible = layer.visible !== false;
    const count = featureCountOf(layer);
    if (visible) visibleLayers++;
    features += count;
    if (visible) visibleFeatures += count;
  }
  const ratio = visibleFeatures / RECOMMENDED_VISIBLE_FEATURES;
  return {
    layers: layers.length,
    visibleLayers,
    features,
    visibleFeatures,
    ratio,
    stress: loadStress(ratio),
  };
}
