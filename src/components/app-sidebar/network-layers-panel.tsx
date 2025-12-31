import { useMemo, useState, useEffect } from "react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "../ui/sidebar";
import { ChevronDown, ChevronRight, LocateFixed, Info } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { Button } from "../ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "../ui/label";
import {
  useNetworkLayersVisible,
  useIgrsPreference,
} from "@/store/layers-store";
import { useUdpLayers } from "@/components/map/udp-layers";
import UdpLayerConfigPopover from "./udp-layer-config-popover";
import { calculateIgrs } from "@/lib/utils";

type NetworkLayersPanelProps = {
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
  variant?: "accordion" | "plain";
  enableSelection?: boolean;
};

const NetworkLayersPanel = ({
  isOpen,
  setIsOpen,
  variant = "accordion",
}: NetworkLayersPanelProps) => {
  const { networkLayersVisible, setNetworkLayersVisible } =
    useNetworkLayersVisible();
  const { udpLayers } = useUdpLayers();
  const useIgrs = useIgrsPreference();
  const [focusedLayerId, setFocusedLayerId] = useState<string | null>(null);
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight);

  useEffect(() => {
    const handleResize = () => {
      setWindowHeight(window.innerHeight);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Get UDP layer data
  const networkMembersLayer = udpLayers.find(
    (layer: any) => layer?.id === "udp-network-members-layer"
  );
  const targetsLayer = udpLayers.find(
    (layer: any) => layer?.id === "udp-targets-layer"
  );

  const networkMembersData = networkMembersLayer?.props?.data || [];
  const targetsData = targetsLayer?.props?.data || [];

  const udpLayerItems = useMemo(
    () =>
      [
        {
          id: "udp-network-members-layer",
          name: "Network Members",
          type: "network-members",
          count: networkMembersData.length,
          data: networkMembersData,
        },
        {
          id: "udp-targets-layer",
          name: "Targets",
          type: "targets",
          count: targetsData.length,
          data: targetsData,
        },
      ].filter((item) => item.count > 0),
    [networkMembersData, targetsData]
  );

  // Smooth focus animation: zoom out first, then fly to target with parabolic motion
  const handleFocusLayer = (layerId: string) => {
    setFocusedLayerId(layerId);
    const layer = udpLayers.find((l: any) => l?.id === layerId);
    if (!layer || !layer.props?.data || layer.props.data.length === 0) {
      return;
    }

    const mapRef = (window as any).mapRef;
    if (!mapRef?.current) return;

    const map = mapRef.current.getMap();
    const data = layer.props.data;

    // Calculate bounds from data
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    data.forEach((item: any) => {
      if (item.longitude !== undefined && item.latitude !== undefined) {
        minLng = Math.min(minLng, item.longitude);
        maxLng = Math.max(maxLng, item.longitude);
        minLat = Math.min(minLat, item.latitude);
        maxLat = Math.max(maxLat, item.latitude);
      }
    });

    if (
      minLng !== Infinity &&
      maxLng !== -Infinity &&
      minLat !== Infinity &&
      maxLat !== -Infinity
    ) {
      const currentZoom = map.getZoom();
      const currentBounds = map.getBounds();

      // Check if current view already contains the bounds
      const boundsContained =
        currentBounds.getWest() <= minLng &&
        currentBounds.getEast() >= maxLng &&
        currentBounds.getSouth() <= minLat &&
        currentBounds.getNorth() >= maxLat;
      const zoomDiff = Math.abs(currentZoom - 12); // Rough check
      const isAlreadyFocused = boundsContained && zoomDiff < 1;

      if (isAlreadyFocused) {
        // Already focused, don't animate
        return;
      }

      // Use fitBounds with smooth animation to show the entire bounding box
      // Stop any ongoing animations first to prevent jitter
      map.stop();
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding: { top: 50, bottom: 50, left: 50, right: 50 },
          duration: 2000, // Smooth, slower duration
          maxZoom: 12,
          linear: false, // Use default easing (smooth)
        }
      );
    }
  };

  const formatCoordinate = (lat: number, lng: number) => {
    if (useIgrs) {
      // calculateIgrs expects (longitude, latitude)
      const igrs = calculateIgrs(lng, lat);
      return {
        value: igrs || `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`,
        isIgrsAvailable: igrs !== null,
      };
    }
    return {
      value: `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`,
      isIgrsAvailable: true, // Not using IGRS, so no issue
    };
  };

  const renderList = () => {
    if (udpLayerItems.length === 0) {
      return (
        <div className="text-center text-sm text-muted-foreground py-3">
          No network data yet
        </div>
      );
    }

    // Calculate height based on number of layers, capped at 90% of screen height
    const estimatedItemHeight = 200; // Estimated height per item in pixels
    const calculatedHeight = udpLayerItems.length * estimatedItemHeight + 24; // 24px for padding
    const maxHeight = windowHeight * 0.9;
    const dynamicHeight = Math.min(calculatedHeight, maxHeight);

    return (
      <div className="overflow-y-auto" style={{ height: `${dynamicHeight}px` }}>
        <Virtuoso
          style={{ height: "100%" }}
          data={udpLayerItems}
          increaseViewportBy={280}
          itemContent={(_, layer) => {
            // Get sample items for display (max 3)
            const sampleItems = layer.data.slice(0, 3);
            const isFocused = focusedLayerId === layer.id;

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
                      onClick={() => handleFocusLayer(layer.id)}
                    >
                      <LocateFixed size={10} />
                    </Button>
                    <UdpLayerConfigPopover
                      layerId={layer.id}
                      layerName={layer.name}
                    />
                  </div>

                  <div className="min-w-0 pr-14">
                    <div className="flex items-start gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="truncate text-[16px]">
                          {layer.name}
                        </span>
                      </div>
                    </div>

                    {sampleItems.length > 0 && (
                      <div className="mt-3 border-t border-border/40 pt-3">
                        <dt className="text-[14px] font-semibold tracking-wide text-foreground mb-2 flex items-center gap-1">
                          {useIgrs ? "IGRS" : "Coordinates"}
                        </dt>
                        <div className="space-y-1">
                          {sampleItems.map((item: any, idx: number) => {
                            const coord = formatCoordinate(
                              item.latitude,
                              item.longitude
                            );
                            return (
                              <dd
                                key={idx}
                                className="font-mono text-[12px] text-zinc-600 flex items-center gap-1"
                              >
                                <span>
                                  {item.name || `Item ${idx + 1}`}:{" "}
                                  {coord.value}
                                </span>
                                {useIgrs && !coord.isIgrsAvailable && (
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
                              </dd>
                            );
                          })}
                          {layer.count > 3 && (
                            <dd className="text-[12px] text-zinc-600 italic">
                              ...and {layer.count - 3} more
                            </dd>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          }}
        />
      </div>
    );
  };

  if (variant === "plain") {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between px-3 py-2">
          <label className="flex items-center gap-2 font-medium text-foreground text-sm">
            <Switch
              id="show-network-layers-panel"
              checked={networkLayersVisible}
              onCheckedChange={setNetworkLayersVisible}
            />
            <Label htmlFor="show-network-layers-panel">
              Show Network Layers
            </Label>
          </label>
        </div>
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
        <span className="text-sm">Network Layers</span>
        {isOpen ? (
          <ChevronDown size={16} className="text-muted-foreground" />
        ) : (
          <ChevronRight size={16} className="text-muted-foreground" />
        )}
      </SidebarGroupLabel>

      <SidebarGroupContent
        className={`${isOpen ? "block" : "hidden"} transition-all relative`}
      >
        {renderList()}
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default NetworkLayersPanel;
