import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import { rgbToHex, hexToRgb, getDistance, getPolygonArea } from "@/lib/utils";
import { useMemo } from "react";

interface LayerPopoverProps {
  layer: any;
  updateLayer: (id: string, newData: any) => void;
  children: React.ReactNode;
}

const LayerPopover = ({ layer, updateLayer, children }: LayerPopoverProps) => {
  const isLine =
    layer.type === "line" ||
    (layer.type === "geojson" &&
      layer.geojson?.features?.some((f: any) =>
        ["LineString", "MultiLineString"].includes(f.geometry?.type)
      ));
  const isPoint =
    layer.type === "point" ||
    (layer.type === "geojson" &&
      layer.geojson?.features?.some((f: any) =>
        ["Point", "MultiPoint"].includes(f.geometry?.type)
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

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-4" align="end">
        {/* Name Field */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Layer Name
          </label>
          <Input
            defaultValue={layer.name}
            className="mt-1 h-8 text-sm"
            onBlur={(e) => {
              const newName = e.target.value.trim();
              if (newName && newName !== layer.name) {
                updateLayer(layer.id, { ...layer, name: newName });
              }
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </div>

        <Separator />

        {/* Color */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Color
          </label>
          <Input
            type="color"
            value={rgbToHex(layer.color)}
            className="mt-1 h-10 w-full rounded-lg cursor-pointer"
            onChange={(e) => {
              const color = hexToRgb(e.target.value);
              if (color) updateLayer(layer.id, { ...layer, color });
            }}
          />
        </div>

        {/* Line Width */}
        {isLine && (
          <>
            <Separator />
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Line Width
              </label>
              <Input
                type="range"
                min={1}
                max={20}
                step={1}
                value={layer.lineWidth ?? 5}
                onChange={(e) =>
                  updateLayer(layer.id, {
                    ...layer,
                    lineWidth: parseInt(e.target.value),
                  })
                }
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1</span>
                <span>{layer.lineWidth ?? 5}</span>
                <span>20</span>
              </div>
            </div>
          </>
        )}

        {/* Point Radius */}
        {isPoint && (
          <>
            <Separator />
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Point Radius
              </label>
              <Input
                type="range"
                min={100}
                max={100000}
                step={1000}
                value={
                  layer.type === "point"
                    ? layer.radius || 200
                    : layer.pointRadius || 50000
                }
                onChange={(e) => {
                  const value = parseInt(e.target.value);
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
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>100</span>
                <span>
                  {layer.type === "point"
                    ? layer.radius || 200
                    : layer.pointRadius || 50000}
                </span>
                <span>100k</span>
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
