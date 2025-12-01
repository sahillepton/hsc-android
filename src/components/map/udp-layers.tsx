import { useEffect, useMemo, useState } from "react";
import { IconLayer } from "@deck.gl/layers";
import { useNetworkLayersVisible } from "@/store/layers-store";
import { useUdpSymbolsStore } from "@/store/udp-symbols-store";
import { useUdpConfigStore } from "@/store/udp-config-store";
import { Udp } from "../../plugins/udp";

// Test mode configuration - set to true to use WebSocket instead of UDP
const IS_TEST = false;
const WS_IP = "192.168.1.213";
const WS_PORT = 8080;

interface UdpLayerData {
  targets: any[];
  networkMembers: any[];
}

// Binary parsing functions (from websocket-server.js)
const parseBinaryMessage = (msgBuffer: ArrayBuffer) => {
  const msg = new Uint8Array(msgBuffer);
  const bin = Array.from(msg)
    .map((b) => b.toString(2).padStart(8, "0"))
    .join("");

  const readBits = (start: number, len: number) =>
    parseInt(bin.slice(start, start + len), 2);

  const readI16 = (start: number) => {
    let v = readBits(start, 16);
    return v & 0x8000 ? v - 0x10000 : v;
  };

  const readU32 = (start: number) => readBits(start, 32);

  const header = {
    msgId: readBits(0, 8),
    opcode: readBits(8, 8),
    reserved0: readBits(16, 32),
    reserved1: readBits(48, 32),
    reserved2: readBits(80, 32),
  };

  const opcode = header.opcode;

  if (opcode === 101) {
    // Network Members
    const numMembers = readBits(128, 8);
    let offset = 160;
    const members = [];
    for (let i = 0; i < numMembers; i++) {
      const m = {
        globalId: readU32(offset),
        latitude: readU32(offset + 32) / 11930469,
        longitude: readU32(offset + 64) / 11931272.17,
        altitude: readI16(offset + 96),
        veIn: readI16(offset + 112),
        veIe: readI16(offset + 128),
        veIu: readI16(offset + 144),
        trueHeading: readI16(offset + 160),
        reserved: readI16(offset + 176),
        opcode: 101,
      };
      members.push(m);
      offset += 192;
    }
    return { type: "networkMembers", opcode: 101, data: members, header };
  }

  if (opcode === 104) {
    // Targets
    const numTargets = readBits(128, 16);
    let offset = 160;
    const targets = [];
    for (let i = 0; i < numTargets; i++) {
      const t = {
        globalId: readU32(offset),
        latitude: readU32(offset + 32) / 11930469,
        longitude: readU32(offset + 64) / 11931272.17,
        altitude: readI16(offset + 96),
        heading: readI16(offset + 112),
        groundSpeed: readI16(offset + 128),
        reserved0: readBits(offset + 144, 8),
        reserved1: readBits(offset + 152, 8),
        range: readU32(offset + 160),
        opcode: 104,
      };
      targets.push(t);
      offset += 192;
    }
    return { type: "targets", opcode: 104, data: targets, header };
  }

  if (opcode === 106) {
    // Threats
    const senderGlobalId = readU32(128);
    const numOfThreats = readBits(160, 8);
    let offset = 192;
    const threats = [];
    for (let i = 0; i < numOfThreats; i++) {
      const t = {
        threatId: readBits(offset, 8),
        isSearchMode: readBits(offset + 8, 8),
        isLockOn: readBits(offset + 16, 8),
        threatType: readBits(offset + 24, 8),
        threatRange: readBits(offset + 32, 8),
        reserved: readBits(offset + 40, 24),
        threatAzimuth: readBits(offset + 64, 16),
        threatFrequency: readBits(offset + 80, 16),
        opcode: 106,
      };
      threats.push(t);
      offset += 96;
    }
    return {
      type: "threats",
      opcode: 106,
      data: threats,
      header,
      senderGlobalId,
    };
  }

  return { type: "unknown", opcode, header };
};

