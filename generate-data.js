// Generate 250 data messages with movements
import fs from 'fs';

const LAT_RES = 0.000000083819;
const LON_RES = 0.000000083819;

// Base locations
const MEMBERS = {
  10: { name: 'PNJB', lat: 30.9, lon: 75.85 },   // Punjab
  94: { name: 'RAJS', lat: 26.9, lon: 75.8 },    // Rajasthan
  80: { name: 'DELH', lat: 28.6, lon: 77.2 }     // Delhi
};

const TARGETS = {
  1: { lat: 32.7, lon: 74.9 },   // Jammu
  2: { lat: 34.1, lon: 74.8 },   // Kashmir
  3: { lat: 34.4, lon: 73.5 }    // POK
};

function latLonToBytes(val) {
  const raw = Math.round(val / LAT_RES);
  return [(raw >> 24) & 0xFF, (raw >> 16) & 0xFF, (raw >> 8) & 0xFF, raw & 0xFF];
}

function globalIdToBytes(id) {
  return [0, 0, 0, id];
}

function createOpcode101(seqNum, members) {
  const header = [
    seqNum & 0xFF, 101, 1, 0, 0, 0, 0, 28, 0, 0, 1, 154, 51, 145, 
    (seqNum >> 8) & 0xFF, seqNum & 0xFF
  ];
  
  const numMembers = Object.keys(members).length;
  const buffer = [...header, numMembers, 0, 0, 0];
  
  for (const [id, pos] of Object.entries(members)) {
    const gid = globalIdToBytes(parseInt(id));
    const lat = latLonToBytes(pos.lat);
    const lon = latLonToBytes(pos.lon);
    buffer.push(...gid, ...lat, ...lon, 15, 158, 174, 178, 72, 195, 0, 0, 127, 254, 0, 0);
  }
  
  return buffer;
}

function createOpcode102(seqNum, id, name, controllingId) {
  const header = [
    seqNum & 0xFF, 102, 1, 0, 0, 0, 0, 28, 0, 0, 1, 154, 51, 145,
    (seqNum >> 8) & 0xFF, seqNum & 0xFF
  ];
  
  const gid = globalIdToBytes(id);
  const callsign = [name.charCodeAt(0), name.charCodeAt(1), name.charCodeAt(2), name.charCodeAt(3), 0, 0];
  const radioData = new Array(28).fill(0);
  const internalData = [1, 0, 0, 0];
  const regionalData = [1, 1, 1, 1, 0, 0, 0, 0, id, 0, 20, 0, 30, 0, 40, 0, 0, controllingId];
  const ctn = [name.charCodeAt(0), name.charCodeAt(1), name.charCodeAt(2), name.charCodeAt(3), 0];
  const padding = new Array(11).fill(0);
  const battleData = new Array(40).fill(0);
  battleData[0] = 1;
  
  return [
    ...header,
    1, 0, 0, 0,
    ...gid, ...callsign, 1, 0,
    ...radioData,
    ...internalData,
    ...regionalData,
    ...ctn,
    ...padding,
    ...battleData
  ];
}

function createOpcode104(seqNum, targets) {
  const header = [
    seqNum & 0xFF, 104, 1, 0, 0, 0, 0, 76, 0, 0, 1, 154, 51, 145,
    (seqNum >> 8) & 0xFF, seqNum & 0xFF
  ];
  
  const numTargets = Object.keys(targets).length;
  const buffer = [...header, 0, numTargets, 0, 0];
  
  for (const [id, pos] of Object.entries(targets)) {
    const gid = globalIdToBytes(parseInt(id));
    const lat = latLonToBytes(pos.lat);
    const lon = latLonToBytes(pos.lon);
    buffer.push(...gid, ...lat, ...lon, 15, 159, 192, 8, 74, 254, 0, 0, 0, 0, 0, 0, 0, 0);
  }
  
  return buffer;
}

// Generate data
const allBuffers = [];
let seq = 1;

// First send metadata for all members
allBuffers.push(createOpcode102(seq++, 10, 'PNJB', 0));   // Punjab - root
allBuffers.push(createOpcode102(seq++, 94, 'RAJS', 10)); // Rajasthan -> Punjab
allBuffers.push(createOpcode102(seq++, 80, 'DELH', 94)); // Delhi -> Rajasthan

// Generate 250 position updates with small movements
for (let i = 0; i < 250; i++) {
  // Small random movement (±0.01 degrees)
  const memberPositions = {};
  for (const [id, base] of Object.entries(MEMBERS)) {
    memberPositions[id] = {
      lat: base.lat + (Math.random() - 0.5) * 0.02,
      lon: base.lon + (Math.random() - 0.5) * 0.02
    };
  }
  
  const targetPositions = {};
  for (const [id, base] of Object.entries(TARGETS)) {
    // Targets move slightly south (towards India)
    targetPositions[id] = {
      lat: base.lat - (i * 0.001),  // Moving south slowly
      lon: base.lon + (Math.random() - 0.5) * 0.01
    };
  }
  
  // Add opcode 101 (member positions)
  allBuffers.push(createOpcode101(seq++, memberPositions));
  
  // Add opcode 104 (target positions)
  allBuffers.push(createOpcode104(seq++, targetPositions));
  
  // Every 25 iterations, resend metadata
  if (i % 25 === 0) {
    allBuffers.push(createOpcode102(seq++, 10, 'PNJB', 0));
    allBuffers.push(createOpcode102(seq++, 94, 'RAJS', 10));
    allBuffers.push(createOpcode102(seq++, 80, 'DELH', 94));
  }
}

// Write to file
fs.writeFileSync('public/data.json', JSON.stringify(allBuffers, null, 2));


