import { useState, useRef, useEffect } from "react";
import {
  EyeIcon,
  EyeOffIcon,
  LocateFixed,
  Settings2,
  ArrowUp,
} from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { Button } from "../ui/button";
import LayerPopover from "./layer-popover";
import LayerCardSkeleton from "./layer-card-skeleton";
import type { LayerProps } from "@/lib/definitions";

// Component to handle skeleton transition for individual layer items
type LayerCardItemProps = {
  layer: LayerProps;
  isSelected: boolean;
  isFocused: boolean;
  uploadedDate: string | null;
  enableSelection: boolean;
  onToggleSelect: (layerId: string) => void;
  onToggleVisibility: (layerId: string, visible: boolean) => void;
  onFocusLayer: (layerId: string) => void;
  onBringToTop: (layerId: string) => void;
  onUpdateLayer: (layerId: string, layer: LayerProps) => void;
  setFocusedLayerId: (layerId: string | null) => void;
  onItemRendered: (layerId: string) => void;
  isRendered: boolean;
};

const LayerCardItem = ({
  layer,
  isSelected,
  isFocused,
  uploadedDate,
  enableSelection,
  onToggleSelect,
  onToggleVisibility,
  onFocusLayer,
  onBringToTop,
  onUpdateLayer,
  setFocusedLayerId,
  onItemRendered,
  isRendered,
}: LayerCardItemProps) => {
  useEffect(() => {
    if (!isRendered) {
      const timeout = setTimeout(() => {
        onItemRendered(layer.id);
      }, 50);
      return () => clearTimeout(timeout);
    }
  }, [layer.id, isRendered, onItemRendered]);

  if (!isRendered) {
    return <LayerCardSkeleton />;
  }

  return (
    <div className="mb-3">
      <div
        key={layer.id}
        className={`relative rounded-2xl border border-border/60 bg-white/90 p-4 shadow-sm ${
          isFocused ? "border-l-4 border-l-sky-300" : ""
        }`}
      >
        <div className="absolute right-3 top-3 flex items-center gap-1">
          {/* Don't show bring to top for raster layers (DEM) */}
          {layer.type !== "dem" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title={`Bring to top: ${layer.name}`}
              onClick={() => onBringToTop(layer.id)}
            >
              <ArrowUp size={10} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={`Focus layer: ${layer.name}`}
            onClick={() => {
              setFocusedLayerId(layer.id);
              onFocusLayer(layer.id);
            }}
          >
            <LocateFixed size={10} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() =>
              onToggleVisibility(layer.id, layer.visible === false)
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
          <LayerPopover layer={layer} updateLayer={onUpdateLayer}>
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
                onChange={() => onToggleSelect(layer.id)}
              />
            )}
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-ellipsis max-w-[200px] overflow-hidden text-foreground">
                {layer.name}
              </div>
            </div>
          </div>
          {uploadedDate && (
            <div className="text-[10px] text-muted-foreground mt-1">
              Uploaded: {uploadedDate}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

type LayersListProps = {
  layers: LayerProps[];
  enableSelection?: boolean;
  selectedIds: string[];
  onToggleSelect: (layerId: string) => void;
  onToggleSelectAll: () => void;
  onBulkDelete: () => void;
  onToggleVisibility: (layerId: string, visible: boolean) => void;
  onFocusLayer: (layerId: string) => void;
  onBringToTop: (layerId: string) => void;
  onUpdateLayer: (layerId: string, layer: LayerProps) => void;
};

const LayersList = ({
  layers,
  enableSelection = false,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onBulkDelete,
  onToggleVisibility,
  onFocusLayer,
  onBringToTop,
  onUpdateLayer,
}: LayersListProps) => {
  const [searchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight);
  const [focusedLayerId, setFocusedLayerId] = useState<string | null>(null);
  const [renderedItems, setRenderedItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handleResize = () => {
      setWindowHeight(window.innerHeight);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Clear focused layer if it's no longer in the list
  useEffect(() => {
    if (focusedLayerId && !layers.find((l) => l.id === focusedLayerId)) {
      setFocusedLayerId(null);
    }
  }, [focusedLayerId, layers]);

  // Reset rendered items when layers change significantly
  useEffect(() => {
    const layerIds = new Set(layers.map((l) => l.id));
    setRenderedItems((prev) => {
      const filtered = new Set(
        Array.from(prev).filter((id) => layerIds.has(id))
      );
      return filtered;
    });
  }, [layers.length]);

  const handleItemRendered = (layerId: string) => {
    setRenderedItems((prev) => new Set(prev).add(layerId));
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

  // Filter layers based on search query
  const filteredLayers = layers.filter((layer) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      layer.name.toLowerCase().includes(query) ||
      layer.type.toLowerCase().includes(query)
    );
  });

  const handleBulkToggleVisibility = () => {
    if (!selectedIds.length) return;

    // Get selected layers
    const selectedLayers = layers.filter((layer) =>
      selectedIds.includes(layer.id)
    );

    // Toggle each layer individually based on its current state
    selectedLayers.forEach((layer) => {
      // If layer is hidden (visible === false), make it visible (true)
      // If layer is visible (visible !== false), make it hidden (false)
      const newVisibility = layer.visible === false ? true : false;
      onToggleVisibility(layer.id, newVisibility);
    });
  };

  return (
    <>
      {/* Sticky header outside scrollable container */}
      {enableSelection && filteredLayers.length > 0 && (
        <div className="flex items-center justify-between px-3 py-2 text-[13px] sticky top-0 z-10 bg-background mb-4">
          <label className="flex items-center gap-2 font-medium text-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 rounded -mt-0.5 border-border"
              checked={
                selectedIds.length > 0 &&
                selectedIds.length === filteredLayers.length &&
                filteredLayers.every((layer) => selectedIds.includes(layer.id))
              }
              onChange={onToggleSelectAll}
            />
            <span>Select All</span>
          </label>
          <div className="flex items-center gap-2">
            <Button
              style={{ zoom: 0.8, backgroundColor: "#3b82f6" }}
              disabled={!selectedIds.length}
              onClick={handleBulkToggleVisibility}
              className="p-2 font-[600] text-white hover:bg-blue-600"
            >
              Toggle visibility
            </Button>
            <Button
              variant="destructive"
              style={{ zoom: 0.8 }}
              disabled={!selectedIds.length}
              onClick={onBulkDelete}
              className="p-2 font-[600]"
            >
              Delete ({selectedIds.length || 0})
            </Button>
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className="space-y-3 flex-1 flex flex-col min-h-0"
      >
        {/* Search Bar */}
        {/* <div className="px-3">
        <div className="relative">
          <Search className="transform absolute top-3.5 left-2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search layers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div> */}
        {filteredLayers.length === 0 && searchQuery.trim() && (
          <div className="text-center text-sm text-muted-foreground py-3 px-3">
            No layers found matching "{searchQuery}"
          </div>
        )}
        {filteredLayers.length === 0 && !searchQuery.trim() && (
          <div className="text-center text-sm text-muted-foreground py-3 px-3">
            No Layer Present
          </div>
        )}
        {filteredLayers.length > 0 && (
          <div
            className="overflow-y-auto"
            style={{
              height: `${Math.min(
                filteredLayers.length * 120 + 24,
                windowHeight * 0.9
              )}px`,
            }}
          >
            <Virtuoso
              style={{ height: "100%" }}
              data={filteredLayers.sort((a, b) => {
                // Sort by uploadedAt/createdAt timestamp (newest first)
                const aTime =
                  (a as any).uploadedAt || (a as any).createdAt || 0;
                const bTime =
                  (b as any).uploadedAt || (b as any).createdAt || 0;
                return bTime - aTime; // Descending order (newest first)
              })}
              increaseViewportBy={280}
              itemContent={(_, layer) => {
                const isSelected = selectedIds.includes(layer.id);
                const uploadedDate = formatDate(
                  (layer as any).uploadedAt || (layer as any).createdAt
                );
                const isFocused = focusedLayerId === layer.id;
                const isRendered = renderedItems.has(layer.id);

                return (
                  <LayerCardItem
                    layer={layer}
                    isSelected={isSelected}
                    isFocused={isFocused}
                    uploadedDate={uploadedDate}
                    enableSelection={enableSelection}
                    onToggleSelect={onToggleSelect}
                    onToggleVisibility={onToggleVisibility}
                    onFocusLayer={onFocusLayer}
                    onBringToTop={onBringToTop}
                    onUpdateLayer={onUpdateLayer}
                    setFocusedLayerId={setFocusedLayerId}
                    onItemRendered={handleItemRendered}
                    isRendered={isRendered}
                  />
                );
              }}
            />
          </div>
        )}
      </div>
    </>
  );
};

export default LayersList;
