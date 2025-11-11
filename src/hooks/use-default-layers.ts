import { TextLayer } from "@deck.gl/layers";
import placesData from "@/lib/places.json";
import { indianStatesData } from "@/data/indian-states";
import { useMemo } from "react";

// Memoize expensive data processing outside the hook to avoid recomputation
const stateCenterByName: Record<string, [number, number]> = (
  indianStatesData as any[]
).reduce((acc: Record<string, [number, number]>, item: any) => {
  const key = String(item.name || "")
    .trim()
    .toLowerCase();
  if (item.coordinates && Array.isArray(item.coordinates)) {
    acc[key] = item.coordinates as [number, number];
  }
  return acc;
}, {});

const cityLabelData = Array.isArray(placesData)
  ? placesData
      .filter(
        (place: any) =>
          place &&
          typeof place.longitude === "number" &&
          typeof place.latitude === "number" &&
          typeof place.city === "string"
      )
      .map((place: any) => ({
        city: place.city,
        position: [place.longitude, place.latitude] as [number, number],
      }))
  : [];

const indiaPlacesData = Object.entries(placesData as any).flatMap(
  ([cityName, city]: [string, any]) =>
    (city?.districts || []).flatMap((district: any) =>
      Array.isArray(district?.places)
        ? district.places.map((place: any) => ({
            name: place.name,
            coordinates: [place.lng, place.lat],
            city: cityName,
          }))
        : []
    )
);

const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~2.399
const districtsLabelData = Object.entries(placesData as any).flatMap(
  ([stateName, stateObj]: [string, any]) => {
    const stateKey = stateName.trim().toLowerCase();
    const base = stateCenterByName[stateKey];
    if (!base) return [] as any[];
    const districts = Array.isArray(stateObj?.districts)
      ? stateObj.districts
      : [];
    return districts.map((d: any, idx: number) => {
      const rDeg = 0.05 + 0.015 * Math.floor(idx / 6); // small radial spread in degrees
      const theta = idx * goldenAngle;
      const dx = rDeg * Math.cos(theta);
      const dy = rDeg * Math.sin(theta);
      const lng = base[0] + dx;
      const lat = base[1] + dy;
      return {
        name: String(d?.name || ""),
        coordinates: [lng, lat] as [number, number],
        state: stateName,
      };
    });
  }
);

