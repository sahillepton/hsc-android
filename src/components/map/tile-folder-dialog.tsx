import { OfflineTileServer } from "@/plugins/offline-tile-server";

/**
 * Check if storage permissions are granted
 */
export const checkStoragePermission = async (): Promise<boolean> => {
  try {
    const result = await OfflineTileServer.checkStoragePermission();
    return result.hasPermission;
  } catch (error) {
    console.error("Error checking storage permission:", error);
    return false;
  }
};

/**
 * Wait for storage permissions to be granted (with timeout)
 * Polls every 500ms up to maxWaitMs (default 30 seconds)
 */
export const waitForStoragePermission = async (
  maxWaitMs: number = 30000
): Promise<boolean> => {
  const startTime = Date.now();
  const pollInterval = 500; // Check every 500ms

  while (Date.now() - startTime < maxWaitMs) {
    const hasPermission = await checkStoragePermission();
    if (hasPermission) {
      console.log("[TileServer] Storage permission granted");
      return true;
    }
    // Wait before next check
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  console.warn("[TileServer] Timeout waiting for storage permission");
  return false;
};

/**
 * Initialize tile server - always uses default path: Internal storage/Documents/tiles
 * Checks permissions first and waits if needed
 * No folder selection, no preferences - always uses default path
 */
export const initializeTileServer = async (
  waitForPermission: boolean = true
): Promise<string | null> => {
  try {
    // Check permissions first
    let hasPermission = await checkStoragePermission();

    // If no permission and we should wait, wait for it
    if (!hasPermission && waitForPermission) {
      console.log(
        "[TileServer] Storage permission not granted, waiting for user to grant..."
      );
      hasPermission = await waitForStoragePermission(30000); // Wait up to 30 seconds
    }

    if (!hasPermission) {
      console.warn(
        "[TileServer] Storage permission not granted, server may not be able to read tiles"
      );
      // Still return URL - server might work if permissions are granted later
    }

    // Server is always running with default path (Documents/tiles)
    // Just get the URL - server already initialized with default path
    const result = await OfflineTileServer.getServerUrl();
    console.log("[TileServer] Server URL:", result.baseUrl);
    console.log(
      "[TileServer] Using default path: Internal storage/Documents/tiles"
    );
    return result.baseUrl;
  } catch (error) {
    console.error("Error getting tile server URL:", error);
    return null;
  }
};
