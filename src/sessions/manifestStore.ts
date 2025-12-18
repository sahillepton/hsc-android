import { Filesystem, Encoding } from "@capacitor/filesystem";
import {
  HSC_DIRECTORY,
  HSC_MANIFEST_PATH,
  HSC_BASE_DIR,
  HSC_UNTRACKED_PATH,
} from "./constants";

export type ManifestStatus = "staged" | "saved" | "staged_delete";

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

  // file type: "tiff" | "vector" | "shapefile" | undefined (for backward compatibility)
  type?: "tiff" | "vector" | "shapefile";

  // layer color: RGB or RGBA array (optional for backward compatibility)
  color?: [number, number, number] | [number, number, number, number];

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
 * Untracked file structure
 */
type UntrackedFile = {
  absolutePath: string;
  layerId: string;
};

type UntrackedManifest = {
  files: UntrackedFile[];
};

/**
 * Add staged file to untracked.json
 */
async function addToUntracked(
  absolutePath: string,
  layerId: string
): Promise<void> {
  try {
    // Load existing untracked files
    let untracked: UntrackedManifest = { files: [] };
    try {
      const result = await Filesystem.readFile({
        path: HSC_UNTRACKED_PATH,
        directory: HSC_DIRECTORY,
        encoding: Encoding.UTF8,
      });
      const content = (result.data ?? "") as string;
      untracked = safeJsonParse<UntrackedManifest>(content, { files: [] });
    } catch {
      // File doesn't exist yet, start with empty
      untracked = { files: [] };
    }

    // Check if already exists
    if (!untracked.files.some((f) => f.layerId === layerId)) {
      untracked.files.push({ absolutePath, layerId });
    }

    // Ensure directory exists
    try {
      await Filesystem.mkdir({
        path: HSC_BASE_DIR,
        directory: HSC_DIRECTORY,
        recursive: true,
      });
    } catch {
      // Directory may already exist, ignore
    }

    // Write back to disk
    await Filesystem.writeFile({
      path: HSC_UNTRACKED_PATH,
      directory: HSC_DIRECTORY,
      data: JSON.stringify(untracked, null, 2),
      encoding: Encoding.UTF8,
      recursive: true,
    });
  } catch (error) {
    console.error("[Manifest] Error adding to untracked.json:", error);
    // Don't throw - untracked.json is best-effort
  }
}

/**
 * Remove file from untracked.json
 */
async function removeFromUntracked(layerId: string): Promise<void> {
  try {
    // Load existing untracked files
    let untracked: UntrackedManifest = { files: [] };
    try {
      const result = await Filesystem.readFile({
        path: HSC_UNTRACKED_PATH,
        directory: HSC_DIRECTORY,
        encoding: Encoding.UTF8,
      });
      const content = (result.data ?? "") as string;
      untracked = safeJsonParse<UntrackedManifest>(content, { files: [] });
    } catch {
      // File doesn't exist, nothing to remove
      return;
    }

    // Remove the entry
    untracked.files = untracked.files.filter((f) => f.layerId !== layerId);

    // Write back to disk (or delete if empty)
    if (untracked.files.length === 0) {
      try {
        await Filesystem.deleteFile({
          path: HSC_UNTRACKED_PATH,
          directory: HSC_DIRECTORY,
        });
      } catch {
        // File might not exist, ignore
      }
    } else {
      await Filesystem.writeFile({
        path: HSC_UNTRACKED_PATH,
        directory: HSC_DIRECTORY,
        data: JSON.stringify(untracked, null, 2),
        encoding: Encoding.UTF8,
        recursive: true,
      });
    }
  } catch (error) {
    console.error("[Manifest] Error removing from untracked.json:", error);
    // Don't throw - untracked.json is best-effort
  }
}

/**
 * Load untracked files from disk
 */
