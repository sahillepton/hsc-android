import { useMemo, useState, useEffect } from "react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "../ui/sidebar";
import { ChevronDown, ChevronRight, LocateFixed } from "lucide-react";
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

  // Focus on a UDP layer by calculating bounds
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
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding: { top: 50, bottom: 50, left: 50, right: 50 },
          duration: 1000,
        }
      );
    }
  };

  const formatCoordinate = (lat: number, lng: number) => {
    if (useIgrs) {
      // calculateIgrs expects (longitude, latitude)
      const igrs = calculateIgrs(lng, lat);
      return igrs || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  };

  const renderList = () => {
    if (udpLayerItems.length === 0) {
      return (
        <div className="text-center text-sm text-muted-foreground py-3">
          No network data yet
        </div>
      );
    }

    return (
      <Virtuoso
        style={{
          maxHeight: windowHeight * 0.8,
        }}
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
                      <span className="truncate text-[16px]">{layer.name}</span>
                    </div>
                  </div>

                  {sampleItems.length > 0 && (
                    <div className="mt-3 border-t border-border/40 pt-3">
                      <dt className="text-[14px] font-semibold tracking-wide text-foreground mb-2">
                        Coordinates
                      </dt>
                      <div className="space-y-1">
                        {sampleItems.map((item: any, idx: number) => (
                          <dd
                            key={idx}
                            className="font-mono text-[12px] text-zinc-600"
                          >
                            {item.name || `Item ${idx + 1}`}:{" "}
                            {formatCoordinate(item.latitude, item.longitude)}
                          </dd>
                        ))}
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