export const useDefaultLayers = (mapZoom: number) => {
  // Memoize layer creation to avoid recreating on every render
  // Only update when zoom changes significantly (use rounded zoom for stability)
  const roundedZoom = Math.floor(mapZoom * 10) / 10;

  const stateTextSize = useMemo(
    () => Math.max(10, Math.min(20, 10 + roundedZoom * 1)),
    [roundedZoom]
  );

  const stateNamesLayer = useMemo(
    () =>
      new TextLayer({
        id: "state-names-layer",
        data: indianStatesData,
        pickable: false,
        getPosition: (d: any) => d.coordinates,
        getText: (d: any) => d.name,
        getSize: stateTextSize,
        getAngle: 0,
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        getColor: [255, 255, 255, 255], // White to improve contrast
        fontFamily: "Arial, sans-serif",
        fontWeight: "600", // Semibold appearance
        outlineWidth: Math.max(1, Math.min(2.2, 1 + roundedZoom * 0.12)), // Scale outline with zoom
        outlineColor: [0, 0, 0, 255], // Black outline for better visibility
        billboard: true,
        sizeScale: 1,
        sizeMinPixels: Math.max(8, 8 + roundedZoom * 0.9), // Dynamic min based on zoom
        sizeMaxPixels: Math.max(16, 16 + roundedZoom * 1.4), // Dynamic max based on zoom
        // Avoid label overlaps
        collisionEnabled: true,
        collisionPadding: Math.max(2, 2 + (roundedZoom - 0) * 0.35), // Scale padding with zoom
        visible: true, // Always visible
        updateTriggers: {
          getSize: [stateTextSize],
        },
      }),
    [stateTextSize, roundedZoom]
  );

  const cityLabelBaseSize = useMemo(
    () =>
      roundedZoom >= 5
        ? Math.max(12, Math.min(26, 12 + (roundedZoom - 5) * 2.2))
        : 12,
    [roundedZoom]
  );

  const cityNamesLayer = useMemo(
    () =>
      new TextLayer({
        id: "city-names-layer",
        data: cityLabelData,
        pickable: false,
        getPosition: (d: any) => d.position,
        getText: (d: any) => d.city,
        getColor: [255, 255, 255, 210],
        getSize: cityLabelBaseSize,
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        sizeUnits: "pixels",
        sizeMinPixels: Math.max(10, Math.min(18, cityLabelBaseSize - 2)),
        sizeMaxPixels: Math.max(18, Math.min(28, cityLabelBaseSize + 4)),
        billboard: true,
        fontWeight: "200",
        collisionEnabled: true,
        visible: roundedZoom >= 8,
        updateTriggers: {
          getSize: [cityLabelBaseSize],
        },
      }),
    [cityLabelBaseSize, roundedZoom]
  );

  const placesTextSize = useMemo(
    () =>
      roundedZoom >= 8
        ? Math.max(11, Math.min(20, 9 + (roundedZoom - 8) * 2.25))
        : 11,
    [roundedZoom]
  );

  const indiaPlacesLayer = useMemo(
    () =>
      new TextLayer({
        id: "india-places-layer",
        data: indiaPlacesData,
        pickable: false,
        getPosition: (d: any) => d.coordinates,
        getText: (d: any) => d.name,
        getSize: placesTextSize,
        getAngle: 0,
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        getColor: [255, 255, 0, 255], // Bright yellow text
        fontFamily: "Arial, sans-serif",
        fontWeight: "bold",
        outlineWidth:
          roundedZoom >= 8
            ? Math.max(1.2, Math.min(2.5, 0.8 + (roundedZoom - 8) * 0.43))
            : 1.2, // Scale outline with zoom
        outlineColor: [0, 0, 0, 255], // Black outline for better visibility
        billboard: true,
        sizeScale: 1,
        sizeMinPixels:
          roundedZoom >= 8
            ? Math.max(9, 7 + (roundedZoom - 8) * 1.5)
            : 9, // Dynamic min based on zoom
        sizeMaxPixels:
          roundedZoom >= 8
            ? Math.max(16, 13 + (roundedZoom - 8) * 2.25)
            : 16, // Dynamic max based on zoom
        // Avoid label overlaps
        collisionEnabled: true,
        collisionPadding:
          roundedZoom >= 8
            ? Math.max(1.5, 1 + (roundedZoom - 8) * 0.5)
            : 1.5, // Scale padding with zoom
        visible: roundedZoom >= 8, // Show at slightly lower zoom for better visibility
        updateTriggers: {
          getSize: [placesTextSize],
        },
      }),
    [placesTextSize, roundedZoom]
  );

  const districtsTextSize = useMemo(
    () =>
      roundedZoom >= 7
        ? Math.max(12, Math.min(22, 10 + (roundedZoom - 7) * 2.4))
        : 12,
    [roundedZoom]
  );

  const indiaDistrictsLayer = useMemo(
    () =>
      new TextLayer({
        id: "india-districts-layer",
        data: districtsLabelData,
        pickable: false,
        getPosition: (d: any) => d.coordinates,
        getText: (d: any) => d.name,
        getSize: districtsTextSize,
        getAngle: 0,
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        getColor: [255, 165, 0, 255], // Bright orange for districts
        fontFamily: "Arial, sans-serif",
        fontWeight: "bold",
        outlineWidth:
          roundedZoom >= 7
            ? Math.max(1.3, Math.min(2.5, 1 + (roundedZoom - 7) * 0.3))
            : 1.3, // Scale outline with zoom
        outlineColor: [0, 0, 0, 255],
        billboard: true,
        sizeScale: 1,
        sizeMinPixels:
          roundedZoom >= 7 ? Math.max(10, 8 + (roundedZoom - 7) * 1.6) : 10, // Dynamic min based on zoom
        sizeMaxPixels:
          roundedZoom >= 7 ? Math.max(18, 15 + (roundedZoom - 7) * 2.4) : 18, // Dynamic max based on zoom
        collisionEnabled: true,
        collisionPadding:
          roundedZoom >= 7 ? Math.max(2, 1.5 + (roundedZoom - 7) * 0.5) : 2, // Scale padding with zoom
        visible: roundedZoom >= 7, // Show at slightly lower zoom for better visibility
        updateTriggers: {
          getSize: [districtsTextSize],
        },
      }),
    [districtsTextSize, roundedZoom]
  );

  return {
    cityNamesLayer,
    indiaPlacesLayer,
    indiaDistrictsLayer,
    stateNamesLayer,
  };
};