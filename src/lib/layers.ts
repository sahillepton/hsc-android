import type { LayerProps } from "./definitions";
import { extractGeometryCoordinates } from "./utils";

export const computeLayerBounds = (layer: LayerProps) => {
    const points: [number, number][] = [];

    if (layer.type === "point" && layer.position) {
      points.push(layer.position);
    }

    if (layer.type === "line" && layer.path) {
      points.push(...layer.path);
    }

    if (layer.type === "polygon" && layer.polygon) {
      layer.polygon.forEach((ring) => {
        ring.forEach((coord) => {
          points.push(coord);
        });
      });
    }

    if (layer.type === "geojson" && layer.geojson) {
      layer.geojson.features.forEach((feature) => {
        if (feature.geometry) {
          points.push(...extractGeometryCoordinates(feature.geometry));
        }
      });
    }

    if (layer.type === "nodes" && layer.nodes) {
      layer.nodes.forEach((node) => {
        points.push([node.longitude, node.latitude]);
      });
    }

    if (layer.bounds) {
      const [[minLng, minLat], [maxLng, maxLat]] = layer.bounds;
      points.push([minLng, minLat], [maxLng, maxLat]);
    }

    const validPoints = points.filter(
      (point) =>
        Array.isArray(point) &&
        point.length >= 2 &&
        typeof point[0] === "number" &&
        typeof point[1] === "number" &&
        !Number.isNaN(point[0]) &&
        !Number.isNaN(point[1])
    );

    if (validPoints.length === 0) {
      return null;
    }

    const longitudes = validPoints.map((point) => point[0]);
    const latitudes = validPoints.map((point) => point[1]);

    const minLng = Math.min(...longitudes);
    const maxLng = Math.max(...longitudes);
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);

    const isSinglePoint =
      Math.abs(maxLng - minLng) < 1e-6 &&
      Math.abs(maxLat - minLat) < 1e-6;

    const center: [number, number] = [
      (minLng + maxLng) / 2,
      (minLat + maxLat) / 2,
    ];

    return {
      bounds: [minLng, minLat, maxLng, maxLat] as [
        number,
        number,
        number,
        number
      ],
      center,
      isSinglePoint,
    };
  };


  export const generateLayerId = () => {
    return `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
   }

