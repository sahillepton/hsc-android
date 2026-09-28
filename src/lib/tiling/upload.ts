// Upload-side helpers for the tiling path. Called from the file-upload
// flow when `shouldTile(stagedFile.size)` returns true.
//
// Steps:
//   1. RasterTiling.probe(absolutePath) → bounds, dtype, sourceCrs, nativeZoom
//   1.5 RasterTiling.buildOverviews(absolutePath) → write .ovr sidecar so
//       low-zoom tiles read from a pre-decimated pyramid instead of scanning
//       the full raster every time. One-time per file. Skipped for small
//       rasters or files that already have overviews.
//   2. RasterTiling.registerLayer(layerId, absolutePath) → tile server can serve
//   3. RasterTiling.getTileBaseUrl() → base URL for the local tile server
//   4. Construct a LayerProps with `tilesUrl`, `tileBoundsWgs84`, etc.

import type { LayerProps } from "@/lib/definitions";
import { buildTilesUrl } from "@/lib/tiling/render";
import { RasterTiling } from "@/plugins/raster-tiling";

export interface TilingUploadInput {
  layerId: string;
  layerName: string;
  absolutePath: string;
  /** Optional RGBA tint for the layer chip (Mapbox raster source has no tint, but we keep it for the panel UI). */
  color?: [number, number, number] | [number, number, number, number];
}

export interface TilingUploadCallbacks {
  /**
   * Called when the upload pipeline enters a phase the user might want to
   * see in the toast (probe, optimize, register). Use this to update the
   * loading toast's text without dismissing it.
   */
  onPhase?: (phase: "probing" | "optimizing" | "ready") => void;
}

export async function runTilingUpload(
  input: TilingUploadInput,
  cb?: TilingUploadCallbacks,
): Promise<LayerProps> {
  // 1. Probe the raster (bounds, CRS, palette, native zoom).
  cb?.onPhase?.("probing");
  const probe = await RasterTiling.probe({ path: input.absolutePath });
  if (!probe.boundsWgs84) {
    throw new Error(
      "Raster has no usable geo-reference; cannot tile-display this file.",
    );
  }

  // 1.5. Build overview pyramid if missing (one-time, big rasters only).
  // This is what makes low-zoom tiles fast — without overviews, every
  // z=4 tile of a 1 GB BigTIFF takes 2-5 s. With them, ~50 ms.
  //
  // Do NOT delete this call. It is the only producer of the .ovr/internal
  // pyramid that the worker's `-ovr AUTO` warp selects from; without it every
  // tile at every zoom reads the raster at FULL resolution and downsamples on
  // the fly. It is also what gives the "optimizing" phase its duration — drop
  // it and the phase toast flashes past, so a slow upload looks like a hang.
  cb?.onPhase?.("optimizing");
  try {
    await RasterTiling.buildOverviews({ path: input.absolutePath });
  } catch {
    // Non-fatal — tiles still render, just slower at low zoom.
  }

  // 2. Register layerId → source path with the tile server.
  cb?.onPhase?.("ready");
  await RasterTiling.registerLayer({
    layerId: input.layerId,
    path: input.absolutePath,
  });

  // 3. Resolve the local tile server's base URL.
  const { baseUrl } = await RasterTiling.getTileBaseUrl();
  if (!baseUrl) {
    throw new Error("Local tile server not running yet");
  }
  const tilesUrl = buildTilesUrl(baseUrl, input.layerId);

  // 4. Compose a LayerProps the renderer can react to.
  const [w, s, e, n] = probe.boundsWgs84;
  // Allow Mapbox to request tiles at every zoom level. Low zooms cover huge
  // source areas so they may take a few seconds the first time, but the
  // result is cached on disk and the user expects to see *something* at the
  // initial world/country view.
  const minZoom = 0;
  // Let users overzoom past native by 2 levels (Mapbox upsamples cached
  // native-zoom tiles instead of asking for new ones beyond maxzoom).
  const maxZoom = Math.min(22, probe.nativeZoom + 2);

  const layer: LayerProps = {
    type: "dem",
    id: input.layerId,
    name: input.layerName,
    color: input.color || [255, 255, 255],
    visible: true,
    bounds: [
      [w, s],
      [e, n],
    ],
    tileSourcePath: input.absolutePath,
    tilesUrl,
    tileMinZoom: minZoom,
    tileMaxZoom: maxZoom,
    tileBoundsWgs84: [w, s, e, n],
    sourceCrs: probe.sourceCrs,
    sourceDtype: probe.dtype,
    sourceValueMin: probe.min,
    sourceValueMax: probe.max,
    uploadedAt: Date.now(),
  };
  return layer;
}
