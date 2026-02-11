// Simple script to parse PBF file and extract layer names
// Run with: node parse-pbf-file.cjs

const fs = require('fs');
const path = require('path');

// Read the PBF file
const pbfPath = path.join(__dirname, 'public', '0.pbf');
const buffer = fs.readFileSync(pbfPath);

console.log('PBF File size:', buffer.length, 'bytes');
console.log('First 200 bytes (hex):');
console.log(buffer.slice(0, 200).toString('hex').match(/.{2}/g)?.join(' ') || '');

// Simple PBF parser to extract layer names
function readVarint(buffer, offset) {
  let value = 0;
  let shift = 0;
  let byte;
  
  do {
    if (offset >= buffer.length) break;
    byte = buffer[offset++];
    value |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  
  return { value, offset };
}

function parseLayer(buffer, offset, length) {
  const layerData = buffer.slice(offset, offset + length);
  let pos = 0;
  let name = '';
  
  while (pos < layerData.length) {
    const tag = readVarint(layerData, pos);
    pos = tag.offset;
    const fieldNumber = tag.value >>> 3;
    const wireType = tag.value & 0x7;
    
    if (wireType === 2) { // Length-delimited
      const len = readVarint(layerData, pos);
      pos = len.offset;
      
      if (fieldNumber === 1) { // name field
        name = layerData.slice(pos, pos + len.value).toString('utf8');
        pos += len.value;
        break; // Found name, we can stop
      } else {
        pos += len.value;
      }
    } else {
      pos++;
    }
  }
  
  return name;
}

// Parse the PBF tile
let offset = 0;
const layers = [];

while (offset < buffer.length) {
  const tag = readVarint(buffer, offset);
  offset = tag.offset;
  const fieldNumber = tag.value >>> 3;
  const wireType = tag.value & 0x7;
  
  if (wireType === 2) { // Length-delimited
    const length = readVarint(buffer, offset);
    offset = length.offset;
    
    if (fieldNumber === 3) { // Layer message (field 3 in Tile message)
      const layerName = parseLayer(buffer, offset, length.value);
      if (layerName) {
        layers.push(layerName);
        console.log(`Found layer: "${layerName}"`);
      }
      offset += length.value;
    } else {
      offset += length.value;
    }
  } else {
    offset++;
  }
  
  if (offset >= buffer.length) break;
}

console.log('\n=== RESULTS ===');
if (layers.length > 0) {
  console.log('Layer names found:', layers);
  console.log('\nUse this layer name in your Mapbox source-layer:');
  console.log('  "source-layer": "' + layers[0] + '"');
} else {
  console.log('No layer names found. The PBF might use a different structure.');
  console.log('Try common names: "layer", "features", "geometry", "default"');
}

