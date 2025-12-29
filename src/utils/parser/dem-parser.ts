import { fileToDEMRaster } from "@/lib/utils";
import type { LayerProps } from "@/lib/definitions";

export interface DemParseResult {
  bounds: [number, number, number, number];
  width: number;
  height: number;
  data: Float32Array;
  min: number;
  max: number;
  canvas: HTMLCanvasElement;
}

export interface DemParseOptions {
  layerId: string;
  layerName: string;
  onProgress?: (percent: number) => void;
}

/**
 * Parse DEM file using worker thread, with fallback to main thread
 */
export async function parseDemFile(
  file: File,
  options: DemParseOptions
): Promise<DemParseResult> {
  const { onProgress } = options;

  try {
    onProgress?.(10);

    // Prefer worker: offload DEM parsing; fallback to main thread if worker fails/times out
    const runWorker = async (): Promise<DemParseResult> => {
      const worker = new Worker(
        new URL("../../workers/dem-worker.ts", import.meta.url),
        { type: "module" }
      );
      const ab = await file.arrayBuffer();
      onProgress?.(30);

      const result = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => {
          worker.terminate();
          reject(new Error("Worker timeout"));
        }, 300000); // 5 minutes

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

        worker.postMessage({ type: "parse-dem", name: file.name, buffer: ab }, [
          ab,
        ]);
      });

      if (result?.error) throw new Error(result.error);

      onProgress?.(70);

      // Rebuild canvas from grayscale on main thread
      const elevation = new Float32Array(result.elevationBuffer);
      const grayscale = new Uint8ClampedArray(result.grayscaleBuffer);
      const canvas = document.createElement("canvas");
      canvas.width = result.width;
      canvas.height = result.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Failed to create canvas for DEM");
      }
      const cloned = new Uint8ClampedArray(grayscale.length);
      cloned.set(grayscale);
      const img = new ImageData(cloned, result.width, result.height);
      ctx.putImageData(img, 0, 0);

      return {
        bounds: result.bounds,
        width: result.width,
        height: result.height,
        data: elevation,
        min: result.min,
        max: result.max,
        canvas,
      };
    };

    let dem: DemParseResult;
    try {
      dem = await Promise.race([
        runWorker(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Processing timeout after 5 minutes")),
            300000
          )
        ),
      ]);
    } catch (workerErr) {
      // Worker failed; fallback to main-thread parsing
      onProgress?.(50);
      dem = await Promise.race([
        fileToDEMRaster(file),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Processing timeout after 5 minutes")),
            300000
          )
        ),
      ]);
    }

    onProgress?.(90);
    return dem;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Error parsing DEM: ${errorMessage}`);
  }
}

/**
 * Create a layer from parsed DEM data
 */
export function createDemLayer(
  dem: DemParseResult,
  options: DemParseOptions
): LayerProps {
  const { layerId, layerName } = options;

  return {
    type: "dem",
    id: layerId,
    name: layerName,
    color: [255, 255, 255],
    visible: true,
    bounds: [
      [dem.bounds[0], dem.bounds[1]],
      [dem.bounds[2], dem.bounds[3]],
    ],
    bitmap: dem.canvas,
    texture: dem.canvas,
    elevationData: {
      data: dem.data,
      width: dem.width,
      height: dem.height,
      min: dem.min,
      max: dem.max,
    },
    uploadedAt: Date.now(),
  } as LayerProps & { uploadedAt: number };
}
