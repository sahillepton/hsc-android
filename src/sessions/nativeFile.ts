import { Filesystem } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
import { getHscFilesDir, HSC_DIRECTORY } from "./constants";
import { NativeUploader } from "@/plugins/native-uploader";

export type StagedNativeFile = {
  absolutePath: string;
  logicalPath: string; // "DATA/HSC-SESSIONS/FILES/..."
  size: number;
  mimeType: string;
  status: "staged";
  originalName: string;
};

function isElectron(): boolean {
  return typeof window !== "undefined" && !!(window as any).electronAPI;
}

export function sanitizeFileName(name: string): string {
  // keep it filesystem-safe and stable
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function stampedFileName(
  originalName: string,
  idx = 0,
  now = Date.now(),
): string {
  return `${now}_${idx}_${sanitizeFileName(originalName)}`;
}

/**
 * Convert the plugin absolutePath to a fetchable URL.
 * On Electron: returns the path as-is (use readFileBinary IPC instead of fetch).
 * On Android (Capacitor): uses Capacitor.convertFileSrc.
 */
export function webviewUrlFromAbsolutePath(absolutePath: string): string {
  if (isElectron()) {
    return absolutePath;
  }
  return Capacitor.convertFileSrc(absolutePath);
}

/**
 * Small-file helper ONLY. Creates a browser File object so existing parsers remain unchanged.
 * WARNING: reads full file into JS memory.
 *
 * On Electron: Uses binary IPC (structured clone) — no base64, no UI thread blocking.
 * On Android: Uses Capacitor.convertFileSrc + fetch.
 */
export async function fileFromAbsolutePathAsFile(
  absolutePath: string,
  fileName: string,
  mimeType?: string,
): Promise<File> {
  if (isElectron()) {
    const api = (window as any).electronAPI;
    const uint8: Uint8Array | null = await api.readFileBinary(absolutePath);
    if (!uint8) throw new Error(`Failed to read file: ${absolutePath}`);
    const mime = mimeType || "application/octet-stream";
    return new File([uint8], fileName, { type: mime });
  }

  // Capacitor (Android) path
  const url = webviewUrlFromAbsolutePath(absolutePath);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to read staged file: ${res.status}`);
  const blob = await res.blob();
  return new File([blob], fileName, {
    type: mimeType || blob.type || "application/octet-stream",
  });
}

/**
 * Delete a file by absolute path (same approach as restore uses)
 */
export async function deleteFileByAbsolutePath(
  absolutePath: string,
): Promise<void> {
  // Use native plugin to delete file directly by absolute path
  // This avoids Capacitor Filesystem directory mapping issues
  try {
    await NativeUploader.deleteFile({ absolutePath });
  } catch (error) {
    const errorMsg = `[DeleteFile] FAILED to delete: ${absolutePath}`;
    console.error(errorMsg);
    console.error(`[DeleteFile] Error:`, error);
    console.error(
      `[DeleteFile] Error message:`,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

/**
 * Delete a staged/saved file by logical path (for backward compatibility):
 * "DATA/HSC-SESSIONS/FILES/<name>" (new) or "DOCUMENTS/HSC-SESSIONS/FILES/<name>" (legacy)
 */
export async function deleteFileByLogicalPath(
  logicalPath: string,
): Promise<void> {
  const dataPrefix = "DATA/";
  const docsPrefix = "DOCUMENTS/";
  let rel: string;
  if (logicalPath.startsWith(dataPrefix)) {
    rel = logicalPath.slice(dataPrefix.length);
  } else if (logicalPath.startsWith(docsPrefix)) {
    rel = logicalPath.slice(docsPrefix.length);
  } else {
    rel = logicalPath;
  }

  try {
    await Filesystem.deleteFile({
      path: rel,
      directory: HSC_DIRECTORY,
    });
  } catch (error) {
    throw error;
  }
}

/**
 * Optional: list files under HSC-SESSIONS/FILES (debug helper)
 */
export async function listSessionFiles(): Promise<string[]> {
  try {
    const r = await Filesystem.readdir({
      path: getHscFilesDir(),
      directory: HSC_DIRECTORY,
    });
    return (r.files || []).map((f: any) => f.name ?? String(f));
  } catch {
    return [];
  }
}
