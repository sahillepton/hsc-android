import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
import { HSC_FILES_DIR } from "./constants";
import { NativeUploader } from "@/plugins/native-uploader";

export type StagedNativeFile = {
  absolutePath: string;
  logicalPath: string; // "DOCUMENTS/HSC-SESSIONS/FILES/..."
  size: number;
  mimeType: string;
  status: "staged";
  originalName: string;
};

export function sanitizeFileName(name: string): string {
  // keep it filesystem-safe and stable
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function stampedFileName(
  originalName: string,
  idx = 0,
  now = Date.now()
): string {
  return `${now}_${idx}_${sanitizeFileName(originalName)}`;
}

/**
 * Convert the plugin absolutePath to a WebView URL (fetchable).
 */
export function webviewUrlFromAbsolutePath(absolutePath: string): string {
  return Capacitor.convertFileSrc(absolutePath);
}

/**
 * Small-file helper ONLY. Creates a browser File object so existing parsers remain unchanged.
 * WARNING: reads full file into JS memory.
 */
export async function fileFromAbsolutePathAsFile(
  absolutePath: string,
  fileName: string,
  mimeType?: string
): Promise<File> {
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
  absolutePath: string
): Promise<void> {
  console.log(`[DeleteFile] Deleting file with absolutePath: ${absolutePath}`);

  // Use native plugin to delete file directly by absolute path
  // This avoids Capacitor Filesystem directory mapping issues
  try {
    await NativeUploader.deleteFile({ absolutePath });
    console.log(`[DeleteFile] ✓ Successfully deleted: ${absolutePath}`);
  } catch (error) {
    const errorMsg = `[DeleteFile] ✗ FAILED to delete: ${absolutePath}`;
    console.error(errorMsg);
    console.error(`[DeleteFile] Error:`, error);
    console.error(
      `[DeleteFile] Error message:`,
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}

/**
 * Delete a staged/saved file by logical path (for backward compatibility):
 * "DOCUMENTS/HSC-SESSIONS/FILES/<name>"
 */
export async function deleteFileByLogicalPath(
  logicalPath: string
): Promise<void> {
  // Convert logical path to expected format and use absolute path approach
  // This is a fallback - prefer using absolutePath directly
  const prefix = "DOCUMENTS/";
  const rel = logicalPath.startsWith(prefix)
    ? logicalPath.slice(prefix.length)
    : logicalPath;
  const fullPath = `documents/${rel}`;

  try {
    await Filesystem.deleteFile({
      path: fullPath,
      directory: Directory.Data,
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
      path: HSC_FILES_DIR,
      directory: Directory.Data, // Plugin saves to app's private files
    });
    return (r.files || []).map((f: any) => f.name ?? String(f));
  } catch {
    return [];
  }
}
