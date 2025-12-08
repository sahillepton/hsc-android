import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Input } from "../ui/input";
import { Slider } from "../ui/slider";
import { Separator } from "../ui/separator";
import { rgbToHex, hexToRgb, getDistance, getPolygonArea } from "@/lib/utils";
import { useMemo, useState } from "react";

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
  // Check for line geometry types
  const isLine =
    layer.type === "line" ||
    (layer.type === "geojson" &&
      layer.geojson &&
      Array.isArray(layer.geojson.features) &&
      layer.geojson.features.some((f: any) => {
        const geomType = f?.geometry?.type;
        return geomType === "LineString" || geomType === "MultiLineString";
      }));

  // Check for point geometry types
  const isPoint =
    layer.type === "point" ||
    (layer.type === "geojson" &&
      layer.geojson &&
      Array.isArray(layer.geojson.features) &&
      layer.geojson.features.some((f: any) => {
        const geomType = f?.geometry?.type;
        return geomType === "Point" || geomType === "MultiPoint";
      }));

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

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-4 ml-10 mt-3" align="end">
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
