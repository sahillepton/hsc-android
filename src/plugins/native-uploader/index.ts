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

export type UploadProgressEvent = {
  fileIndex: number;
  bytesWritten: number;
  totalBytes: number; // -1 if unknown
  originalName: string;
};

export type PickerClosedEvent = {
  count: number;
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
    listenerFunc: (event: UploadProgressEvent) => void,
  ): Promise<{ remove: () => void }>;

  addListener(
    eventName: "pickerClosed",
    listenerFunc: (event: PickerClosedEvent) => void,
  ): Promise<{ remove: () => void }>;
}

// ── Platform detection ──
function isElectron(): boolean {
  return typeof window !== "undefined" && !!(window as any).electronAPI;
}

// ── Electron desktop implementation ──
function createDesktopPlugin(): NativeUploaderPlugin {
  const api = () => (window as any).electronAPI;
  return {
    async pickAndStageMany(options?: { maxFiles?: 1 | 2 }) {
      return await api().nativePickAndStageMany(options?.maxFiles);
    },
    async deleteFile(options: { absolutePath: string }) {
      await api().nativeDeleteFile(options.absolutePath);
    },
    async saveExtractedFile(options: {
      base64Data: string;
      fileName: string;
      mimeType?: string;
    }) {
      return await api().nativeSaveExtractedFile(
        options.base64Data,
        options.fileName,
        options.mimeType,
      );
    },
    addListener: (async (
      eventName: "uploadProgress" | "pickerClosed",
      listenerFunc: (event: UploadProgressEvent | PickerClosedEvent) => void,
    ) => {
      const electronApi = api();
      if (eventName === "uploadProgress") {
        const unsubscribe: () => void =
          electronApi.nativeUploaderOnUploadProgress?.(
            listenerFunc as (ev: UploadProgressEvent) => void,
          ) ?? (() => {});
        return { remove: () => unsubscribe() };
      }
      if (eventName === "pickerClosed") {
        const unsubscribe: () => void =
          electronApi.nativeUploaderOnPickerClosed?.(
            listenerFunc as (ev: PickerClosedEvent) => void,
          ) ?? (() => {});
        return { remove: () => unsubscribe() };
      }
      return { remove: () => {} };
    }) as NativeUploaderPlugin["addListener"],
  };
}

// ── Export: Electron uses IPC, Android uses Capacitor native plugin ──
export const NativeUploader: NativeUploaderPlugin = isElectron()
  ? createDesktopPlugin()
  : registerPlugin<NativeUploaderPlugin>("NativeUploader");
