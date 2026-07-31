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
  minzoom?: number;
  maxzoom?: number;
  /**
   * Whitelist of feature-property keys to show in the tooltip. `undefined` means
   * show all (default); an array shows only those keys (used to trim tooltips for
   * layers with many attributes). Chosen in the layers panel's layer settings.
   */
  tooltipAttributes?: string[];

  // ── Tiling (large GeoTIFF served on-demand by the local tile server) ──
  // Set on layers that took the tiling path instead of in-renderer
  // BitmapLayer. Untiled layers leave these undefined.
  /** Absolute path to the original .tif on disk. Source for renderTile/sampleAt. */
  tileSourcePath?: string;
  /** Mapbox raster source URL template, e.g. "http://localhost:PORT/layers/<id>/{z}/{x}/{y}.png". */
  tilesUrl?: string;
  /** Min/max zoom the local tile server can render efficiently for this raster. */
  tileMinZoom?: number;
  tileMaxZoom?: number;
  /** [w, s, e, n] in WGS84, used as Mapbox raster source bounds. */
  tileBoundsWgs84?: [number, number, number, number];
  /** Source CRS (EPSG:xxxx or WKT) recorded by the tiling probe. */
  sourceCrs?: string | null;
  /** Source dtype recorded by the tiling probe (Byte, Float32, …). */
  sourceDtype?: string;
  /** Computed min/max for sample 0 — used by hover to format ranges. */
  sourceValueMin?: number;
  sourceValueMax?: number;
  uploadedAt?: number;
}

export type DrawingMode = "point" | "polygon" | "polyline" | "azimuthal" | null;
