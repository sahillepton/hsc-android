import { useEffect, useState } from "react";
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
} from "lucide-react";
import { Button } from "../ui/button";
import {
  useFocusLayerRequest,
  useHoverInfo,
  useLayers,
  useIgrsPreference,
} from "@/store/layers-store";
import LayerPopover from "./layer-popover";
import {
  calculateBearingDegrees,
  formatLayerMeasurements,
  normalizeAngleSigned,
} from "@/lib/layers";
import { isSketchLayer } from "@/lib/sketch-layers";

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

  const sketchLayers = layers.filter(isSketchLayer).slice().reverse();
  const layerIds = sketchLayers.map((layer) => layer.id);
  const layerIdSignature = layerIds.join("|");
  const layerIdSet = new Set(layerIds);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [focusedLayerId, setFocusedLayerId] = useState<string | null>(null);

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

    return (
      <div className="grid gap-3 text-xs">
        {sketchLayers.map((layer) => {
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
          return (
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
                    focusLayer(layer.id);
                  }}
                >
                  <LocateFixed size={10} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() =>
                    handleToggleVisibility(layer.id, layer.visible === false)
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
                      className="mt-1 -ml-1 h-4 w-4 rounded border-border"
                      checked={isSelected}
                      onChange={() => toggleSelect(layer.id)}
                    />
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground mb-2">
                    <span className="truncate text-[16px]">
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
                        <dt className="text-[13px] font-semibold tracking-wide text-foreground mb-2">
                          {measurement.label}
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
          );
        })}
      </div>
    );
  };

  if (variant === "plain") {
    return (
      <div className="space-y-3">
        {enableSelection && sketchLayers.length > 0 && (
          <div className="flex items-center justify-between px-0 py-2 text-[13px] sticky top-0 z-10 bg-background mb-4">
            <label className="flex items-center gap-2 font-medium text-foreground">
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
          <label className="flex items-center gap-2 font-medium text-foreground">
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
        className={`${
          isOpen ? "block" : "hidden"
        } transition-all max-h-[260px] overflow-y-auto relative`}
      >
        {/* Top fade gradient */}
        <div className="sticky top-0 h-6 bg-gradient-to-b from-background to-transparent pointer-events-none z-20 -mt-1" />
        <div className="space-y-3">{renderList()}</div>
        {/* Bottom fade gradient */}
        <div className="sticky bottom-0 h-6 bg-gradient-to-t from-background to-transparent pointer-events-none z-20 -mb-1" />
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default SketchLayersPanel;
