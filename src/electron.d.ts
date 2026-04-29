export interface ElectronAPI {
  // Filesystem
  readFile: (path: string, encoding?: string) => Promise<string>;
  readFileBinary: (path: string) => Promise<Uint8Array | null>;
  readFileInDir: (
    relativePath: string,
    directory: string,
    encoding?: string,
  ) => Promise<string | null>;
  readFileInDirBinary: (
    relativePath: string,
    directory: string,
  ) => Promise<Uint8Array | null>;
  writeFile: (path: string, data: string) => Promise<string>;
  writeFileInDir: (
    relativePath: string,
    directory: string,
    data: string,
    encoding?: string,
  ) => Promise<string>;
  deleteFile: (path: string) => Promise<void>;
  deleteFileInDir: (relativePath: string, directory: string) => Promise<void>;
  mkdir: (relativePath: string, directory: string) => Promise<void>;
  readdirInDir: (
    relativePath: string,
    directory: string,
  ) => Promise<Array<{ name: string; type: string }>>;
  existsInDir: (relativePath: string, directory: string) => Promise<boolean>;
  stat: (
    path: string,
  ) => Promise<{ size: number; ctime: string; mtime: string }>;

  // Preferences
  getPreference: (key: string) => Promise<string | null>;
  setPreference: (key: string, value: string) => Promise<void>;
  removePreference: (key: string) => Promise<void>;

  // Dialogs
  openFile: (options?: any) => Promise<string[]>;
  openFolder: () => Promise<string | null>;
  saveFile: (defaultPath: string, filters?: any[]) => Promise<string | null>;

  // App paths
  getPath: (name: string) => Promise<string>;
  getDocumentsPath: () => Promise<string>;
  resolveDirectory: (directory: string) => Promise<string>;

  // Screenshot
  captureScreenshot: () => Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }>;

  // Shell
  showItemInFolder: (path: string) => Promise<void>;

  // NativeUploader
  nativePickAndStageMany: (maxFiles?: number) => Promise<{
    files: Array<{
      absolutePath: string;
      logicalPath: string;
      size: number;
      mimeType: string;
      status: "staged";
      originalName: string;
    }>;
  }>;
  nativeDeleteFile: (absolutePath: string) => Promise<void>;
  nativeSaveExtractedFile: (
    base64Data: string,
    fileName: string,
    mimeType?: string,
  ) => Promise<{
    absolutePath: string;
    logicalPath: string;
    size: number;
    mimeType: string;
  }>;

  // ZipFolder
  zipExtractRecursive: (
    zipPath: string,
    outputDir?: string,
  ) => Promise<{
    files: Array<{
      absolutePath: string;
      name: string;
      type: "vector" | "tiff" | "shapefile";
      size: number;
    }>;
  }>;
  zipHscSessionsFolder: () => Promise<{
    absolutePath: string;
    fileName: string;
    size: number;
  }>;
  zipManifestFiles: (
    files: Array<{ absolutePath: string; originalName: string }>,
  ) => Promise<{
    absolutePath: string;
    fileName: string;
    size: number;
  }>;

  // TileCache
  tileCacheSetDir: (tilePath: string) => Promise<{ success: boolean }>;
  tileCacheGetTile: (
    z: string,
    x: string,
    y: string,
  ) => Promise<{ data: string; fromCache: boolean }>;
  tileCacheClear: () => Promise<{ success: boolean }>;
  tileCachePickDir: () => Promise<{ path: string }>;

  // Udp
  udpCreate: () => Promise<{ ok: boolean; port: number }>;
  udpSend: (data: string) => Promise<{ ok: boolean }>;
  udpCloseAll: () => Promise<{ ok: boolean }>;
  udpOnMessage: (
    callback: (event: { buffer: Uint8Array; byteLength: number }) => void,
  ) => () => void;

  // Tile Server
  tileServerGetUrl: () => Promise<{ baseUrl: string; port: number }>;
  tileServerUpdateFolder: (
    folderPath: string,
  ) => Promise<{ baseUrl: string; port: number }>;
  tileServerCheckPermission: () => Promise<{ hasPermission: boolean }>;
  tileServerSelectFolder: () => Promise<{ uri: string }>;
  tileServerGetSavedFolder: () => Promise<{ uri: string | null }>;

  // Raster tiling (gdal-async via child Node worker)
  tilingProbe: (absolutePath: string) => Promise<TilingProbeResult>;
  tilingBuildOverviews: (
    absolutePath: string,
  ) => Promise<TilingBuildOverviewsResult>;
  tilingRegisterLayer: (
    layerId: string,
    absolutePath: string,
  ) => Promise<{ ok: boolean }>;
  tilingUnregisterLayer: (
    layerId: string,
    fallbackPath?: string,
  ) => Promise<{ ok: boolean }>;
  tilingSampleAt: (args: {
    layerId: string;
    lon: number;
    lat: number;
  }) => Promise<{ value: number | null; dtype: string }>;
  tilingGetTileBaseUrl: () => Promise<string | null>;
  tilingCloseAll: () => Promise<{ closed: boolean }>;
}

export interface TilingBuildOverviewsResult {
  built: boolean;
  reason?: "already-exists" | "too-small";
  kind?: string;
  levels?: number[];
  count?: number;
  width?: number;
  height?: number;
}

export interface TilingProbeResult {
  width: number;
  height: number;
  bands: number;
  dtype: string;
  sourceCrs: string | null;
  boundsWgs84: [number, number, number, number] | null;
  palette: number[][] | null;
  min: number;
  max: number;
  pixelSize: number;
  nativeZoom: number;
  colorInterp: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
