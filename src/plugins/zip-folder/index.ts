import { registerPlugin } from "@capacitor/core";

export interface ManifestFileEntry {
  absolutePath: string;
  originalName: string;
  layerId?: string;
  layerName?: string;
  size?: number;
}

export interface ZipFolderPlugin {
  zipHscSessionsFolder(): Promise<{
    absolutePath: string;
    fileName: string;
    size: number;
  }>;

  zipManifestFiles(options: { files: ManifestFileEntry[] }): Promise<{
    absolutePath: string;
    fileName: string;
    size: number;
  }>;

  extractZipRecursive(options: {
    zipPath: string;
    outputDir?: string;
  }): Promise<{
    files: Array<{
      absolutePath: string;
      name: string;
      type: "vector" | "tiff" | "shapefile";
      size: number;
    }>;
  }>;
}

// ── Platform detection ──
function isElectron(): boolean {
  return typeof window !== "undefined" && !!(window as any).electronAPI;
}

// ── Electron desktop implementation ──
function createDesktopPlugin(): ZipFolderPlugin {
  const api = () => (window as any).electronAPI;
  return {
    async zipHscSessionsFolder() {
      return await api().zipHscSessionsFolder();
    },
    async zipManifestFiles(options: { files: ManifestFileEntry[] }) {
      return await api().zipManifestFiles(options.files);
    },
    async extractZipRecursive(options: { zipPath: string; outputDir?: string }) {
      return await api().zipExtractRecursive(options.zipPath, options.outputDir);
    },
  };
}

// ── Export: Electron uses IPC, Android uses Capacitor native plugin ──
const ZipFolder: ZipFolderPlugin = isElectron()
  ? createDesktopPlugin()
  : registerPlugin<ZipFolderPlugin>("ZipFolder");

export { ZipFolder };
