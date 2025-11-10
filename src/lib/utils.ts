import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import * as turf from "@turf/turf";
import Papa from "papaparse";
import shp from "shpjs";
// geotiff is optional; we will dynamic import when needed


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const base64ToFile = (base64Data: string, fileName: string, mimeType: string): File => {
  const byteString = atob(base64Data);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([ab], { type: mimeType });
  return new File([blob], fileName, { type: mimeType });
};


export const collectCoordinates = (coordinates: any): [number, number][] => {
  if (!coordinates) return [];

  if (Array.isArray(coordinates)) {
    if (
      coordinates.length >= 2 &&
      typeof coordinates[0] === "number" &&
      typeof coordinates[1] === "number"
    ) {
      return [[coordinates[0], coordinates[1]]];
    }

    return coordinates.flatMap((coord) => collectCoordinates(coord));
  }

  return [];
};

export const extractGeometryCoordinates = (geometry: GeoJSON.Geometry): [number, number][] => {
  if (!geometry) return [];

  switch (geometry.type) {
    case "Point":
      return collectCoordinates(geometry.coordinates);
    case "MultiPoint":
    case "LineString":
      return collectCoordinates(geometry.coordinates);
    case "MultiLineString":
    case "Polygon":
      return collectCoordinates(geometry.coordinates);
    case "MultiPolygon":
      return collectCoordinates(geometry.coordinates);
    case "GeometryCollection":
      return geometry.geometries.flatMap((child) => extractGeometryCoordinates(child));
    default:
      return [];
  }
};


