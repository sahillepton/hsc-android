import { registerPlugin } from "@capacitor/core";

export interface TileCachePlugin {
  setTilesDirectory(options: { path: string }): Promise<{ success: boolean }>;

  getTile(options: {
    z: string;
    x: string;
    y: string;
  }): Promise<{ data: string; fromCache: boolean }>;

  clearCache(): Promise<{ success: boolean }>;

  pickDirectory(): Promise<{ path: string }>;
}

// ── Platform detection ──
function isElectron(): boolean {
  return typeof window !== "undefined" && !!(window as any).electronAPI;
}

// ── Electron desktop implementation ──
function createDesktopPlugin(): TileCachePlugin {
  const api = () => (window as any).electronAPI;
  return {
    async setTilesDirectory(options: { path: string }) {
      return await api().tileCacheSetDir(options.path);
    },
    async getTile(options: { z: string; x: string; y: string }) {
      return await api().tileCacheGetTile(options.z, options.x, options.y);
    },
    async clearCache() {
      return await api().tileCacheClear();
    },
    async pickDirectory() {
      return await api().tileCachePickDir();
    },
  };
}

// ── Export: Electron uses IPC, Android uses Capacitor native plugin ──
export const TileCache: TileCachePlugin = isElectron()
  ? createDesktopPlugin()
  : registerPlugin<TileCachePlugin>("TileCache");
