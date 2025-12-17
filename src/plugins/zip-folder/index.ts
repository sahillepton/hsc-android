import { registerPlugin } from "@capacitor/core";

export interface ZipFolderPlugin {
  zipHscSessionsFolder(): Promise<{
    absolutePath: string;
    fileName: string;
    size: number;
  }>;
}

export const ZipFolder = registerPlugin<ZipFolderPlugin>("ZipFolder");
