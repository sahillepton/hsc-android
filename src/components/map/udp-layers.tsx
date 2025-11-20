import { useEffect, useMemo, useRef, useState } from "react";
import { IconLayer } from "@deck.gl/layers";

interface UdpLayerData {
  targets: any[];
  networkMembers: any[];
}

export const useUdpLayers = () => {
  const [udpData, setUdpData] = useState<UdpLayerData>({
    targets: [],
    networkMembers: [],
  });
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
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
    };

    wsRef.current = ws;

    return () => {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
    };
  }, []);

  // Memoize layers to prevent unnecessary recreations
  const udpLayers = useMemo(() => {
    const layers: any[] = [];

    // Network Members layer (opcode 101) - friendly_aircraft.png
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
            id: "udp-network-members-layer",
            data: validNetworkMembers,
            pickable: true,
            getIcon: () => ({
              url: "/icons/friendly_aircraft.svg",
              width: 32,
              height: 32,
              anchorY: 16,
              anchorX: 16,
              mask: false,
            }),
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
              getIcon: [udpData.networkMembers.length],
            },
          })
        );
      }
    }

    // Targets layer (opcode 104) - alert.png
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
            id: "udp-targets-layer",
            data: validTargets,
            pickable: true,
            getIcon: () => ({
              url: "/icons/alert.svg",
              width: 32,
              height: 32,
              anchorY: 16,
              anchorX: 16,
              mask: false,
            }),
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
              getIcon: [udpData.targets.length],
            },
          })
        );
      }
    }
    return layers;
  }, [udpData.targets, udpData.networkMembers]);
  return udpLayers;
};
