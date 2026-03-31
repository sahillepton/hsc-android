import { useEffect, useMemo } from "react";
import { IconLayer, LineLayer } from "@deck.gl/layers";
import { useNetworkLayersVisible } from "@/store/layers-store";
import { useUdpSymbolsStore } from "@/store/udp-symbols-store";
import { useUdpDataStore } from "@/store/udp-data-store";
import { Udp } from "../../plugins/udp";
import {
  UDP_PORT,
  UDP_NO_DATA_TIMEOUT_MS,
  UDP_STALE_CHECK_INTERVAL_MS,
  UDP_STALE_THRESHOLD_MS,
} from "@/lib/constants";

/**
 * TODO(REVERT): When true, ignore socket payload and parse this fixed buffer instead.
 * Use this for testing — works with Vite HMR without rebuilding `dist-electron/main.cjs`.
 * (Electron main.ts changes are NOT applied until `yarn build:electron`.)
 */
const UDP_USE_TEST_BUFFER = false;
const UDP_TEST_BUFFER = new Uint8Array(
  [
    "22",
    "0",
    "56",
    "1",
    "3",
    "192",
    "168",
    "148",
    "20",
    "4",
    "1",
    "3",
    "20",
    "1",
    "181",
    "237",
    "96",
    "4",
    "161",
    "155",
    "160",
    "0",
    "180",
    "192",
    "168",
    "148",
    "20",
    "2",
    "1",
    "3",
    "100",
    "1",
    "178",
    "224",
    "32",
    "4",
    "158",
    "142",
    "96",
    "0",
    "120",
    "192",
    "168",
    "148",
    "20",
    "3",
    "1",
    "4",
    "20",
    "1",
    "180",
    "102",
    "192",
    "4",
    "160",
    "21",
    "0",
    "0",
    "150",
  ].map((h) => parseInt(h, 16)),
);

// Shared connection state to prevent multiple instances from creating duplicate connections
const globalConnectionState = {
  isConnected: false,
  isConnecting: false,
  listener: null as { remove: () => void } | null,
  noDataTimeout: null as NodeJS.Timeout | null,
  staleCheckInterval: null as NodeJS.Timeout | null,
  lastMessageTime: null as number | null,
};

/** Log effective topology UDP payload once per page load (dev/debug). */
let rawTopologyPacketLoggedOnce = false;
/** Log wire INT32 lat/lon per fused node once per page load (dev/debug). */
let rawLatLonPerMemberLoggedOnce = false;

// UdpLayerData interface is now defined in udp-data-store.ts

type BinaryInput = ArrayBuffer | Uint8Array;

/** Wire INT32 lat/lon → decimal degrees (`public/network-topology-struct.md`). */
const TOPO_LATLON_RAW_TO_DEG = 0.000000083819;

/**
 * Parse topology binary data from UDP server (NEW FORMAT)
 *
 * Structure:
 * - ExtMsgType ext_msg_type (1 byte)
 * - uint16_t payload_length (2 bytes, big-endian)
 * - topoForMcsa:
 *   - UINT8 node_id (1 byte)
 *   - UINT8 numFusedNodes (1 byte)
 *   - topoWithNodeIP[] (numFusedNodes entries):
 *     - UINT8 IP[4] (4 bytes, big-endian / network byte order)
 *     - topology:
 *       - UINT8 id (1 byte)
 *       - UINT8 numNeighbors (1 byte)
 *       - entries[] (numNeighbors entries):
 *         - UINT8 id (1 byte)
 *         - UINT8 snr (1 byte)
 *     - positional:
 *       - INT32 latitude (4 bytes, big-endian; degrees = raw × TOPO_LATLON_RAW_TO_DEG)
 *       - INT32 longitude (4 bytes, big-endian; same scale)
 *       - UINT16 altitude (2 bytes, big-endian)
 *     (no RSSI — entry ends after altitude)
 */
