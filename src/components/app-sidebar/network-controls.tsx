import { ChevronDown, ChevronRight, LocateFixed } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "../ui/sidebar";
import { useNetworkLayersVisible } from "@/store/layers-store";
import { Switch } from "@/components/ui/switch";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import { useUdpLayers } from "@/components/map/udp-layers";
import UdpLayerConfigPopover from "./udp-layer-config-popover";

const NetworkControls = ({
  setIsNetworkControlsOpen,
  isNetworkControlsOpen,
}: {
  setIsNetworkControlsOpen: (isOpen: boolean) => void;
  isNetworkControlsOpen: boolean;
}) => {
  const { networkLayersVisible, setNetworkLayersVisible } =
    useNetworkLayersVisible();
  const { udpLayers } = useUdpLayers();

  // Get UDP layer data counts
  const networkMembersLayer = udpLayers.find(
    (layer: any) => layer?.id === "udp-network-members-layer"
  );
  const targetsLayer = udpLayers.find(
    (layer: any) => layer?.id === "udp-targets-layer"
  );

  const networkMembersCount = networkMembersLayer?.props?.data?.length || 0;
  const targetsCount = targetsLayer?.props?.data?.length || 0;

  // Focus on a UDP layer by calculating bounds
  const handleFocusLayer = (layerId: string) => {
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

  const udpLayerItems = [
    {
      id: "udp-network-members-layer",
      name: "Network Members",
      count: networkMembersCount,
      visible: networkLayersVisible && networkMembersCount > 0,
    },
    {
      id: "udp-targets-layer",
      name: "Targets",
      count: targetsCount,
      visible: networkLayersVisible && targetsCount > 0,
    },
  ].filter((item) => item.count > 0);

  return (
    <SidebarGroup>
      {/* Group Label */}
      <SidebarGroupLabel
        className="flex items-center justify-between p-0 cursor-pointer select-none font-semibold px-2 py-2.5 rounded-lg hover:bg-accent transition-colors"
        onClick={() => setIsNetworkControlsOpen(!isNetworkControlsOpen)}
      >
        <span className="text-sm">Network Controls</span>
        {isNetworkControlsOpen ? (
          <ChevronDown size={16} className="text-muted-foreground" />
        ) : (
          <ChevronRight size={16} className="text-muted-foreground" />
        )}
      </SidebarGroupLabel>

      {/* Collapsible Content */}
      <SidebarGroupContent
        className={`${
          isNetworkControlsOpen ? "block" : "hidden"
        } transition-all`}
      >
        <SidebarMenu className="space-y-2 mt-2 px-3">
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-network-layers"
                  checked={networkLayersVisible}
                  onCheckedChange={setNetworkLayersVisible}
                />
                <Label htmlFor="show-network-layers">Show Network Layers</Label>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* UDP Layers List */}
        {udpLayerItems.length > 0 && (
          <SidebarMenu className="space-y-2 mt-2">
            {udpLayerItems.map((layer) => (
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
                    {layer.count} {layer.count === 1 ? "item" : "items"}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-accent"
                    title={`Focus layer: ${layer.name}`}
                    onClick={() => handleFocusLayer(layer.id)}
                  >
                    <LocateFixed size={14} />
                  </Button>

                  <UdpLayerConfigPopover
                    layerId={layer.id}
                    layerName={layer.name}
                  />
                </div>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default NetworkControls;
