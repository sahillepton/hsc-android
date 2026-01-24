import { useMemo } from "react";
import { LineLayer, PolygonLayer } from "@deck.gl/layers";

interface RubberBandRectangleProps {
  isDrawing: boolean;
  isZooming: boolean;
  start: [number, number] | null;
  end: [number, number] | null;
}

/**
 * Calculate bounding box from rectangle corners
 */
export const calculateRectangleBounds = (
  start: [number, number] | null,
  end: [number, number] | null
): {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
} | null => {
  if (!start || !end) return null;

  const minLng = Math.min(start[0], end[0]);
  const maxLng = Math.max(start[0], end[0]);
  const minLat = Math.min(start[1], end[1]);
  const maxLat = Math.max(start[1], end[1]);

  return { minLng, maxLng, minLat, maxLat };
};

/**
 * Hook to create rectangle outline layer (shown during drawing and zooming)
 */
export const useRubberBandRectangle = ({
  isDrawing,
  isZooming,
  start,
  end,
}: RubberBandRectangleProps) => {
  return useMemo(() => {
    if ((!isDrawing && !isZooming) || !start || !end) {
      return null;
    }

    // Debug: Log when creating rectangle
    if (isDrawing) {
      console.log("[RubberBand] Creating rectangle layer:", {
        start,
        end,
        isDrawing,
        isZooming,
      });
    }

    // Create rectangle coordinates
    // Ensure we have valid coordinates even if start and end are the same
    let minLng = Math.min(start[0], end[0]);
    let maxLng = Math.max(start[0], end[0]);
    let minLat = Math.min(start[1], end[1]);
    let maxLat = Math.max(start[1], end[1]);

    // If start and end are the same (initial click), create a small rectangle for preview
    if (minLng === maxLng && minLat === maxLat) {
      const offset = 0.0001; // Small offset to make rectangle visible
      minLng = start[0] - offset;
      maxLng = start[0] + offset;
      minLat = start[1] - offset;
      maxLat = start[1] + offset;
    }

    const rectangle: [number, number][] = [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat], // Close the rectangle
    ];

    // Create both outline and fill for better visibility (like MS Paint)
    const rectanglePolygon: [number, number][] = [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
    ];

    // Return both a filled polygon (semi-transparent) and an outline
    // We'll use PolygonLayer for fill and LineLayer for outline
    return [
      // Fill layer (semi-transparent blue like MS Paint selection)
      new PolygonLayer({
        id: "rubber-band-rectangle-fill",
        data: [{ polygon: rectanglePolygon }],
        fp64: true, // Use 64-bit precision for Samsung devices
        pickable: false,
        stroked: true,
        filled: true,
        getPolygon: (d: any) => d.polygon,
        getFillColor: isDrawing ? [135, 206, 250, 80] : [255, 255, 255, 0], // Light blue when drawing, transparent when zooming
        getLineColor: [255, 255, 255, 0], // No border on fill
        lineWidthMinPixels: 0,
        updateTriggers: {
          getPolygon: [start, end],
        },
      }),
      // Outline layer (white solid border - more visible)
      new LineLayer({
        id: "rubber-band-rectangle-outline",
        data: [{ path: rectangle }],
        pickable: false,
        getPath: (d: any) => d.path,
        getColor: [255, 255, 255, 255], // White outline
        getWidth: 3,
        widthUnits: "pixels",
        widthMinPixels: 3,
        widthMaxPixels: 3,
        updateTriggers: {
          getPath: [start, end],
        },
      }),
    ];
  }, [isDrawing, isZooming, start, end]);
};

/**
 * Hook to create overlay layer (black overlay outside selection, shown only during zooming)
 */
export const useRubberBandOverlay = ({
  isZooming,
  start,
  end,
}: {
  isZooming: boolean;
  start: [number, number] | null;
  end: [number, number] | null;
}) => {
  return useMemo(() => {
    if (!isZooming || !start || !end) return null;

    // Create rectangle coordinates
    const minLng = Math.min(start[0], end[0]);
    const maxLng = Math.max(start[0], end[0]);
    const minLat = Math.min(start[1], end[1]);
    const maxLat = Math.max(start[1], end[1]);

    const rectangle: [number, number][] = [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
    ];

    // Create world bounds polygon (outer ring)
    const worldBounds: [number, number][] = [
      [-180, -90],
      [180, -90],
      [180, 90],
      [-180, 90],
    ];

    // Create polygon with hole (world - selection)
    const overlayPolygon = [
      worldBounds, // Outer ring: world bounds
      rectangle, // Inner ring: user's selection (hole)
    ];

    return new PolygonLayer({
      id: "rubber-band-overlay",
      data: [{ polygon: overlayPolygon }],
      fp64: true, // Use 64-bit precision for Samsung devices
      pickable: false,
      stroked: false,
      filled: true,
      wireframe: false,
      getPolygon: (d: any) => d.polygon,
      getFillColor: [0, 0, 0, 180], // Black with ~70% opacity
      getLineColor: [255, 255, 255, 0],
      lineWidthMinPixels: 0,
      updateTriggers: {
        getPolygon: [start, end],
      },
    });
  }, [isZooming, start, end]);
};
