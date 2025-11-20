import { useEffect, useMemo, useRef, useState } from "react";
import { IconLayer } from "@deck.gl/layers";
import { useNetworkLayersVisible } from "@/store/layers-store";
import { useUdpSymbolsStore } from "@/store/udp-symbols-store";

interface UdpLayerData {
  targets: any[];
  networkMembers: any[];
}

export const useUdpLayers = (onHover?: (info: any) => void) => {
  const [udpData, setUdpData] = useState<UdpLayerData>({
    targets: [],
    networkMembers: [],
  });
  const { networkLayersVisible } = useNetworkLayersVisible();
  const { getNodeSymbol, nodeSymbols } = useUdpSymbolsStore();
  const wsRef = useRef<WebSocket | null>(null);

  // Manage WebSocket connection based on networkLayersVisible
  useEffect(() => {
    if (!networkLayersVisible) {
      // Close WebSocket and clear data when network layers are hidden
      if (wsRef.current) {
        const ws = wsRef.current;
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          console.log(
            "🔌 Closing WebSocket connection (Network layers disabled)"
          );
          ws.close();
        }
        wsRef.current = null;
      }
      // Clear UDP data
      setUdpData({
        targets: [],
        networkMembers: [],
      });
      return;
    }

    // Connect WebSocket when network layers are visible
    console.log("🔌 Connecting to WebSocket: ws://localhost:8080");
    const ws = new WebSocket("ws://localhost:8080");

    ws.onopen = () => {
      console.log("✅ WebSocket connected successfully");
    };

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);

        // Filter out welcome/connection messages
        if (
          parsed.message &&
          parsed.message.includes("Connected to WebSocket bridge")
        ) {
          return;
        }

        // Update state based on type
        if (parsed.type === "networkMembers") {
          setUdpData((prev) => ({
            ...prev,
            networkMembers: parsed.data || [],
          }));
        } else if (parsed.type === "targets") {
          setUdpData((prev) => ({
            ...prev,
            targets: parsed.data || [],
          }));
        }
      } catch (e) {
        console.error("❌ Error parsing WebSocket message:", e);
      }
    };

    ws.onerror = (error) => {
      console.error("❌ WebSocket error:", error);
    };

    ws.onclose = (event) => {
      console.log(
        "🔌 WebSocket closed, code:",
        event.code,
        "reason:",
        event.reason
      );
      wsRef.current = null;
    };

    wsRef.current = ws;

    return () => {
      if (wsRef.current) {
        const currentWs = wsRef.current;
        if (
          currentWs.readyState === WebSocket.OPEN ||
          currentWs.readyState === WebSocket.CONNECTING
        ) {
          currentWs.close();
        }
        wsRef.current = null;
      }
    };
  }, [networkLayersVisible]);

  // Memoize layers to prevent unnecessary recreations
  const udpLayers = useMemo(() => {
    if (!networkLayersVisible) {
      return [];
    }

    const layers: any[] = [];
    const networkMembersLayerId = "udp-network-members-layer";
    const targetsLayerId = "udp-targets-layer";

    // Network Members layer
    if (udpData.networkMembers.length > 0) {
      const validNetworkMembers = udpData.networkMembers.filter(
        (d: any) =>
          d &&
          typeof d.longitude === "number" &&
          typeof d.latitude === "number" &&
          !isNaN(d.longitude) &&
          !isNaN(d.latitude)
      );

      if (validNetworkMembers.length > 0) {
        layers.push(
          new IconLayer({
            id: networkMembersLayerId,
            data: validNetworkMembers,
            pickable: true,
            onHover: onHover,
            getIcon: (d: any) => {
              const userId = d.userId || d.id || 0;
              const customSymbol = getNodeSymbol(networkMembersLayerId, userId);
              const symbol = customSymbol || "friendly_aircraft";
              const isRectangularIcon = [
                "ground_unit",
                "command_post",
                "naval_unit",
              ].includes(symbol);
              return {
                url: `/icons/${symbol}.svg`,
                width: isRectangularIcon ? 28 : 32,
                height: isRectangularIcon ? 20 : 32,
                anchorY: isRectangularIcon ? 10 : 16,
                anchorX: isRectangularIcon ? 14 : 16,
                mask: false,
              };
            },
            getPosition: (d: any) => [d.longitude, d.latitude],
            getSize: 32,
            sizeScale: 1,
            getPixelOffset: [0, 0],
            alphaCutoff: 0.001,
            billboard: true,
            sizeUnits: "pixels",
            sizeMinPixels: 16,
            sizeMaxPixels: 48,
            updateTriggers: {
              getPosition: [udpData.networkMembers.length],
              getIcon: [udpData.networkMembers.length, nodeSymbols],
            },
          })
        );
      }
    }

    // Targets layer
    if (udpData.targets.length > 0) {
      const validTargets = udpData.targets.filter(
        (d: any) =>
          d &&
          typeof d.longitude === "number" &&
          typeof d.latitude === "number" &&
          !isNaN(d.longitude) &&
          !isNaN(d.latitude)
      );

      if (validTargets.length > 0) {
        layers.push(
          new IconLayer({
            id: targetsLayerId,
            data: validTargets,
            pickable: true,
            onHover: onHover,
            getIcon: (d: any) => {
              const userId = d.userId || d.id || 0;
              const customSymbol = getNodeSymbol(targetsLayerId, userId);
              const symbol = customSymbol || "alert";
              const isRectangularIcon = [
                "ground_unit",
                "command_post",
                "naval_unit",
              ].includes(symbol);
              return {
                url: `/icons/${symbol}.svg`,
                width: isRectangularIcon ? 28 : 32,
                height: isRectangularIcon ? 20 : 32,
                anchorY: isRectangularIcon ? 10 : 16,
                anchorX: isRectangularIcon ? 14 : 16,
                mask: false,
              };
            },
            getPosition: (d: any) => [d.longitude, d.latitude],
            getSize: 32,
            sizeScale: 1,
            getPixelOffset: [0, 0],
            alphaCutoff: 0.001,
            billboard: true,
            sizeUnits: "pixels",
            sizeMinPixels: 16,
            sizeMaxPixels: 48,
            updateTriggers: {
              getPosition: [udpData.targets.length],
              getIcon: [udpData.targets.length, nodeSymbols],
            },
          })
        );
      }
    }
    return layers;
  }, [
    udpData.targets,
    udpData.networkMembers,
    onHover,
    networkLayersVisible,
    getNodeSymbol,
    nodeSymbols, // Add nodeSymbols to dependencies so layers update when symbols change
  ]);

  return udpLayers;
};