export const useUdpLayers = (onHover?: (info: any) => void) => {
  const [udpData, setUdpData] = useState<UdpLayerData>({
    targets: [],
    networkMembers: [],
  });
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [noDataWarning, setNoDataWarning] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { networkLayersVisible } = useNetworkLayersVisible();
  const { getNodeSymbol, nodeSymbols } = useUdpSymbolsStore();
  const { host, port } = useUdpConfigStore();

  useEffect(() => {
    if (!networkLayersVisible) {
      setUdpData({
        targets: [],
        networkMembers: [],
      });
      setConnectionError(null);
      setIsConnected(false);
      return;
    }

    // For test mode, use WebSocket; otherwise check UDP config
    if (IS_TEST) {
      // WebSocket mode - use hardcoded WS_IP and WS_PORT
      if (!WS_IP || !WS_PORT || WS_PORT <= 0) {
        setUdpData({
          targets: [],
          networkMembers: [],
        });
        setConnectionError(null);
        setIsConnected(false);
        return;
      }
    } else {
      // UDP mode - check if host or port are configured
      if (!host || !host.trim() || !port || port <= 0) {
        setUdpData({
          targets: [],
          networkMembers: [],
        });
        setConnectionError(null);
        setIsConnected(false);
        return;
      }
    }

    let connectionEstablished = false;
    let noDataTimeout: NodeJS.Timeout | null = null;
    let websocket: WebSocket | null = null;
    setConnectionError(null);
    setNoDataWarning(null);

    const connectUdp = async () => {
      if (IS_TEST) {
        // Use WebSocket for testing
        try {
          const wsUrl = `ws://${WS_IP}:${WS_PORT}`;
          console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);
          websocket = new WebSocket(wsUrl);
          websocket.binaryType = "arraybuffer";

          websocket.onopen = () => {
            connectionEstablished = true;
            setIsConnected(true);
            setConnectionError(null);
            console.log(`✅ WebSocket connected to ${wsUrl}`);

            // Send registration message
            try {
              websocket?.send("bridge-register");
              console.log("📤 Sent registration message to WebSocket server");
            } catch (sendError) {
              console.warn(
                "⚠️ Could not send registration message:",
                sendError
              );
            }

            // Check for no data after 15 seconds
            noDataTimeout = setTimeout(() => {
              setNoDataWarning(
                "Please check the WebSocket server configurations. No data is coming!"
              );
              setIsConnected(false);
            }, 15000);
          };

          websocket.onmessage = (event: MessageEvent) => {
            try {
              setNoDataWarning(null);
              setIsConnected(true);
              if (noDataTimeout) {
                clearTimeout(noDataTimeout);
                noDataTimeout = null;
              }

              let buffer: ArrayBuffer;
              if (event.data instanceof ArrayBuffer) {
                buffer = event.data;
                handleBinaryMessage(buffer);
              } else if (event.data instanceof Blob) {
                const reader = new FileReader();
                reader.onload = () => {
                  if (reader.result instanceof ArrayBuffer) {
                    handleBinaryMessage(reader.result);
                  }
                };
                reader.onerror = (error) => {
                  console.error("❌ Error reading Blob:", error);
                };
                reader.readAsArrayBuffer(event.data);
              } else if (typeof event.data === "string") {
                // Handle JSON message directly (no binary conversion)
                try {
                  const jsonData = JSON.parse(event.data);
                  // Check if it's already in the expected format (type, opcode, data)
                  if (
                    jsonData.type &&
                    (jsonData.type === "networkMembers" ||
                      jsonData.type === "targets")
                  ) {
                    handleJsonMessage(jsonData);
                  } else {
                    console.warn(
                      "⚠️ Received JSON message with unexpected format:",
                      jsonData
                    );
                  }
                } catch (jsonError) {
                  console.error(
                    "❌ Could not parse WebSocket message as JSON:",
                    jsonError
                  );
                }
              } else {
                console.warn(
                  "⚠️ Received unsupported message type from WebSocket:",
                  typeof event.data
                );
              }
            } catch (e) {
              console.error("❌ Error processing WebSocket message:", e);
            }
          };

          websocket.onerror = (error) => {
            console.error("❌ WebSocket error:", error);
            setIsConnected(false);
          };

          websocket.onclose = (event) => {
            console.log(
              `🔌 WebSocket closed: ${event.code} - ${
                event.reason || "No reason"
              }`
            );
            setIsConnected(false);
            if (event.code !== 1000) {
              setConnectionError(
                `WebSocket connection closed. Code: ${event.code}${
                  event.reason ? `, Reason: ${event.reason}` : ""
                }`
              );
            }
          };
        } catch (error: any) {
          console.error("❌ WebSocket connection error:", error);
          const errorMessage =
            error?.message || error?.toString() || "Unknown error";
          const fullErrorMessage = `Failed to connect to WebSocket server!\n\nHost: ${WS_IP}\nPort: ${WS_PORT}\n\nError: ${errorMessage}`;
          setIsConnected(false);
          setConnectionError(fullErrorMessage);
          alert(fullErrorMessage);
        }
      } else {
        // Use UDP (normal mode)
        try {
          console.log(`🔌 Connecting to UDP: ${host}:${port}`);
          await Udp.create({ address: host, port });
          connectionEstablished = true;
          setIsConnected(true);
          setConnectionError(null);
          console.log(`✅ UDP connected to ${host}:${port}`);

          // Check for no data after 15 seconds
          noDataTimeout = setTimeout(() => {
            setNoDataWarning(
              "Please check the UDP server configurations. No data is coming!"
            );
            setIsConnected(false);
          }, 5000);

          // Send registration message to UDP server
          try {
            await Udp.send({
              address: host,
              port: port,
              data: "bridge-register",
            });
            console.log("📤 Sent registration message to UDP server");
          } catch (sendError) {
            console.warn("⚠️ Could not send registration message:", sendError);
            setConnectionError(
              "Failed to send registration message. Connection may be unstable."
            );
          }
        } catch (error: any) {
          console.error("❌ UDP connection error:", error);
          const errorMessage =
            error?.message || error?.toString() || "Unknown error";
          const fullErrorMessage = `Failed to connect to UDP server!\n\nHost: ${host}\nPort: ${port}\n\nError: ${errorMessage}\n\nPlease check your configuration.`;
          setIsConnected(false);
          setConnectionError(fullErrorMessage);
          alert(fullErrorMessage);
        }
      }
    };

    // Helper function to handle binary messages (shared between UDP and WebSocket)
    const handleBinaryMessage = (buffer: ArrayBuffer) => {
      const parsed = parseBinaryMessage(buffer);
      const enrichedData = {
        ...parsed,
        timestamp: new Date().toISOString(),
        rawLength: buffer.byteLength,
      };

      console.log("📡 Message received:", enrichedData);

      if (enrichedData.type === "networkMembers") {
        setUdpData((prev) => ({
          ...prev,
          networkMembers: enrichedData.data || [],
        }));
      } else if (enrichedData.type === "targets") {
        setUdpData((prev) => ({
          ...prev,
          targets: enrichedData.data || [],
        }));
      }
    };

    // Helper function to handle JSON messages directly (for WebSocket test mode)
    const handleJsonMessage = (jsonData: any) => {
      const enrichedData = {
        ...jsonData,
        timestamp: new Date().toISOString(),
      };

      if (enrichedData.type === "networkMembers") {
        setUdpData((prev) => ({
          ...prev,
          networkMembers: enrichedData.data || [],
        }));
      } else if (enrichedData.type === "targets") {
        setUdpData((prev) => ({
          ...prev,
          targets: enrichedData.data || [],
        }));
      }
    };

    let listener: { remove: () => void } | null = null;

    const setupListener = async () => {
      await connectUdp();

      if (connectionEstablished && !IS_TEST) {
        // Listen for UDP messages (only for UDP, WebSocket handles via onmessage)
        listener = await Udp.addListener("udpMessage", (event: any) => {
          try {
            setNoDataWarning(null);
            setIsConnected(true);
            if (noDataTimeout) {
              clearTimeout(noDataTimeout);
              noDataTimeout = null;
            }

            if (!event.buffer) {
              console.warn("⚠️ UDP message received with no buffer.");
              return;
            }

            handleBinaryMessage(event.buffer);
          } catch (e) {
            console.error("❌ Error parsing UDP message:", e);
          }
        });
      }
    };

    setupListener();

    return () => {
      if (noDataTimeout) {
        clearTimeout(noDataTimeout);
      }

      // Close WebSocket if open
      if (websocket) {
        websocket.close();
        websocket = null;
      }

      // Close UDP if open
      if (connectionEstablished && !IS_TEST) {
        Udp.closeAllSockets().catch(console.error);
      }
      if (listener) {
        listener.remove();
      }
      setUdpData({
        targets: [],
        networkMembers: [],
      });
      setConnectionError(null);
      setNoDataWarning(null);
      setIsConnected(false);
    };
  }, [networkLayersVisible, host, port]);

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
    nodeSymbols,
  ]);

  return { udpLayers, connectionError, noDataWarning, isConnected };
};
