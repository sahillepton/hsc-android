// Resolve when Mapbox has finished loading the *currently visible* tiles for
// a tiled raster layer. Used by the upload flow so the "Tiling X..." toast
// stays in loading state until the user can actually see something — instead
// of being marked "ready" the moment the layer is registered (which happens
// long before any pixel hits the canvas).
//
// Two signals are needed (just `idle` is not enough):
//   1. At least one `data` event for the layer's source with `tile` set —
//      proves Mapbox actually started fetching tiles for it. Otherwise the
//      first `idle` event right after the layer is added (when the map is
//      sitting still and hasn't asked for anything yet) would fire and we'd
//      wrongly mark the upload "loaded" before a single pixel hit canvas.
//   2. `isSourceLoaded(sourceId)` returns true on `idle` — proves the
//      visible viewport's tiles are all in.

type MapboxLikeMap = {
  on: (ev: string, cb: (e?: any) => void) => void;
  off: (ev: string, cb: (e?: any) => void) => void;
  isSourceLoaded?: (id: string) => boolean;
};

const RASTER_PREFIX = "raster-";

export interface WaitForTilesOptions {
  /**
   * Hard cap so a stuck render doesn't strand the toast forever.
   * Default 10 minutes — long enough for a multi-GB raster's first load.
   */
  timeoutMs?: number;
}

/**
 * Resolve to `true` once at least one tile has been delivered AND the
 * raster source reports loaded on a subsequent `idle`. Resolves to
 * `false` on timeout — caller decides whether to surface success or
 * a softer "still working" state.
 */
export function waitForRasterTilesLoaded(
  map: MapboxLikeMap,
  layerId: string,
  opts: WaitForTilesOptions = {},
): Promise<boolean> {
  const sourceId = `${RASTER_PREFIX}${layerId}`;
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;

  return new Promise<boolean>((resolve) => {
    let firstTileSeen = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      try { map.off("data", onData); } catch { /* noop */ }
      try { map.off("idle", onIdle); } catch { /* noop */ }
      if (timer) clearTimeout(timer);
    };

    const onData = (e?: any) => {
      // Mapbox fires a `data` event for every tile that arrives. We just
      // need any one of them for our source to know fetching has begun.
      if (
        e &&
        e.sourceId === sourceId &&
        e.dataType === "source" &&
        e.tile
      ) {
        firstTileSeen = true;
      }
    };

    const onIdle = () => {
      // Wait until at least one tile has actually arrived — without this,
      // the first `idle` fires before Mapbox even requests anything.
      if (!firstTileSeen) return;
      try {
        if (map.isSourceLoaded?.(sourceId)) {
          cleanup();
          resolve(true);
        }
      } catch {
        // Source might have been removed (layer deleted) — treat as done.
        cleanup();
        resolve(true);
      }
    };

    map.on("data", onData);
    map.on("idle", onIdle);
    timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
  });
}
