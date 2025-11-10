// TODO: File to be named types.ts
// TODO: Why not work with auto save?
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
    type: "point" | "polygon" | "line" | "geojson" | "nodes" | "connections" | "dem" | "annotation";
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
    // For raster/DEM overlays
    bitmap?: HTMLCanvasElement | ImageBitmap | HTMLImageElement | string;
    texture?: HTMLCanvasElement | ImageBitmap | HTMLImageElement | string;
    elevationData?: {
      data: Float32Array;
      width: number;
      height: number;
      min: number;
      max: number;
    };
    geojson?: GeoJSON.FeatureCollection;
    // For nodes
    nodes?: Node[];
    // For annotation layers
    annotations?: Array<{
      position: [number, number];
      text: string;
      color?: [number, number, number];
      fontSize?: number;
    }>;
  }

export type DrawingMode = "point" | "polygon" | "line" | "azimuthal" | null