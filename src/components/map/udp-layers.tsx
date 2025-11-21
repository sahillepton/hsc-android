import { useEffect, useMemo, useRef, useState } from "react";
import { IconLayer } from "@deck.gl/layers";
import { useNetworkLayersVisible } from "@/store/layers-store";
import { useUdpSymbolsStore } from "@/store/udp-symbols-store";
import { useUdpConfigStore } from "@/store/udp-config-store";

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
  const { getWsUrl, wsHost, wsPort } = useUdpConfigStore();
  const wsRef = useRef<WebSocket | null>(null);

  // Manage WebSocket connection based on networkLayersVisible
  useEffect(() => {
    // Always close existing connection first (whether config changed or layers hidden)
    if (wsRef.current) {
      const oldWs = wsRef.current;
      if (
        oldWs.readyState === WebSocket.OPEN ||
        oldWs.readyState === WebSocket.CONNECTING
      ) {
        console.log("🔌 Closing existing WebSocket connection");
        oldWs.close();
      }
      wsRef.current = null;
    }

    if (!networkLayersVisible) {
      // Clear UDP data when network layers are hidden
      setUdpData({
        targets: [],
        networkMembers: [],
      });
      return;
    }

    // Small delay to ensure old connection is closed before creating new one
    const connectTimeout = setTimeout(() => {
      // Connect WebSocket when network layers are visible
      const wsUrl = getWsUrl();
      console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      let connectionOpened = false;
      let connectionFailed = false;

      ws.onopen = () => {
        console.log("✅ WebSocket connected successfully");
        connectionOpened = true;
        connectionFailed = false;
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
        connectionFailed = true;
      };

      ws.onclose = (event) => {
        console.log(
          "🔌 WebSocket closed, code:",
          event.code,
          "reason:",
          event.reason
        );

        // Show alert if connection failed (not opened successfully or closed with error)
        // Error codes: 1006 (abnormal closure), 1002 (protocol error), etc.
        // Don't show alert if it was a normal close (1000) or going away (1001)
        if (
          !connectionOpened &&
          (connectionFailed ||
            event.code === 1006 ||
            (event.code !== 1000 && event.code !== 1001))
        ) {
          alert(
            `Connection to socket bridge server failed!\n\nHost: ${wsHost}\nPort: ${wsPort}\n\nPlease check your configuration.`
          );
        }

        wsRef.current = null;
      };

      wsRef.current = ws;
    }, 100); // Small delay to ensure old connection cleanup

    return () => {
      clearTimeout(connectTimeout);
      if (wsRef.current) {
        const currentWs = wsRef.current;
        if (
          currentWs.readyState === WebSocket.OPEN ||
          currentWs.readyState === WebSocket.CONNECTING
        ) {
          console.log("🔌 Cleaning up WebSocket connection");
          currentWs.close();
        }
        wsRef.current = null;
      }
      // Clear UDP data when connection changes
      setUdpData({
        targets: [],
        networkMembers: [],
      });
    };
  }, [networkLayersVisible, wsHost, wsPort, getWsUrl]);

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
