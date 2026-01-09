import { registerPlugin } from "@capacitor/core";

export interface OfflineTileServerPlugin {
  /**
   * Open folder picker to select tile directory
   * Returns the selected folder URI
   */
  selectTileFolder(): Promise<{ uri: string }>;

  /**
   * Start the local HTTP tile server
   * @param options.uri - The SAF URI of the tile folder
   * @param options.useTms - If true, tiles are in TMS format (Y coordinate flipped). Default: false (XYZ format)
   * @returns Base URL and port of the server
   */
  startTileServer(options: { uri: string; useTms?: boolean }): Promise<{
    baseUrl: string;
    port: number;
  }>;

  /**
   * Stop the tile server
   */
  stopTileServer(): Promise<void>;

  /**
   * Get the saved folder URI from previous session
   * @returns The saved URI or null if none exists
   */
  getSavedFolderUri(): Promise<{ uri: string | null }>;
}

export const OfflineTileServer =
  registerPlugin<OfflineTileServerPlugin>("OfflineTileServer");
