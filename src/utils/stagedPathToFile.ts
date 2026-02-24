import { Capacitor } from "@capacitor/core";

/**
 * Read a staged file from disk and return as a browser File object.
 *
 * On Electron: Uses binary IPC (structured clone) — the main process reads the file
 * and sends the raw Buffer which arrives as a Uint8Array. No base64, no UI thread blocking.
 *
 * On Android (Capacitor): Uses Capacitor.convertFileSrc + fetch to read the file.
 */

function isElectron(): boolean {
  return typeof window !== "undefined" && !!(window as any).electronAPI;
}

export async function stagedPathToFile(params: {
  absolutePath: string;
  originalName: string;
  mimeType?: string;
}): Promise<File> {
  if (isElectron()) {
    // Electron: read binary via IPC (structured clone — zero base64)
    const api = (window as any).electronAPI;
    const uint8: Uint8Array | null = await api.readFileBinary(params.absolutePath);
    if (!uint8) throw new Error(`Failed to read staged file: ${params.absolutePath}`);
    const mime = params.mimeType || "application/octet-stream";
    return new File([uint8], params.originalName, { type: mime });
  }

  // Capacitor (Android): convert to webview URL and fetch
  const url = Capacitor.convertFileSrc(params.absolutePath);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to read staged file: ${res.status}`);

  const blob = await res.blob();
  return new File([blob], params.originalName, {
    type: params.mimeType || blob.type || "application/octet-stream",
  });
}
