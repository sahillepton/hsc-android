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

const ZipFolder = registerPlugin<ZipFolderPlugin>("ZipFolder");

export { ZipFolder };