export function rgbToHex(rgb: [number, number, number] | [number, number, number, number]): string {
  const [r, g, b, a] = rgb;

  const toHex = (n: number) => {
    const hex = Math.max(0, Math.min(255, n)).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  let hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;

  if (a !== undefined) {
    const alphaValue = a <= 1 ? Math.round(a * 255) : a;
    hex += toHex(alphaValue);
  }

  return hex;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  hex = hex.replace(/^#/, "");

  if (hex.length === 3) {
    hex = hex.split("").map((c) => c + c).join("");
  }

  if (hex.length !== 6) return null;

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  return [r, g, b];
}


export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${meters.toFixed(1)} m`;
  } else if (meters < 1000000) {
    return `${(meters / 1000).toFixed(2)} km`;
  } else {
    return `${(meters / 1000000).toFixed(2)} Mm`;
  }
}

export function formatArea(squareMeters: number): string {
  if (squareMeters < 10000) {
    return `${squareMeters.toFixed(1)} m²`;
  } else if (squareMeters < 1000000) {
    return `${(squareMeters / 10000).toFixed(2)} ha`;
  } else {
    return `${(squareMeters / 1000000).toFixed(2)} km²`;
  }
}

export function getPolygonArea(polygon:  [number, number][][]) {
  const area =turf.area(turf.polygon(polygon));
  const areaInKm2 = turf.convertArea(area, 'meters', 'kilometers');
  return areaInKm2.toFixed(2);
}


export function getDistance (point1: [number, number], point2: [number, number]) {
  const from = turf.point([point1[0], point1[1]]);
  const to = turf.point([point2[0], point2[1]]);
  return turf.distance(from, to, {units : 'kilometers'}).toFixed(2);
}


export function csvToGeoJSON(csvString: string, latField = "latitude", lonField = "longitude") {
  const result = Papa.parse(csvString, { header: true, skipEmptyLines: true });

  const features = result.data.map((row: any) => {
    const lat = parseFloat(row[latField]);
    const lon = parseFloat(row[lonField]);

    if (isNaN(lat) || isNaN(lon)) return null;

    return {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [lon, lat],
      },
      properties: { ...row },
    };
  }).filter(f => f !== null);

  return {
    type: "FeatureCollection",
    features,
  };
}

export async function shpToGeoJSON(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const geojson = await shp(arrayBuffer);
  return geojson;
}

// Parse GPX to GeoJSON
export function gpxToGeoJSON(gpxText: string): GeoJSON.FeatureCollection {
  const parser = new DOMParser();
  const gpxDoc = parser.parseFromString(gpxText, "text/xml");
  const features: GeoJSON.Feature[] = [];

  // Parse waypoints (wpt)
  const waypoints = gpxDoc.getElementsByTagName("wpt");
  for (let i = 0; i < waypoints.length; i++) {
    const wpt = waypoints[i];
    const lat = parseFloat(wpt.getAttribute("lat") || "0");
    const lon = parseFloat(wpt.getAttribute("lon") || "0");
    const name = wpt.getElementsByTagName("name")[0]?.textContent || "";
    const ele = wpt.getElementsByTagName("ele")[0]?.textContent;

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [lon, lat],
      },
      properties: {
        name,
        elevation: ele ? parseFloat(ele) : undefined,
        type: "waypoint",
      },
    });
  }

  // Parse tracks (trk)
  const tracks = gpxDoc.getElementsByTagName("trk");
  for (let i = 0; i < tracks.length; i++) {
    const trk = tracks[i];
    const name = trk.getElementsByTagName("name")[0]?.textContent || "";
    const segments = trk.getElementsByTagName("trkseg");
    
    for (let j = 0; j < segments.length; j++) {
      const seg = segments[j];
      const points = seg.getElementsByTagName("trkpt");
      const coordinates: [number, number][] = [];

      for (let k = 0; k < points.length; k++) {
        const pt = points[k];
        const lat = parseFloat(pt.getAttribute("lat") || "0");
        const lon = parseFloat(pt.getAttribute("lon") || "0");
        coordinates.push([lon, lat]);
      }

      if (coordinates.length > 1) {
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates,
          },
          properties: {
            name: segments.length > 1 ? `${name} (segment ${j + 1})` : name,
            type: "track",
          },
        });
      }
    }
  }

  // Parse routes (rte)
  const routes = gpxDoc.getElementsByTagName("rte");
  for (let i = 0; i < routes.length; i++) {
    const rte = routes[i];
    const name = rte.getElementsByTagName("name")[0]?.textContent || "";
    const points = rte.getElementsByTagName("rtept");
    const coordinates: [number, number][] = [];

    for (let j = 0; j < points.length; j++) {
      const pt = points[j];
      const lat = parseFloat(pt.getAttribute("lat") || "0");
      const lon = parseFloat(pt.getAttribute("lon") || "0");
      coordinates.push([lon, lat]);
    }

    if (coordinates.length > 1) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates,
        },
        properties: {
          name,
          type: "route",
        },
      });
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

// Parse KML to GeoJSON
export async function kmlToGeoJSON(kmlText: string): Promise<GeoJSON.FeatureCollection> {
  const parser = new DOMParser();
  const kmlDoc = parser.parseFromString(kmlText, "text/xml");
  const features: GeoJSON.Feature[] = [];

  // Helper to parse coordinate strings
  const parseCoordinates = (coordString: string): [number, number][] => {
    return coordString
      .trim()
      .split(/\s+/)
      .map((coord) => {
        const parts = coord.split(",");
        const lon = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        return [lon, lat] as [number, number];
      })
      .filter(([lon, lat]) => !isNaN(lon) && !isNaN(lat));
  };

  // Parse Placemarks
  const placemarks = kmlDoc.getElementsByTagName("Placemark");
  for (let i = 0; i < placemarks.length; i++) {
    const pm = placemarks[i];
    const name = pm.getElementsByTagName("name")[0]?.textContent || "";
    const description = pm.getElementsByTagName("description")[0]?.textContent || "";

    // Point
    const point = pm.getElementsByTagName("Point")[0];
    if (point) {
      const coord = point.getElementsByTagName("coordinates")[0]?.textContent || "";
      const coords = parseCoordinates(coord);
      if (coords.length > 0) {
        features.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: coords[0],
          },
          properties: {
            name,
            description,
            type: "point",
          },
        });
      }
    }

    // LineString
    const lineString = pm.getElementsByTagName("LineString")[0];
    if (lineString) {
      const coord = lineString.getElementsByTagName("coordinates")[0]?.textContent || "";
      const coords = parseCoordinates(coord);
      if (coords.length > 1) {
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: coords,
          },
          properties: {
            name,
            description,
            type: "linestring",
          },
        });
      }
    }

    // Polygon
    const polygon = pm.getElementsByTagName("Polygon")[0];
    if (polygon) {
      const outerBoundary = polygon.getElementsByTagName("outerBoundaryIs")[0];
      if (outerBoundary) {
        const linearRing = outerBoundary.getElementsByTagName("LinearRing")[0];
        if (linearRing) {
          const coord = linearRing.getElementsByTagName("coordinates")[0]?.textContent || "";
          const coords = parseCoordinates(coord);
          if (coords.length > 2) {
            // Close the polygon
            if (coords[0][0] !== coords[coords.length - 1][0] || 
                coords[0][1] !== coords[coords.length - 1][1]) {
              coords.push(coords[0]);
            }
            features.push({
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [coords],
              },
              properties: {
                name,
                description,
                type: "polygon",
              },
            });
          }
        }
      }
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

// Extract KMZ (ZIP containing KML)
export  async function kmzToGeoJSON(file: File): Promise<GeoJSON.FeatureCollection> {
  // Use JSZip-like approach or parse as ZIP
  // For now, try to read as text first (some KMZ files can be read as text)
  try {
    const text = await file.text();
    return await kmlToGeoJSON(text);
  } catch {
    // If that fails, it's a proper ZIP - would need JSZip library
    // For now, throw error suggesting to extract KML first
    throw new Error("KMZ (compressed KML) files require extraction. Please extract the KML file from the KMZ archive and upload the .kml file instead.");
  }
}

export async function fileToGeoJSON(file : File) {
  // Better extension detection (handle .geojson and multi-dot filenames)
  const fileName = file.name.toLowerCase();
  let ext = '';
  if (fileName.endsWith('.geojson')) {
    ext = 'geojson';
  } else if (fileName.endsWith('.tiff')) {
    ext = 'tiff';
  } else {
    const parts = fileName.split('.');
    ext = parts.length > 1 ? parts[parts.length - 1] : '';
  }

  if (ext === "csv") {
    const text = await file.text();
    return csvToGeoJSON(text, "latitude", "longitude"); 
  }

  if (ext === "shp" || ext === "zip") {
    return await shpToGeoJSON(file);
  }

  if (ext === "geojson" || ext === "json") {
    const text = await file.text();
    return JSON.parse(text); 
  }

  if (ext === "gpx") {
    const text = await file.text();
    return gpxToGeoJSON(text);
  }

  if (ext === "kml") {
    const text = await file.text();
    return await kmlToGeoJSON(text);
  }

  if (ext === "kmz") {
    return await kmzToGeoJSON(file);
  }

  throw new Error(`Unsupported file type: .${ext}. Supported formats: GeoJSON, CSV, Shapefile, GPX, KML`);
}

export interface DemRasterResult {
  canvas: HTMLCanvasElement;
  bounds: [number, number, number, number];
  width: number;
  height: number;
  data: Float32Array;
  min: number;
  max: number;
}

export async function fileToDEMRaster(file: File): Promise<DemRasterResult>{
  // Better extension detection (handle .tiff and multi-dot filenames)
  const fileName = file.name.toLowerCase();
  let ext = '';
  if (fileName.endsWith('.tiff')) {
    ext = 'tiff';
  } else {
    const parts = fileName.split('.');
    ext = parts.length > 1 ? parts[parts.length - 1] : '';
  }
  
  if (ext !== 'tif' && ext !== 'tiff') {
    throw new Error('Unsupported DEM format. Only GeoTIFF (.tif, .tiff) is supported.');
  }

  // Lazy-load geotiff to avoid bundling if unused
  const geotiff = await import('geotiff');
  const arrayBuffer = await file.arrayBuffer();
  const tiff = await geotiff.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();

  const width = image.getWidth();
  const height = image.getHeight();
  const raster = await image.readRasters({ interleave: true, samples: [0] });

  // Try to get bounding box using different methods
  let bounds: [number, number, number, number];
  
  try {
    // Try getBoundingBox first (for properly georeferenced GeoTIFFs)
    const bbox = image.getBoundingBox();
    if (bbox && bbox.length === 4 && bbox.every(v => Number.isFinite(v))) {
      bounds = bbox as [number, number, number, number];
    } else {
      throw new Error('No valid bounding box');
    }
  } catch (error) {
    // If getBoundingBox fails, try to extract from file directory tags
    try {
      const fileDirectory = image.fileDirectory;
      const modelPixelScaleTag = fileDirectory.ModelPixelScaleTag;
      const modelTiepointTag = fileDirectory.ModelTiepointTag;
    //  const geoAsciiParamsTag = fileDirectory.GeoAsciiParamsTag;
      
      if (modelTiepointTag && modelPixelScaleTag && modelTiepointTag.length >= 6) {
        // Use ModelTiepointTag and ModelPixelScaleTag for georeferencing
        // Format: [I, J, K, X, Y, Z] where I,J,K are pixel coordinates and X,Y,Z are world coordinates
        const [tieI, tieJ, worldX, worldY] = modelTiepointTag;
        const [scaleX, scaleY] = modelPixelScaleTag;
        
        // Calculate bounds from tiepoint and pixel scale
        // The tiepoint represents the world coordinates at pixel (I, J)
        const pixelX = tieI;
        const pixelY = tieJ;
        const worldOriginX = worldX;
        const worldOriginY = worldY;
        
        // Calculate the world coordinates at the corners
        const minX = worldOriginX - (pixelX * scaleX);
        const maxX = worldOriginX + ((width - pixelX) * scaleX);
        // Note: Y axis might be inverted depending on the file
        const minY = worldOriginY - ((height - pixelY) * Math.abs(scaleY));
        const maxY = worldOriginY + (pixelY * Math.abs(scaleY));
        
        bounds = [minX, minY, maxX, maxY];
      } else if (fileDirectory.GeoTransformationMatrix && fileDirectory.GeoTransformationMatrix.length === 16) {
        // Use GeoTransformationMatrix (4x4 matrix)
        const matrix = fileDirectory.GeoTransformationMatrix;
        // Extract translation and scale from matrix
        const originX = matrix[12]; // Translation X
        const originY = matrix[13]; // Translation Y
        const scaleX = matrix[0];   // Scale X
        const scaleY = matrix[5];   // Scale Y
        
        const minX = originX;
        const maxX = originX + (width * scaleX);
        const minY = originY;
        const maxY = originY + (height * Math.abs(scaleY));
        
        bounds = [minX, minY, maxX, maxY];
      } else {
        throw new Error('No georeferencing tags found');
      }
    } catch (error2) {
      // If no georeferencing is found, use default bounds (India - can be adjusted by user)
      // Default to India bounds: [minLng, minLat, maxLng, maxLat]
      const defaultBounds: [number, number, number, number] = [68.0, 6.0, 97.0, 37.0];
      bounds = defaultBounds;
      
      // Log a warning but don't throw - allow the DEM to be displayed
      console.warn('GeoTIFF file does not contain georeferencing information. Using default bounds (India). The DEM will be displayed but may not be correctly positioned. Please use a properly georeferenced GeoTIFF file for accurate positioning.');
    }
  }

  // Create a color ramp (simple grayscale)
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let i = 0; i < raster.length; i++) {
    const v = raster[i] as number;
    if (Number.isFinite(v)) {
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
  }
  if (!Number.isFinite(minVal) || !Number.isFinite(maxVal) || minVal === maxVal) {
    minVal = 0; maxVal = 1;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const v = raster[i] as number;
    const t = Number.isFinite(v) ? (v - minVal) / (maxVal - minVal) : 0;
    const shade = Math.max(0, Math.min(255, Math.round(t * 255)));
    imgData.data[i * 4 + 0] = shade;
    imgData.data[i * 4 + 1] = shade;
    imgData.data[i * 4 + 2] = shade;
    imgData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  // Return bounds as [minLng, minLat, maxLng, maxLat]
  // Note: GeoTIFF bounds might be in different coordinate systems
  // Ensure the order is correct for Mapbox (longitude, latitude)
  const elevationData = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const v = raster[i] as number;
    elevationData[i] = Number.isFinite(v) ? v : minVal;
  }

  return {
    canvas,
    bounds,
    width,
    height,
    data: elevationData,
    min: minVal,
    max: maxVal,
  };
}
