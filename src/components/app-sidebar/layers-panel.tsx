import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from "../ui/sidebar";
import {
  useLayers,
  useFocusLayerRequest,
  useHoverInfo,
} from "@/store/layers-store";
import { isSketchLayer } from "@/lib/sketch-layers";
import LayersList from "./layers-list";

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

  if (variant === "plain") {
    return (
      <LayersList
        layers={nonSketchLayers}
        enableSelection={enableSelection}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        onBulkDelete={handleBulkDelete}
        onToggleVisibility={handleToggleVisibility}
        onFocusLayer={focusLayer}
        onBringToTop={bringLayerToTop}
        onUpdateLayer={updateLayer}
      />
    );
  }

  return (
    <SidebarGroup>
      {/* Collapsible Header */}
      <SidebarGroupLabel
        className="flex items-center justify-between cursor-pointer select-none font-semibold py-2.5 rounded-lg hover:bg-accent transition-colors"
        style={{ paddingLeft: "2%", paddingRight: "2%" }}
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
        } transition-all overflow-hidden relative`}
      >
        {/* Top fade gradient */}
        <div className="sticky top-0 h-6 bg-gradient-to-b from-background to-transparent pointer-events-none z-20 -mt-1" />
        <LayersList
          layers={nonSketchLayers}
          enableSelection={enableSelection}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onBulkDelete={handleBulkDelete}
          onToggleVisibility={handleToggleVisibility}
          onFocusLayer={focusLayer}
          onBringToTop={bringLayerToTop}
          onUpdateLayer={updateLayer}
        />
        {/* Bottom fade gradient */}
        <div className="sticky bottom-0 h-6 bg-gradient-to-t from-background to-transparent pointer-events-none z-20 -mb-1" />
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default LayersPanel;
