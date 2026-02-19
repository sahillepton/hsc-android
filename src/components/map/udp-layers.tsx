import { useEffect, useMemo } from "react";
import { IconLayer, LineLayer } from "@deck.gl/layers";
import { useNetworkLayersVisible } from "@/store/layers-store";
import { useUdpSymbolsStore } from "@/store/udp-symbols-store";
import { useUdpDataStore } from "@/store/udp-data-store";
import { Udp } from "../../plugins/udp";

// Shared connection state to prevent multiple instances from creating duplicate connections
const globalConnectionState = {
  isConnected: false,
  isConnecting: false,
  listener: null as { remove: () => void } | null,
  noDataTimeout: null as NodeJS.Timeout | null,
  staleCheckInterval: null as NodeJS.Timeout | null,
  lastMessageTime: null as number | null,
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
    const v = readBits(start, 16);
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
 *       - INT32 latitude (4 bytes, big-endian, microdegrees)
 *       - INT32 longitude (4 bytes, big-endian, microdegrees)
 *       - UINT16 altitude (2 bytes, big-endian)
 *     - int8_t RSSI (1 byte, signed, -128 to 127)
 */
const parseTopologyBinary = (
  buffer: ArrayBuffer
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
      rssi: number;
      neighbors: Array<{ id: number; snr: number }>;
    }
  >;
  connections: Map<string, number>;
} => {
  const view = new DataView(buffer);
  const bufferLength = buffer.byteLength;
  let offset = 0;

  const hasEnoughBytes = (bytesNeeded: number): boolean => {
    return offset + bytesNeeded <= bufferLength;
  };

  const emptyResult = { motherNodeId: null as number | null, nodes: new Map() as Map<number, any>, connections: new Map() as Map<string, number> };

  // --- Header ---

  // ExtMsgType (1 byte)
  if (!hasEnoughBytes(1)) {
    console.warn(
      "[Topology Parser] Buffer too small: cannot read ext_msg_type"
    );
    return emptyResult;
  }
  offset += 1;

  // payload_length (2 bytes, big-endian)
  if (!hasEnoughBytes(2)) {
    console.warn(
      "[Topology Parser] Buffer too small: cannot read payload_length"
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
      "[Topology Parser] Buffer too small: cannot read numFusedNodes"
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
      rssi: number;
      neighbors: Array<{ id: number; snr: number }>;
    }
  >();
  const connections = new Map<string, number>();

  // --- topoWithNodeIP[] ---
  for (let i = 0; i < numFusedNodes; i++) {
    // IP[4] (4 bytes, big-endian / network byte order)
    if (!hasEnoughBytes(4)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${i + 1}/${numFusedNodes}: cannot read IP`
      );
      break;
    }
    const ip = `${view.getUint8(offset)}.${view.getUint8(offset + 1)}.${view.getUint8(offset + 2)}.${view.getUint8(offset + 3)}`;
    offset += 4;

    // topology.id (1 byte)
    if (!hasEnoughBytes(1)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${i + 1}/${numFusedNodes}: cannot read topology id`
      );
      break;
    }
    const nodeId = view.getUint8(offset);
    offset += 1;

    // topology.numNeighbors (1 byte)
    if (!hasEnoughBytes(1)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${i + 1}/${numFusedNodes}: cannot read numNeighbors`
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
          `[Topology Parser] Buffer too small at node ${nodeId}, neighbor ${j + 1}/${numNeighbors}`
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

    // positional.latitude (INT32, big-endian, microdegrees)
    if (!hasEnoughBytes(4)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${nodeId}: cannot read latitude`
      );
      break;
    }
    const lat = view.getInt32(offset, false) / 1000000;
    offset += 4;

    // positional.longitude (INT32, big-endian, microdegrees)
    if (!hasEnoughBytes(4)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${nodeId}: cannot read longitude`
      );
      break;
    }
    const long = view.getInt32(offset, false) / 1000000;
    offset += 4;

    // positional.altitude (UINT16, big-endian)
    if (!hasEnoughBytes(2)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${nodeId}: cannot read altitude`
      );
      break;
    }
    const altitude = view.getUint16(offset, false);
    offset += 2;

    // RSSI (int8_t, signed, -128 to 127)
    if (!hasEnoughBytes(1)) {
      console.warn(
        `[Topology Parser] Buffer too small at node ${nodeId}: cannot read RSSI`
      );
      break;
    }
    const rssi = view.getInt8(offset);
    offset += 1;

    nodes.set(nodeId, { id: nodeId, ip, lat, long, altitude, rssi, neighbors });
  }

  console.log("[Topology] Parsed nodes:", JSON.stringify(Array.from(nodes.values()), null, 2));

  return { motherNodeId, nodes, connections };
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
  const resetConnectionState = useUdpDataStore(
    (state) => state.resetConnectionState
  );
  const { networkLayersVisible } = useNetworkLayersVisible();
  const { getNodeSymbol, getLayerSymbol, getGroupSymbol, nodeSymbols, motherNodeSymbol } =
    useUdpSymbolsStore();
  const groupSymbols = useUdpSymbolsStore((state) => state.groupSymbols);

  useEffect(() => {
    if (!networkLayersVisible) {
      // Only cleanup if this is the last instance and connection exists
      if (globalConnectionState.isConnected) {
        // Clear global state
        if (globalConnectionState.noDataTimeout) {
          clearTimeout(globalConnectionState.noDataTimeout);
          globalConnectionState.noDataTimeout = null;
        }
        if (globalConnectionState.staleCheckInterval) {
          clearInterval(globalConnectionState.staleCheckInterval);
          globalConnectionState.staleCheckInterval = null;
        }
        globalConnectionState.lastMessageTime = null;
        if (globalConnectionState.listener) {
          globalConnectionState.listener.remove();
          globalConnectionState.listener = null;
        }
        Udp.closeAllSockets().catch(console.error);
        globalConnectionState.isConnected = false;
        globalConnectionState.isConnecting = false;
      }

      // Only reset connection state, preserve data so it comes back when toggled on
      resetConnectionState();
      return;
    }

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
    let noDataTimeout: NodeJS.Timeout | null = null;
    setConnectionError(null);
    setNoDataWarning(null);

    const connectUdp = async () => {
      try {
        // Create UDP socket bound to port 40074 (handled in native plugin)
        await Udp.create({});
        connectionEstablished = true;
        globalConnectionState.isConnected = true;
        globalConnectionState.isConnecting = false;
        setIsConnected(true);
        setConnectionError(null);

        // Check for no data after 5 seconds
        noDataTimeout = setTimeout(() => {
          setNoDataWarning(
            "No data received on port 40074. Please check network connectivity."
          );
          setIsConnected(false);
          globalConnectionState.isConnected = false;
        }, 5000);
        globalConnectionState.noDataTimeout = noDataTimeout;

        // No registration message needed - data arrives automatically from intranet

        // Start stale data check — clear topology if no data for 10 seconds
        if (globalConnectionState.staleCheckInterval) {
          clearInterval(globalConnectionState.staleCheckInterval);
        }
        globalConnectionState.staleCheckInterval = setInterval(() => {
          if (globalConnectionState.lastMessageTime === null) return;
          const now = Date.now();
          if (now - globalConnectionState.lastMessageTime > 5000) {
            console.log("[UDP] No data for 5s — clearing stale topology");
            globalConnectionState.lastMessageTime = null;
            setUdpData((prev) => ({
              ...prev,
              topology: {
                motherNodeId: null,
                nodes: new Map(),
                connections: new Map(),
              },
            }));
          }
        }, 2000);
      } catch (error: any) {
        console.error("❌ UDP connection error:", error);
        const errorMessage =
          error?.message || error?.toString() || "Unknown error";
        const fullErrorMessage = `Failed to bind UDP socket on port 40074!\n\nError: ${errorMessage}\n\nPlease check network permissions.`;
        setIsConnected(false);
        globalConnectionState.isConnected = false;
        globalConnectionState.isConnecting = false;
        setConnectionError(fullErrorMessage);
        alert(fullErrorMessage);
      }
    };

    // Helper function to handle binary messages
    const handleBinaryMessage = (
      buffer: ArrayBuffer | number[] | Uint8Array
    ) => {
      // Track last message time for stale detection
      globalConnectionState.lastMessageTime = Date.now();

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

        // If successful and we got nodes, update store and return early
        if (topologyData.nodes.size > 0) {
          setUdpData((prev) => ({
            ...prev,
            topology: {
              motherNodeId: topologyData.motherNodeId,
              nodes: topologyData.nodes,
              connections: topologyData.connections,
            },
          }));
          return; // Exit early, don't parse as regular binary
        }
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

    let listener: { remove: () => void } | null = null;

    const setupListener = async () => {
      await connectUdp();

      if (connectionEstablished) {
        // Only set up listener if one doesn't already exist
        if (!globalConnectionState.listener) {
          // Listen for UDP messages
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
  }, [networkLayersVisible]);

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
          parameters: { depthTest: false, depthMask: false },
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
      const validNetworkMembers = udpData.networkMembers
        .filter(
          (d: any) =>
            d &&
            typeof d.longitude === "number" &&
            typeof d.latitude === "number" &&
            !isNaN(d.longitude) &&
            !isNaN(d.latitude)
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
      const validTargets = udpData.targets
        .filter(
          (d: any) =>
            d &&
            typeof d.longitude === "number" &&
            typeof d.latitude === "number" &&
            !isNaN(d.longitude) &&
            !isNaN(d.latitude)
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
            parameters: { depthTest: false, depthMask: false },
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
            parameters: { depthTest: false, depthMask: false },
            getSourcePosition: (d: any) => [d.from.longitude, d.from.latitude],
            getTargetPosition: (d: any) => [d.to.longitude, d.to.latitude],
            getColor: (d: any) => d.color,
            getWidth: 3,
            widthUnits: "pixels",
            widthMinPixels: 2,
            widthMaxPixels: 6,
          })
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
                  url: `/icons/${mSymbol}.svg`,
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
              getIcon: [udpData.topology.nodes.size, nodeSymbols, groupSymbols, motherNodeSymbol],
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
    motherNodeSymbol,
  ]);

  return { udpLayers, connectionError, noDataWarning, isConnected };
};
