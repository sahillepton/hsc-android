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

export type SaveExtractedFileResult = {
  absolutePath: string;
  logicalPath: string;
  size: number;
  mimeType: string;
};

export interface NativeUploaderPlugin {
  pickAndStageMany(options?: {
    maxFiles?: 1 | 2;
  }): Promise<PickAndStageManyResult>;

  deleteFile(options: { absolutePath: string }): Promise<void>;

  saveExtractedFile(options: {
    base64Data: string;
    fileName: string;
    mimeType?: string;
  }): Promise<SaveExtractedFileResult>;

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
