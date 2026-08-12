import type { LayerProps } from "./definitions";

/**
 * Stable keys for the rows a raster (DEM / GeoTIFF) tooltip can draw.
 *
 * Unlike a vector layer — whose tooltip rows ARE its feature properties, so the
 * keys come from the data — a raster tooltip renders a fixed, synthesised set of
 * rows. These keys name those rows so the same "Tooltip Attributes" selector can
 * show/hide them.
 *
 * They are persisted in `layer.tooltipAttributes` and round-trip through session
 * save/restore (autosave spreads the layer object), so the strings must never
 * change meaning.
 *
 * `VALUE` / `RANGE` are deliberately shared by both raster branches — a tiled
 * raster labels them "Value"/"Range" and an elevation raster "Elevation"/
 * "Elevation Range", but they gate the same row, so a saved selection stays
 * meaningful if a layer is ever re-imported down the other path.
 */
export const RASTER_TOOLTIP_ATTRIBUTES = {
  LATITUDE: "latitude",
  LONGITUDE: "longitude",
  VALUE: "value",
  RANGE: "range",
  CRS: "crs",
  PIXEL_INDEX: "pixelIndex",
  RASTER_SIZE: "rasterSize",
} as const;

export interface RasterTooltipAttribute {
  key: string;
  /** Label shown in the settings panel — matches the tooltip row it gates. */
  label: string;
}

/**
 * Which raster tooltip branch a layer will render, or `null` when none will.
 *
 * Mirrors the two guards in `tooltip.tsx` exactly:
 *   • "tiled"     — `type === "dem" && tilesUrl && bounds` (sampled via the worker)
 *   • "elevation" — `type === "dem" && elevationData && bounds`
 *
 * A colour GeoTIFF (RGB / RGBA / palette) is also stored as `type: "dem"` but has
 * neither `tilesUrl` nor `elevationData` — no tooltip branch fires for it, so it
 * must offer NO attributes rather than list rows it can never draw.
 */
export const getRasterTooltipKind = (
  layer: LayerProps | null | undefined,
): "tiled" | "elevation" | null => {
  if (!layer || layer.type !== "dem" || !layer.bounds) return null;
  if (layer.tilesUrl) return "tiled";
  if (layer.elevationData) return "elevation";
  return null;
};

/** True when this layer's tooltip is one of the raster branches. */
export const isRasterTooltipLayer = (
  layer: LayerProps | null | undefined,
): boolean => getRasterTooltipKind(layer) !== null;

/**
 * Every key a raster layer's tooltip can gate, independent of the IGRS display
 * preference. Used as the base for a not-yet-configured selection so toggling a
 * row while IGRS is ON never silently drops `longitude` (which IGRS hides).
 */
export const getRasterTooltipAttributeKeys = (
  layer: LayerProps | null | undefined,
): string[] => {
  const kind = getRasterTooltipKind(layer);
  if (!kind) return [];
  const { LATITUDE, LONGITUDE, VALUE, RANGE, CRS, PIXEL_INDEX, RASTER_SIZE } =
    RASTER_TOOLTIP_ATTRIBUTES;
  const keys: string[] = [LATITUDE, LONGITUDE, VALUE];
  if (kind === "tiled") {
    if (
      typeof layer!.sourceValueMin === "number" &&
      typeof layer!.sourceValueMax === "number"
    ) {
      keys.push(RANGE);
    }
    if (layer!.sourceCrs) keys.push(CRS);
  } else {
    keys.push(RANGE, PIXEL_INDEX, RASTER_SIZE);
  }
  return keys;
};

/**
 * The rows this specific raster's tooltip will actually draw, in render order,
 * with the label the tooltip uses — so the settings panel lists exactly what the
 * tooltip can show and never a row this layer cannot produce.
 *
 * `useIgrs` matters because the IGRS preference collapses the Latitude and
 * Longitude rows into a single "IGRS" row; listing both then would offer a
 * "Longitude" checkbox that gates nothing.
 */
export const getRasterTooltipAttributes = (
  layer: LayerProps | null | undefined,
  useIgrs: boolean,
): RasterTooltipAttribute[] => {
  const kind = getRasterTooltipKind(layer);
  if (!kind) return [];
  const { LATITUDE, LONGITUDE, VALUE, RANGE, CRS, PIXEL_INDEX, RASTER_SIZE } =
    RASTER_TOOLTIP_ATTRIBUTES;

  const attributes: RasterTooltipAttribute[] = [];
  if (useIgrs) {
    attributes.push({ key: LATITUDE, label: "IGRS" });
  } else {
    attributes.push(
      { key: LATITUDE, label: "Latitude" },
      { key: LONGITUDE, label: "Longitude" },
    );
  }

  if (kind === "tiled") {
    // Matches the tooltip's own label choice: a Byte raster reads as a class id,
    // anything else as a measured value.
    attributes.push({
      key: VALUE,
      label: layer!.sourceDtype === "Byte" ? "Class" : "Value",
    });
    if (
      typeof layer!.sourceValueMin === "number" &&
      typeof layer!.sourceValueMax === "number"
    ) {
      attributes.push({ key: RANGE, label: "Range" });
    }
    if (layer!.sourceCrs) {
      attributes.push({ key: CRS, label: "CRS" });
    }
  } else {
    attributes.push(
      { key: PIXEL_INDEX, label: "Pixel Index" },
      { key: VALUE, label: "Elevation" },
      { key: RANGE, label: "Elevation Range" },
      { key: RASTER_SIZE, label: "Raster Size" },
    );
  }
  return attributes;
};

/**
 * Whether a raster tooltip row is shown.
 *
 * `undefined` (never configured) shows every row. A raster has at most a handful
 * of rows — always under `TOOLTIP_DEFAULT_ATTR_LIMIT` — so, unlike a big-schema
 * vector layer, it needs no seeded default selection for "ticked = shown" to
 * hold. That keeps the settings panel from writing to the store just because a
 * raster's row scrolled into view.
 */
export const isRasterTooltipAttrShown = (
  layer: LayerProps | null | undefined,
  key: string,
): boolean => {
  const selected = layer?.tooltipAttributes;
  if (!Array.isArray(selected)) return true;
  return selected.includes(key);
};
