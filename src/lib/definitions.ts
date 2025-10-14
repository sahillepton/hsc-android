export interface Node {
  snr: number;
  rssi: number;
  distance: number;
  userId: number;
  hopCount: number;
  connectedNodeIds: number[];
  latitude: number;
  longitude: number;
}

export interface LayerProps {
    type: "point" | "polygon" | "line" | "geojson" | "nodes" | "connections";
    visible: boolean; // Default to true
    id: string;
    name: string;
    position?: [number, number]; // Optional for multi-point shapes
    color: [number, number, number] | [number, number, number, number]; // RGB or RGBA
    radius?: number;
    pointRadius?: number; // For GeoJSON point features
    // For lines
    path?: [number, number][];
    lineWidth?: number;
    // For polygons
    polygon?: [number, number][][];
    // For rectangles
    bounds?: [[number, number], [number, number]];
    geojson?: GeoJSON.FeatureCollection;
    // For nodes
    nodes?: Node[];
  }