const parseTopologyBinary = (
  buffer: BinaryInput,
): {
  motherNodeId: number | null;
  nodes: Map<
    number,
    {
      id: number;
      ip: string;
      lat: number;
      long: number;
      altitude: number;
      neighbors: Array<{ id: number; snr: number }>;
    }
  >;
  connections: Map<string, number>;
} => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bufferLength = bytes.byteLength;
  let offset = 0;

  const hasEnoughBytes = (bytesNeeded: number): boolean => {
    return offset + bytesNeeded <= bufferLength;
  };

  const emptyResult = {
    motherNodeId: null as number | null,
    nodes: new Map() as Map<number, any>,
    connections: new Map() as Map<string, number>,
  };

  // --- Header ---

  // ExtMsgType (1 byte)
  if (!hasEnoughBytes(1)) {
    console.warn(
      "[Topology Parser] Buffer too small: cannot read ext_msg_type",
    );
    return emptyResult;
  }
  offset += 1;

  // payload_length (2 bytes, big-endian)
  if (!hasEnoughBytes(2)) {
    console.warn(
      "[Topology Parser] Buffer too small: cannot read payload_length",
    );
    return emptyResult;
  }
  offset += 2;

  // --- topoForMcsa ---

  // node_id (1 byte) — the mother node's ID
  if (!hasEnoughBytes(1)) {
    console.warn("[Topology Parser] Buffer too small: cannot read node_id");
    return emptyResult;
  }
  const motherNodeId = view.getUint8(offset);
  offset += 1;

  // numFusedNodes (1 byte)
  if (!hasEnoughBytes(1)) {
    console.warn(
      "[Topology Parser] Buffer too small: cannot read numFusedNodes",
    );
    return emptyResult;
  }
  const numFusedNodes = view.getUint8(offset);
  offset += 1;

  const nodes = new Map<
    number,
    {
      id: number;
      ip: string;
      lat: number;
      long: number;
      altitude: number;
      neighbors: Array<{ id: number; snr: number }>;
    }
  >();
  const connections = new Map<string, number>();

  // --- topoWithNodeIP[] ---
  for (let i = 0; i < numFusedNodes; i++) {
    // IP[4] (4 bytes, big-endian / network byte order)
    if (!hasEnoughBytes(4)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${i + 1}/${numFusedNodes}: cannot read IP`,
      );
      break;
    }
    const ip = `${view.getUint8(offset)}.${view.getUint8(offset + 1)}.${view.getUint8(offset + 2)}.${view.getUint8(offset + 3)}`;
    offset += 4;

    // topology.id (1 byte)
    if (!hasEnoughBytes(1)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${i + 1}/${numFusedNodes}: cannot read topology id`,
      );
      break;
    }
    const nodeId = view.getUint8(offset);
    offset += 1;

    // topology.numNeighbors (1 byte)
    if (!hasEnoughBytes(1)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${i + 1}/${numFusedNodes}: cannot read numNeighbors`,
      );
      break;
    }
    const numNeighbors = view.getUint8(offset);
    offset += 1;

    // entries[] (numNeighbors × 2 bytes)
    const neighbors: Array<{ id: number; snr: number }> = [];
    for (let j = 0; j < numNeighbors; j++) {
      if (!hasEnoughBytes(2)) {
        console.warn(
          `[Topology Parser] Buffer too small at node ${nodeId}, neighbor ${j + 1}/${numNeighbors}`,
        );
        break;
      }
      const neighborId = view.getUint8(offset);
      offset += 1;
      const snr = view.getUint8(offset);
      offset += 1;
      neighbors.push({ id: neighborId, snr });

      // Connection key (smaller ID first to avoid duplicates)
      const smallerId = Math.min(nodeId, neighborId);
      const largerId = Math.max(nodeId, neighborId);
      connections.set(`${smallerId}_${largerId}`, snr);
    }

    // positional.latitude (INT32, big-endian → degrees via struct scale)
    if (!hasEnoughBytes(4)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${nodeId}: cannot read latitude`,
      );
      break;
    }

    const latRaw = view.getInt32(offset, false);
    offset += 4;

    // positional.longitude (INT32, big-endian, same scale as latitude)
    if (!hasEnoughBytes(4)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${nodeId}: cannot read longitude`,
      );
      break;
    }
    const lonRaw = view.getInt32(offset, false);
    offset += 4;

    if (!rawLatLonPerMemberLoggedOnce) {
      console.log(
        `[Topology] node id=${nodeId} raw lat (INT32)=${latRaw} raw lon (INT32)=${lonRaw}`,
      );
    }

    const lat = latRaw * TOPO_LATLON_RAW_TO_DEG;
    const long = lonRaw * TOPO_LATLON_RAW_TO_DEG;

    // positional.altitude (UINT16, big-endian)
    if (!hasEnoughBytes(2)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${nodeId}: cannot read altitude`,
      );
      break;
    }
    const altitude = view.getUint16(offset, false);
    offset += 2;

    nodes.set(nodeId, { id: nodeId, ip, lat, long, altitude, neighbors });
  }

  rawLatLonPerMemberLoggedOnce = true;

  return { motherNodeId, nodes, connections };
};

