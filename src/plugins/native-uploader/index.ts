import { registerPlugin } from "@capacitor/core";

export type StagedNativeFile = {
  absolutePath: string;
  logicalPath: string;
  size: number;
  mimeType: string;
  status: "staged";
  originalName: string;
};

export type PickAndStageManyResult = {
  files: StagedNativeFile[];
};

export interface NativeUploaderPlugin {
  pickAndStageMany(options?: {
    maxFiles?: 1 | 2;
  }): Promise<PickAndStageManyResult>;

  deleteFile(options: { absolutePath: string }): Promise<void>;

  addListener(
    eventName: "uploadProgress",
    listenerFunc: (event: {
      fileIndex: number;
      bytesWritten: number;
      totalBytes: number; // -1 if unknown
      originalName: string;
    }) => void
  ): Promise<{ remove: () => void }>;
}

export const NativeUploader =
  registerPlugin<NativeUploaderPlugin>("NativeUploader");