export async function loadUntrackedFiles(): Promise<UntrackedFile[]> {
  try {
    const result = await Filesystem.readFile({
      path: HSC_UNTRACKED_PATH,
      directory: HSC_DIRECTORY,
      encoding: Encoding.UTF8,
    });
    const content = (result.data ?? "") as string;
    const untracked = safeJsonParse<UntrackedManifest>(content, { files: [] });
    return untracked.files || [];
  } catch {
    // File doesn't exist, return empty array
    return [];
  }
}

/**
 * Clear untracked.json (after cleanup or save)
 */
export async function clearUntracked(): Promise<void> {
  try {
    await Filesystem.deleteFile({
      path: HSC_UNTRACKED_PATH,
      directory: HSC_DIRECTORY,
    });
  } catch {
    // File might not exist, ignore
  }
}

/**
 * Add or update entry in temp manifest (in-memory only)
 * If status is "staged", also add to untracked.json
 */
export async function upsertTempManifestEntry(
  entry: ManifestEntry
): Promise<void> {
  const idx = tempManifest.findIndex((x) => x.layerId === entry.layerId);
  const wasStaged = idx >= 0 && tempManifest[idx].status === "staged";
  const isNowStaged = entry.status === "staged";
  const isNowSaved = entry.status === "saved";

  if (idx >= 0) {
    tempManifest[idx] = entry;
  } else {
    tempManifest.push(entry);
  }

  // If status changed to "staged", add to untracked.json
  if (isNowStaged && !wasStaged) {
    await addToUntracked(entry.absolutePath, entry.layerId);
  }

  // If status changed to "saved", remove from untracked.json
  if (isNowSaved && wasStaged) {
    await removeFromUntracked(entry.layerId);
  }
}

/**
 * Upsert entry (for backward compatibility - uses temp manifest)
 */
export async function upsertManifestEntry(entry: ManifestEntry): Promise<void> {
  await upsertTempManifestEntry(entry);
}

/**
 * Update layer color in manifest
 */
export async function updateManifestColor(
  layerId: string,
  color: [number, number, number] | [number, number, number, number]
): Promise<void> {
  const entry = tempManifest.find((x) => x.layerId === layerId);
  if (entry) {
    entry.color = color;
  } else {
    // Also check stored manifest for saved layers
    const stored = await loadStoredManifest();
    const storedEntry = stored.find((x) => x.layerId === layerId);
    if (storedEntry) {
      // Add to temp manifest with updated color
      await upsertTempManifestEntry({
        ...storedEntry,
        color,
      });
    }
  }
}

/**
 * Remove layer from temp manifest (after deleting file)
 */
export function removeFromTempManifest(layerId: string): void {
  tempManifest = tempManifest.filter((x) => x.layerId !== layerId);
}

/**
 * Mark layer for deletion:
 * - If status is "staged", delete immediately and remove from temp manifest
 * - If status is "saved", mark as "staged_delete" in temp manifest (don't delete yet)
 * - If status is "staged_delete", delete immediately
 */
