// Vector parsing worker: offloads CSV/GPX/KML/KMZ/WKT/PRJ parsing to keep the UI responsive.
// Falls back to main thread when parsing isn't supported (e.g., DOMParser unavailable in worker).

import { fileToGeoJSON } from "../lib/utils";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const ctx: any = self as any;

type VectorParseRequest = {
  type: "parse-vector";
  name: string;
  mime?: string;
  buffer: ArrayBuffer;
};

type VectorParseResponse =
  | {
      type: "parse-vector-result";
      geojson: GeoJSON.FeatureCollection | GeoJSON.Feature;
      error?: undefined;
      unsupported?: false;
    }
  | {
      type: "parse-vector-result";
      geojson?: undefined;
      error: string;
      unsupported?: boolean;
    };

const requiresDOMParser = (name: string) => {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".gpx") || lower.endsWith(".kml") || lower.endsWith(".kmz")
  );
};

ctx.onmessage = async (ev: MessageEvent<VectorParseRequest>) => {
  const msg = ev.data;
  if (msg.type !== "parse-vector") return;

  try {
    if (requiresDOMParser(msg.name) && typeof DOMParser === "undefined") {
      ctx.postMessage({
        type: "parse-vector-result",
        error: "DOMParser not available in worker",
        unsupported: true,
      } satisfies VectorParseResponse);
      return;
    }

    const file = new File([msg.buffer], msg.name, {
      type: msg.mime || "application/octet-stream",
    });

    const geojson = await fileToGeoJSON(file);
    ctx.postMessage({
      type: "parse-vector-result",
      geojson,
    } satisfies VectorParseResponse);
  } catch (error: any) {
    ctx.postMessage({
      type: "parse-vector-result",
      error: error?.message || "Unknown error",
    } satisfies VectorParseResponse);
  }
};
