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

   export const isPointNearFirstPoint = (
    point: [number, number],
    firstPoint: [number, number],
    threshold = 0.01
  ) => {
    const distance = Math.sqrt(
      Math.pow(point[0] - firstPoint[0], 2) +
        Math.pow(point[1] - firstPoint[1], 2)
    );
    return distance < threshold;
  };

  export const toRadians = (deg: number) => (deg * Math.PI) / 180;
  export const toDegrees = (rad: number) => (rad * 180) / Math.PI;

  export const calculateDistanceMeters = (a: [number, number], b: [number, number]) => {
    const R = 6371000;
    const lat1 = toRadians(a[1]);
    const lat2 = toRadians(b[1]);
    const dLat = toRadians(b[1] - a[1]);
    const dLon = toRadians(b[0] - a[0]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
    return R * c;
  };


  export const calculateBearingDegrees = (a: [number, number], b: [number, number]) => {
    const lat1 = toRadians(a[1]);
    const lat2 = toRadians(b[1]);
    const dLon = toRadians(b[0] - a[0]);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const brng = Math.atan2(y, x);
    return (toDegrees(brng) + 360) % 360; // Normalize 0-360
  };

  export const makeSectorPolygon = (
    center: [number, number],
    radiusMeters: number,
    bearingDeg: number,
    sectorAngleDeg: number,
    segments = 64
  ): [number, number][] => {
    const [lng, lat] = center;
    const latRad = toRadians(lat);
    const metersPerDegLat = 111320; // approx
    const metersPerDegLng = 111320 * Math.cos(latRad);
    const dLat = radiusMeters / metersPerDegLat;
    const dLng = radiusMeters / metersPerDegLng;

    const half = sectorAngleDeg / 2;
    const start = toRadians(bearingDeg - half);
    const end = toRadians(bearingDeg + half);

    const points: [number, number][] = [];
    // start at center
    points.push([lng, lat]);

    // sample arc from start to end
    const steps = Math.max(8, Math.floor((segments * sectorAngleDeg) / 360));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const theta = start + t * (end - start);
      const x = dLng * Math.sin(theta); // east-west offset
      const y = dLat * Math.cos(theta); // north-south offset
      points.push([lng + x, lat + y]);
    }

    // close back to center
    points.push([lng, lat]);
    return points;
  };


  export const availableIcons = [
    'alert',
    'command_post', 
    'friendly_aircraft',
    'ground_unit',
    'hostile_aircraft',
    'mother-aircraft',
    'naval_unit',
    'neutral_aircraft',
    'sam_site',
    'unknown_aircraft'
  ];