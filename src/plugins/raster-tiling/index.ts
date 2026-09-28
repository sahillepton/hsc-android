// Platform-agnostic abstraction over the raster-tiling backend.
//
// Electron : forwards to window.electronAPI.tiling* (Node child worker
//            running gdal-async + sharp).
// Android  : forwards to the Capacitor "RasterTiling" plugin, which is
//            implemented twice — RasterTilingPlugin.java for the
//            standalone build (com.example.app), RasterTilingPlugin.kt
//            for the integrated MCSA drop (org.deal.mcsa.plugins). Both
//            register the same plugin name so the JS layer is identical.
//
// Mirrors the existing offline-tile-server / native-uploader pattern.

import { registerPlugin } from "@capacitor/core";
import type {
  TilingProbeResult,
  TilingBuildOverviewsResult,
} from "@/electron";

export type { TilingProbeResult, TilingBuildOverviewsResult };

export interface RasterTilingPlugin {
  probe(opts: { path: string }): Promise<TilingProbeResult>;
  buildOverviews(opts: { path: string }): Promise<TilingBuildOverviewsResult>;
  registerLayer(opts: {
    layerId: string;
    path: string;
  }): Promise<{ ok: boolean }>;
  unregisterLayer(opts: {
    layerId: string;
    /** Optional absolute path; used as a fallback to locate the per-layer
     *  tile cache when the native registry has no entry (e.g. app-startup
     *  cleanup before any layer is re-registered). */
    path?: string;
  }): Promise<{ ok: boolean }>;
  sampleAt(opts: {
    layerId: string;
    lon: number;
    lat: number;
  }): Promise<{ value: number | null; dtype: string }>;
  /** Returns null on platforms where the local tile server isn't running yet. */
  getTileBaseUrl(): Promise<{ baseUrl: string | null }>;
  closeAll(): Promise<{ closed: boolean }>;
}

// ── Platform detection ──
function isElectron(): boolean {
  return typeof window !== "undefined" && !!(window as any).electronAPI;
}

// ── Electron desktop implementation ──
// Wraps the existing IPC verbs so the renderer can use one API on both
// platforms. The wire shapes are the same; only `getTileBaseUrl` is
// normalised to return `{ baseUrl }` instead of a bare string.
function createDesktopPlugin(): RasterTilingPlugin {
  const api = () => (window as any).electronAPI;
  return {
    probe: ({ path }) => api().tilingProbe(path),
    buildOverviews: ({ path }) => api().tilingBuildOverviews(path),
    registerLayer: ({ layerId, path }) =>
      api().tilingRegisterLayer(layerId, path),
    unregisterLayer: ({ layerId, path }) =>
      api().tilingUnregisterLayer(layerId, path),
    sampleAt: (opts) => api().tilingSampleAt(opts),
    getTileBaseUrl: async () => ({
      baseUrl: await api().tilingGetTileBaseUrl(),
    }),
    closeAll: () => api().tilingCloseAll(),
  };
}

// ── Export: Electron uses IPC, Android uses the Capacitor RasterTiling plugin ──
export const RasterTiling: RasterTilingPlugin = isElectron()
  ? createDesktopPlugin()
  : registerPlugin<RasterTilingPlugin>("RasterTiling");
