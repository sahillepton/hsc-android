import { TileCache } from "@/plugins/tile-cache";

// Cache for pending requests to avoid duplicate loads
const pendingRequests = new Map<string, Promise<ArrayBuffer>>();

/**
 * Load a PBF tile from native cache
 */
export async function loadTileFromCache(
  z: string,
  x: string,
  y: string
): Promise<ArrayBuffer> {
  const cacheKey = `${z}/${x}/${y}`;

  // Check if request is already pending
  const pending = pendingRequests.get(cacheKey);
  if (pending) {
    return pending;
  }

  // Create new request
  const requestPromise = (async () => {
    try {
      const result = await TileCache.getTile({ z, x, y });

      // Decode base64 to ArrayBuffer
      const base64Data = result.data;
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      return bytes.buffer;
    } catch (error) {
      console.error(`Error loading tile ${cacheKey}:`, error);
      throw error;
    } finally {
      // Remove from pending requests
      pendingRequests.delete(cacheKey);
    }
  })();

  // Store pending request
  pendingRequests.set(cacheKey, requestPromise);

  return requestPromise;
}

/**
 * Create a blob URL for a tile that will be loaded from native cache
 * This is used to create a URL that Mapbox can fetch
 */
export function createTileBlobUrl(z: string, x: string, y: string): string {
  // Use a custom protocol that we'll intercept
  return `native-tile://${z}/${x}/${y}.pbf`;
}

// Cache blob URLs to avoid recreating them
const blobUrlCache = new Map<string, string>();
// Track tiles being loaded to avoid duplicate requests
const loadingTiles = new Map<string, Promise<string>>();

/**
 * Load tile and create blob URL for Mapbox to fetch (synchronous return, async load)
 * Returns a placeholder blob URL immediately, then updates it when tile loads
 */
export function getTileBlobUrl(z: string, x: string, y: string): string {
  const cacheKey = `${z}/${x}/${y}`;

  // Return cached blob URL if exists
  if (blobUrlCache.has(cacheKey)) {
    return blobUrlCache.get(cacheKey)!;
  }

  // If already loading, return a placeholder (will be updated when loaded)
  if (loadingTiles.has(cacheKey)) {
    // Return a data URL placeholder that fetch can intercept
    return `native-tile://${z}/${x}/${y}.pbf`;
  }

  // Start loading the tile asynchronously
  const loadPromise = (async () => {
    try {
      const arrayBuffer = await loadTileFromCache(z, x, y);
      const blob = new Blob([arrayBuffer], { type: "application/x-protobuf" });
      const blobUrl = URL.createObjectURL(blob);
      blobUrlCache.set(cacheKey, blobUrl);
      return blobUrl;
    } catch (error) {
      console.error(`Failed to load tile ${cacheKey}:`, error);
      // Return empty data URL as fallback
      const fallbackUrl = "data:application/x-protobuf;base64,";
      blobUrlCache.set(cacheKey, fallbackUrl);
      return fallbackUrl;
    } finally {
      loadingTiles.delete(cacheKey);
    }
  })();

  loadingTiles.set(cacheKey, loadPromise);

  // Return placeholder URL - fetch override will handle it
  return `native-tile://${z}/${x}/${y}.pbf`;
}

/**
 * Transform a native-tile:// URL to load from cache
 * This should be used in transformRequest
 */
export async function transformTileRequest(
  url: string
): Promise<Response | null> {
  const match = url.match(/native-tile:\/\/(\d+)\/(\d+)\/(\d+)\.pbf/);
  if (!match) {
    return null; // Not our custom URL
  }

  const [, z, x, y] = match;

  try {
    const arrayBuffer = await loadTileFromCache(z, x, y);

    // Create a Response object with ArrayBuffer directly
    // Mapbox GL expects binary PBF data
    return new Response(arrayBuffer, {
      status: 200,
      statusText: "OK",
      headers: {
        "Content-Type": "application/x-protobuf",
      },
    });
  } catch (error) {
    console.error(`Failed to load tile ${z}/${x}/${y}:`, error);
    // Return 404 response
    return new Response(null, {
      status: 404,
      statusText: "Not Found",
    });
  }
}
