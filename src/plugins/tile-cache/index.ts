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

export const TileCache = registerPlugin<TileCachePlugin>("TileCache");
