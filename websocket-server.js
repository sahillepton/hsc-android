// WebSocket Server + UDP Bridge
// Run: node websocket-server.js
// Or: yarn ws-server
//
// This bridge:
// 1. Connects to UDP server on port 5005
// 2. Receives binary buffers from UDP server
// 3. Forwards them to WebSocket clients on port 8080

import { WebSocketServer, WebSocket } from 'ws';
import dgram from 'dgram';

const WS_PORT = 8080;
const UDP_SERVER_PORT = 5005;
const UDP_SERVER_HOST = 'localhost';

// Create WebSocket server
const wss = new WebSocketServer({ port: WS_PORT });

// Create UDP socket to connect to UDP server
const udpSocket = dgram.createSocket('udp4');

// Store connected WebSocket clients
const wsClients = new Set();

console.log(`✅ WebSocket server started on ws://localhost:${WS_PORT}`);
console.log(`✅ UDP bridge connecting to ${UDP_SERVER_HOST}:${UDP_SERVER_PORT}`);
console.log(`📡 Bridge ready - waiting for connections...`);

// Binary parsing functions
const parseBinaryMessage = (msg) => {
  // Convert buffer to binary string
  const bin = Array.from(msg)
    .map((b) => b.toString(2).padStart(8, "0"))
    .join("");

  const readBits = (start, len) =>
    parseInt(bin.slice(start, start + len), 2);

  const readI16 = (start) => {
    let v = readBits(start, 16);
    return v & 0x8000 ? v - 0x10000 : v;
  };

  const readU32 = (start) => readBits(start, 32);

  // Read header
  const header = {
    msgId: readBits(0, 8),
    opcode: readBits(8, 8),
    reserved0: readBits(16, 32),
    reserved1: readBits(48, 32),
    reserved2: readBits(80, 32),
  };

  const opcode = header.opcode;

  // Parse based on opcode
  if (opcode === 101) {
    // Network Members
    const numMembers = readBits(128, 8); // byte 16
    let offset = 160; // skip reserved[3]
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
      offset += 192; // 24 bytes = 192 bits
    }
    return { type: 'networkMembers', opcode: 101, data: members, header };
  }

  if (opcode === 104) {
    // Targets
    const numTargets = readBits(128, 16); // bytes 16–17
    let offset = 160; // skip reserved[2]
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
      offset += 192; // 24 bytes = 192 bits
    }
    return { type: 'targets', opcode: 104, data: targets, header };
  }

  if (opcode === 106) {
    // Threats
    const senderGlobalId = readU32(128); // bytes 16-19
    const numOfThreats = readBits(160, 8); // byte 20
    let offset = 192; // skip reserved[3] (bytes 21-23)
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
      offset += 96; // 12 bytes = 96 bits
    }
    return { type: 'threats', opcode: 106, data: threats, header, senderGlobalId };
  }

  // Unknown opcode
  return { type: 'unknown', opcode, header };
};

// UDP message handler - receives binary buffers from UDP server
udpSocket.on('message', (msg, rinfo) => {
  // Parse binary message
  const parsed = parseBinaryMessage(msg);
  
  // Create JSON message with parsed data
  const wsMessage = JSON.stringify({
    ...parsed,
    timestamp: new Date().toISOString(),
    rawLength: msg.length
  });
  
  // Forward to all connected WebSocket clients
  wsClients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(wsMessage);
    }
  });
});

udpSocket.on('error', () => {
  // Silent error handling
});

// Bind UDP socket (use any available port)
udpSocket.bind(() => {
  // Register with UDP server by sending a message
  // This adds us to the server's clients list
  const registerMsg = Buffer.from('bridge-register');
  udpSocket.send(registerMsg, UDP_SERVER_PORT, UDP_SERVER_HOST);
});

// WebSocket connection handler
wss.on('connection', (ws) => {
  wsClients.add(ws);

  // Send welcome message
  ws.send(JSON.stringify({
    message: 'Connected to WebSocket bridge',
    udpServer: `${UDP_SERVER_HOST}:${UDP_SERVER_PORT}`,
    timestamp: new Date().toISOString()
  }));

  ws.on('close', () => {
    wsClients.delete(ws);
  });

  ws.on('error', (error) => {
    wsClients.delete(ws);
  });
});

wss.on('error', () => {
  // Silent error handling
});

