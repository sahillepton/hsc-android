/**
 * Parse a PBF (Protocol Buffer Format) vector tile file to extract layer information
 * This uses the Mapbox Vector Tile specification
 */

export interface PbfLayerInfo {
  name: string;
  version: number;
  extent: number;
  features: Array<{
    id?: number;
    type: number; // 1=Point, 2=LineString, 3=Polygon
    geometry: number[];
    properties: Record<string, any>;
  }>;
}

export interface PbfTileInfo {
  layers: PbfLayerInfo[];
}

/**
 * Parse PBF file and extract layer names
 * This is a simplified parser - full PBF parsing requires protobuf decoding
 */
export async function parsePbfFile(file: File): Promise<PbfTileInfo> {
  const arrayBuffer = await file.arrayBuffer();
  return parsePbfBuffer(arrayBuffer);
}

/**
 * Parse PBF from ArrayBuffer
 */
export function parsePbfBuffer(buffer: ArrayBuffer): PbfTileInfo {
  // PBF files use Protocol Buffer encoding
  // We need to decode the binary format
  // This is a simplified version - full implementation would use protobuf.js or similar

  const view = new DataView(buffer);
  const layers: PbfLayerInfo[] = [];

  let offset = 0;

  try {
    // PBF tiles are encoded with varint length prefixes
    // Each message has: [tag (varint)] [length (varint)] [data]

    while (offset < buffer.byteLength) {
      // Read tag (field number and wire type)
      const tag = readVarint(view, offset);
      offset = tag.offset;
      const fieldNumber = tag.value >>> 3;
      const wireType = tag.value & 0x7;

      if (wireType === 2) {
        // Length-delimited (string, bytes, embedded message)
        const length = readVarint(view, offset);
        offset = length.offset;

        if (fieldNumber === 3) {
          // Layer message (field 3 in Tile message)
          const layerData = new Uint8Array(buffer, offset, length.value);
          const layer = parseLayer(layerData);
          if (layer) {
            layers.push(layer);
          }
          offset += length.value;
        } else {
          offset += length.value;
        }
      } else {
        // Skip other wire types
        offset++;
      }

      if (offset >= buffer.byteLength) break;
    }
  } catch (e) {
    console.warn("Error parsing PBF:", e);
  }

  return { layers };
}

/**
 * Read a varint (variable-length integer) from the buffer
 */
function readVarint(
  view: DataView,
  offset: number
): { value: number; offset: number } {
  let value = 0;
  let shift = 0;
  let byte: number;

  do {
    if (offset >= view.byteLength) break;
    byte = view.getUint8(offset++);
    value |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);

  return { value, offset };
}

/**
 * Parse a Layer message from PBF data
 */
function parseLayer(data: Uint8Array): PbfLayerInfo | null {
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;
    let name = "";
    let version = 1;
    let extent = 4096;
    const features: any[] = [];

    while (offset < data.byteLength) {
      const tag = readVarint(view, offset);
      offset = tag.offset;
      const fieldNumber = tag.value >>> 3;
      const wireType = tag.value & 0x7;

      if (wireType === 2) {
        // Length-delimited
        const length = readVarint(view, offset);
        offset = length.offset;

        if (fieldNumber === 1) {
          // name
          const nameBytes = new Uint8Array(
            data.buffer,
            data.byteOffset + offset,
            length.value
          );
          name = new TextDecoder().decode(nameBytes);
          offset += length.value;
        } else if (fieldNumber === 2) {
          // features
          // Skip feature parsing for now - just count them
          offset += length.value;
        } else if (fieldNumber === 3) {
          // keys (string table)
          offset += length.value;
        } else if (fieldNumber === 4) {
          // values (value table)
          offset += length.value;
        } else if (fieldNumber === 5) {
          // extent
          const extentValue = readVarint(view, offset);
          extent = extentValue.value;
          offset = extentValue.offset;
        } else {
          offset += length.value;
        }
      } else if (wireType === 0) {
        // Varint
        if (fieldNumber === 15) {
          // version
          const versionValue = readVarint(view, offset);
          version = versionValue.value;
          offset = versionValue.offset;
        } else {
          const value = readVarint(view, offset);
          offset = value.offset;
        }
      } else {
        offset++;
      }
    }

    if (name) {
      return { name, version, extent, features };
    }
  } catch (e) {
    console.warn("Error parsing layer:", e);
  }

  return null;
}

/**
 * Extract layer names from a PBF file (simpler version)
 * Uses Mapbox GL JS to parse if available
 */
export async function getLayerNamesFromPbf(file: File): Promise<string[]> {
  try {
    // Try using Mapbox GL's tile parsing if available
    if (typeof window !== "undefined" && (window as any).mapboxgl) {
      // This would require Mapbox GL's internal tile parser
      // For now, we'll use a simpler approach
    }

    // Fallback: parse manually
    const info = await parsePbfFile(file);
    return info.layers.map((l) => l.name);
  } catch (e) {
    console.error("Error getting layer names:", e);
    return [];
  }
}
