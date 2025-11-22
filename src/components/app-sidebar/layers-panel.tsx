import {
  ChevronDown,
  ChevronRight,
  EyeIcon,
  EyeOffIcon,
  LocateFixed,
  Trash2,
  Settings2,
  ArrowUp,
} from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "../ui/sidebar";
import { Button } from "../ui/button";
import {
  useLayers,
  useFocusLayerRequest,
  useHoverInfo,
} from "@/store/layers-store";
import LayerPopover from "./layer-popover";

const LayersPanel = ({
  setIsLayersOpen,
  isLayersOpen,
}: {
  setIsLayersOpen: (isOpen: boolean) => void;
  isLayersOpen: boolean;
}) => {
  const { layers, bringLayerToTop } = useLayers();
  const { focusLayer, deleteLayer, updateLayer } = useFocusLayerRequest();
  const { hoverInfo, setHoverInfo } = useHoverInfo();
  return (
    <SidebarGroup>
      {/* Collapsible Header */}
      <SidebarGroupLabel
        className="flex items-center justify-between cursor-pointer select-none font-semibold px-2 py-2.5 rounded-lg hover:bg-accent transition-colors"
        onClick={() => setIsLayersOpen(!isLayersOpen)}
      >
        <span className="text-sm">Layers Panel</span>
        {isLayersOpen ? (
          <ChevronDown size={16} className="text-muted-foreground" />
        ) : (
          <ChevronRight size={16} className="text-muted-foreground" />
        )}
      </SidebarGroupLabel>

      {/* Collapsible Content */}
      <SidebarGroupContent
        className={`${
          isLayersOpen ? "block" : "hidden"
        } transition-all max-h-[200px] overflow-y-auto`}
      >
        {layers.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            No Layer Present
          </div>
        ) : (
          <SidebarMenu className="space-y-2 mt-2">
            {layers.map((layer) => {
              const isProgressiveLayer = (layer.name || "").startsWith(
                "Progressive Network"
              );

              return (
                <SidebarMenuItem
                  key={layer.id}
                  className="flex items-center justify-between px-3 py-2 rounded-lg border border-border/50 hover:bg-accent/40 transition-colors"
                >
                  {/* Layer Info */}
                  <div className="flex flex-col flex-1 truncate">
                    <span className="text-sm font-medium truncate">
                      {layer.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {layer.type}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 hover:bg-accent"
                      title={`Focus layer: ${layer.name}`}
                      onClick={() => focusLayer(layer.id)}
                    >
                      <LocateFixed size={14} />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 hover:bg-accent"
                      onClick={() => {
                        const newVisible =
                          layer.visible !== false ? false : true;
                        updateLayer(layer.id, {
                          ...layer,
                          visible: newVisible,
                        });
                        // Close tooltip if the layer being hidden is currently being hovered
                        if (!newVisible && hoverInfo) {
                          // Check if the hovered object belongs to this layer
                          const hoveredObject = hoverInfo.object;
                          let hoveredLayerId: string | undefined;

                          if ((hoveredObject as any)?.layerId) {
                            hoveredLayerId = (hoveredObject as any).layerId;
                          } else if (
                            (hoveredObject as any)?.id &&
                            (hoveredObject as any)?.type
                          ) {
                            hoveredLayerId = (hoveredObject as any).id;
                          } else if (hoverInfo.layer?.id) {
                            const deckLayerId = hoverInfo.layer.id;
                            hoveredLayerId = layers.find(
                              (l) => l.id === deckLayerId
                            )?.id;
                            if (!hoveredLayerId) {
                              const baseId = deckLayerId
                                .replace(/-icon-layer$/, "")
                                .replace(/-signal-overlay$/, "")
                                .replace(/-bitmap$/, "");
                              hoveredLayerId = layers.find(
                                (l) => l.id === baseId
                              )?.id;
                            }
                          }

                          if (hoveredLayerId === layer.id) {
                            setHoverInfo(undefined);
                          }
                        }
                      }}
                      title={
                        layer.visible
                          ? `Hide layer: ${layer.name}`
                          : `Show layer: ${layer.name}`
                      }
                    >
                      {layer.visible ? (
                        <EyeIcon size={14} />
                      ) : (
                        <EyeOffIcon size={14} />
                      )}
                    </Button>

                    {/* Settings (popover) */}
                    <LayerPopover layer={layer} updateLayer={updateLayer}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-accent"
                        title={`Layer settings: ${layer.name}`}
                      >
                        <Settings2 size={14} />
                      </Button>
                    </LayerPopover>

                    {/* Bring to Top */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 hover:bg-accent"
                      title={`Bring to top: ${layer.name}`}
                      onClick={() => bringLayerToTop(layer.id)}
                    >
                      <ArrowUp size={14} />
                    </Button>

                    {!isProgressiveLayer && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-accent"
                        title={`Delete layer: ${layer.name}`}
                        onClick={() => {
                          if (
                            confirm(
                              `Are you sure you want to delete "${layer.name}"?`
                            )
                          ) {
                            deleteLayer(layer.id);
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default LayersPanel;
