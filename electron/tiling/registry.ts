// In-memory map of layerId → on-disk source raster path.
//
// Populated on upload (renderer calls `tiling:registerLayer`) and on app
// startup (when a saved manifest is loaded). The HTTP tile server route
// `/layers/<layerId>/{z}/{x}/{y}.png` looks up the source path here, then
// hands (path, z, x, y) to the worker.

const layerToSource = new Map<string, string>();

export function registerLayer(layerId: string, absolutePath: string): void {
  if (!layerId || !absolutePath) return;
  layerToSource.set(layerId, absolutePath);
}

export function unregisterLayer(layerId: string): void {
  layerToSource.delete(layerId);
}

export function lookupSource(layerId: string): string | null {
  return layerToSource.get(layerId) || null;
}

export function listLayers(): Array<{ layerId: string; path: string }> {
  return Array.from(layerToSource, ([layerId, path]) => ({ layerId, path }));
}
