import { registerPlugin } from "@capacitor/core";

export interface ZipFolderPlugin {
  zipHscSessionsFolder(): Promise<{
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