export async function markLayerStagedDelete(layerId: string): Promise<void> {
  // Find entry in temp manifest
  const entry = tempManifest.find((x) => x.layerId === layerId);
  if (!entry) {
    // Also check stored manifest for saved layers
    const stored = await loadStoredManifest();
    const storedEntry = stored.find((x) => x.layerId === layerId);
    if (storedEntry && storedEntry.status === "saved") {
      // Add to temp manifest with staged_delete status
      upsertTempManifestEntry({
        ...storedEntry,
        status: "staged_delete",
      });
      return;
    }
    return;
  }

  // If already staged_delete, delete immediately
  if (entry.status === "staged_delete") {
    const { deleteFileByAbsolutePath } = await import("./nativeFile");
    try {
      await deleteFileByAbsolutePath(entry.absolutePath);
    } catch (error) {
      console.error(
        `[Manifest] Error deleting file for layer ${layerId}:`,
        error
      );
    }
    removeFromTempManifest(layerId);
    return;
  }

  // If status is "staged", delete immediately and remove from untracked.json
  if (entry.status === "staged") {
    const { deleteFileByAbsolutePath } = await import("./nativeFile");
    try {
      await deleteFileByAbsolutePath(entry.absolutePath);
    } catch (error) {
      console.error(
        `[Manifest] Error deleting file for layer ${layerId}:`,
        error
      );
    }
    // Remove from untracked.json
    await removeFromUntracked(layerId);
    removeFromTempManifest(layerId);
    return;
  }

  // If status is "saved", mark as staged_delete (don't delete yet)
  if (entry.status === "saved") {
    upsertTempManifestEntry({
      ...entry,
      status: "staged_delete",
    });
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
 * - Delete all files with "staged_delete" status
 * - If temp manifest is empty, delete all files from stored manifest first
 * - Remove "staged_delete" entries from manifest
 * - Upgrade all "staged" to "saved"
 * - Sort by size (increasing order)
 * - Write to disk (replaces previous manifest, even if empty)
 */
export async function finalizeSaveManifest(): Promise<ManifestEntry[]> {
  const { deleteFileByAbsolutePath } = await import("./nativeFile");

  // Delete files with staged_delete status
  const stagedDeleteEntries = tempManifest.filter(
    (e) => e.status === "staged_delete"
  );
  for (const entry of stagedDeleteEntries) {
    try {
      await deleteFileByAbsolutePath(entry.absolutePath);
      console.log(
        `[Manifest] Deleted staged_delete file: ${entry.originalName}`
      );
    } catch (error) {
      console.error(
        `[Manifest] Error deleting staged_delete file ${entry.originalName}:`,
        error
      );
    }
  }

  // Filter out staged_delete entries and upgrade "staged" to "saved"
  let m: ManifestEntry[] = tempManifest
    .filter((e) => e.status !== "staged_delete")
    .map((e) =>
      e.status === "staged" ? { ...e, status: "saved" as ManifestStatus } : e
    );

  // Load stored manifest to find files that need to be deleted
  const storedManifest = await loadStoredManifest();

  // Create a set of layerIds that will be in the new manifest
  const newManifestLayerIds = new Set(m.map((e) => e.layerId));

  // Find files in stored manifest that are not in the new manifest
  const filesToDelete = storedManifest.filter(
    (entry) =>
      entry.status === "saved" && !newManifestLayerIds.has(entry.layerId)
  );

  // Delete files that are in stored manifest but not in new manifest
  if (filesToDelete.length > 0) {
    console.log(
      `[Manifest] Deleting ${filesToDelete.length} file(s) that are no longer in current session`
    );

    for (const entry of filesToDelete) {
      try {
        await deleteFileByAbsolutePath(entry.absolutePath);
        console.log(
          `[Manifest] Deleted file no longer in session: ${entry.originalName}`
        );
      } catch (error) {
        console.error(
          `[Manifest] Error deleting file ${entry.originalName}:`,
          error
        );
      }
    }
  }

  // Sort by size (increasing order)
  m.sort((a, b) => a.size - b.size);

  // Replace stored manifest with temp (even if empty)
  await writeManifest(m);

  // Clear untracked.json (all staged files are now saved)
  await clearUntracked();

  return m;
}

/**
 * Restore: Merge temp manifest with stored manifest
 * - Load stored manifest from disk
 * - Merge with temp manifest ensuring unique layer_id objects only
 * - Return merged manifest
 */
export async function restoreManifest(): Promise<ManifestEntry[]> {
  // Load stored manifest
  const stored = await loadStoredManifest();

  // Create a map to ensure unique layer_id objects
  const layerIdMap = new Map<string, ManifestEntry>();

  // First, add all stored entries (excluding staged_delete)
  for (const entry of stored) {
    if (entry.status !== "staged_delete") {
      layerIdMap.set(entry.layerId, entry);
    }
  }

  // Then, add/override with temp entries (excluding staged_delete)
  for (const tempEntry of tempManifest) {
    if (tempEntry.status !== "staged_delete") {
      layerIdMap.set(tempEntry.layerId, tempEntry); // Temp overrides stored
    }
  }

  // Convert map back to array
  const merged: ManifestEntry[] = Array.from(layerIdMap.values());

  // Update temp manifest with merged result
  tempManifest = merged;

  return merged;
}
