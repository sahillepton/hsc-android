import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  EyeIcon,
  EyeOffIcon,
  LocateFixed,
  Settings2,
  ArrowUp,
} from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from "../ui/sidebar";
import { Button } from "../ui/button";
import {
  useLayers,
  useFocusLayerRequest,
  useHoverInfo,
} from "@/store/layers-store";
import LayerPopover from "./layer-popover";
import { isSketchLayer } from "@/lib/sketch-layers";
import { calculateLayerZoomRange } from "@/lib/layers";

type LayersPanelProps = {
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
  variant?: "accordion" | "plain";
  enableSelection?: boolean;
};

const LayersPanel = ({
  isOpen,
  setIsOpen,
  variant = "accordion",
  enableSelection = false,
}: LayersPanelProps) => {
  const { layers, bringLayerToTop } = useLayers();
  const { focusLayer, deleteLayer, updateLayer } = useFocusLayerRequest();
  const { hoverInfo, setHoverInfo } = useHoverInfo();
  const nonSketchLayers = layers.filter((layer) => !isSketchLayer(layer));

  const layerIds = nonSketchLayers.map((layer) => layer.id);
  const layerIdSignature = layerIds.join("|");
  const layerIdSet = new Set(layerIds);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const next = prev.filter((id) => layerIdSet.has(id));
      if (next.length === prev.length) {
        return prev;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerIdSignature]);

  const toggleSelect = (layerId: string) => {
    setSelectedIds((prev) =>
      prev.includes(layerId)
        ? prev.filter((id) => id !== layerId)
        : [...prev, layerId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === layerIds.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(layerIds);
    }
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (
      confirm(
        `Delete ${selectedIds.length} selected layer${
          selectedIds.length > 1 ? "s" : ""
        }?`
      )
    ) {
      selectedIds.forEach((id) => deleteLayer(id));
      setSelectedIds([]);
    }
  };

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return null;
    try {
      const date = new Date(timestamp);
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return null;
    }
  };

  const handleToggleVisibility = (layerId: string, visible: boolean) => {
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return;

    updateLayer(layerId, {
      ...layer,
      visible,
    });

    // Close tooltip if the layer being hidden is currently being hovered
    if (!visible && hoverInfo) {
      // Check if the hovered object belongs to this layer
      const hoveredObject = hoverInfo.object;
      let hoveredLayerId: string | undefined;

      if ((hoveredObject as any)?.layerId) {
        hoveredLayerId = (hoveredObject as any).layerId;
      } else if ((hoveredObject as any)?.id && (hoveredObject as any)?.type) {
        hoveredLayerId = (hoveredObject as any).id;
      } else if (hoverInfo.layer?.id) {
        const deckLayerId = hoverInfo.layer.id;
        hoveredLayerId = nonSketchLayers.find((l) => l.id === deckLayerId)?.id;
        if (!hoveredLayerId) {
          const baseId = deckLayerId
            .replace(/-icon-layer$/, "")
            .replace(/-signal-overlay$/, "")
            .replace(/-bitmap$/, "");
          hoveredLayerId = nonSketchLayers.find((l) => l.id === baseId)?.id;
        }
      }

      if (hoveredLayerId === layerId) {
        setHoverInfo(undefined);
      }
    }
  };

  const renderList = () => {
    if (nonSketchLayers.length === 0) {
      return (
        <div className="text-center text-sm text-muted-foreground py-3">
          No Layer Present
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {enableSelection && nonSketchLayers.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 text-[13px] sticky top-0 z-[2] bg-white">
            <label className="flex items-center gap-2 font-medium text-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded -mt-0.5 border-border"
                checked={
                  selectedIds.length > 0 &&
                  selectedIds.length === nonSketchLayers.length
                }
                onChange={toggleSelectAll}
              />
              <span>Select All</span>
            </label>
            <Button
              variant="destructive"
              style={{ zoom: 0.8 }}
              disabled={!selectedIds.length}
              onClick={handleBulkDelete}
              className="p-2 font-[600]"
            >
              Delete ({selectedIds.length || 0})
            </Button>
          </div>
        )}
        <div className="grid gap-3 text-xs">
          {nonSketchLayers
            .sort((a, b) => {
              // Sort by uploadedAt/createdAt timestamp (newest first)
              const aTime = (a as any).uploadedAt || (a as any).createdAt || 0;
              const bTime = (b as any).uploadedAt || (b as any).createdAt || 0;
              return bTime - aTime; // Descending order (newest first)
            })
            .map((layer) => {
              const isSelected = selectedIds.includes(layer.id);
              const uploadedDate = formatDate(
                (layer as any).uploadedAt || (layer as any).createdAt
              );

              return (
                <div
                  key={layer.id}
                  className="relative rounded-2xl border border-border/60 bg-white/90 p-4 shadow-sm"
                >
                  <div className="absolute right-3 top-3 flex items-center gap-1">
                    {/* Don't show bring to top for raster layers (DEM) */}
                    {layer.type !== "dem" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={`Bring to top: ${layer.name}`}
                        onClick={() => bringLayerToTop(layer.id)}
                      >
                        <ArrowUp size={10} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title={`Focus layer: ${layer.name}`}
                      onClick={() => focusLayer(layer.id)}
                    >
                      <LocateFixed size={10} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() =>
                        handleToggleVisibility(
                          layer.id,
                          layer.visible === false
                        )
                      }
                      title={
                        layer.visible === false
                          ? `Show layer: ${layer.name}`
                          : `Hide layer: ${layer.name}`
                      }
                    >
                      {layer.visible === true ? (
                        <EyeIcon size={10} />
                      ) : (
                        <EyeOffIcon size={10} />
                      )}
                    </Button>
                    <LayerPopover layer={layer} updateLayer={updateLayer}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={`Layer settings: ${layer.name}`}
                      >
                        <Settings2 size={10} />
                      </Button>
                    </LayerPopover>
                  </div>

                  <div className="min-w-0 pr-14">
                    <div className="flex items-start gap-2">
                      {enableSelection && (
                        <input
                          type="checkbox"
                          className="mt-0.5 -ml-1 h-4 w-4 rounded border-border"
                          checked={isSelected}
                          onChange={() => toggleSelect(layer.id)}
                        />
                      )}
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-foreground">
                          {layer.name}
                        </div>
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 bg-slate-100">
                          {layer.type}
                        </span>
                      </div>
                    </div>
                    {uploadedDate && (
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Uploaded: {uploadedDate}
                      </div>
                    )}
                    {(() => {
                      // Calculate zoom range if not set (for display only, not saved until user saves)
                      const displayZoomRange =
                        layer.minzoom !== undefined ||
                        layer.maxzoom !== undefined
                          ? {
                              minZoom: layer.minzoom,
                              maxZoom: layer.maxzoom,
                            }
                          : layer.type !== "point"
                          ? calculateLayerZoomRange(layer)
                          : undefined;

                      if (displayZoomRange) {
                        const minZoom =
                          displayZoomRange.minZoom ?? layer.minzoom;
                        const maxZoom =
                          displayZoomRange.maxZoom ?? layer.maxzoom;
                        return (
                          <div className="text-[10px] text-muted-foreground mt-1">
                            Zoom:{" "}
                            {minZoom !== undefined ? minZoom.toFixed(0) : "?"} -{" "}
                            {maxZoom !== undefined ? maxZoom.toFixed(0) : "?"}
                            {(layer.minzoom === undefined ||
                              layer.maxzoom === undefined) && (
                              <span className="text-[9px] text-muted-foreground/70 ml-1">
                                (auto)
                              </span>
                            )}
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    );
  };

  if (variant === "plain") {
    return <div className="space-y-3">{renderList()}</div>;
  }

  return (
    <SidebarGroup>
      {/* Collapsible Header */}
      <SidebarGroupLabel
        className="flex items-center justify-between cursor-pointer select-none font-semibold px-2 py-2.5 rounded-lg hover:bg-accent transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="text-sm">Layers Panel</span>
        {isOpen ? (
          <ChevronDown size={16} className="text-muted-foreground" />
        ) : (
          <ChevronRight size={16} className="text-muted-foreground" />
        )}
      </SidebarGroupLabel>

      {/* Collapsible Content */}
      <SidebarGroupContent
        className={`${
          isOpen ? "block" : "hidden"
        } transition-all max-h-[200px] overflow-y-auto`}
      >
        <div className="space-y-3">{renderList()}</div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default LayersPanel;
