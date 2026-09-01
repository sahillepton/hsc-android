import type { LayerProps } from "./definitions";
import { Filesystem, Encoding } from "@capacitor/filesystem";
import { NativeUploader } from "@/plugins/native-uploader";
import { HSC_DIRECTORY } from "@/sessions/constants";
import { stampedFileName, sanitizeFileName } from "@/sessions/nativeFile";
import { upsertManifestEntry } from "@/sessions/manifestStore";
import { calculateIgrs } from "./utils";

export const SHORTEST_ROUTE_LAYER_PREFIX = "Shortest Route";

/**
 * Feature properties that are the route's own bookkeeping, not user data.
 *
 * They are written by buildShortestRouteGeoJSON and are already surfaced as the
 * proper From / To / Distance rows, so showing them again as raw attributes is
 * duplication — and it is what pushed the route tooltip past its height cap and
 * gave it a scrollbar. Shared so the tooltip's default filter and the settings
 * panel's default SELECTION cannot drift apart.
 */
export const SHORTEST_ROUTE_INTERNAL_PROPS = [
  "shortestRoute",
  "lineColor",
  "distanceMeters",
] as const;

export const SHORTEST_ROUTE_LINE_COLOR: [number, number, number] = [
  245, 158, 11,
];

export function isShortestRouteLayer(layer: LayerProps): boolean {
  if (layer.type !== "geojson") return false;
  // Name is the fast path for routes created in this session.
  if ((layer.name || "").startsWith(SHORTEST_ROUTE_LAYER_PREFIX)) return true;
  // Otherwise trust the DATA. Identity used to be the name prefix alone, which
  // does not survive a round trip: exporting sanitises the name for the filename
  // ("Shortest Route 1" -> "Shortest_Route_1", see file-section.tsx) and the
  // re-imported layer takes that filename as its name. The underscore form failed
  // the prefix test, so a re-imported route stopped being a route — which is why
  //   • its tooltip/panel row lost the "(lat, lng to lat, lng)" subtitle, and
  //   • nextShortestRouteName() no longer counted it, handing the next route the
  //     number 1 again; both then sanitised to the same filename and the export
  //     failed with a duplicate-name error.
  // `properties.shortestRoute` is written by buildShortestRouteGeoJSON and IS
  // carried through the .geojson file, so it survives the round trip.
  const features = layer.geojson?.features;
  if (!Array.isArray(features) || features.length === 0) return false;
  return features.some(
    (f) => (f?.properties as { shortestRoute?: unknown } | null)?.shortestRoute === true,
  );
}

// NOTE: there used to be a `formatShortestRouteLayerName(from, to)` here that built
// "Shortest Route (lat°, lon° to lat°, lon°)". It was the layer's stored NAME, which
// put the coordinates in the panel heading (duplicating the subtitle), could not
// honour the IGRS preference — a name is persisted, the preference is not — and left
// no short label to identify a route by. Routes are now named sequentially via
// `nextShortestRouteName`, with the coordinates supplied by
// `getShortestRouteCoordinateSubtitle`, which does honour IGRS. Deleted rather than
// left unused so it cannot be wired back in by accident.

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

/**
 * One endpoint of a route, in the user's chosen coordinate system.
 *
 * Falls back to lat/long when IGRS is on but the point lies outside the IGRS
 * window (`calculateIgrs` returns null beyond roughly lon 68–104 / lat 8–39.5), so
 * a route with one endpoint outside India still reads sensibly instead of showing
 * a blank.
 */
function formatRouteEndpoint(
  point: [number, number],
  useIgrs: boolean,
): string {
  const [lng, lat] = point;
  if (useIgrs) {
    const igrs = calculateIgrs(lng, lat);
    if (igrs) return igrs;
  }
  return `${lat.toFixed(6)}°, ${lng.toFixed(6)}°`;
}

/**
 * Coordinate subtitle for a route row — derived from the geometry, not the stored
 * name, and rendered in IGRS when that preference is on.
 *
 * `useIgrs` is a REQUIRED argument rather than an optional one: this used to format
 * lat/long unconditionally, so a route's coordinates were the one place in the app
 * that ignored the IGRS toggle. Making callers pass it means a new call site cannot
 * silently reintroduce that.
 */
export function getShortestRouteCoordinateSubtitle(
  layer: LayerProps,
  useIgrs: boolean,
): string | null {
  const endpoints = getShortestRouteEndpoints(layer);
  if (!endpoints) return null;
  return `(${formatRouteEndpoint(endpoints.from, useIgrs)} to ${formatRouteEndpoint(endpoints.to, useIgrs)})`;
}

/**
 * Heading for a shortest-route layer in the panels: just the layer's own name
 * (e.g. "Shortest Route 2").
 *
 * It used to rebuild the name from the endpoints, so the heading read
 * "Shortest Route (28.613900°, 77.209000° to 19.076000°, 72.877700°)" — and the
 * coordinates then appeared TWICE, because the panels also render
 * `getShortestRouteCoordinateSubtitle` underneath. Returning `layer.name` keeps
 * the heading short, lets the from/to live only in the subtitle, and means a
 * renamed route actually shows its new name.
 */
export function getShortestRouteDisplayName(layer: LayerProps): string {
  return layer.name;
}

/**
 * Next free "Shortest Route N" name for a new route.
 *
 * Scans the existing route layers for a trailing number and takes max + 1, so
 * deleting route 2 and adding another gives 4 rather than colliding with route 3
 * (route geojson is written to disk as `<name>.geojson`, so names must stay unique
 * within a session).
 */
export function nextShortestRouteName(layers: LayerProps[]): string {
  let highest = 0;
  for (const l of layers) {
    if (!isShortestRouteLayer(l)) continue;
    const m = (l.name || "").match(
      // Accept the sanitised form too: exporting rewrites the name for the
      // filename ("Shortest Route 1" -> "Shortest_Route_1", file-section.tsx) and
      // a re-imported layer carries that name. Matching only the spaced form sent
      // every underscored route to the `else` branch below, which caps `highest`
      // at 1 — so two imported routes still produced number 2 and collided on
      // export again.
      //
      // Deliberately backslash-free ([ _] not [\s_], [0-9] not \d): the separator
      // can only ever be a space or the underscore the sanitiser writes, and an
      // escaped class here is easy to get silently wrong in a nested string.
      new RegExp(
        "^" +
          SHORTEST_ROUTE_LAYER_PREFIX.replace(/ +/g, "[ _]+") +
          "[ _]+([0-9]+)[ _]*$",
      ),
    );
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > highest) highest = n;
    } else {
      // A legacy coordinate-style name still occupies a slot.
      highest = Math.max(highest, 1);
    }
  }
  return `${SHORTEST_ROUTE_LAYER_PREFIX} ${highest + 1}`;
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
