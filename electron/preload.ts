import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // Filesystem
  readFile: (p: string, enc?: string) =>
    ipcRenderer.invoke("fs:readFile", p, enc),
  readFileBinary: (p: string) => ipcRenderer.invoke("fs:readFileBinary", p),
  readFileInDir: (rel: string, dir: string, enc?: string) =>
    ipcRenderer.invoke("fs:readFileInDir", rel, dir, enc),
  readFileInDirBinary: (rel: string, dir: string) =>
    ipcRenderer.invoke("fs:readFileInDirBinary", rel, dir),
  writeFile: (p: string, data: string) =>
    ipcRenderer.invoke("fs:writeFile", p, data),
  writeFileInDir: (rel: string, dir: string, data: string, enc?: string) =>
    ipcRenderer.invoke("fs:writeFileInDir", rel, dir, data, enc),
  deleteFile: (p: string) => ipcRenderer.invoke("fs:deleteFile", p),
  deleteFileInDir: (rel: string, dir: string) =>
    ipcRenderer.invoke("fs:deleteFileInDir", rel, dir),
  mkdir: (rel: string, dir: string) => ipcRenderer.invoke("fs:mkdir", rel, dir),
  rmdir: (dirPath: string) => ipcRenderer.invoke("fs:rmdir", dirPath),
  readdirInDir: (rel: string, dir: string) =>
    ipcRenderer.invoke("fs:readdirInDir", rel, dir),
  existsInDir: (rel: string, dir: string) =>
    ipcRenderer.invoke("fs:existsInDir", rel, dir),
  stat: (p: string) => ipcRenderer.invoke("fs:stat", p),

  // Preferences
  getPreference: (k: string) => ipcRenderer.invoke("prefs:get", k),
  setPreference: (k: string, v: string) =>
    ipcRenderer.invoke("prefs:set", k, v),
  removePreference: (k: string) => ipcRenderer.invoke("prefs:remove", k),

  // Dialogs
  openFile: (opts?: any) => ipcRenderer.invoke("dialog:openFile", opts),
  openFolder: () => ipcRenderer.invoke("dialog:openFolder"),
  saveFile: (defaultPath: string, filters?: any[]) =>
    ipcRenderer.invoke("dialog:saveFile", defaultPath, filters),

  // App paths
  getPath: (name: string) => ipcRenderer.invoke("app:getPath", name),
  getDocumentsPath: () => ipcRenderer.invoke("app:getDocumentsPath"),
  resolveDirectory: (dir: string) =>
    ipcRenderer.invoke("app:resolveDirectory", dir),

  // Screenshot
  captureScreenshot: () => ipcRenderer.invoke("screenshot:capture"),

  // Shell
  showItemInFolder: (p: string) =>
    ipcRenderer.invoke("shell:showItemInFolder", p),

  // NativeUploader
  nativePickAndStageMany: (maxFiles?: number) =>
    ipcRenderer.invoke("nativeUploader:pickAndStageMany", maxFiles),
  nativeDeleteFile: (absolutePath: string) =>
    ipcRenderer.invoke("nativeUploader:deleteFile", absolutePath),
  nativeSaveExtractedFile: (
    base64Data: string,
    fileName: string,
    mimeType?: string,
  ) =>
    ipcRenderer.invoke(
      "nativeUploader:saveExtractedFile",
      base64Data,
      fileName,
      mimeType,
    ),
  nativeUploaderOnUploadProgress: (
    callback: (event: {
      fileIndex: number;
      bytesWritten: number;
      totalBytes: number;
      originalName: string;
    }) => void,
  ) => {
    const handler = (
      _event: unknown,
      data: {
        fileIndex: number;
        bytesWritten: number;
        totalBytes: number;
        originalName: string;
      },
    ) => callback(data);
    ipcRenderer.on("nativeUploader:uploadProgress", handler);
    return () => {
      ipcRenderer.removeListener("nativeUploader:uploadProgress", handler);
    };
  },
  nativeUploaderOnPickerClosed: (
    callback: (event: { count: number }) => void,
  ) => {
    const handler = (_event: unknown, data: { count: number }) =>
      callback(data);
    ipcRenderer.on("nativeUploader:pickerClosed", handler);
    return () => {
      ipcRenderer.removeListener("nativeUploader:pickerClosed", handler);
    };
  },

  // ZipFolder
  zipExtractRecursive: (zipPath: string, outputDir?: string) =>
    ipcRenderer.invoke("zipFolder:extractZipRecursive", zipPath, outputDir),
  zipHscSessionsFolder: () =>
    ipcRenderer.invoke("zipFolder:zipHscSessionsFolder"),
  zipManifestFiles: (
    files: Array<{ absolutePath: string; originalName: string }>,
  ) => ipcRenderer.invoke("zipFolder:zipManifestFiles", files),

  // TileCache
  tileCacheSetDir: (tilePath: string) =>
    ipcRenderer.invoke("tileCache:setTilesDirectory", tilePath),
  tileCacheGetTile: (z: string, x: string, y: string) =>
    ipcRenderer.invoke("tileCache:getTile", z, x, y),
  tileCacheClear: () => ipcRenderer.invoke("tileCache:clearCache"),
  tileCachePickDir: () => ipcRenderer.invoke("tileCache:pickDirectory"),

  // Udp
  udpCreate: () => ipcRenderer.invoke("udp:create"),
  udpSend: (data: string) => ipcRenderer.invoke("udp:send", data),
  udpCloseAll: () => ipcRenderer.invoke("udp:closeAllSockets"),
  udpOnMessage: (
    callback: (event: { buffer: Uint8Array; byteLength: number }) => void,
  ) => {
    const handler = (
      _event: unknown,
      data: { buffer: Uint8Array; byteLength: number },
    ) => callback(data);
    ipcRenderer.on("udp:message", handler);
    return () => {
      ipcRenderer.removeListener("udp:message", handler);
    };
  },

  // Tile Server
  tileServerGetUrl: () => ipcRenderer.invoke("tileServer:getServerUrl"),
  tileServerUpdateFolder: (folderPath: string) =>
    ipcRenderer.invoke("tileServer:updateFolderPath", folderPath),
  tileServerCheckPermission: () =>
    ipcRenderer.invoke("tileServer:checkStoragePermission"),
  tileServerSelectFolder: () =>
    ipcRenderer.invoke("tileServer:selectTileFolder"),
  tileServerGetSavedFolder: () =>
    ipcRenderer.invoke("tileServer:getSavedFolderUri"),
});
