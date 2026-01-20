import { useEffect, useMemo } from "react";
import { IconLayer, LineLayer } from "@deck.gl/layers";
import { useNetworkLayersVisible } from "@/store/layers-store";
import { useUdpSymbolsStore } from "@/store/udp-symbols-store";
import { useUdpConfigStore } from "@/store/udp-config-store";
import { useUdpDataStore } from "@/store/udp-data-store";
import { Udp } from "../../plugins/udp";

// Test mode configuration - set to true to use WebSocket instead of UDP
const IS_TEST = false;
const WS_IP = "192.168.1.213";
const WS_PORT = 8080;

// Shared connection state to prevent multiple instances from creating duplicate connections
let globalConnectionState = {
  isConnected: false,
  isConnecting: false,
  host: null as string | null,
  port: null as number | null,
  websocket: null as WebSocket | null,
  listener: null as { remove: () => void } | null,
  noDataTimeout: null as NodeJS.Timeout | null,
};

// UdpLayerData interface is now defined in udp-data-store.ts

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

  const readString = (start: number, len: number) => {
    const bytes = [];
    for (let i = 0; i < len; i++) {
      const byte = readBits(start + i * 8, 8);
      if (byte === 0) break;
      bytes.push(byte);
    }
    return String.fromCharCode(...bytes);
  };

  const header = {
    msgId: readBits(0, 8),
    opcode: readBits(8, 8),
    reserved0: readBits(16, 32),
    reserved1: readBits(48, 32),
    reserved2: readBits(80, 32),
  };

  const opcode = header.opcode;

  if (opcode === 101) {
    // Network Members Positions
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
    return {
      type: "networkMemberPositions",
      opcode: 101,
      data: members,
      header,
    };
  }

  if (opcode === 102) {
    // Network Members Metadata
    const numMembers = readBits(128, 8);
    let offset = 160;
    const members = [];

    for (let i = 0; i < numMembers; i++) {
      // opcode102B - globalData (40 bytes = 320 bits)
      const globalId = readU32(offset);
      const callsign = readString(offset + 32, 6);
      const callsignId = readBits(offset + 80, 16);

      // opcode102C - internalData (4 bytes = 32 bits, starts at offset+320)
      const internalOffset = offset + 320;
      const isMotherAc = readBits(internalOffset, 8);
      const trackId = readBits(internalOffset + 8, 16);

      // opcode102D - regionalData (starts at offset+352)
      const regionalOffset = offset + 352;
      const isValid = readBits(regionalOffset, 8);
      const role = readBits(regionalOffset + 8, 8);
      const idnTag = readBits(regionalOffset + 16, 8);
      const acCategory = readBits(regionalOffset + 24, 8);
      const isMissionLeader = readBits(regionalOffset + 32, 8);
      const isRogue = readBits(regionalOffset + 40, 8);
      const isFormation = readBits(regionalOffset + 48, 8);
      const recoveryEmergency = readBits(regionalOffset + 56, 8);
      const displayId = readBits(regionalOffset + 64, 16);
      const acType = readBits(regionalOffset + 80, 16);
      const bimg = readBits(regionalOffset + 96, 16);
      const timg = readBits(regionalOffset + 112, 16);
      const c2Critical = readBits(regionalOffset + 128, 8);
      const controllingNodeId = readBits(regionalOffset + 136, 8);
      const ctn = readString(regionalOffset + 152, 5);

      // opcode102G - metadata (8 bytes, part of regionalData at regionalOffset+192)
      const metadataOffset = regionalOffset + 192;
      const baroAltitude = readI16(metadataOffset);
      const groundSpeed = readI16(metadataOffset + 16);
      const mach = readI16(metadataOffset + 32);

      // opcode102E - battleGroupData (starts at offset+608 = offset+320+32+256)
      const battleOffset = offset + 608;
      const bgIsValid = readBits(battleOffset, 8);
      const q1LockFinalizationState = readBits(battleOffset + 8, 8);
      const q2LockFinalizationState = readBits(battleOffset + 16, 8);
      const fuelState = readBits(battleOffset + 24, 8);
      const q1LockGlobalId = readU32(battleOffset + 32);
      const q2LockGlobalId = readU32(battleOffset + 64);
      const radarLockGlobalId = readU32(battleOffset + 96);
      const combatEmergency = readBits(battleOffset + 160, 8);
      const chaffRemaining = readBits(battleOffset + 168, 8);
      const flareRemaining = readBits(battleOffset + 176, 8);
      const masterArmStatus = readBits(battleOffset + 184, 8);
      const acsStatus = readBits(battleOffset + 192, 8);
      const fuel = readBits(battleOffset + 200, 8);
      const numOfWeapons = readBits(battleOffset + 208, 8);
      const numOfSensors = readBits(battleOffset + 216, 8);

      // Parse weaponsData
      let weaponsOffset = battleOffset + 224;
      const weaponsData = [];
      for (let w = 0; w < numOfWeapons; w++) {
        weaponsData.push({
          code: readBits(weaponsOffset, 8),
          value: readBits(weaponsOffset + 8, 8),
        });
        weaponsOffset += 32;
      }

      // Parse sensorsData
      let sensorsOffset = weaponsOffset;
      const sensorsData = [];
      for (let s = 0; s < numOfSensors; s++) {
        sensorsData.push({
          code: readBits(sensorsOffset, 8),
          value: readBits(sensorsOffset + 8, 8),
        });
        sensorsOffset += 32;
      }

      const member = {
        globalId,
        callsign,
        callsignId,
        isMotherAc,
        trackId,
        isValid,
        role,
        idnTag,
        acCategory,
        isMissionLeader,
        isRogue,
        isFormation,
        recoveryEmergency,
        displayId,
        acType,
        bimg,
        timg,
        c2Critical,
        controllingNodeId,
        ctn,
        baroAltitude,
        groundSpeed,
        mach,
        battleGroupData: {
          isValid: bgIsValid,
          q1LockFinalizationState,
          q2LockFinalizationState,
          fuelState,
          q1LockGlobalId,
          q2LockGlobalId,
          radarLockGlobalId,
          combatEmergency,
          chaffRemaining,
          flareRemaining,
          masterArmStatus,
          acsStatus,
          fuel,
          weaponsData,
          sensorsData,
        },
        opcode: 102,
      };

      members.push(member);

      // Calculate next member offset (base + variable weapons + sensors)
      offset = sensorsOffset;
    }

    return {
      type: "networkMemberMetadata",
      opcode: 102,
      data: members,
      header,
    };
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

  if (opcode === 103) {
    // Engaging Members
    const numEngagingMembers = readBits(128, 8);
    let offset = 160;
    const engagingMembers = [];
    for (let i = 0; i < numEngagingMembers; i++) {
      const e = {
        globalId: readU32(offset),
        engagementTargetGid: readU32(offset + 32),
        weaponLaunch: readBits(offset + 64, 8),
        hangFire: readBits(offset + 72, 8),
        tth: readBits(offset + 80, 8),
        tta: readBits(offset + 88, 8),
        engagementTargetWeaponCode: readBits(offset + 96, 8),
        reserved: readBits(offset + 104, 8),
        dMax1: readI16(offset + 112),
        dMax2: readI16(offset + 128),
        dmin: readI16(offset + 144),
        opcode: 103,
      };
      engagingMembers.push(e);
      offset += 160;
    }
    return {
      type: "engagingMembers",
      opcode: 103,
      data: engagingMembers,
      header,
    };
  }

  if (opcode === 105) {
    // Targets with SA Leader
    const numTargets = readBits(128, 16);
    let offset = 160;
    const targets = [];
    for (let i = 0; i < numTargets; i++) {
      const globalId = readU32(offset);
      const displayId = readBits(offset + 32, 16);
      const callSign = readString(offset + 48, 6);
      const callsignId = readBits(offset + 96, 16);
      const iffSensor = readBits(offset + 112, 8);
      const trackSource = readBits(offset + 120, 8);
      const grouped = readBits(offset + 128, 8);
      const isLocked = readBits(offset + 136, 8);
      const localTrackNumber = readBits(offset + 144, 16);
      const saLeader = readU32(offset + 160);
      const acType = readBits(offset + 192, 16);
      const acCategory = readBits(offset + 208, 8);
      const nodeId = readBits(offset + 216, 8);
      const idnTag = readBits(offset + 224, 8);
      const nctr = readBits(offset + 232, 8);
      const jam = readBits(offset + 240, 8);
      const numOfContributors = readBits(offset + 248, 8);
      const lno = readBits(offset + 256, 8);
      const ctn = readString(offset + 264, 5);

      // Parse contributors
      let contributorsOffset = offset + 320;
      const contributors = [];
      for (let c = 0; c < numOfContributors; c++) {
        contributors.push({
          displayId: readBits(contributorsOffset, 16),
          lno: readBits(contributorsOffset + 16, 8),
        });
        contributorsOffset += 32;
      }

      const target = {
        globalId,
        displayId,
        callSign,
        callsignId,
        iffSensor,
        trackSource,
        grouped,
        isLocked,
        localTrackNumber,
        saLeader,
        acType,
        acCategory,
        nodeId,
        idnTag,
        nctr,
        jam,
        numOfContributors,
        lno,
        ctn,
        contributors,
        opcode: 105,
      };

      targets.push(target);
      offset = contributorsOffset;
    }
    return { type: "targets105", opcode: 105, data: targets, header };
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

  if (opcode === 122) {
    // Geo Messages
    const globalId = readU32(128);
    const messageId = readU32(160);
    const senderGid = readU32(192);
    const latitude = readU32(224) / 11930469;
    const longitude = readU32(256) / 11931272.17;
    const altitude = readI16(288);
    const missionId = readBits(304, 16);
    const source = readBits(320, 8);
    const geoType = readBits(328, 8);
    const action = readBits(336, 8);
    const nodeId = readBits(344, 8);

    return {
      type: "geoMessages",
      opcode: 122,
      data: [
        {
          globalId,
          messageId,
          senderGid,
          latitude,
          longitude,
          altitude,
          missionId,
          source,
          geoType,
          action,
          nodeId,
          opcode: 122,
        },
      ],
      header,
    };
  }

  return { type: "unknown", opcode, header };
};

/**
 * Parse topology binary data from UDP server
 * Format: currentNodeId (UINT8, skip), numFusedNodes (UINT8), then for each node:
 *   - node.id (UINT8)
 *   - neighbor count (UINT8)
 *   - neighbors: neighbor.id (UINT8), neighbor.snr (UINT8) [repeated]
 *   - latitude (INT32 big-endian, microdegrees)
 *   - longitude (INT32 big-endian, microdegrees)
 *   - altitude (UINT16 big-endian, skip but read)
 */
const parseTopologyBinary = (
  buffer: ArrayBuffer
): {
  nodes: Map<
    number,
    {
      id: number;
      lat: number;
      long: number;
      neighbors: Array<{ id: number; snr: number }>;
    }
  >;
  connections: Map<string, number>;
} => {
  const view = new DataView(buffer);
  const bufferLength = buffer.byteLength;
  let offset = 0;

  // Helper function to check if we have enough bytes remaining
  const hasEnoughBytes = (bytesNeeded: number): boolean => {
    return offset + bytesNeeded <= bufferLength;
  };

  // Skip first byte (currentNodeId - we don't need it)
  if (!hasEnoughBytes(1)) {
    console.warn(
      "[Topology Parser] Buffer too small: cannot read currentNodeId"
    );
    return { nodes: new Map(), connections: new Map() };
  }
  offset += 1;

  // Read number of fused nodes (UINT8)
  if (!hasEnoughBytes(1)) {
    console.warn("[Topology Parser] Buffer too small: cannot read numNodes");
    return { nodes: new Map(), connections: new Map() };
  }
  const numNodes = view.getUint8(offset);
  offset += 1;

  const nodes = new Map<
    number,
    {
      id: number;
      lat: number;
      long: number;
      neighbors: Array<{ id: number; snr: number }>;
    }
  >();

  const connections = new Map<string, number>();

  // Parse each node
  for (let i = 0; i < numNodes; i++) {
    // Check if we have enough bytes for node ID (1 byte)
    if (!hasEnoughBytes(1)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${
          i + 1
        }/${numNodes}: cannot read node ID. Parsed ${
          nodes.size
        } nodes successfully.`
      );
      break; // Stop parsing, return what we have
    }
    const nodeId = view.getUint8(offset);
    offset += 1;

    // Check if we have enough bytes for neighbor count (1 byte)
    if (!hasEnoughBytes(1)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${nodeId}: cannot read neighbor count. Parsed ${nodes.size} nodes successfully.`
      );
      break;
    }
    const neighborCount = view.getUint8(offset);
    offset += 1;

    // Read neighbors
    const neighbors: Array<{ id: number; snr: number }> = [];
    for (let j = 0; j < neighborCount; j++) {
      // Check if we have enough bytes for neighbor (2 bytes: id + snr)
      if (!hasEnoughBytes(2)) {
        console.warn(
          `[Topology Parser] Buffer too small at node ${nodeId}, neighbor ${
            j + 1
          }/${neighborCount}: cannot read neighbor data. Parsed ${
            nodes.size
          } nodes successfully.`
        );
        break; // Break out of neighbor loop, continue to next node if possible
      }
      const neighborId = view.getUint8(offset);
      offset += 1;
      const snr = view.getUint8(offset);
      offset += 1;
      neighbors.push({ id: neighborId, snr });

      // Create connection key (always smaller ID first to avoid duplicates)
      const smallerId = Math.min(nodeId, neighborId);
      const largerId = Math.max(nodeId, neighborId);
      const connectionKey = `${smallerId}_${largerId}`;

      // Store connection (overwrite if exists, use latest SNR)
      connections.set(connectionKey, snr);
    }

    // Check if we have enough bytes for latitude (4 bytes INT32)
    if (!hasEnoughBytes(4)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${nodeId}: cannot read latitude. Parsed ${nodes.size} nodes successfully.`
      );
      break;
    }
    const latMicroDegrees = view.getInt32(offset, false); // false = big-endian
    const lat = latMicroDegrees / 1000000;
    offset += 4;

    // Check if we have enough bytes for longitude (4 bytes INT32)
    if (!hasEnoughBytes(4)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${nodeId}: cannot read longitude. Parsed ${nodes.size} nodes successfully.`
      );
      break;
    }
    const longMicroDegrees = view.getInt32(offset, false); // false = big-endian
    const long = longMicroDegrees / 1000000;
    offset += 4;

    // Check if we have enough bytes for altitude (2 bytes UINT16)
    if (!hasEnoughBytes(2)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${nodeId}: cannot read altitude. Parsed ${nodes.size} nodes successfully.`
      );
      break;
    }
    // Skip altitude (UINT16, big-endian) - read but don't store
    offset += 2;

    nodes.set(nodeId, { id: nodeId, lat, long, neighbors });
  }

  return { nodes, connections };
};

/**
 * Convert SNR value to color gradient (red → yellow → green)
 * @param snr Signal-to-Noise Ratio (0-100)
 * @returns RGBA color array [R, G, B, A]
 */
const getSnrColor = (snr: number): [number, number, number, number] => {
  // Normalize SNR to 0-1 range (max SNR = 100)
  const normalized = Math.max(0, Math.min(1, snr / 100));

  if (normalized < 0.5) {
    // Red to Yellow
    const t = normalized * 2; // 0 to 1
    return [255, Math.round(255 * t), 0, 200];
  } else {
    // Yellow to Green
    const t = (normalized - 0.5) * 2; // 0 to 1
    return [Math.round(255 * (1 - t)), 255, 0, 200];
  }
};

export const useUdpLayers = (onHover?: (info: any) => void) => {
  // Use shared store for UDP data so all components access the same data
  // Subscribe to the entire udpData object so components re-render when any part changes
  const udpData = useUdpDataStore((state) => state.udpData);
  const setUdpData = useUdpDataStore((state) => state.setUdpData);
  const connectionError = useUdpDataStore((state) => state.connectionError);
  const setConnectionError = useUdpDataStore(
    (state) => state.setConnectionError
  );
  const noDataWarning = useUdpDataStore((state) => state.noDataWarning);
  const setNoDataWarning = useUdpDataStore((state) => state.setNoDataWarning);
  const isConnected = useUdpDataStore((state) => state.isConnected);
  const setIsConnected = useUdpDataStore((state) => state.setIsConnected);
  const reset = useUdpDataStore((state) => state.reset);
  const resetConnectionState = useUdpDataStore(
    (state) => state.resetConnectionState
  );
  const { networkLayersVisible } = useNetworkLayersVisible();
  const { getNodeSymbol, getLayerSymbol, getGroupSymbol, nodeSymbols } =
    useUdpSymbolsStore();
  const groupSymbols = useUdpSymbolsStore((state) => state.groupSymbols);
  const { host, port } = useUdpConfigStore();

  useEffect(() => {
    if (!networkLayersVisible) {
      // Only cleanup if this is the last instance and connection exists
      if (
        globalConnectionState.isConnected &&
        globalConnectionState.host === host &&
        globalConnectionState.port === port
      ) {
        // Clear global state
        if (globalConnectionState.noDataTimeout) {
          clearTimeout(globalConnectionState.noDataTimeout);
          globalConnectionState.noDataTimeout = null;
        }
        if (globalConnectionState.websocket) {
          globalConnectionState.websocket.close();
          globalConnectionState.websocket = null;
        }
        if (globalConnectionState.listener) {
          globalConnectionState.listener.remove();
          globalConnectionState.listener = null;
        }
        if (!IS_TEST) {
          Udp.closeAllSockets().catch(console.error);
        }
        globalConnectionState.isConnected = false;
        globalConnectionState.isConnecting = false;
        globalConnectionState.host = null;
        globalConnectionState.port = null;
      }

      // Only reset connection state, preserve data so it comes back when toggled on
      resetConnectionState();
      return;
    }

    // For test mode, use WebSocket; otherwise check UDP config
    if (IS_TEST) {
      // WebSocket mode - use hardcoded WS_IP and WS_PORT
      if (!WS_IP || !WS_PORT || WS_PORT <= 0) {
        reset();
        return;
      }
    } else {
      // UDP mode - check if host or port are configured
      if (!host || !host.trim() || !port || port <= 0) {
        reset();
        return;
      }
    }

    // Check if connection already exists for the same host/port
    const connectionKey = `${host}:${port}`;
    const existingConnectionKey =
      globalConnectionState.host && globalConnectionState.port
        ? `${globalConnectionState.host}:${globalConnectionState.port}`
        : null;

    // If connection already exists for same host/port, don't create a new one
    if (
      globalConnectionState.isConnected &&
      existingConnectionKey === connectionKey
    ) {
      // Connection already exists, just sync local state
      setIsConnected(true);
      setConnectionError(null);
      setNoDataWarning(null);
      return;
    }

    // If already connecting, don't start another connection
    if (
      globalConnectionState.isConnecting &&
      existingConnectionKey === connectionKey
    ) {
      return;
    }

    // Mark as connecting
    globalConnectionState.isConnecting = true;
    globalConnectionState.host = host;
    globalConnectionState.port = port;

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
          websocket = new WebSocket(wsUrl);
          websocket.binaryType = "arraybuffer";

          websocket.onopen = () => {
            connectionEstablished = true;
            globalConnectionState.isConnected = true;
            globalConnectionState.isConnecting = false;
            globalConnectionState.websocket = websocket;
            setIsConnected(true);
            setConnectionError(null);

            // Send registration message
            try {
              websocket?.send("bridge-register");
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
              globalConnectionState.isConnected = false;
            }, 15000);
            globalConnectionState.noDataTimeout = noDataTimeout;
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
            globalConnectionState.isConnected = false;
            globalConnectionState.isConnecting = false;
            globalConnectionState.websocket = null;
          };

          websocket.onclose = (event) => {
            setIsConnected(false);
            globalConnectionState.isConnected = false;
            globalConnectionState.isConnecting = false;
            globalConnectionState.websocket = null;
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
          await Udp.create({ address: host, port });
          connectionEstablished = true;
          globalConnectionState.isConnected = true;
          globalConnectionState.isConnecting = false;
          setIsConnected(true);
          setConnectionError(null);

          // Check for no data after 5 seconds
          noDataTimeout = setTimeout(() => {
            setNoDataWarning(
              "Please check the UDP server configurations. No data is coming!"
            );
            setIsConnected(false);
            globalConnectionState.isConnected = false;
          }, 5000);
          globalConnectionState.noDataTimeout = noDataTimeout;

          // Send registration message to UDP server
          try {
            await Udp.send({
              address: host,
              port: port,
              data: "bridge-register",
            });
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
          globalConnectionState.isConnected = false;
          globalConnectionState.isConnecting = false;
          setConnectionError(fullErrorMessage);
          alert(fullErrorMessage);
        }
      }
    };

    // Helper function to handle binary messages (shared between UDP and WebSocket)
    const handleBinaryMessage = (
      buffer: ArrayBuffer | number[] | Uint8Array
    ) => {
      // Convert buffer to ArrayBuffer if needed
      let arrayBuffer: ArrayBuffer;
      if (buffer instanceof ArrayBuffer) {
        arrayBuffer = buffer;
      } else if (Array.isArray(buffer)) {
        // Convert array to ArrayBuffer
        const uint8Array = new Uint8Array(buffer);
        arrayBuffer = uint8Array.buffer;
      } else if (buffer instanceof Uint8Array) {
        // Create a new ArrayBuffer from Uint8Array
        arrayBuffer = new Uint8Array(buffer).buffer;
      } else {
        console.error("[Topology] Unknown buffer type:", typeof buffer);
        return;
      }

      // Try topology parsing first
      try {
        const topologyData = parseTopologyBinary(arrayBuffer);

        // If successful, update store and return early
        setUdpData((prev) => ({
          ...prev,
          topology: {
            nodes: topologyData.nodes,
            connections: topologyData.connections,
          },
        }));
        return; // Exit early, don't parse as regular binary
      } catch (e) {
        // Not topology format, continue to regular parser
        console.log("[Topology] Parse failed, trying regular parser:", e);
      }

      // Fall back to regular binary parser
      const parsed = parseBinaryMessage(arrayBuffer);
      const enrichedData = {
        ...parsed,
        timestamp: new Date().toISOString(),
        rawLength: arrayBuffer.byteLength,
      };

      if (enrichedData.type === "networkMemberPositions") {
        // Store positions in Map, then merge with metadata
        setUdpData((prev) => {
          const newPositions = new Map(prev.networkMemberPositions);
          (enrichedData.data || []).forEach((member: any) => {
            newPositions.set(member.globalId, member);
          });

          // Merge positions with metadata
          const merged = Array.from(newPositions.values()).map((pos) => {
            const meta = prev.networkMemberMetadata.get(pos.globalId);
            const result = meta ? { ...pos, ...meta } : pos;
            return result;
          });

          return {
            ...prev,
            networkMemberPositions: newPositions,
            networkMembers: merged,
          };
        });
      } else if (enrichedData.type === "networkMemberMetadata") {
        // Store metadata in Map, then merge with positions
        setUdpData((prev) => {
          const newMetadata = new Map(prev.networkMemberMetadata);
          (enrichedData.data || []).forEach((member: any) => {
            newMetadata.set(member.globalId, member);
          });

          // Merge positions with metadata
          const merged = Array.from(prev.networkMemberPositions.values()).map(
            (pos) => {
              const meta = newMetadata.get(pos.globalId);
              const result = meta ? { ...pos, ...meta } : pos;
              return result;
            }
          );

          return {
            ...prev,
            networkMemberMetadata: newMetadata,
            networkMembers: merged,
          };
        });
      } else if (enrichedData.type === "targets") {
        setUdpData((prev) => ({
          ...prev,
          targets: enrichedData.data || [],
        }));
      } else if (enrichedData.type === "engagingMembers") {
        setUdpData((prev) => ({
          ...prev,
          engagingMembers: enrichedData.data || [],
        }));
      } else if (enrichedData.type === "threats") {
        setUdpData((prev) => ({
          ...prev,
          threats: enrichedData.data || [],
        }));
      } else if (enrichedData.type === "geoMessages") {
        setUdpData((prev) => ({
          ...prev,
          geoMessages: enrichedData.data || [],
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
        // Only set up listener if one doesn't already exist
        if (!globalConnectionState.listener) {
          // Listen for UDP messages (only for UDP, WebSocket handles via onmessage)
          listener = await Udp.addListener("udpMessage", (event: any) => {
            try {
              setNoDataWarning(null);
              setIsConnected(true);
              globalConnectionState.isConnected = true;
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
      // Cleanup function runs when dependencies change or component unmounts
      // When networkLayersVisible becomes false, the effect body already handles cleanup above
      // This cleanup mainly handles component unmount or dependency changes
      // Note: networkLayersVisible in this closure is the OLD value when deps change

      // If the old value was true and we had a connection, cleanup when unmounting or when toggling off
      // But since the effect body already handles the toggle-off case, we mainly handle unmount here
      // We'll let the effect body handle the networkLayersVisible = false case

      // Only cleanup connection if we're unmounting (not just toggling)
      // The effect body at the top already handles the toggle-off case
      const connectionKey = `${host}:${port}`;
      const existingConnectionKey =
        globalConnectionState.host && globalConnectionState.port
          ? `${globalConnectionState.host}:${globalConnectionState.port}`
          : null;

      // Only cleanup if connection matches this instance and is still active
      // The effect body already handled cleanup when networkLayersVisible became false
      if (
        existingConnectionKey === connectionKey &&
        globalConnectionState.isConnected
      ) {
        if (globalConnectionState.noDataTimeout) {
          clearTimeout(globalConnectionState.noDataTimeout);
          globalConnectionState.noDataTimeout = null;
        }

        // Close WebSocket if open
        if (globalConnectionState.websocket) {
          globalConnectionState.websocket.close();
          globalConnectionState.websocket = null;
        }

        // Close UDP if open
        if (!IS_TEST) {
          Udp.closeAllSockets().catch(console.error);
        }
        if (globalConnectionState.listener) {
          globalConnectionState.listener.remove();
          globalConnectionState.listener = null;
        }
        globalConnectionState.isConnected = false;
        globalConnectionState.isConnecting = false;
        globalConnectionState.host = null;
        globalConnectionState.port = null;

        // Only reset connection state (not data) - preserve data for when toggle comes back on
        resetConnectionState();
      }
    };
  }, [networkLayersVisible, host, port]);

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
          !isNaN(d.latitude)
      );

      // Build connections based on controllingNodeId
      validMembers.forEach((member: any) => {
        if (member.controllingNodeId && member.controllingNodeId !== 0) {
          const controller = validMembers.find(
            (m: any) => m.globalId === member.controllingNodeId
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
          getSourcePosition: (d: any) => [d.from.longitude, d.from.latitude],
          getTargetPosition: (d: any) => [d.to.longitude, d.to.latitude],
          getColor: (d: any) => d.color,
          getWidth: 2,
          widthUnits: "pixels",
          widthMinPixels: 1,
          widthMaxPixels: 4,
        })
      );
    }

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
            getIcon: (_d: any) => {
              const customSymbol = getLayerSymbol(networkMembersLayerId);
              const symbol = customSymbol || "fighter8";
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
            getIcon: (_d: any) => {
              const customSymbol = getLayerSymbol(targetsLayerId);
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

    // Geo Messages layer (Opcode 122)
    if (udpData.geoMessages.length > 0) {
      const validGeoMessages = udpData.geoMessages.filter(
        (d: any) =>
          d &&
          typeof d.longitude === "number" &&
          typeof d.latitude === "number" &&
          !isNaN(d.longitude) &&
          !isNaN(d.latitude)
      );

      if (validGeoMessages.length > 0) {
        layers.push(
          new IconLayer({
            id: geoMessagesLayerId,
            data: validGeoMessages,
            pickable: false, // No tooltip for geo messages
            getIcon: (_d: any) => {
              return {
                url: `/icons/unknown_aircraft.svg`,
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
          })
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
            color: getSnrColor(snr),
          });
        }
      });

      if (connectionData.length > 0) {
        layers.push(
          new LineLayer({
            id: "udp-topology-connections-layer",
            data: connectionData,
            pickable: true,
            getSourcePosition: (d: any) => [d.from.longitude, d.from.latitude],
            getTargetPosition: (d: any) => [d.to.longitude, d.to.latitude],
            getColor: (d: any) => d.color,
            getWidth: 3,
            widthUnits: "pixels",
            widthMinPixels: 2,
            widthMaxPixels: 6,
          })
        );
      } else {
      }
    } else {
    }

    // Topology Nodes Layer
    if (udpData.topology.nodes.size > 0) {
      const topologyNodes = Array.from(udpData.topology.nodes.values()).filter(
        (node) =>
          typeof node.long === "number" &&
          typeof node.lat === "number" &&
          !isNaN(node.long) &&
          !isNaN(node.lat)
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

        // Map topology nodes to include properties needed for tooltip and member actions
        const topologyNodesWithProps = topologyNodes.map((node) => ({
          ...node,
          globalId: node.id,
          displayId: node.id,
          callsign: `Node ${node.id}`,
          latitude: node.lat,
          longitude: node.long,
          neighborCount: node.neighbors?.length || 0,
          groupId: nodeToGroup.get(node.id) || "A",
        }));

        layers.push(
          new IconLayer({
            id: topologyNodesLayerId,
            data: topologyNodesWithProps,
            pickable: true,
            onHover: onHover,
            getIcon: (d: any) => {
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
                url: `/icons/${symbol}.svg`,
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
              getIcon: [udpData.topology.nodes.size, nodeSymbols, groupSymbols],
            },
          })
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
  ]);

  return { udpLayers, connectionError, noDataWarning, isConnected };
};
