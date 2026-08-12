import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Input } from "../ui/input";
import { Slider } from "../ui/slider";
import { Separator } from "../ui/separator";
import { rgbToHex, hexToRgb, getDistance, getPolygonArea } from "@/lib/utils";
import { TOOLTIP_DEFAULT_ATTR_LIMIT } from "@/lib/constants";
import {
  getRasterTooltipAttributeKeys,
  getRasterTooltipAttributes,
  isRasterTooltipLayer,
  type RasterTooltipAttribute,
} from "@/lib/raster-tooltip-attributes";
import { useIgrsPreference } from "@/store/layers-store";
import { useMemo, useState, useEffect, useRef } from "react";

interface LayerPopoverProps {
  layer: any;
  updateLayer: (id: string, newData: any) => void;
  children: React.ReactNode;
}

const LayerPopover = ({ layer, updateLayer, children }: LayerPopoverProps) => {
  const [widthPreview, setWidthPreview] = useState(layer.lineWidth ?? 5);
  const [radiusPreview, setRadiusPreview] = useState(
    layer.type === "point" ? layer.radius ?? 5 : layer.pointRadius ?? 5
  );
  const [zoomPreview, setZoomPreview] = useState(layer.minzoom ?? 0);

  // Update preview values when layer changes
  useEffect(() => {
    setZoomPreview(layer.minzoom ?? 0);
  }, [layer.minzoom]);

  // Close this settings panel when the user scrolls a container OUTSIDE it — the
  // layer list or the page — so it doesn't float detached from its row. We listen
  // ONLY to the `scroll` event (which fires when a real overflow container scrolls,
  // by wheel OR touch), NOT `wheel`/`touchmove`: those also fire on the MAP's
  // wheel-zoom / pinch-zoom, and intercepting them made map zoom stutter after the
  // panel had been used. Radix already closes the panel on an outside pointer-down
  // (clicking the map), so map interaction still dismisses it — just not zoom.
  // Scrolls INSIDE the panel (its own overflow) are ignored so every control stays
  // reachable.
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsideScroll = (e: Event) => {
      const t = e.target as Node | null;
      if (t && contentRef.current?.contains(t)) return; // scrolling within the panel
      // Never close while the user is actively TYPING in one of this panel's
      // fields. On Android, focusing the Layer Name input opens the soft keyboard,
      // which shrinks the viewport; the WebView then scrolls the layer list to keep
      // the focused field visible — an OUTSIDE scroll, which would close the panel
      // and unmount the input mid-rename.
      //
      // Scoped to text-entry elements ON PURPOSE. An earlier version skipped the
      // close whenever focus was anywhere inside the panel, but Radix moves focus
      // to the content container as soon as the popover opens — so that condition
      // was true almost always and scroll-close stopped working altogether. Only a
      // focused input/textarea/contenteditable implies a keyboard is up and a
      // rename is in progress; a merely-open panel must still close on scroll.
      const active = document.activeElement as HTMLElement | null;
      const isTextEntry =
        !!active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable);
      if (isTextEntry && contentRef.current?.contains(active)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", closeOnOutsideScroll, true);
    return () => {
      window.removeEventListener("scroll", closeOnOutsideScroll, true);
    };
  }, [open]);

  // A feature's geometry may be a GeometryCollection whose parts hold the actual
  // lines/points (e.g. highway networks), so recurse into it — otherwise the
  // width/radius controls never appear for those layers.
  const geometryHasType = (
    geom: GeoJSON.Geometry | null | undefined,
    types: string[],
  ): boolean => {
    if (!geom) return false;
    if (types.includes(geom.type)) return true;
    if (geom.type === "GeometryCollection" && Array.isArray(geom.geometries)) {
      return geom.geometries.some((g) => geometryHasType(g, types));
    }
    return false;
  };

  // Check for line geometry types
  const isLine =
    layer.type === "line" ||
    (layer.type === "geojson" &&
      layer.geojson &&
      Array.isArray(layer.geojson.features) &&
      layer.geojson.features.some((f: GeoJSON.Feature) =>
        geometryHasType(f?.geometry, ["LineString", "MultiLineString"]),
      ));

  // Check for point geometry types
  const isPoint =
    layer.type === "point" ||
    (layer.type === "geojson" &&
      layer.geojson &&
      Array.isArray(layer.geojson.features) &&
      layer.geojson.features.some((f: GeoJSON.Feature) =>
        geometryHasType(f?.geometry, ["Point", "MultiPoint"]),
      ));

  const distance = useMemo(() => {
    if (layer.type === "line" && layer.path?.length >= 2)
      return getDistance(layer.path[0], layer.path[layer.path.length - 1]);
    return null;
  }, [layer]);

  const area = useMemo(() => {
    if (layer.type === "polygon" && layer.polygon)
      return getPolygonArea(layer.polygon);
    return null;
  }, [layer]);

  // Feature-property keys available for a vector layer, for the tooltip-attribute
  // selector below. Sampled (not every feature) so huge sets stay cheap.
  const geojsonAttributeKeys = useMemo<string[]>(() => {
    const features = layer.geojson?.features;
    if (!Array.isArray(features) || features.length === 0) return [];
    const keys = new Set<string>();
    for (const f of features.slice(0, 300)) {
      const props = f?.properties;
      if (props && typeof props === "object") {
        for (const k of Object.keys(props)) keys.add(k);
      }
    }
    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }, [layer.geojson]);

  // A raster (DEM / GeoTIFF) has no feature properties — its tooltip renders a
  // fixed set of synthesised rows (coordinates, sampled value, range, CRS, …)
  // instead. Listing those gives rasters the SAME show/hide control vector layers
  // have; without this the whole section was gated off and a TIFF's settings
  // panel showed nothing but Layer Name and Min Zoom.
  const useIgrs = useIgrsPreference();
  const isRaster = isRasterTooltipLayer(layer);

  // Both kinds normalise to { key, label }: a vector attribute is its own label,
  // a raster row gets the label the tooltip actually prints for it.
  const availableAttributes = useMemo<RasterTooltipAttribute[]>(() => {
    if (isRaster) return getRasterTooltipAttributes(layer, useIgrs);
    return geojsonAttributeKeys.map((key) => ({ key, label: key }));
  }, [isRaster, layer, useIgrs, geojsonAttributeKeys]);

  // The keys an unconfigured layer counts as selected. For a raster this is the
  // FULL key set rather than the listing above: the IGRS preference hides the
  // Longitude row, and seeding a toggle from the visible listing would silently
  // drop `longitude` from the stored selection, so it would come back unticked
  // when the user switched IGRS off again.
  const defaultSelectionKeys = useMemo<string[]>(
    () =>
      isRaster
        ? getRasterTooltipAttributeKeys(layer)
        : availableAttributes.map((a) => a.key),
    [isRaster, layer, availableAttributes],
  );

  // undefined = not yet configured; array = the exact keys to show.
  const selectedAttributes = layer.tooltipAttributes as string[] | undefined;

  // Materialize the default selection once, so the panel and the tooltip always
  // agree ("ticked = shown"). A big-schema layer seeds to the first N fields; a
  // small one seeds to all. Without this, an unconfigured layer showed EVERY box
  // ticked while the tooltip silently capped at N — the mismatch reported here.
  useEffect(() => {
    // Rasters need no seed: they have at most a handful of rows, always under the
    // cap, and `isRasterTooltipAttrShown` already treats "unconfigured" as "show
    // all" — so panel and tooltip agree with no write. Skipping it matters
    // because this component mounts for every layer row scrolled into view, and
    // a zip import can bring in hundreds of rasters: seeding each would fire a
    // store write (and a full layers re-render) per row.
    if (isRaster) return;
    if (availableAttributes.length === 0) return;
    if (selectedAttributes === undefined) {
      // Seed a default selection (up to the cap) so the panel and tooltip agree.
      updateLayer(layer.id, {
        ...layer,
        tooltipAttributes: defaultSelectionKeys.slice(
          0,
          TOOLTIP_DEFAULT_ATTR_LIMIT,
        ),
      });
    } else if (selectedAttributes.length > TOOLTIP_DEFAULT_ATTR_LIMIT) {
      // Enforce the hard cap on any pre-existing over-selection (older layers).
      updateLayer(layer.id, {
        ...layer,
        tooltipAttributes: selectedAttributes.slice(
          0,
          TOOLTIP_DEFAULT_ATTR_LIMIT,
        ),
      });
    }
    // Runs to convergence; once within the cap the branches above are no-ops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAttributes, availableAttributes]);

  // Before the seed lands, treat the first N as shown so the panel never flashes
  // every box ticked (which would contradict the cap). A raster is never seeded
  // and always fits under the cap, so unconfigured means every row is shown —
  // exactly what `isRasterTooltipAttrShown` does on the tooltip side.
  const isAttrShown = (key: string) =>
    selectedAttributes === undefined
      ? isRaster ||
        availableAttributes.findIndex((a) => a.key === key) <
          TOOLTIP_DEFAULT_ATTR_LIMIT
      : selectedAttributes.includes(key);

  // Counts the LISTED rows that are ticked. Not the stored array's length: a
  // raster's stored selection can hold `longitude` while IGRS hides that row, and
  // a vector layer's can hold a key absent from the sampled first 300 features —
  // either would make the footer read "Showing 6 of 5".
  const shownCount = availableAttributes.filter((a) =>
    isAttrShown(a.key),
  ).length;

  // A raster's stored selection, narrowed to keys this layer actually owns. The
  // raster keys are a small fixed vocabulary, so a stored array holding anything
  // else is foreign (only reachable from a hand-edited or externally-written
  // session). Counting those foreign keys toward the cap would mark a raster
  // `atCap`, disable every checkbox, and make `toggleAttribute` a no-op — a
  // permanently dead panel, since rasters deliberately skip the truncation branch
  // that would otherwise heal it. Narrowing here keeps the cap honest AND makes
  // the first click rewrite the array clean.
  const effectiveSelection =
    isRaster && selectedAttributes
      ? selectedAttributes.filter((k) => defaultSelectionKeys.includes(k))
      : selectedAttributes;

  // The cap applies to what is STORED (that is what the tooltip renders), so it
  // is measured against the effective selection, not the visible listing.
  const effectiveSelectionCount =
    effectiveSelection?.length ??
    Math.min(defaultSelectionKeys.length, TOOLTIP_DEFAULT_ATTR_LIMIT);
  const atCap = effectiveSelectionCount >= TOOLTIP_DEFAULT_ATTR_LIMIT;
  // Only a layer with more rows than the cap can be truncated by it; for a raster
  // (≤ 6 rows) the cap is never reachable, so its wording stays out of the way.
  const capApplies = availableAttributes.length > TOOLTIP_DEFAULT_ATTR_LIMIT;

  // Selections are stored EXPLICITLY (the tooltip honors exactly what is ticked),
  // and turning ON is blocked once the cap is reached — turning OFF is always fine.
  const toggleAttribute = (key: string) => {
    const current = effectiveSelection ?? defaultSelectionKeys;
    const isOn = current.includes(key);
    if (!isOn && current.length >= TOOLTIP_DEFAULT_ATTR_LIMIT) return;
    const next = isOn
      ? current.filter((k: string) => k !== key)
      : [...current, key];
    updateLayer(layer.id, { ...layer, tooltipAttributes: next });
  };

  const setAllAttributes = (show: boolean) => {
    updateLayer(layer.id, {
      ...layer,
      // "All" is capped — select the first N (the most the tooltip will show).
      tooltipAttributes: show
        ? defaultSelectionKeys.slice(0, TOOLTIP_DEFAULT_ATTR_LIMIT)
        : [],
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        className="w-72 p-3 space-y-4"
        side="left"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        sticky="always"
        // `hideWhenDetached` is deliberately NOT set. It makes Radix add Floating
        // UI's `hide({ strategy: "referenceHidden" })` middleware
        // (@radix-ui/react-popper index.mjs:126), and on `referenceHidden` Radix
        // writes `visibility: "hidden"` onto the popper wrapper (index.mjs:161-163).
        // With `collisionBoundary` left at its default `[]` the clipping boundary is
        // the VISUAL viewport (@floating-ui/dom: `height = visualViewport.height`),
        // which the Android soft keyboard shrinks — and `visualViewport` is itself a
        // resize source for `autoUpdate`. So opening the keyboard on the LAST layer
        // row (the one row that always sits in the band the keyboard covers) marked
        // its trigger as hidden, the wrapper went `visibility: hidden`, and Blink
        // cannot keep focus in an invisible subtree: it blurred the Layer Name input
        // and Android dismissed the keyboard mid-rename. The app is locked to
        // landscape (AndroidManifest `screenOrientation="landscape"`) where the IME
        // eats most of the short screen, which is why it reproduced every time.
        // The "don't leave the panel floating detached from its row" intent this
        // prop served is already covered by the outside-scroll close above plus
        // Radix's own dismiss-on-outside-pointer-down.
      >
        <style>{`
          [data-slot='slider-track'] {
            background-color: #e5e7eb !important;
          }
          [data-slot='slider-range'] {
            background-color: #60a5fa !important;
          }
          [data-slot='slider-thumb'] {
            background-color: #3b82f6 !important;
            border-color: #3b82f6 !important;
          }
        `}</style>
        {/* Name Field */}
        <div className="mb-2">
          <label className="text-xs font-medium text-muted-foreground">
            Layer Name
          </label>
          <Input
            defaultValue={layer.name}
            className="mt-1 h-8 text-sm"
            tabIndex={-1}
            onBlur={(e) => {
              const newName = e.target.value.trim();
              if (newName && newName !== layer.name) {
                updateLayer(layer.id, { ...layer, name: newName });
              }
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </div>

        {/* Color - Don't show for raster layers (DEM) */}
        {layer.type !== "dem" && (
          <div className="mb-2">
            <label className="text-xs font-medium text-muted-foreground">
              Color
            </label>
            <Input
              type="color"
              value={rgbToHex(layer.color)}
              tabIndex={-1}
              className="mt-1 h-10 w-full rounded-lg cursor-pointer"
              onChange={(e) => {
                const color = hexToRgb(e.target.value);
                if (color) updateLayer(layer.id, { ...layer, color });
              }}
            />
          </div>
        )}

        {/* Line Width */}
        {isLine && (
          <>
            <div className="mb-2">
              <label className="text-xs font-medium text-muted-foreground">
                Line Width
              </label>
              <Slider
                min={1}
                max={50}
                step={1}
                value={[widthPreview]}
                onValueChange={(values) => setWidthPreview(values[0])}
                onValueCommit={(values) =>
                  updateLayer(layer.id, {
                    ...layer,
                    lineWidth: values[0],
                  })
                }
                className="mt-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>1 px</span>
                <span className="font-medium">Current: {widthPreview} px</span>
                <span>50 px</span>
              </div>
            </div>
          </>
        )}

        {/* Point Radius */}
        {isPoint && (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Point Radius
              </label>
              <Slider
                min={1}
                max={50}
                step={1}
                value={[radiusPreview]}
                onValueChange={(values) => setRadiusPreview(values[0])}
                onValueCommit={(values) => {
                  const value = values[0];
                  if (layer.type === "point") {
                    updateLayer(layer.id, {
                      ...layer,
                      radius: value,
                    });
                  } else {
                    updateLayer(layer.id, {
                      ...layer,
                      pointRadius: value,
                    });
                  }
                }}
                className="mt-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>1 px</span>
                <span className="font-medium">Current: {radiusPreview} px</span>
                <span>50 px</span>
              </div>
            </div>
          </>
        )}

        {/* Min Zoom Threshold */}
        <div className="mb-2">
          <label className="text-xs font-medium text-muted-foreground">
            Min Zoom
          </label>
          <Slider
            min={0}
            max={18}
            step={1}
            value={[zoomPreview]}
            onValueChange={(values) => setZoomPreview(values[0])}
            onValueCommit={(values) =>
              updateLayer(layer.id, {
                ...layer,
                minzoom: values[0],
              })
            }
            className="mt-2"
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>0</span>
            <span className="font-medium">
              Current: {zoomPreview.toFixed(0)}
            </span>
            <span>18</span>
          </div>
        </div>

        {/* Tooltip attribute selection — trims large-attribute tooltips */}
        {availableAttributes.length > 0 && (
          <>
            <Separator />
            <div className="mb-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Tooltip Attributes
                </label>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    className="text-blue-600 hover:underline"
                    onClick={() => setAllAttributes(true)}
                  >
                    {capApplies ? `First ${TOOLTIP_DEFAULT_ATTR_LIMIT}` : "All"}
                  </button>
                  <span className="text-muted-foreground">·</span>
                  <button
                    type="button"
                    className="text-blue-600 hover:underline"
                    onClick={() => setAllAttributes(false)}
                  >
                    None
                  </button>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto rounded-md border border-border/60 p-2 space-y-1">
                {availableAttributes.map(({ key, label }) => {
                  const shown = isAttrShown(key);
                  const locked = !shown && atCap; // cap reached — can't add more
                  return (
                    <label
                      key={key}
                      className={`flex items-start gap-2 text-xs ${
                        locked ? "cursor-not-allowed opacity-40" : "cursor-pointer"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border"
                        checked={shown}
                        disabled={locked}
                        onChange={() => toggleAttribute(key)}
                      />
                      <span className="min-w-0 break-all">{label}</span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {`Showing ${shownCount} of ${availableAttributes.length}`}
                {capApplies && ` · max ${TOOLTIP_DEFAULT_ATTR_LIMIT}`}
                {capApplies && atCap && " (deselect one to add another)"}
              </p>
            </div>
          </>
        )}

        {(distance || area) && (
          <>
            <Separator />
            <div className="text-xs text-muted-foreground">
              {distance && <p>Length: {distance} km</p>}
              {area && <p>Area: {area} km²</p>}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default LayerPopover;
