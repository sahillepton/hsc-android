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
}

export const OfflineTileServer =
  registerPlugin<OfflineTileServerPlugin>("OfflineTileServer");
