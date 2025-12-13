import { fileToGeoJSON } from "@/lib/utils";
import type { LayerProps } from "@/lib/definitions";

export interface AnnotationParseOptions {
  layerId: string;
  layerName: string;
}

export interface Annotation {
  position: [number, number];
  text: string;
  color?: [number, number, number];
  fontSize?: number;
}

/**
 * Parse annotation file from GeoJSON
 */
export async function parseAnnotationFile(file: File): Promise<Annotation[]> {
  const geojson = await fileToGeoJSON(file);

  if (
    !geojson ||
    geojson.type !== "FeatureCollection" ||
    !Array.isArray(geojson.features)
  ) {
    throw new Error(
      "Invalid annotation file format. Could not convert to GeoJSON."
    );
  }

  if (geojson.features.length === 0) {
    throw new Error("Annotation file contains no features.");
  }

  const annotations: Annotation[] = [];

  geojson.features.forEach((feature: any) => {
    const text =
      feature.properties?.text ||
      feature.properties?.label ||
      feature.properties?.name ||
      feature.properties?.annotation ||
      feature.properties?.title ||
      "";

    if (text && feature.geometry) {
      let position: [number, number] | null = null;

      if (feature.geometry.type === "Point" && feature.geometry.coordinates) {
        position = [
          feature.geometry.coordinates[0],
          feature.geometry.coordinates[1],
        ];
      } else if (
        feature.geometry.type === "LineString" &&
        feature.geometry.coordinates.length > 0
      ) {
        position = [
          feature.geometry.coordinates[0][0],
          feature.geometry.coordinates[0][1],
        ];
      } else if (
        feature.geometry.type === "Polygon" &&
        feature.geometry.coordinates.length > 0
      ) {
        position = [
          feature.geometry.coordinates[0][0][0],
          feature.geometry.coordinates[0][0][1],
        ];
      }

      if (position) {
        let color: [number, number, number] | undefined;
        if (feature.properties?.color) {
          if (Array.isArray(feature.properties.color)) {
            color = feature.properties.color.slice(0, 3) as [
              number,
              number,
              number
            ];
          }
        }

        annotations.push({
          position,
          text: String(text),
          color,
          fontSize:
            feature.properties?.fontSize ||
            feature.properties?.font_size ||
            undefined,
        });
      }
    }
  });

  if (annotations.length === 0) {
    throw new Error(
      "No valid annotations found. Features must have text/label/name/annotation properties."
    );
  }

  return annotations;
}

/**
 * Create a layer from parsed annotation data
 */
export function createAnnotationLayer(
  annotations: Annotation[],
  options: AnnotationParseOptions
): LayerProps {
  const { layerId, layerName } = options;

  return {
    type: "annotation",
    id: layerId,
    name: layerName,
    color: [0, 0, 0],
    visible: true,
    annotations: annotations,
    uploadedAt: Date.now(),
  } as LayerProps & { uploadedAt: number };
}
