import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Input } from "../ui/input";
import { Slider } from "../ui/slider";
import { Separator } from "../ui/separator";
import { rgbToHex, hexToRgb, getDistance, getPolygonArea } from "@/lib/utils";
import { TOOLTIP_DEFAULT_ATTR_LIMIT } from "@/lib/constants";
import { useMemo, useState, useEffect } from "react";

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
  const availableAttributes = useMemo<string[]>(() => {
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

  // undefined = not yet configured; array = the exact keys to show.
  const selectedAttributes = layer.tooltipAttributes as string[] | undefined;

  // Materialize the default selection once, so the panel and the tooltip always
  // agree ("ticked = shown"). A big-schema layer seeds to the first N fields; a
  // small one seeds to all. Without this, an unconfigured layer showed EVERY box
  // ticked while the tooltip silently capped at N — the mismatch reported here.
  useEffect(() => {
    if (availableAttributes.length === 0) return;
    if (selectedAttributes === undefined) {
      // Seed a default selection (up to the cap) so the panel and tooltip agree.
      updateLayer(layer.id, {
        ...layer,
        tooltipAttributes: availableAttributes.slice(
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
  // every box ticked (which would contradict the cap).
  const isAttrShown = (key: string) =>
    selectedAttributes === undefined
      ? availableAttributes.indexOf(key) < TOOLTIP_DEFAULT_ATTR_LIMIT
      : selectedAttributes.includes(key);

  const selectedCount =
    selectedAttributes?.length ??
    Math.min(availableAttributes.length, TOOLTIP_DEFAULT_ATTR_LIMIT);
  const atCap = selectedCount >= TOOLTIP_DEFAULT_ATTR_LIMIT;

  // Selections are stored EXPLICITLY (the tooltip honors exactly what is ticked),
  // and turning ON is blocked once the cap is reached — turning OFF is always fine.
  const toggleAttribute = (key: string) => {
    const current = selectedAttributes ?? availableAttributes;
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
        ? availableAttributes.slice(0, TOOLTIP_DEFAULT_ATTR_LIMIT)
        : [],
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-72 p-3 space-y-4"
        side="left"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        sticky="always"
        hideWhenDetached
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
                    First {TOOLTIP_DEFAULT_ATTR_LIMIT}
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
                {availableAttributes.map((key) => {
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
                      <span className="min-w-0 break-all">{key}</span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {`Showing ${selectedCount} of ${availableAttributes.length} · max ${TOOLTIP_DEFAULT_ATTR_LIMIT}`}
                {atCap && " (deselect one to add another)"}
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
