import { useState } from "react";
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

  // Get UDP layer data - only network members
  const networkMembersLayer = udpLayers.find(
    (layer: any) => layer?.id === "udp-network-members-layer"
  );

  const networkMembersData = networkMembersLayer?.props?.data || [];

  // Smooth focus animation: zoom out first, then fly to target with parabolic motion
  const handleFocusLayer = () => {
    setFocusedLayerId("udp-network-members-layer");
    if (!networkMembersData || networkMembersData.length === 0) {
      return;
    }

    const mapRef = (window as any).mapRef;
    if (!mapRef?.current) return;

    const map = mapRef.current.getMap();
    const data = networkMembersData;

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
        value: igrs || `${lat.toFixed(4)}° , ${lng.toFixed(4)}°`,
        isIgrsAvailable: igrs !== null,
      };
    }
    return {
      value: `${lat.toFixed(4)}° , ${lng.toFixed(4)}°`,
      isIgrsAvailable: true, // Not using IGRS, so no issue
    };
  };

  const renderList = () => {
    if (networkMembersData.length === 0) {
      return (
        <div className="text-center text-sm text-muted-foreground py-3">
          No network data yet
        </div>
      );
    }

    const isFocused = focusedLayerId === "udp-network-members-layer";

    return (
      <div className="mb-3">
        <div
          className={`relative rounded-2xl border border-border/60 bg-white/90 p-4 shadow-sm ${
            isFocused ? "border-l-4 border-l-sky-300" : ""
          }`}
        >
          <div className="absolute right-3 top-3 flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Focus Network Members"
              onClick={() => handleFocusLayer()}
            >
              <LocateFixed size={10} />
            </Button>
            <UdpLayerConfigPopover
              layerId="udp-network-members-layer"
              layerName="Network Members"
            />
          </div>

          <div className="min-w-0 pr-14">
            <div className="flex items-start gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                <span className="truncate text-[16px]">Network Members</span>
              </div>
            </div>

            {networkMembersData.length > 0 && (
              <div className="mt-3 border-t border-border/40 pt-3 w-full">
                <div className="border border-border/20 rounded-lg overflow-hidden w-full">
                  <Virtuoso
                    style={{
                      height: `${Math.min(
                        networkMembersData.length * 48 + 2,
                        384
                      )}px`,
                      width: "100% !important",
                    }}
                    data={networkMembersData}
                    increaseViewportBy={200}
                    itemContent={(idx, item: any) => {
                      const globalId = item.globalId ?? item.id ?? idx;
                      const coord = formatCoordinate(
                        item.latitude,
                        item.longitude
                      );

                      return (
                        <div className="py-3 px-3 border-b border-border/20 last:border-b-0 bg-white hover:bg-zinc-50/50 transition-colors">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-[12px] text-black">
                                Global ID:
                              </span>
                              <span className="font-mono text-[12px] text-zinc-500">
                                {globalId}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-[12px] text-black">
                                Location:
                              </span>
                              <span className="font-mono text-[12px] text-zinc-500 flex items-center gap-1">
                                {coord.value}
                                {useIgrs && !coord.isIgrsAvailable && (
                                  <div className="relative group">
                                    <Info
                                      size={12}
                                      className="text-muted-foreground cursor-help"
                                    />
                                    <div className="absolute -left-2 bottom-full mb-1 hidden group-hover:block z-10 bg-black text-white text-[10px] px-2 py-1 rounded whitespace-nowrap">
                                      IGRS not available
                                    </div>
                                  </div>
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
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
