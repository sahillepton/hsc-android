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
  Trash2,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  useFocusLayerRequest,
  useHoverInfo,
  useLayers,
  useIgrsPreference,
} from "@/store/layers-store";
import LayerPopover from "./layer-popover";
import { formatLayerMeasurements } from "@/lib/layers";
import { isSketchLayer } from "@/lib/sketch-layers";

const columnClasses = "text-left text-xs font-semibold text-muted-foreground";

const SketchLayersPanel = ({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
}) => {
  const { layers } = useLayers();
  const useIgrs = useIgrsPreference();
  const { focusLayer, deleteLayer, updateLayer } = useFocusLayerRequest();
  const { hoverInfo, setHoverInfo } = useHoverInfo();

  const sketchLayers = layers.filter(isSketchLayer);

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

      <SidebarGroupContent
        className={`${
          isOpen ? "block" : "hidden"
        } transition-all max-h-[260px] overflow-y-auto`}
      >
        {sketchLayers.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            No sketches yet
          </div>
        ) : (
          <div className="px-1 py-2">
            <div className="overflow-x-auto rounded-lg border border-border/70 bg-card">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className={`${columnClasses} px-3 py-2`}>Layer Name</th>
                    <th className={`${columnClasses} px-3 py-2`}>
                      Measurements
                    </th>
                    <th className={`${columnClasses} px-3 py-2 text-right`}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sketchLayers.map((layer) => {
                    const measurements = formatLayerMeasurements(layer, {
                      useIgrs,
                    });
                    return (
                      <tr
                        key={layer.id}
                        className="border-t border-border/70 text-xs"
                      >
                        <td className="px-3 py-2 align-top">
                          <div className="font-medium text-sm text-foreground">
                            {layer.name}
                          </div>
                          <div className="text-[11px] text-muted-foreground capitalize">
                            {layer.type}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          {measurements.length === 0 ? (
                            <span className="text-muted-foreground text-xs">
                              No measurements
                            </span>
                          ) : (
                            <div className="space-y-1 text-xs">
                              {measurements.map((measurement, index) => (
                                <div
                                  key={`${layer.id}-${measurement.label}-${index}`}
                                  className="flex flex-col"
                                >
                                  <span className="text-muted-foreground">
                                    {measurement.label}
                                  </span>
                                  <span className="font-mono text-[12px] text-foreground">
                                    {measurement.value}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 hover:bg-accent"
                              title={`Focus layer: ${layer.name}`}
                              onClick={() => focusLayer(layer.id)}
                            >
                              <LocateFixed size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 hover:bg-accent"
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
                              {layer.visible === false ? (
                                <EyeIcon size={14} />
                              ) : (
                                <EyeOffIcon size={14} />
                              )}
                            </Button>
                            <LayerPopover
                              layer={layer}
                              updateLayer={updateLayer}
                            >
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 hover:bg-accent"
                                title={`Layer settings: ${layer.name}`}
                              >
                                <Settings2 size={14} />
                              </Button>
                            </LayerPopover>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 hover:bg-accent text-destructive"
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
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default SketchLayersPanel;
