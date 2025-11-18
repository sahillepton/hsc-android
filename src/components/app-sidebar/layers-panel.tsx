import {
  ChevronDown,
  ChevronRight,
  EyeIcon,
  EyeOffIcon,
  LocateFixed,
  X,
  Settings2,
} from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "../ui/sidebar";
import { Button } from "../ui/button";
import { useLayers, useFocusLayerRequest } from "@/store/layers-store";
import LayerPopover from "./layer-popover";

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
        className={`${isLayersOpen ? "block" : "hidden"} transition-all`}
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
                      title="Focus layer"
                      onClick={() => focusLayer(layer.id)}
                    >
                      <LocateFixed size={14} />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 hover:bg-accent"
                      onClick={() =>
                        updateLayer(layer.id, {
                          ...layer,
                          visible: layer.visible !== false ? false : true,
                        })
                      }
                      title={layer.visible ? "Hide layer" : "Show layer"}
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
                        title="Layer settings"
                      >
                        <Settings2 size={14} />
                      </Button>
                    </LayerPopover>

                    {!isProgressiveLayer && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                        title="Delete layer"
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
                        <X size={14} />
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
