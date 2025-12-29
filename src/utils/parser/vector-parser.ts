import { fileToGeoJSON } from "@/lib/utils";
import type { LayerProps } from "@/lib/definitions";

export interface VectorParseOptions {
  layerId: string;
  layerName: string;
  onProgress?: (percent: number) => void;
  generateRandomColor: () => [number, number, number];
}

/**
 * Extract size (radius/width) from feature properties
 */
export function extractSizeFromProperties(
  properties: any,
  sizeType: "point" | "line"
): number | null {
  if (!properties) return null;

  const sizeKeys =
    sizeType === "point"
      ? [
          "size",
          "radius",
          "pointRadius",
          "point-radius",
          "point_radius",
          "marker-size",
          "markerSize",
        ]
      : [
          "size",
          "width",
          "lineWidth",
          "line-width",
          "line_width",
          "stroke-width",
          "strokeWidth",
        ];

  for (const key of sizeKeys) {
    const sizeValue = properties[key];
    if (sizeValue !== undefined && sizeValue !== null) {
      const size = parseFloat(sizeValue);
      if (!isNaN(size)) {
        // Clamp to minimum of 1 and maximum of 50
        return Math.max(1, Math.min(50, Math.round(size)));
      }
    }
  }
  return null;
}

/**
 * Parse vector file in worker thread
 */
export async function parseVectorInWorker(file: File): Promise<any> {
  const worker = new Worker(
    new URL("../../workers/vector-worker.ts", import.meta.url),
    { type: "module" }
  );
  const ab = await file.arrayBuffer();
  return await new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("Vector worker timeout"));
    }, 180000); // 3 minutes
    
    worker.onmessage = (e: MessageEvent<any>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(e.data);
    };
    
    worker.onerror = (err) => {
      clearTimeout(timer);
      worker.terminate();
      reject(err);
    };
    
    worker.postMessage(
      { type: "parse-vector", name: file.name, mime: file.type, buffer: ab },
      [ab]
    );
  });
}

/**
 * Parse vector/GeoJSON file
 */
export async function parseVectorFile(
  file: File,
  options: VectorParseOptions
): Promise<GeoJSON.FeatureCollection> {
  const { onProgress } = options;
  
  try {
    onProgress?.(10);
    
    const lowerName = file.name.toLowerCase();
    let ext = "";
    if (lowerName.endsWith(".geojson")) {
      ext = "geojson";
    } else if (lowerName.endsWith(".tiff")) {
      ext = "tiff";
    } else {
      const parts = lowerName.split(".");
      ext = parts.length > 1 ? parts[parts.length - 1] : "";
    }

    const shouldOffloadVector = [
      "csv",
      "gpx",
      "kml",
      "kmz",
      "wkt",
      "prj",
    ].includes(ext);

    let rawGeojson: any = null;

    if (shouldOffloadVector) {
      try {
        onProgress?.(20);
        const workerResult = await parseVectorInWorker(file);
        if (workerResult?.geojson) {
          rawGeojson = workerResult.geojson;
        } else if (workerResult?.unsupported) {
          // Fall back to main thread below
        } else if (workerResult?.error) {
          // Fall back to main thread parsing
        }
      } catch {
        // Fall back to main thread parsing
      }
    }

    if (!rawGeojson) {
      onProgress?.(40);
      rawGeojson = await fileToGeoJSON(file);
    }

    onProgress?.(60);
    
    // Convert to FeatureCollection format
    let features: GeoJSON.Feature[] = [];

    if (rawGeojson.type === "FeatureCollection") {
      features = (rawGeojson as GeoJSON.FeatureCollection).features || [];
    } else if (rawGeojson.type === "Feature") {
      features = [rawGeojson as GeoJSON.Feature];
    } else if (
      (rawGeojson as any).features &&
      Array.isArray((rawGeojson as any).features)
    ) {
      features = (rawGeojson as any).features;
    } else if ((rawGeojson as any).geometry) {
      features = [
        {
          type: "Feature",
          geometry: (rawGeojson as any).geometry,
          properties: (rawGeojson as any).properties ?? {},
        },
      ];
    }

    // Filter out invalid features
    const validFeatures = features.filter((f) => f && f.geometry);

    onProgress?.(80);
    return {
      type: "FeatureCollection",
      features: validFeatures,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Create a layer from parsed vector data
 */
export function createVectorLayer(
  featureCollection: GeoJSON.FeatureCollection,
  options: VectorParseOptions
): LayerProps {
  const { layerId, layerName, generateRandomColor } = options;
  
  // Extract size values from properties if available
  const firstFeature = featureCollection.features[0];
  const hasPoints = featureCollection.features.some(
    (f) => f.geometry?.type === "Point" || f.geometry?.type === "MultiPoint"
  );
  const hasLines = featureCollection.features.some(
    (f) =>
      f.geometry?.type === "LineString" ||
      f.geometry?.type === "MultiLineString"
  );

  const extractedPointRadius = hasPoints
    ? extractSizeFromProperties(firstFeature?.properties, "point")
    : null;
  const extractedLineWidth = hasLines
    ? extractSizeFromProperties(firstFeature?.properties, "line")
    : null;

  return {
    type: "geojson",
    id: layerId,
    name: layerName,
    geojson: featureCollection,
    color: generateRandomColor(),
    pointRadius: extractedPointRadius ?? 5,
    lineWidth: extractedLineWidth ?? 5,
    visible: true,
    uploadedAt: Date.now(),
  } as LayerProps & { uploadedAt: number };
}

