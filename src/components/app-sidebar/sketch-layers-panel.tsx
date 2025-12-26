import { useEffect, useMemo, useState } from "react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "../ui/sidebar";
import {
  ChevronDown,
  ChevronRight,
  EyeIcon,
  EyeOffIcon,
  LocateFixed,
  Settings2,
  Info,
} from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { Button } from "../ui/button";
import {
  useFocusLayerRequest,
  useHoverInfo,
  useLayers,
  useIgrsPreference,
} from "@/store/layers-store";
import LayerPopover from "./layer-popover";
import SketchLayerCardSkeleton from "./sketch-layer-card-skeleton";
import {
  calculateBearingDegrees,
  formatLayerMeasurements,
  normalizeAngleSigned,
  type LayerMeasurement,
} from "@/lib/layers";
import { isSketchLayer } from "@/lib/sketch-layers";
import type { LayerProps } from "@/lib/definitions";

// Component to handle skeleton transition for individual sketch layer items
type SketchLayerCardItemProps = {
  layer: LayerProps;
  isSelected: boolean;
  isFocused: boolean;
  measurements: LayerMeasurement[];
  badgeClass: string;
  enableSelection: boolean;
  useIgrs: boolean;
  onToggleSelect: (layerId: string) => void;
  onToggleVisibility: (layerId: string, visible: boolean) => void;
  onFocusLayer: (layerId: string) => void;
  onUpdateLayer: (layerId: string, layer: LayerProps) => void;
  setFocusedLayerId: (layerId: string | null) => void;
  onItemRendered: (layerId: string) => void;
  isRendered: boolean;
};

const SketchLayerCardItem = ({
  layer,
  isSelected,
  isFocused,
  measurements,
  badgeClass,
  enableSelection,
  onToggleSelect,
  onToggleVisibility,
  onFocusLayer,
  onUpdateLayer,
  setFocusedLayerId,
  onItemRendered,
  isRendered,
}: SketchLayerCardItemProps) => {
  useEffect(() => {
    if (!isRendered) {
      const timeout = setTimeout(() => {
        onItemRendered(layer.id);
      }, 50);
      return () => clearTimeout(timeout);
    }
  }, [layer.id, isRendered, onItemRendered]);

  if (!isRendered) {
    return <SketchLayerCardSkeleton />;
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
                className="mt-1 -ml-1 h-4 w-4 rounded border-border"
                checked={isSelected}
                onChange={() => onToggleSelect(layer.id)}
              />
            )}
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground mb-2">
              <span className="truncate text-[16px] max-w-[200px] overflow-hidden text-ellipsis">
                {layer.name}
                <span
                  className={`text-[10px] ml-2 font-semibold uppercase tracking-wide ${badgeClass}`}
                >
                  {layer.type}
                </span>
              </span>
              <span
                className={`rounded-full text-[10px] font-semibold uppercase tracking-wide ${badgeClass}`}
              ></span>
            </div>
          </div>

          <dl className="mt-3 grid w-full grid-cols-2 gap-x-4 gap-y-2">
            {measurements.length === 0 ? (
              <span className="col-span-2 text-muted-foreground text-xs">
                No measurements
              </span>
            ) : (
              measurements.map((measurement, index) => (
                <div
                  key={`${layer.id}-${measurement.label}-${index}`}
                  className="flex flex-col"
                >
                  <dt className="text-[13px] font-semibold tracking-wide text-foreground mb-2 flex items-center gap-1">
                    {measurement.label.includes("IGRS") &&
                    !measurement.isIgrsUnavailable
                      ? "IGRS"
                      : measurement.label.includes("IGRS") &&
                        measurement.isIgrsUnavailable
                      ? "LAT/LONG"
                      : measurement.label}
                    {measurement.isIgrsUnavailable && (
                      <div className="relative group">
                        <Info
                          size={12}
                          className="text-muted-foreground cursor-help"
                        />
                        <div className="absolute left-0 bottom-full mb-1 hidden group-hover:block z-10 bg-black text-white text-[10px] px-2 py-1 rounded whitespace-nowrap">
                          IGRS not available
                        </div>
                      </div>
                    )}
                  </dt>
                  <dd className="font-mono text-[12px] text-zinc-600">
                    {measurement.value}
                  </dd>
                </div>
              ))
            )}
          </dl>
        </div>
      </div>
    </div>
  );
};

type SketchLayersPanelProps = {
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
  variant?: "accordion" | "plain";
  enableSelection?: boolean;
};