/**
 * Parse a hex color string (#RRGGBB) into [R, G, B]
 */
const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
};

/**
 * Convert SNR value to color gradient using three configurable stops.
 * @param snr Signal-to-Noise Ratio (0-100)
 * @param colors Tuple of 3 hex color strings [low, mid, high]
 * @returns RGBA color array [R, G, B, A]
 */
const getSnrColor = (
  snr: number,
  colors: [string, string, string] = ["#FF0000", "#FFFF00", "#00FF00"],
): [number, number, number, number] => {
  const normalized = Math.max(0, Math.min(1, snr / 100));

  const low = hexToRgb(colors[0]);
  const mid = hexToRgb(colors[1]);
  const high = hexToRgb(colors[2]);

  if (normalized < 0.5) {
    // Lerp low → mid
    const t = normalized * 2;
    return [
      Math.round(low[0] + (mid[0] - low[0]) * t),
      Math.round(low[1] + (mid[1] - low[1]) * t),
      Math.round(low[2] + (mid[2] - low[2]) * t),
      200,
    ];
  } else {
    // Lerp mid → high
    const t = (normalized - 0.5) * 2;
    return [
      Math.round(mid[0] + (high[0] - mid[0]) * t),
      Math.round(mid[1] + (high[1] - mid[1]) * t),
      Math.round(mid[2] + (high[2] - mid[2]) * t),
      200,
    ];
  }
};

/**
 * Interpolate line width from 3 breakpoints based on SNR value.
 * @param snr Signal-to-Noise Ratio (0-100)
 * @param widths [lowWidth, midWidth, highWidth]
 * @returns interpolated pixel width
 */
const getSnrWidth = (
  snr: number,
  widths: [number, number, number] = [1, 3, 5],
): number => {
  const normalized = Math.max(0, Math.min(1, snr / 100));
  if (normalized < 0.5) {
    const t = normalized * 2;
    return widths[0] + (widths[1] - widths[0]) * t;
  } else {
    const t = (normalized - 0.5) * 2;
    return widths[1] + (widths[2] - widths[1]) * t;
  }
};

