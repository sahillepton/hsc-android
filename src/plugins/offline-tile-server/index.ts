import { registerPlugin } from "@capacitor/core";

export interface OfflineTileServerPlugin {
  /**
   * Open folder picker to select tile directory
   * Returns the selected folder URI
   */
  selectTileFolder(): Promise<{ uri: string }>;

  /**
   * Update the folder path the server reads from (server is always running)
   * @param options.uri - The SAF URI of the tile folder
   * @param options.useTms - If true, tiles are in TMS format (Y coordinate flipped). Default: false (XYZ format)
   * @returns Base URL and port of the server
   */
  updateFolderPath(options: { uri: string; useTms?: boolean }): Promise<{
    baseUrl: string;
    port: number;
  }>;

  /**
   * Get the server URL (server is always running)
   * @returns Base URL and port of the server
   */
  getServerUrl(): Promise<{
    baseUrl: string;
    port: number;
  }>;

  /**
   * Get the saved folder URI from previous session
   * @returns The saved URI or null if none exists
   */
  getSavedFolderUri(): Promise<{ uri: string | null }>;

  /**
   * Check if storage permissions are granted
   * @returns true if permissions are granted, false otherwise
   */
  checkStoragePermission(): Promise<{ hasPermission: boolean }>;

  /**
   * Point the /basemap/ route at a folder (or clear it with an empty path).
   * Same server / same port — leaves the default tiles + user rasters untouched.
   * @param options.path - Absolute folder path (Electron) or SAF tree URI (Android)
   */
  basemapSetFolder(options: { path: string }): Promise<{
    ok?: boolean;
    baseUrl: string | null;
    port?: number;
  }>;
}

// ── Platform detection ──
function isElectron(): boolean {
  return typeof window !== "undefined" && !!(window as any).electronAPI;
}

// ── Electron desktop implementation ──
function createDesktopPlugin(): OfflineTileServerPlugin {
  const api = () => (window as any).electronAPI;
  return {
    async selectTileFolder() {
      return await api().tileServerSelectFolder();
    },
    async updateFolderPath(options: { uri: string; useTms?: boolean }) {
      return await api().tileServerUpdateFolder(options.uri);
    },
    async getServerUrl() {
      return await api().tileServerGetUrl();
    },
    async getSavedFolderUri() {
      return await api().tileServerGetSavedFolder();
    },
    async checkStoragePermission() {
      return await api().tileServerCheckPermission();
    },
    async basemapSetFolder(options: { path: string }) {
      return await api().basemapSetFolder(options.path);
    },
  };
}

// ── Export: Electron uses IPC, Android uses Capacitor native plugin ──
export const OfflineTileServer: OfflineTileServerPlugin = isElectron()
  ? createDesktopPlugin()
  : registerPlugin<OfflineTileServerPlugin>("OfflineTileServer");
