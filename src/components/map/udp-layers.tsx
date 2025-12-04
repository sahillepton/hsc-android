import { useEffect, useMemo, useState } from "react";
import { IconLayer, LineLayer } from "@deck.gl/layers";
import { useNetworkLayersVisible } from "@/store/layers-store";
import { useUdpSymbolsStore } from "@/store/udp-symbols-store";
import { useUdpConfigStore } from "@/store/udp-config-store";
import { Udp } from "../../plugins/udp";

// Test mode configuration - set to true to use WebSocket instead of UDP
const IS_TEST = true;
const WS_IP = "192.168.1.213";
const WS_PORT = 8080;

interface UdpLayerData {
  targets: any[];
  networkMembers: any[];
  networkMemberPositions: Map<number, any>;
  networkMemberMetadata: Map<number, any>;
  engagingMembers: any[];
  threats: any[];
  geoMessages: any[];
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

    console.log("🔍 Parsing Opcode 102 - numMembers:", numMembers);

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

      console.log(`🔍 Member ${i + 1}:`, {
        globalId,
        callsign,
        isMotherAc,
        controllingNodeId,
        role,
      });

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

export const useUdpLayers = (onHover?: (info: any) => void) => {
  const [udpData, setUdpData] = useState<UdpLayerData>({
    targets: [],
    networkMembers: [],
    networkMemberPositions: new Map(),
    networkMemberMetadata: new Map(),
    engagingMembers: [],
    threats: [],
    geoMessages: [],
  });
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [noDataWarning, setNoDataWarning] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { networkLayersVisible } = useNetworkLayersVisible();
  const { getNodeSymbol, getLayerSymbol, nodeSymbols } = useUdpSymbolsStore();
  const { host, port } = useUdpConfigStore();

  useEffect(() => {
    if (!networkLayersVisible) {
      setUdpData({
        targets: [],
        networkMembers: [],
        networkMemberPositions: new Map(),
        networkMemberMetadata: new Map(),
        engagingMembers: [],
        threats: [],
        geoMessages: [],
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
          networkMemberPositions: new Map(),
          networkMemberMetadata: new Map(),
          engagingMembers: [],
          threats: [],
          geoMessages: [],
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
          networkMemberPositions: new Map(),
          networkMemberMetadata: new Map(),
          engagingMembers: [],
          threats: [],
          geoMessages: [],
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
              console.log("🔍 Message received:", event.data);
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

      if (enrichedData.type === "networkMemberPositions") {
        // Store positions in Map, then merge with metadata
        setUdpData((prev) => {
          const newPositions = new Map(prev.networkMemberPositions);
          (enrichedData.data || []).forEach((member: any) => {
            newPositions.set(member.globalId, member);
            console.log(`📍 Stored position for member ${member.globalId}`);
          });

          // Merge positions with metadata
          const merged = Array.from(newPositions.values()).map((pos) => {
            const meta = prev.networkMemberMetadata.get(pos.globalId);
            const result = meta ? { ...pos, ...meta } : pos;
            console.log(`🔄 Merged member ${pos.globalId}:`, {
              hasPosition: true,
              hasMetadata: !!meta,
              controllingNodeId: result.controllingNodeId,
            });
            return result;
          });

          console.log(
            `✅ Total merged members after position update: ${merged.length}`
          );

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
            console.log(`📋 Stored metadata for member ${member.globalId}:`, {
              controllingNodeId: member.controllingNodeId,
              isMotherAc: member.isMotherAc,
            });
          });

          // Merge positions with metadata
          const merged = Array.from(prev.networkMemberPositions.values()).map(
            (pos) => {
              const meta = newMetadata.get(pos.globalId);
              const result = meta ? { ...pos, ...meta } : pos;
              console.log(`🔄 Merged member ${pos.globalId}:`, {
                hasPosition: true,
                hasMetadata: !!meta,
                controllingNodeId: result.controllingNodeId,
              });
              return result;
            }
          );

          console.log(
            `✅ Total merged members after metadata update: ${merged.length}`
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
      } else if (enrichedData.type === "targets105") {
        // Opcode 105 contains SA leader relationships
        // We can use this data for additional topology connections
        console.log("📡 SA Leader data received:", enrichedData.data);
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
        networkMemberPositions: new Map(),
        networkMemberMetadata: new Map(),
        engagingMembers: [],
        threats: [],
        geoMessages: [],
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
    const geoMessagesLayerId = "udp-geo-messages-layer";

    console.log(
      "🔗 Building topology layers with members:",
      udpData.networkMembers
    );

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

      console.log("🔗 Valid members for topology:", validMembers.length);

      // Log all members with their metadata
      validMembers.forEach((member: any, index: number) => {
        console.log(`📊 Member ${index + 1} data:`, {
          globalId: member.globalId,
          callsign: member.callsign,
          isMotherAc: member.isMotherAc,
          controllingNodeId: member.controllingNodeId,
          role: member.role,
          hasPosition: !!(member.latitude && member.longitude),
          hasMetadata: !!(member.callsign || member.role !== undefined),
        });
      });

      // Build connections based on controllingNodeId
      validMembers.forEach((member: any) => {
        console.log(
          `🔍 Checking member ${member.globalId}, controllingNodeId: ${member.controllingNodeId}`
        );

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
            console.log(
              `✅ Control connection: ${controller.globalId} → ${member.globalId}`
            );
          } else {
            console.log(
              `❌ Controller not found for member ${member.globalId}, looking for globalId ${member.controllingNodeId}`
            );
          }
        } else {
          console.log(
            `⚠️ Member ${member.globalId} has no controller (controllingNodeId: ${member.controllingNodeId})`
          );
        }
      });

      console.log(`🔗 Total topology connections: ${connections.length}`);
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
      console.log(
        "✅ Added topology LineLayer with",
        connections.length,
        "connections"
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

    return layers;
  }, [
    udpData.targets,
    udpData.networkMembers,
    udpData.geoMessages,
    onHover,
    networkLayersVisible,
    getNodeSymbol,
    getLayerSymbol,
    nodeSymbols,
  ]);

  return { udpLayers, connectionError, noDataWarning, isConnected };
};
