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
  type:
    | "point"
    | "polygon"
    | "line"
    | "azimuth"
    | "geojson"
    | "nodes"
    | "connections"
    | "dem"
    | "annotation"
    | "udp";
  visible: boolean;
  id: string;
  name: string;
  position?: [number, number];
  color: [number, number, number] | [number, number, number, number];
  radius?: number;
  pointRadius?: number;
  path?: [number, number][];
  lineWidth?: number;
  polygon?: [number, number][][];
  segmentDistancesKm?: number[];
  totalDistanceKm?: number;
  bounds?: [[number, number], [number, number]];
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
  nodes?: Node[];
  annotations?: Array<{
    position: [number, number];
    text: string;
    color?: [number, number, number];
    fontSize?: number;
  }>;
  sectorAngleDeg?: number;
  radiusMeters?: number;
  bearing?: number;
  symbol?: string; // Symbol for UDP layers
  azimuthCenter?: [number, number];
  azimuthTarget?: [number, number];
  azimuthNorth?: [number, number];
  azimuthAngleDeg?: number;
  distanceMeters?: number;
}

export type DrawingMode = "point" | "polygon" | "polyline" | "azimuthal" | null;
