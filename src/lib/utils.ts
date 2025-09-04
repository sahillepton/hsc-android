import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import * as turf from "@turf/turf";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}


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