const typeAccent: Record<string, string> = {
  line: "text-blue-600 ",
  polygon: "text-emerald-600",
  point: "text-amber-600",
};

const SketchLayersPanel = ({
  isOpen,
  setIsOpen,
  variant = "accordion",
  enableSelection = false,
}: SketchLayersPanelProps) => {
  const { layers } = useLayers();
  const useIgrs = useIgrsPreference();
  const { focusLayer, deleteLayer, updateLayer } = useFocusLayerRequest();
  const { hoverInfo, setHoverInfo } = useHoverInfo();

  const sketchLayers = useMemo(
    () => layers.filter(isSketchLayer).slice().reverse(),
    [layers]
  );
  const layerIds = useMemo(
    () => sketchLayers.map((layer) => layer.id),
    [sketchLayers]
  );
  const layerIdSignature = useMemo(() => layerIds.join("|"), [layerIds]);
  const layerIdSet = useMemo(() => new Set(layerIds), [layerIds]);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [focusedLayerId, setFocusedLayerId] = useState<string | null>(null);
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight);
  const [renderedItems, setRenderedItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handleResize = () => {
      setWindowHeight(window.innerHeight);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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

  useEffect(() => {
    if (focusedLayerId && !layerIds.includes(focusedLayerId)) {
      setFocusedLayerId(null);
    }
  }, [focusedLayerId, layerIdSignature, layerIds]);

  // Reset rendered items when layers change significantly
  useEffect(() => {
    const layerIdsSet = new Set(layerIds);
    setRenderedItems((prev) => {
      const filtered = new Set(
        Array.from(prev).filter((id) => layerIdsSet.has(id))
      );
      return filtered;
    });
  }, [layerIds.length]);

  const handleItemRendered = (layerId: string) => {
    setRenderedItems((prev) => new Set(prev).add(layerId));
  };

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

  const handleBulkToggleVisibility = () => {
    if (!selectedIds.length) return;

    // Get selected layers
    const selectedLayers = sketchLayers.filter((layer) =>
      selectedIds.includes(layer.id)
    );

    // Toggle each layer individually based on its current state
    selectedLayers.forEach((layer) => {
      // If layer is hidden (visible === false), make it visible (true)
      // If layer is visible (visible !== false), make it hidden (false)
      const newVisibility = layer.visible === false ? true : false;
      handleToggleVisibility(layer.id, newVisibility);
    });
  };

  const handleToggleVisibility = (layerId: string, visible: boolean) => {
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return;

    updateLayer(layerId, {
      ...layer,
      visible,
    });

    if (!visible && hoverInfo) {
      const hoveredObject = hoverInfo.object;
      let hoveredLayerId: string | undefined;

      if ((hoveredObject as any)?.layerId) {
        hoveredLayerId = (hoveredObject as any).layerId;
      } else if ((hoveredObject as any)?.id && (hoveredObject as any)?.type) {
        hoveredLayerId = (hoveredObject as any).id;
      } else if (hoverInfo.layer?.id) {
        const deckLayerId = hoverInfo.layer.id;
        hoveredLayerId =
          layers.find((l) => l.id === deckLayerId)?.id ??
          layers.find(
            (l) =>
              deckLayerId.startsWith(l.id) ||
              deckLayerId.startsWith(`${l.id}-icon-layer`) ||
              deckLayerId.startsWith(`${l.id}-signal-overlay`) ||
              deckLayerId.startsWith(`${l.id}-bitmap`)
          )?.id;
      }

      if (hoveredLayerId === layerId) {
        setHoverInfo(undefined);
      }
    }
  };

  const renderList = () => {
    if (sketchLayers.length === 0) {
      return (
        <div className="text-center text-sm text-muted-foreground py-3">
          No sketches yet
        </div>
      );
    }

    // Calculate height based on number of layers, capped at 90% of screen height
    const estimatedItemHeight = 300; // Estimated height per item in pixels
    const calculatedHeight = sketchLayers.length * estimatedItemHeight + 32; // 24px for padding
    const maxHeight = windowHeight * 0.9;
    const dynamicHeight = Math.min(calculatedHeight, maxHeight);

    return (
      <div className="overflow-y-auto" style={{ height: `${dynamicHeight}px` }}>
        <Virtuoso
          style={{
            height: `100%`,
          }}
          data={sketchLayers}
          increaseViewportBy={280}
          components={{
            Footer: () => <div style={{ height: "180px" }} />, // Add bottom padding to ensure last item is fully visible
          }}
          itemContent={(_, layer) => {
            const azimuthAngle =
              layer.type === "azimuth" &&
              layer.azimuthCenter &&
              layer.azimuthTarget
                ? normalizeAngleSigned(
                    calculateBearingDegrees(
                      layer.azimuthCenter,
                      layer.azimuthTarget
                    )
                  )
                : normalizeAngleSigned(layer.azimuthAngleDeg ?? 0);

            const measurements = formatLayerMeasurements(
              layer.type === "azimuth"
                ? { ...layer, azimuthAngleDeg: azimuthAngle }
                : layer,
              { useIgrs }
            );
            const badgeClass =
              typeAccent[layer.type] ?? "text-slate-600 bg-slate-100";
            const isSelected = selectedIds.includes(layer.id);
            const isFocused = focusedLayerId === layer.id;
            const isRendered = renderedItems.has(layer.id);

            return (
              <SketchLayerCardItem
                layer={layer}
                isSelected={isSelected}
                isFocused={isFocused}
                measurements={measurements}
                badgeClass={badgeClass}
                enableSelection={enableSelection}
                useIgrs={useIgrs}
                onToggleSelect={toggleSelect}
                onToggleVisibility={handleToggleVisibility}
                onFocusLayer={focusLayer}
                onUpdateLayer={updateLayer}
                setFocusedLayerId={setFocusedLayerId}
                onItemRendered={handleItemRendered}
                isRendered={isRendered}
              />
            );
          }}
        />
      </div>
    );
  };

  if (variant === "plain") {
    return (
      <div className="space-y-3 overflow-hidden">
        {enableSelection && sketchLayers.length > 0 && (
          <div className="flex items-center justify-between px-0 py-2 text-[13px] sticky top-0 z-10 bg-background mb-4">
            <label className="flex items-center gap-2 font-medium text-foreground pl-[2%] pr-[2%]">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border"
                checked={
                  selectedIds.length > 0 &&
                  selectedIds.length === sketchLayers.length
                }
                onChange={toggleSelectAll}
              />
              <span>Select All</span>
            </label>
            <div className="flex items-center gap-2">
              <Button
                style={{ zoom: 0.8, backgroundColor: "#3b82f6" }}
                disabled={!selectedIds.length}
                onClick={handleBulkToggleVisibility}
                className="p-2 font-semibold text-white hover:bg-blue-600"
              >
                Toggle visibility
              </Button>
              <Button
                variant="destructive"
                style={{ zoom: 0.8 }}
                disabled={!selectedIds.length}
                onClick={handleBulkDelete}
                className="p-2 font-semibold"
              >
                Delete ({selectedIds.length || 0})
              </Button>
            </div>
          </div>
        )}
        {renderList()}
      </div>
    );
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel
        className="flex items-center justify-between cursor-pointer select-none font-semibold px-2 py-2.5 rounded-lg hover:bg-accent transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="text-sm">Sketch Layers</span>
        {isOpen ? (
          <ChevronDown size={16} className="text-muted-foreground" />
        ) : (
          <ChevronRight size={16} className="text-muted-foreground" />
        )}
      </SidebarGroupLabel>

      {/* Sticky header outside scrollable container */}
      {enableSelection && sketchLayers.length > 0 && isOpen && (
        <div className="flex items-center justify-between px-3 py-2 text-[13px] sticky top-0 z-10 bg-background mb-4">
          <label className="flex items-center gap-2 font-medium text-foreground pl-[2%] pr-[2%]">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={
                selectedIds.length > 0 &&
                selectedIds.length === sketchLayers.length
              }
              onChange={toggleSelectAll}
            />
            <span>Select All</span>
          </label>
          <div className="flex items-center gap-2">
            <Button
              style={{ zoom: 0.8, backgroundColor: "#3b82f6" }}
              disabled={!selectedIds.length}
              onClick={handleBulkToggleVisibility}
              className="p-2 font-semibold text-white hover:bg-blue-600"
            >
              Toggle visibility
            </Button>
            <Button
              variant="destructive"
              style={{ zoom: 0.8 }}
              disabled={!selectedIds.length}
              onClick={handleBulkDelete}
              className="p-2 font-semibold"
            >
              Delete ({selectedIds.length || 0})
            </Button>
          </div>
        </div>
      )}

      <SidebarGroupContent
        className={`${isOpen ? "block" : "hidden"} transition-all relative`}
      >
        {renderList()}
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default SketchLayersPanel;
