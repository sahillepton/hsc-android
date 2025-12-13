import { Filesystem, Encoding } from "@capacitor/filesystem";
import { HSC_DIRECTORY, HSC_MANIFEST_PATH, HSC_BASE_DIR } from "./constants";

export type ManifestStatus = "staged" | "saved";

export type ManifestEntry = {
  layerId: string;
  layerName: string;

  // storage info
  path: string; // logicalPath: "DOCUMENTS/HSC-SESSIONS/FILES/<name>"
  absolutePath: string; // native absolute path (android)
  originalName: string;
  mimeType?: string;

  size: number;
  status: ManifestStatus;
  createdAt: number;

  // allow extra properties without breaking (Cursor can extend)
  [k: string]: any;
};

// In-memory temp manifest (starts empty each session)
let tempManifest: ManifestEntry[] = [];

function safeJsonParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/**
 * Get temp manifest (in-memory, starts empty each session)
 */
export function getTempManifest(): ManifestEntry[] {
  return tempManifest;
}

/**
 * Load stored manifest from disk
 */
export async function loadStoredManifest(): Promise<ManifestEntry[]> {
  try {
    const r = await Filesystem.readFile({
      path: HSC_MANIFEST_PATH,
      directory: HSC_DIRECTORY,
      encoding: Encoding.UTF8,
    });
    const txt = (r.data ?? "") as string;
    const arr = safeJsonParse<any>(txt, []);
    return Array.isArray(arr) ? (arr as ManifestEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Load manifest (for backward compatibility - returns temp manifest)
 */
export async function loadManifest(): Promise<ManifestEntry[]> {
  return tempManifest;
}

export async function writeManifest(entries: ManifestEntry[]): Promise<void> {
  try {
    // Ensure directory exists
    await Filesystem.mkdir({
      path: HSC_BASE_DIR,
      directory: HSC_DIRECTORY,
      recursive: true,
    });
  } catch {
    // Directory may already exist, ignore
  }

  await Filesystem.writeFile({
    path: HSC_MANIFEST_PATH,
    directory: HSC_DIRECTORY,
    data: JSON.stringify(entries, null, 2),
    encoding: Encoding.UTF8,
    recursive: true,
  });
}

/**
 * Add or update entry in temp manifest (in-memory only)
 */
export function upsertTempManifestEntry(entry: ManifestEntry): void {
  const idx = tempManifest.findIndex((x) => x.layerId === entry.layerId);
  if (idx >= 0) {
    tempManifest[idx] = entry;
  } else {
    tempManifest.push(entry);
  }
}

/**
 * Upsert entry (for backward compatibility - uses temp manifest)
 */
export async function upsertManifestEntry(entry: ManifestEntry): Promise<void> {
  upsertTempManifestEntry(entry);
}

/**
 * Remove layer from temp manifest (after deleting file)
 */
export function removeFromTempManifest(layerId: string): void {
  tempManifest = tempManifest.filter((x) => x.layerId !== layerId);
}

/**
 * Mark layer for deletion (for backward compatibility - now just removes from temp)
 */
export async function markLayerStagedDelete(layerId: string): Promise<void> {
  // Find entry in temp manifest to get file path
  const entry = tempManifest.find((x) => x.layerId === layerId);
  if (entry) {
    // Delete file first using absolutePath (same as restore uses)
    const { deleteFileByAbsolutePath } = await import("./nativeFile");
    try {
      await deleteFileByAbsolutePath(entry.absolutePath);
    } catch (error) {
      console.error(
        `[Manifest] Error deleting file for layer ${layerId}:`,
        error
      );
    }
    // Then remove from temp manifest
    removeFromTempManifest(layerId);
  }
}

/**
 * Remove layer from manifest (for backward compatibility)
 */
export async function removeLayerFromManifest(layerId: string): Promise<void> {
  removeFromTempManifest(layerId);
}

/**
 * Save: Replace stored manifest with temp manifest
 * - Upgrade all "staged" to "saved"
 * - Sort by size (increasing order)
 * - Write to disk (replaces previous manifest, even if empty)
 */
export async function finalizeSaveManifest(): Promise<ManifestEntry[]> {
  // Upgrade "staged" to "saved"
  let m: ManifestEntry[] = tempManifest.map((e) =>
    e.status === "staged" ? { ...e, status: "saved" as ManifestStatus } : e
  );

  // Sort by size (increasing order)
  m.sort((a, b) => a.size - b.size);

  // Replace stored manifest with temp (even if empty)
  await writeManifest(m);

  return m;
}

/**
 * Restore: Merge temp manifest with stored manifest
 * - Load stored manifest from disk
 * - Merge with temp manifest (temp + stored)
 * - Return merged manifest
 */
export async function restoreManifest(): Promise<ManifestEntry[]> {
  // Load stored manifest
  const stored = await loadStoredManifest();

  // Merge: temp + stored (temp takes precedence for same layerId)
  const merged: ManifestEntry[] = [...stored];
  for (const tempEntry of tempManifest) {
    const existingIdx = merged.findIndex(
      (x) => x.layerId === tempEntry.layerId
    );
    if (existingIdx >= 0) {
      merged[existingIdx] = tempEntry; // Temp overrides stored
    } else {
      merged.push(tempEntry); // Add new from temp
    }
  }

  // Update temp manifest with merged result
  tempManifest = merged;

  return merged;
}