export const useUdpLayers = (onHover?: (info: any) => void) => {
  // Use shared store for UDP data so all components access the same data
  // Subscribe to the entire udpData object so components re-render when any part changes
  const udpData = useUdpDataStore((state) => state.udpData);
  const setUdpData = useUdpDataStore((state) => state.setUdpData);
  const connectionError = useUdpDataStore((state) => state.connectionError);
  const setConnectionError = useUdpDataStore(
    (state) => state.setConnectionError,
  );
  const noDataWarning = useUdpDataStore((state) => state.noDataWarning);
  const setNoDataWarning = useUdpDataStore((state) => state.setNoDataWarning);
  const isConnected = useUdpDataStore((state) => state.isConnected);
  const setIsConnected = useUdpDataStore((state) => state.setIsConnected);
  const resetConnectionState = useUdpDataStore(
    (state) => state.resetConnectionState,
  );
  const { networkLayersVisible } = useNetworkLayersVisible();
  const {
    getNodeSymbol,
    getLayerSymbol,
    getGroupSymbol,
    nodeSymbols,
    motherNodeSymbol,
    snrColors,
    snrLineWidths,
  } = useUdpSymbolsStore();
  const groupSymbols = useUdpSymbolsStore((state) => state.groupSymbols);

  useEffect(() => {
    // UDP connection stays alive regardless of networkLayersVisible toggle.
    // The toggle only controls rendering (handled in useMemo below).

    // If connection already exists, don't create a new one
    if (globalConnectionState.isConnected) {
      // Connection already exists, just sync local state
      setIsConnected(true);
      setConnectionError(null);
      setNoDataWarning(null);
      return;
    }

    // If already connecting, don't start another connection
    if (globalConnectionState.isConnecting) {
      return;
    }

    // Mark as connecting
    globalConnectionState.isConnecting = true;

    let connectionEstablished = false;
    let firstMessageHandled = false;
    let noDataTimeout: NodeJS.Timeout | null = null;
    type UdpUpdater = (prev: any) => any;
    let pendingUpdater: UdpUpdater | null = null;
    let rafHandle: number | null = null;
    setConnectionError(null);
    setNoDataWarning(null);

    const flushPendingUdpUpdate = () => {
      if (!pendingUpdater) return;
      const updater = pendingUpdater;
      pendingUpdater = null;
      setUdpData(updater);
    };

    const scheduleUdpUpdate = (updater: UdpUpdater) => {
      const previous = pendingUpdater;
      pendingUpdater = previous ? (state) => updater(previous(state)) : updater;

      if (rafHandle === null) {
        rafHandle = requestAnimationFrame(() => {
          rafHandle = null;
          flushPendingUdpUpdate();
        });
      }
    };

    const connectUdp = async () => {
      try {
        // Create UDP socket bound to UDP_PORT (handled in native plugin)
        await Udp.create({});
        connectionEstablished = true;
        globalConnectionState.isConnected = true;
        globalConnectionState.isConnecting = false;
        setIsConnected(true);
        setConnectionError(null);

        // Check for no data after 5 seconds
        noDataTimeout = setTimeout(() => {
          setNoDataWarning(
            `No data received on port ${UDP_PORT}. Please check network connectivity.`,
          );
          setIsConnected(false);
          globalConnectionState.isConnected = false;
        }, UDP_NO_DATA_TIMEOUT_MS);
        globalConnectionState.noDataTimeout = noDataTimeout;

        // No registration message needed - data arrives automatically from intranet

        // Start stale data check — clear topology if no data for 10 seconds
        if (globalConnectionState.staleCheckInterval) {
          clearInterval(globalConnectionState.staleCheckInterval);
        }
        globalConnectionState.staleCheckInterval = setInterval(() => {
          if (globalConnectionState.lastMessageTime === null) return;
          const now = Date.now();
          if (
            now - globalConnectionState.lastMessageTime >
            UDP_STALE_THRESHOLD_MS
          ) {
            globalConnectionState.lastMessageTime = null;
            firstMessageHandled = false;
            scheduleUdpUpdate((prev) => ({
              ...prev,
              topology: {
                motherNodeId: null,
                nodes: new Map(),
                connections: new Map(),
              },
            }));
          }
        }, UDP_STALE_CHECK_INTERVAL_MS);
      } catch (error: any) {
        console.error("❌ UDP connection error:", error);
        const errorMessage =
          error?.message || error?.toString() || "Unknown error";
        const fullErrorMessage = `Failed to bind UDP socket on port ${UDP_PORT}!\n\nError: ${errorMessage}\n\nPlease check network permissions.`;
        setIsConnected(false);
        globalConnectionState.isConnected = false;
        globalConnectionState.isConnecting = false;
        setConnectionError(fullErrorMessage);
        alert(fullErrorMessage);
      }
    };

    // Helper function to handle binary messages
    const handleBinaryMessage = (
      buffer: ArrayBuffer | number[] | Uint8Array,
    ) => {
      // Track last message time for stale detection
      globalConnectionState.lastMessageTime = Date.now();

      // Convert incoming payload to a byte view without unnecessary copies.
      let packet: Uint8Array;
      if (buffer instanceof ArrayBuffer) {
        packet = new Uint8Array(buffer);
      } else if (Array.isArray(buffer)) {
        // Backward-compatible fallback for older payloads.
        packet = Uint8Array.from(buffer);
      } else if (buffer instanceof Uint8Array) {
        packet = buffer;
      } else {
        console.error("[Topology] Unknown buffer type:", typeof buffer);
        return;
      }

      if (UDP_USE_TEST_BUFFER) {
        packet = UDP_TEST_BUFFER;
      }

      if (!rawTopologyPacketLoggedOnce) {
        rawTopologyPacketLoggedOnce = true;
        console.log("packet", packet);
      }

      // Topology-only UDP mode.
      try {
        const topologyData = parseTopologyBinary(packet);

        // If successful and we got nodes, update topology state.
        if (topologyData.nodes.size > 0) {
          scheduleUdpUpdate((prev) => ({
            ...prev,
            topology: {
              motherNodeId: topologyData.motherNodeId,
              nodes: topologyData.nodes,
              connections: topologyData.connections,
            },
          }));
        }
      } catch {
        // Ignore malformed/non-topology packets in topology-only mode.
      }
    };

    let listener: { remove: () => void } | null = null;

    const setupListener = async () => {
      await connectUdp();

      if (connectionEstablished) {
        // Only set up listener if one doesn't already exist
        if (!globalConnectionState.listener) {
          // Listen for UDP messages
          listener = await Udp.addListener("udpMessage", (event: any) => {
            try {
              if (!firstMessageHandled) {
                firstMessageHandled = true;
                setNoDataWarning(null);
                setIsConnected(true);
                globalConnectionState.isConnected = true;
              }
              if (globalConnectionState.noDataTimeout) {
                clearTimeout(globalConnectionState.noDataTimeout);
                globalConnectionState.noDataTimeout = null;
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
          globalConnectionState.listener = listener;
        } else {
          // Reuse existing listener
          listener = globalConnectionState.listener;
        }
      }
    };

    setupListener();

    return () => {
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
      flushPendingUdpUpdate();

      // Cleanup on unmount
      if (globalConnectionState.isConnected) {
        if (globalConnectionState.noDataTimeout) {
          clearTimeout(globalConnectionState.noDataTimeout);
          globalConnectionState.noDataTimeout = null;
        }
        if (globalConnectionState.staleCheckInterval) {
          clearInterval(globalConnectionState.staleCheckInterval);
          globalConnectionState.staleCheckInterval = null;
        }
        globalConnectionState.lastMessageTime = null;

        // Close UDP socket
        Udp.closeAllSockets().catch(console.error);

        if (globalConnectionState.listener) {
          globalConnectionState.listener.remove();
          globalConnectionState.listener = null;
        }
        globalConnectionState.isConnected = false;
        globalConnectionState.isConnecting = false;

        // Only reset connection state (not data) - preserve data for when toggle comes back on
        resetConnectionState();
      }
    };
  }, []); // Connection lifecycle is independent of toggle — runs once on mount

  const udpLayers = useMemo(() => {
    if (!networkLayersVisible) {
      return [];
    }

    const layers: any[] = [];
    const networkMembersLayerId = "udp-network-members-layer";
    const targetsLayerId = "udp-targets-layer";
    const geoMessagesLayerId = "udp-geo-messages-layer";

    // Create topology connections
    const connections: any[] = [];

    if (udpData.networkMembers.length > 0) {
      const validMembers = udpData.networkMembers.filter(
        (d: any) =>
          d &&
          typeof d.longitude === "number" &&
          typeof d.latitude === "number" &&
          !isNaN(d.longitude) &&
          !isNaN(d.latitude),
      );

      // Build connections based on controllingNodeId
      validMembers.forEach((member: any) => {
        if (member.controllingNodeId && member.controllingNodeId !== 0) {
          const controller = validMembers.find(
            (m: any) => m.globalId === member.controllingNodeId,
          );

          if (controller) {
            connections.push({
              from: controller,
              to: member,
              type: "control",
              color: [0, 150, 255, 200], // Blue for control relationships
            });
          }
        }
      });
    }

    // Add topology line layers
    if (connections.length > 0) {
      layers.push(
        new LineLayer({
          id: "udp-topology-lines",
          data: connections,
          pickable: false,
          parameters: { depthTest: false, depthMask: false },
          getSourcePosition: (d: any) => [d.from.longitude, d.from.latitude],
          getTargetPosition: (d: any) => [d.to.longitude, d.to.latitude],
          getColor: (d: any) => d.color,
          getWidth: 2,
          widthUnits: "pixels",
          widthMinPixels: 1,
          widthMaxPixels: 4,
        }),
      );
    }

    // Network Members layer
    if (udpData.networkMembers.length > 0) {
      const validNetworkMembers = udpData.networkMembers
        .filter(
          (d: any) =>
            d &&
            typeof d.longitude === "number" &&
            typeof d.latitude === "number" &&
            !isNaN(d.longitude) &&
            !isNaN(d.latitude),
        )
        .map((d: any) => ({
          globalId: d.globalId,
          longitude: d.longitude,
          latitude: d.latitude,
        }));

      if (validNetworkMembers.length > 0) {
        layers.push(
          new IconLayer({
            id: networkMembersLayerId,
            data: validNetworkMembers,
            pickable: true,
            onHover: onHover,
            parameters: { depthTest: false, depthMask: false },
            getIcon: (_d: any) => {
              const customSymbol = getLayerSymbol(networkMembersLayerId);
              const symbol = customSymbol || "fighter8";
              const isRectangularIcon = [
                "ground_unit",
                "command_post",
                "naval_unit",
              ].includes(symbol);
              return {
                url: `icons/${symbol}.svg`,
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
          }),
        );
      }
    }

    // Targets layer
    if (udpData.targets.length > 0) {
      const validTargets = udpData.targets
        .filter(
          (d: any) =>
            d &&
            typeof d.longitude === "number" &&
            typeof d.latitude === "number" &&
            !isNaN(d.longitude) &&
            !isNaN(d.latitude),
        )
        .map((d: any) => ({
          globalId: d.globalId,
          longitude: d.longitude,
          latitude: d.latitude,
        }));

      if (validTargets.length > 0) {
        layers.push(
          new IconLayer({
            id: targetsLayerId,
            data: validTargets,
            pickable: true,
            onHover: onHover,
            parameters: { depthTest: false, depthMask: false },
            getIcon: (_d: any) => {
              const customSymbol = getLayerSymbol(targetsLayerId);
              const symbol = customSymbol || "alert";
              const isRectangularIcon = [
                "ground_unit",
                "command_post",
                "naval_unit",
              ].includes(symbol);
              return {
                url: `icons/${symbol}.svg`,
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
          }),
        );
      }
    }

    // Geo Messages layer (Opcode 122)
    if (udpData.geoMessages.length > 0) {
      const validGeoMessages = udpData.geoMessages.filter(
        (d: any) =>
          d &&
          typeof d.longitude === "number" &&
          typeof d.latitude === "number" &&
          !isNaN(d.longitude) &&
          !isNaN(d.latitude),
      );

      if (validGeoMessages.length > 0) {
        layers.push(
          new IconLayer({
            id: geoMessagesLayerId,
            data: validGeoMessages,
            pickable: false, // No tooltip for geo messages
            parameters: { depthTest: false, depthMask: false },
            getIcon: (_d: any) => {
              return {
                url: `icons/unknown_aircraft.svg`,
                width: 32,
                height: 32,
                anchorY: 16,
                anchorX: 16,
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
              getPosition: [udpData.geoMessages.length],
            },
          }),
        );
      }
    }

    // Topology Connections Layer (with SNR-based colors)
    if (udpData.topology.connections.size > 0) {
      const connectionData: any[] = [];
      udpData.topology.connections.forEach((snr, key) => {
        const [nodeId1Str, nodeId2Str] = key.split("_");
        const nodeId1 = parseInt(nodeId1Str, 10);
        const nodeId2 = parseInt(nodeId2Str, 10);

        const fromNode = udpData.topology.nodes.get(nodeId1);
        const toNode = udpData.topology.nodes.get(nodeId2);

        if (fromNode && toNode) {
          connectionData.push({
            from: { longitude: fromNode.long, latitude: fromNode.lat },
            to: { longitude: toNode.long, latitude: toNode.lat },
            snr,
            color: getSnrColor(snr, snrColors),
            width: getSnrWidth(snr, snrLineWidths),
          });
        }
      });

      if (connectionData.length > 0) {
        layers.push(
          new LineLayer({
            id: "udp-topology-connections-layer",
            data: connectionData,
            pickable: true,
            parameters: { depthTest: false, depthMask: false },
            getSourcePosition: (d: any) => [d.from.longitude, d.from.latitude],
            getTargetPosition: (d: any) => [d.to.longitude, d.to.latitude],
            getColor: (d: any) => d.color,
            getWidth: (d: any) => d.width,
            widthUnits: "pixels",
            widthMinPixels: 1,
            widthMaxPixels: 12,
          }),
        );
      }
    }

    // Topology Nodes Layer
    if (udpData.topology.nodes.size > 0) {
      const topologyNodes = Array.from(udpData.topology.nodes.values()).filter(
        (node) =>
          typeof node.long === "number" &&
          typeof node.lat === "number" &&
          !isNaN(node.long) &&
          !isNaN(node.lat),
      );

      if (topologyNodes.length > 0) {
        const topologyNodesLayerId = "udp-topology-nodes-layer";

        // Helper function to detect groups and map nodes to groups
        const detectTopologyGroups = () => {
          if (udpData.topology.nodes.size === 0) {
            return { groups: [], nodeToGroup: new Map<number, string>() };
          }

          const groups: Array<{
            id: string;
            nodeIds: Set<number>;
          }> = [];
          const visited = new Set<number>();
          const nodeIds = Array.from(udpData.topology.nodes.keys());
          const nodeToGroup = new Map<number, string>();

          // BFS to find connected components
          const bfs = (startNodeId: number, groupId: string) => {
            const queue = [startNodeId];
            const groupNodeIds = new Set<number>();

            while (queue.length > 0) {
              const currentNodeId = queue.shift()!;
              if (visited.has(currentNodeId)) continue;

              visited.add(currentNodeId);
              groupNodeIds.add(currentNodeId);
              nodeToGroup.set(currentNodeId, groupId);

              const node = udpData.topology.nodes.get(currentNodeId);
              if (!node) continue;

              // Add neighbors to queue (only if they exist in topologyData.nodes)
              node.neighbors.forEach((neighbor) => {
                const neighborNode = udpData.topology.nodes.get(neighbor.id);
                if (neighborNode && !visited.has(neighbor.id)) {
                  queue.push(neighbor.id);
                }
              });
            }

            if (groupNodeIds.size > 0) {
              groups.push({
                id: groupId,
                nodeIds: groupNodeIds,
              });
            }
          };

          // Find all groups
          let groupIndex = 0;
          for (const nodeId of nodeIds) {
            if (!visited.has(nodeId)) {
              const groupId = String.fromCharCode(65 + groupIndex); // A, B, C, ...
              bfs(nodeId, groupId);
              groupIndex++;
            }
          }

          return { groups, nodeToGroup };
        };

        const { nodeToGroup } = detectTopologyGroups();

        // Default icons for each group (fighter1, fighter2, etc.)
        const defaultGroupIcons: Record<string, string> = {
          A: "fighter1",
          B: "fighter2",
          C: "fighter3",
          D: "fighter4",
          E: "fighter5",
          F: "fighter6",
          G: "fighter7",
          H: "fighter8",
          I: "fighter9",
          J: "fighter10",
        };

        // Map topology nodes to include only properties needed for tooltip and rendering
        const motherNodeId = udpData.topology.motherNodeId;

        const topologyNodesWithProps = topologyNodes.map((node) => ({
          globalId: node.id,
          longitude: node.long,
          latitude: node.lat,
          groupId: nodeToGroup.get(node.id) || "A", // Needed for icon selection
          isMotherNode: node.id === motherNodeId,
        }));

        layers.push(
          new IconLayer({
            id: topologyNodesLayerId,
            data: topologyNodesWithProps,
            pickable: true,
            onHover: onHover,
            parameters: { depthTest: false, depthMask: false },
            getIcon: (d: any) => {
              // Mother node gets special icon (configurable via store)
              if (d.isMotherNode) {
                const mSymbol = motherNodeSymbol || "mother-fighter";
                return {
                  url: `icons/${mSymbol}.svg`,
                  width: 48,
                  height: 48,
                  anchorY: 24,
                  anchorX: 24,
                  mask: false,
                };
              }
              const groupId = d.groupId || "A";
              // Get group-specific icon, fallback to default for group, then fighter1
              const groupSymbol = getGroupSymbol(groupId);
              const symbol =
                groupSymbol || defaultGroupIcons[groupId] || "fighter1";
              const isRectangularIcon = [
                "ground_unit",
                "command_post",
                "naval_unit",
              ].includes(symbol);
              return {
                url: `icons/${symbol}.svg`,
                width: isRectangularIcon ? 42 : 48,
                height: isRectangularIcon ? 30 : 48,
                anchorY: isRectangularIcon ? 15 : 24,
                anchorX: isRectangularIcon ? 21 : 24,
                mask: false,
              };
            },
            getPosition: (d: any) => [
              d.longitude || d.long,
              d.latitude || d.lat,
            ],
            getSize: 48,
            sizeScale: 1,
            getPixelOffset: [0, 0],
            alphaCutoff: 0.001,
            billboard: true,
            sizeUnits: "pixels",
            sizeMinPixels: 36,
            sizeMaxPixels: 64,
            updateTriggers: {
              getPosition: [udpData.topology.nodes.size],
              getIcon: [
                udpData.topology.nodes.size,
                nodeSymbols,
                groupSymbols,
                motherNodeSymbol,
              ],
            },
          }),
        );
      }
    }

    return layers;
  }, [
    udpData,
    onHover,
    networkLayersVisible,
    getNodeSymbol,
    getLayerSymbol,
    getGroupSymbol,
    nodeSymbols,
    groupSymbols,
    motherNodeSymbol,
    snrColors,
    snrLineWidths,
  ]);

  return { udpLayers, connectionError, noDataWarning, isConnected };
};
