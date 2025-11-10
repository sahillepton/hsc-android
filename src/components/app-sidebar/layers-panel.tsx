import {
  ChevronDown,
  ChevronRight,
  EyeIcon,
  EyeOffIcon,
  LocateFixed,
  X,
} from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import type { LayerProps } from "@/lib/definitions";
import { getDistance, getPolygonArea, hexToRgb, rgbToHex } from "@/lib/utils";
import { useFocusLayerRequest, useLayers } from "@/store/layers-store";

const LayersPanel = ({
  setIsLayersOpen,
  isLayersOpen,
}: {
  setIsLayersOpen: (isOpen: boolean) => void;
  isLayersOpen: boolean;
}) => {
  const { layers } = useLayers();
  const { focusLayer, deleteLayer, updateLayer } = useFocusLayerRequest();
  return (
    <SidebarGroup className="space-y-3">
      <SidebarGroupLabel
        className="cursor-pointer hover:bg-accent rounded-lg px-3 py-2.5 flex items-center justify-between text-sm font-semibold transition-colors"
        onClick={() => setIsLayersOpen(!isLayersOpen)}
      >
        Layers Panel
        {isLayersOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </SidebarGroupLabel>
      {isLayersOpen && (
        <SidebarGroupContent>
          <SidebarMenu className="space-y-2">
            {layers.map((layer) => {
              console.log("Rendering layer:", layer.id, layer.name);
              return (
                <DropdownMenu>
                  <SidebarMenuItem
                    key={layer.id}
                    className="flex items-center justify-between p-0 rounded-lg border border-border/50 hover:border-border transition-colors"
                  >
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuButton className="flex justify-between flex-1 h-12 px-3 rounded-lg">
                        <div className="flex flex-col items-start">
                          <span className="font-medium text-sm truncate">
                            {layer.name}
                          </span>
                          {layer.type === "polygon" && layer.polygon ? (
                            <span className="text-xs text-muted-foreground">
                              {getPolygonArea(layer.polygon)} km²
                            </span>
                          ) : layer.type === "line" &&
                            layer.path &&
                            layer.path.length >= 2 ? (
                            <span className="text-xs text-muted-foreground">
                              {getDistance(
                                layer.path[0],
                                layer.path[layer.path.length - 1]
                              )}{" "}
                              km
                            </span>
                          ) : null}
                        </div>
                      </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <div className="flex gap-1 px-2">
                      <Button
                        variant={"ghost"}
                        size={"icon"}
                        className="h-8 w-8 shrink-0 hover:bg-accent"
                        title="Focus layer"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          focusLayer(layer.id);
                        }}
                      >
                        <LocateFixed size={14} />
                      </Button>
                      <Button
                        variant={"ghost"}
                        size={"icon"}
                        className="h-8 w-8 shrink-0 hover:bg-accent"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          updateLayer(layer.id, {
                            ...layer,
                            visible: layer.visible !== false ? false : true,
                          });
                        }}
                      >
                        {layer.visible !== false ? (
                          <EyeIcon size={14} />
                        ) : (
                          <EyeOffIcon size={14} />
                        )}
                      </Button>
                      <Button
                        variant={"ghost"}
                        size={"icon"}
                        className="h-8 w-8 shrink-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          if (
                            confirm(
                              `Are you sure you want to delete "${layer.name}"?`
                            )
                          ) {
                            deleteLayer(layer.id);
                          }
                        }}
                      >
                        <X size={14} />
                      </Button>
                    </div>
                  </SidebarMenuItem>
                  <DropdownMenuContent className="w-72" align="start">
                    <DropdownMenuLabel className="px-3 py-2">
                      <Input
                        defaultValue={layer.name}
                        className="border-none p-0 h-auto font-medium text-sm focus-visible:ring-0"
                        onBlur={(e) => {
                          const newName = e.target.value.trim();
                          if (newName && newName !== layer.name) {
                            updateLayer(layer.id, {
                              ...layer,
                              name: newName,
                            });
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                      />
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />

                    <div className="p-3">
                      <label className="text-xs font-medium text-muted-foreground mb-2 block">
                        Color
                      </label>
                      <Input
                        type="color"
                        value={rgbToHex(layer.color)}
                        className="w-full h-10 rounded-lg"
                        onChange={(e) => {
                          const color = hexToRgb(e.target.value);
                          if (color) {
                            updateLayer(layer.id, {
                              ...layer,
                              color: color,
                            });
                          }
                        }}
                      />
                    </div>

                    <DropdownMenuSeparator />
                    {layer.type === "line" &&
                      layer.path &&
                      layer.path.length >= 2 && (
                        <>
                          <div className="p-3 space-y-3">
                            <label className="text-xs font-medium text-muted-foreground block">
                              Line Width
                            </label>
                            <div className="space-y-2">
                              <Input
                                type="range"
                                value={layer.lineWidth ?? 5}
                                min={1}
                                max={20}
                                step={1}
                                className="w-full"
                                onChange={(e) => {
                                  updateLayer(layer.id, {
                                    ...layer,
                                    lineWidth: parseInt(e.target.value, 10),
                                  });
                                }}
                              />
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>1</span>
                                <span className="font-medium">
                                  {layer.lineWidth ?? 5}
                                </span>
                                <span>20</span>
                              </div>
                            </div>
                          </div>
                          <DropdownMenuSeparator />
                        </>
                      )}
                    {layer.type === "point" && (
                      <div className="p-3 space-y-3">
                        <label className="text-xs font-medium text-muted-foreground block">
                          Point Radius
                        </label>
                        <div className="space-y-2">
                          <Input
                            type="range"
                            value={layer.radius || 150}
                            min={100}
                            max={100000}
                            step={1000}
                            className="w-full"
                            onChange={(e) => {
                              updateLayer(layer.id, {
                                ...layer,
                                radius: parseInt(e.target.value),
                              });
                            }}
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>100</span>
                            <span className="font-medium">
                              {layer.radius || 150}
                            </span>
                            <span>100k</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {layer.type === "geojson" && (
                      <div className="p-3 space-y-3">
                        <label className="text-xs font-medium text-muted-foreground block">
                          Point Radius (for point features)
                        </label>
                        <div className="space-y-2">
                          <Input
                            type="range"
                            value={layer.pointRadius || 50000}
                            min={100}
                            max={100000}
                            step={1000}
                            className="w-full"
                            onChange={(e) => {
                              updateLayer(layer.id, {
                                ...layer,
                                pointRadius: parseInt(e.target.value),
                              });
                            }}
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>100</span>
                            <span className="font-medium">
                              {layer.pointRadius || 50000}
                            </span>
                            <span>100k</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
};

export default LayersPanel;
