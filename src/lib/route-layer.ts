import type { LayerProps } from "./definitions";
import { Filesystem, Encoding } from "@capacitor/filesystem";
import { NativeUploader } from "@/plugins/native-uploader";
import { HSC_DIRECTORY } from "@/sessions/constants";
import { stampedFileName, sanitizeFileName } from "@/sessions/nativeFile";
import { upsertManifestEntry } from "@/sessions/manifestStore";

export const SHORTEST_ROUTE_LAYER_PREFIX = "Shortest Route";

export const SHORTEST_ROUTE_LINE_COLOR: [number, number, number] = [
  245, 158, 11,
];

export function isShortestRouteLayer(layer: LayerProps): boolean {
  return (
    layer.type === "geojson" &&
    (layer.name || "").startsWith(SHORTEST_ROUTE_LAYER_PREFIX)
  );
}

/** Display name: Shortest Route (lat°, lon° to lat°, lon°) */
export function formatShortestRouteLayerName(
  from: [number, number],
  to: [number, number],
): string {
  const [lng1, lat1] = from;
  const [lng2, lat2] = to;
  return `${SHORTEST_ROUTE_LAYER_PREFIX} (${lat1.toFixed(6)}°, ${lng1.toFixed(6)}° to ${lat2.toFixed(6)}°, ${lng2.toFixed(6)}°)`;
}

/** Endpoints from a persisted shortest-route GeoJSON line (for display even if name is stale). */
export function getShortestRouteEndpoints(
  layer: LayerProps,
): { from: [number, number]; to: [number, number] } | null {
  if (!isShortestRouteLayer(layer) || !layer.geojson?.features?.length) {
    return null;
  }
  const geom = layer.geojson.features[0]?.geometry;
  if (!geom || geom.type !== "LineString") return null;
  const coords = geom.coordinates;
  if (!coords || coords.length < 2) return null;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (
    first.length < 2 ||
    last.length < 2 ||
    typeof first[0] !== "number" ||
    typeof first[1] !== "number" ||
    typeof last[0] !== "number" ||
    typeof last[1] !== "number"
  ) {
    return null;
  }
  return {
    from: [first[0], first[1]],
    to: [last[0], last[1]],
  };
}

/** Coordinate subtitle with ° — derived from geometry, not stored name. */
export function getShortestRouteCoordinateSubtitle(
  layer: LayerProps,
): string | null {
  const endpoints = getShortestRouteEndpoints(layer);
  if (!endpoints) return null;
  const [lng1, lat1] = endpoints.from;
  const [lng2, lat2] = endpoints.to;
  return `(${lat1.toFixed(6)}°, ${lng1.toFixed(6)}° to ${lat2.toFixed(6)}°, ${lng2.toFixed(6)}°)`;
}

export function getShortestRouteDisplayName(layer: LayerProps): string {
  const endpoints = getShortestRouteEndpoints(layer);
  if (endpoints) {
    return formatShortestRouteLayerName(endpoints.from, endpoints.to);
  }
  return layer.name;
}

export function buildShortestRouteGeoJSON(
  path: [number, number][],
  distMeters: number,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          shortestRoute: true,
          distanceMeters: distMeters,
          lineColor: [...SHORTEST_ROUTE_LINE_COLOR, 255],
        },
        geometry: {
          type: "LineString",
          coordinates: path,
        },
      },
    ],
  };
}

export function createShortestRouteLayer(
  layerId: string,
  layerName: string,
  geojson: GeoJSON.FeatureCollection,
): LayerProps {
  return {
    type: "geojson",
    id: layerId,
    name: layerName,
    geojson,
    color: SHORTEST_ROUTE_LINE_COLOR,
    lineWidth: 4,
    visible: true,
    uploadedAt: Date.now(),
  };
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function logicalPathToRelative(logicalPath: string): string {
  return logicalPath.replace(/^DATA\//, "").replace(/^DOCUMENTS\//, "");
}

async function writeGeoJsonAtPath(
  absolutePath: string | undefined,
  logicalPath: string | undefined,
  geojsonText: string,
  fileName: string,
): Promise<{
  absolutePath: string;
  logicalPath: string;
  originalName: string;
  size: number;
}> {
  if (absolutePath && logicalPath) {
    const isElectron =
      typeof window !== "undefined" &&
      !!(window as Window & { electronAPI?: unknown }).electronAPI;
    if (isElectron) {
      await (window as any).electronAPI.writeFile(absolutePath, geojsonText);
    } else {
      const rel = logicalPathToRelative(logicalPath);
      await Filesystem.writeFile({
        path: rel,
        directory: HSC_DIRECTORY,
        data: geojsonText,
        encoding: Encoding.UTF8,
        recursive: true,
      });
    }
    return {
      absolutePath,
      logicalPath,
      originalName: fileName,
      size: new TextEncoder().encode(geojsonText).length,
    };
  }

  const saved = await NativeUploader.saveExtractedFile({
    base64Data: utf8ToBase64(geojsonText),
    fileName: stampedFileName(fileName),
    mimeType: "application/geo+json",
  });
  return {
    absolutePath: saved.absolutePath,
    logicalPath: saved.logicalPath,
    originalName: fileName,
    size: saved.size,
  };
}

export type ShortestRouteFileMeta = {
  absolutePath: string;
  logicalPath: string;
  originalName: string;
};

/** Write GeoJSON to HSC-SESSIONS/FILES and register a staged manifest entry (same as uploaded vectors). */
export async function persistShortestRouteToSession(options: {
  layerId: string;
  layerName: string;
  path: [number, number][];
  distMeters: number;
  existingFile?: ShortestRouteFileMeta | null;
}): Promise<{
  layer: LayerProps;
  file: ShortestRouteFileMeta;
}> {
  const { layerId, layerName, path, distMeters, existingFile } = options;
  const geojson = buildShortestRouteGeoJSON(path, distMeters);
  const geojsonText = JSON.stringify(geojson, null, 2);
  const fileName = `${sanitizeFileName(layerName)}.geojson`;

  const file = await writeGeoJsonAtPath(
    existingFile?.absolutePath,
    existingFile?.logicalPath,
    geojsonText,
    fileName,
  );

  await upsertManifestEntry({
    layerId,
    layerName,
    path: file.logicalPath,
    absolutePath: file.absolutePath,
    originalName: file.originalName,
    mimeType: "application/geo+json",
    size: file.size,
    status: "staged",
    type: "vector",
    createdAt: Date.now(),
    color: SHORTEST_ROUTE_LINE_COLOR,
  });

  return {
    layer: createShortestRouteLayer(layerId, layerName, geojson),
    file: {
      absolutePath: file.absolutePath,
      logicalPath: file.logicalPath,
      originalName: file.originalName,
    },
  };
}
