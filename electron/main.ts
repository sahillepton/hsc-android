import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import http from "http";
import dgram from "dgram";
import JSZip from "jszip";
import {
  workerProbe,
  workerRenderTile,
  workerSampleAt,
  workerBuildOverviews,
  workerCloseAllDatasets,
  shutdownWorker,
} from "./tiling/worker-client";
import {
  registerLayer as registerTiledLayer,
  unregisterLayer as unregisterTiledLayer,
  lookupSource as lookupTiledLayerSource,
} from "./tiling/registry";
import {
  readCachedTile,
  writeCachedTile,
  deleteCacheDir,
  configureCache,
  enforceCacheBudget,
} from "./tiling/cache";

let mainWindow: BrowserWindow | null = null;
let tileServer: http.Server | null = null;
let tileServerPort: number = 0;
let tileServerFolder: string = "";

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "HSC GIS Desktop",
    autoHideMenuBar: true,
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── Helper ──
function resolveDirectory(dir: string): string {
  switch (dir) {
    case "DOCUMENTS":
      return app.getPath("documents");
    case "DATA":
      return app.getPath("userData");
    case "EXTERNAL":
      return app.getPath("userData");
    case "CACHE":
      return app.getPath("temp");
    case "DESKTOP":
      return app.getPath("desktop");
    case "DOWNLOADS":
      return app.getPath("downloads");
    default:
      return app.getPath("documents");
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ── Filesystem IPC (all async) ──
ipcMain.handle("fs:readFile", async (_e, p: string, enc?: string) => {
  if (enc === "base64") {
    const buf = await fs.readFile(p);
    return buf.toString("base64");
  }
  return await fs.readFile(p, "utf-8");
});

// Binary read — returns raw Buffer (arrives as Uint8Array in renderer via structured clone)
ipcMain.handle("fs:readFileBinary", async (_e, p: string) => {
  const buf = await fs.readFile(p);
  return buf; // Buffer → Uint8Array through IPC structured clone
});

ipcMain.handle(
  "fs:readFileInDir",
  async (_e, rel: string, dir: string, enc?: string) => {
    const full = path.join(resolveDirectory(dir), rel);
    if (!(await pathExists(full))) return null;
    if (enc === "base64") {
      const buf = await fs.readFile(full);
      return buf.toString("base64");
    }
    return await fs.readFile(full, "utf-8");
  },
);

ipcMain.handle(
  "fs:readFileInDirBinary",
  async (_e, rel: string, dir: string) => {
    const full = path.join(resolveDirectory(dir), rel);
    if (!(await pathExists(full))) return null;
    return await fs.readFile(full); // raw Buffer
  },
);

ipcMain.handle("fs:writeFile", async (_e, p: string, data: string) => {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, data, "utf-8");
  return p;
});

ipcMain.handle(
  "fs:writeFileInDir",
  async (_e, rel: string, dir: string, data: string, enc?: string) => {
    const full = path.join(resolveDirectory(dir), rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    if (enc === "base64") await fs.writeFile(full, Buffer.from(data, "base64"));
    else await fs.writeFile(full, data, "utf-8");
    return full;
  },
);

ipcMain.handle("fs:deleteFile", async (_e, p: string) => {
  if (await pathExists(p)) await fs.unlink(p);
});

ipcMain.handle("fs:deleteFileInDir", async (_e, rel: string, dir: string) => {
  const full = path.join(resolveDirectory(dir), rel);
  if (await pathExists(full)) await fs.unlink(full);
});

ipcMain.handle("fs:mkdir", async (_e, rel: string, dir: string) => {
  const full = path.join(resolveDirectory(dir), rel);
  await fs.mkdir(full, { recursive: true });
});

ipcMain.handle("fs:rmdir", async (_e, dirPath: string) => {
  if (await pathExists(dirPath))
    await fs.rm(dirPath, { recursive: true, force: true });
});

ipcMain.handle("fs:readdirInDir", async (_e, rel: string, dir: string) => {
  const full = path.join(resolveDirectory(dir), rel || "");
  if (!(await pathExists(full))) return [];
  const entries = await fs.readdir(full, { withFileTypes: true });
  return entries.map((d) => ({
    name: d.name,
    type: d.isDirectory() ? "directory" : "file",
  }));
});

ipcMain.handle("fs:existsInDir", async (_e, rel: string, dir: string) => {
  return await pathExists(path.join(resolveDirectory(dir), rel));
});

ipcMain.handle("fs:stat", async (_e, p: string) => {
  const s = await fs.stat(p);
  return { size: s.size, ctime: s.ctime, mtime: s.mtime };
});

// ── Preferences IPC (async) ──
const prefsFilePath = () =>
  path.join(app.getPath("userData"), "hsc-prefs.json");

async function loadPrefs(): Promise<Record<string, string>> {
  try {
    const data = await fs.readFile(prefsFilePath(), "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function savePrefs(p: Record<string, string>) {
  await fs.mkdir(path.dirname(prefsFilePath()), { recursive: true });
  await fs.writeFile(prefsFilePath(), JSON.stringify(p, null, 2), "utf-8");
}

ipcMain.handle(
  "prefs:get",
  async (_e, k: string) => (await loadPrefs())[k] ?? null,
);
ipcMain.handle("prefs:set", async (_e, k: string, v: string) => {
  const p = await loadPrefs();
  p[k] = v;
  await savePrefs(p);
});
ipcMain.handle("prefs:remove", async (_e, k: string) => {
  const p = await loadPrefs();
  delete p[k];
  await savePrefs(p);
});

// ── Dialog IPC ──
ipcMain.handle("dialog:openFile", async (_e, opts?: any) => {
  const r = await dialog.showOpenDialog(mainWindow!, {
    properties: opts?.multiSelections
      ? ["openFile", "multiSelections"]
      : ["openFile"],
    filters: opts?.filters || [
      {
        name: "GIS Files",
        extensions: [
          "json",
          "geojson",
          "csv",
          "shp",
          "zip",
          "tif",
          "tiff",
          "xlsx",
          "gpx",
          "kml",
          "kmz",
          "hgt",
        ],
      },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  return r.filePaths;
});

ipcMain.handle("dialog:openFolder", async () => {
  const r = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openDirectory"],
  });
  return r.filePaths[0] || null;
});

ipcMain.handle(
  "dialog:saveFile",
  async (_e, defaultPath: string, filters?: any[]) => {
    const r = await dialog.showSaveDialog(mainWindow!, {
      defaultPath,
      filters: filters || [{ name: "All Files", extensions: ["*"] }],
    });
    return r.filePath || null;
  },
);

// ── App paths ──
ipcMain.handle("app:getPath", async (_e, name: string) =>
  app.getPath(name as any),
);
ipcMain.handle("app:getDocumentsPath", async () => app.getPath("documents"));
ipcMain.handle("app:resolveDirectory", async (_e, dir: string) =>
  resolveDirectory(dir),
);

// ── Screenshot (async) ──
ipcMain.handle("screenshot:capture", async () => {
  if (!mainWindow) return { success: false, error: "No window" };
  try {
    const img = await mainWindow.webContents.capturePage();
    const dir = path.join(app.getPath("pictures"), "HSC-Screenshots");
    await fs.mkdir(dir, { recursive: true });
    const fp = path.join(dir, `screenshot_${Date.now()}.png`);
    await fs.writeFile(fp, img.toPNG());
    return { success: true, path: fp };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("shell:showItemInFolder", async (_e, p: string) =>
  shell.showItemInFolder(p),
);

// ── NativeUploader IPC (async) ──
function getMimeTypeFromExt(ext: string): string {
  const mimes: Record<string, string> = {
    ".json": "application/json",
    ".geojson": "application/geo+json",
    ".csv": "text/csv",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".shp": "application/x-shapefile",
    ".zip": "application/zip",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".gpx": "application/gpx+xml",
    ".kml": "application/vnd.google-earth.kml+xml",
    ".kmz": "application/vnd.google-earth.kmz",
    ".hgt": "application/octet-stream",
    ".pbf": "application/x-protobuf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
  };
  return mimes[ext.toLowerCase()] || "application/octet-stream";
}

function getSessionFilesDir(): string {
  return path.join(app.getPath("userData"), "HSC-SESSIONS", "FILES");
}

ipcMain.handle(
  "nativeUploader:pickAndStageMany",
  async (_e, maxFiles?: number) => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties:
        maxFiles === 1 ? ["openFile"] : ["openFile", "multiSelections"],
      filters: [
        {
          name: "GIS Files",
          extensions: [
            "json",
            "geojson",
            "csv",
            "shp",
            "zip",
            "tif",
            "tiff",
            "xlsx",
            "gpx",
            "kml",
            "kmz",
            "hgt",
          ],
        },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (r.canceled || r.filePaths.length === 0) {
      // Still notify the renderer that the picker closed so the overlay
      // can exit the "Opening file picker…" state promptly.
      mainWindow?.webContents.send("nativeUploader:pickerClosed", {
        count: 0,
      });
      return { files: [] };
    }

    const filePaths = maxFiles ? r.filePaths.slice(0, maxFiles) : r.filePaths;

    // Fire pickerClosed IMMEDIATELY after the dialog resolves so the
    // renderer can switch the overlay off of "Opening file picker…" the
    // moment the OS dialog has actually dismissed. Without this, for large
    // files the overlay appeared stuck on that message while we quietly
    // copied bytes in the background.
    mainWindow?.webContents.send("nativeUploader:pickerClosed", {
      count: filePaths.length,
    });

    const filesDir = getSessionFilesDir();
    await fs.mkdir(filesDir, { recursive: true });

    const staged: Array<{
      absolutePath: string;
      logicalPath: string;
      size: number;
      mimeType: string;
      status: "staged";
      originalName: string;
    }> = [];

    for (let i = 0; i < filePaths.length; i++) {
      const src = filePaths[i];
      const originalName = path.basename(src);
      const stamp = `${Date.now()}_${i}_${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const dest = path.join(filesDir, stamp);

      // Stream the copy so the renderer can show real upload progress
      // for multi-gigabyte rasters. Blocking fs.copyFile made the
      // "Opening file picker…" overlay appear stuck for tens of seconds.
      let totalBytes = 0;
      try {
        const srcStat = await fs.stat(src);
        totalBytes = srcStat.size;
      } catch {
        totalBytes = -1;
      }

      const emitProgress = (bytesWritten: number) => {
        mainWindow?.webContents.send("nativeUploader:uploadProgress", {
          fileIndex: i,
          bytesWritten,
          totalBytes,
          originalName,
        });
      };

      // Initial 0-byte event so the overlay switches off "Opening file
      // picker…" the instant staging begins, even before the first data
      // chunk has been read.
      emitProgress(0);

      await new Promise<void>((resolve, reject) => {
        const readStream = fsSync.createReadStream(src, {
          highWaterMark: 1024 * 1024,
        });
        const writeStream = fsSync.createWriteStream(dest);
        let written = 0;
        let lastEmitMs = Date.now();

        readStream.on("error", reject);
        writeStream.on("error", reject);
        readStream.on("data", (chunk: Buffer | string) => {
          const len =
            typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
          written += len;
          const now = Date.now();
          if (now - lastEmitMs >= 100) {
            lastEmitMs = now;
            emitProgress(written);
          }
        });
        writeStream.on("finish", () => {
          emitProgress(written);
          resolve();
        });
        readStream.pipe(writeStream);
      });

      const stat = await fs.stat(dest);
      const ext = path.extname(originalName);

      staged.push({
        absolutePath: dest,
        logicalPath: `DATA/HSC-SESSIONS/FILES/${stamp}`,
        size: stat.size,
        mimeType: getMimeTypeFromExt(ext),
        status: "staged" as const,
        originalName,
      });
    }

    return { files: staged };
  },
);

ipcMain.handle(
  "nativeUploader:deleteFile",
  async (_e, absolutePath: string) => {
    if (absolutePath && (await pathExists(absolutePath))) {
      await fs.unlink(absolutePath);
    }
  },
);

ipcMain.handle(
  "nativeUploader:saveExtractedFile",
  async (_e, base64Data: string, fileName: string, mimeType?: string) => {
    const filesDir = getSessionFilesDir();
    await fs.mkdir(filesDir, { recursive: true });

    const stamp = `${Date.now()}_0_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const dest = path.join(filesDir, stamp);

    await fs.writeFile(dest, Buffer.from(base64Data, "base64"));
    const stat = await fs.stat(dest);

    return {
      absolutePath: dest,
      logicalPath: `DATA/HSC-SESSIONS/FILES/${stamp}`,
      size: stat.size,
      mimeType: mimeType || getMimeTypeFromExt(path.extname(fileName)),
    };
  },
);

// ── ZipFolder IPC ──
const ALLOWED_EXTENSIONS = new Set([
  "tif",
  "tiff",
  "hgt",
  "dett",
  "geojson",
  "json",
  "csv",
  "gpx",
  "kml",
  "kmz",
  "wkt",
  "shp",
  "shx",
  "dbf",
  "prj",
  "cpg",
  "zip",
]);

type ExtractedFileInfo = {
  absolutePath: string;
  name: string;
  type: "vector" | "tiff" | "shapefile_component" | "shapefile";
  size: number;
};

function getFileType(
  lowerName: string,
): "vector" | "tiff" | "shapefile_component" {
  if (
    lowerName.endsWith(".tif") ||
    lowerName.endsWith(".tiff") ||
    lowerName.endsWith(".hgt") ||
    lowerName.endsWith(".dett")
  ) {
    return "tiff";
  }
  if (
    lowerName.endsWith(".shp") ||
    lowerName.endsWith(".shx") ||
    lowerName.endsWith(".dbf") ||
    lowerName.endsWith(".prj") ||
    lowerName.endsWith(".cpg")
  ) {
    return "shapefile_component";
  }
  return "vector";
}

async function extractZipRecursive(
  zipBuf: Buffer,
  destDir: string,
  depth: number,
  maxDepth: number,
): Promise<ExtractedFileInfo[]> {
  if (depth > maxDepth) return [];

  const zip = await JSZip.loadAsync(zipBuf);
  const results: ExtractedFileInfo[] = [];

  for (const [relativeName, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;

    const fileName = path.basename(relativeName);
    const lowerName = fileName.toLowerCase();
    const ext =
      lowerName.lastIndexOf(".") > 0
        ? lowerName.substring(lowerName.lastIndexOf(".") + 1)
        : "";

    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) continue;

    const data = await entry.async("nodebuffer");

    if (lowerName.endsWith(".zip")) {
      const nested = await extractZipRecursive(
        data,
        destDir,
        depth + 1,
        maxDepth,
      );
      results.push(...nested);
      continue;
    }

    let outputPath = path.join(destDir, fileName);
    let counter = 1;
    const dotIdx = fileName.lastIndexOf(".");
    const baseName = dotIdx > 0 ? fileName.substring(0, dotIdx) : fileName;
    const extPart = dotIdx > 0 ? fileName.substring(dotIdx) : "";
    while (await pathExists(outputPath)) {
      outputPath = path.join(destDir, `${baseName}_${counter}${extPart}`);
      counter++;
    }

    await fs.writeFile(outputPath, data);
    const stat = await fs.stat(outputPath);

    results.push({
      absolutePath: outputPath,
      name: path.basename(outputPath),
      type: getFileType(lowerName),
      size: stat.size,
    });
  }

  return results;
}

async function processShapefiles(
  files: ExtractedFileInfo[],
  destDir: string,
): Promise<ExtractedFileInfo[]> {
  const shapefileGroups = new Map<string, ExtractedFileInfo[]>();

  for (const file of files) {
    const lowerName = file.name.toLowerCase();
    if (
      lowerName.endsWith(".shp") ||
      lowerName.endsWith(".shx") ||
      lowerName.endsWith(".dbf") ||
      lowerName.endsWith(".prj") ||
      lowerName.endsWith(".cpg")
    ) {
      const baseName = lowerName.replace(/\.(shp|shx|dbf|prj|cpg)$/, "");
      const group = shapefileGroups.get(baseName) || [];
      group.push(file);
      shapefileGroups.set(baseName, group);
    }
  }

  const result: ExtractedFileInfo[] = [];
  const processedPaths = new Set<string>();

  for (const [baseName, components] of shapefileGroups.entries()) {
    const hasShp = components.some((c) =>
      c.name.toLowerCase().endsWith(".shp"),
    );
    const hasDbf = components.some((c) =>
      c.name.toLowerCase().endsWith(".dbf"),
    );

    if (hasShp && hasDbf) {
      const zip = new JSZip();
      for (const comp of components) {
        const buf = await fs.readFile(comp.absolutePath);
        zip.file(comp.name, buf);
      }

      const zipBuf = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
      });
      const zipName = `${baseName}.zip`;
      const zipPath = path.join(destDir, zipName);
      await fs.writeFile(zipPath, zipBuf);
      const stat = await fs.stat(zipPath);

      result.push({
        absolutePath: zipPath,
        name: zipName,
        type: "shapefile",
        size: stat.size,
      });

      for (const comp of components) {
        processedPaths.add(comp.absolutePath);
        try {
          await fs.unlink(comp.absolutePath);
        } catch {
          /* ignore */
        }
      }
    } else {
      for (const comp of components) {
        comp.type = "vector";
        result.push(comp);
        processedPaths.add(comp.absolutePath);
      }
    }
  }

  for (const file of files) {
    if (!processedPaths.has(file.absolutePath)) {
      result.push(file);
    }
  }

  return result;
}

ipcMain.handle(
  "zipFolder:extractZipRecursive",
  async (_e, zipPath: string, outputDir?: string) => {
    const dir = outputDir || "HSC-SESSIONS/FILES";
    const destDir = path.join(app.getPath("documents"), dir);
    await fs.mkdir(destDir, { recursive: true });

    if (!(await pathExists(zipPath))) {
      throw new Error(`ZIP file does not exist: ${zipPath}`);
    }

    const zipBuf = await fs.readFile(zipPath);
    const extractedFiles = await extractZipRecursive(zipBuf, destDir, 0, 10);
    const finalFiles = await processShapefiles(extractedFiles, destDir);

    return {
      files: finalFiles.map((f) => ({
        absolutePath: f.absolutePath,
        name: f.name,
        type: f.type === "shapefile_component" ? "vector" : f.type,
        size: f.size,
      })),
    };
  },
);

ipcMain.handle("zipFolder:zipHscSessionsFolder", async () => {
  const sessionsDir = path.join(app.getPath("documents"), "HSC-SESSIONS");
  if (!(await pathExists(sessionsDir))) {
    throw new Error("HSC-SESSIONS folder not found");
  }

  const zip = new JSZip();

  async function addDirToZip(dirPath: string, zipFolder: JSZip) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const subFolder = zipFolder.folder(entry.name)!;
        await addDirToZip(fullPath, subFolder);
      } else {
        const buf = await fs.readFile(fullPath);
        zipFolder.file(entry.name, buf);
      }
    }
  }

  await addDirToZip(sessionsDir, zip);

  const zipBuf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  const zipName = `HSC-SESSIONS_${Date.now()}.zip`;
  const zipPath = path.join(app.getPath("documents"), zipName);
  await fs.writeFile(zipPath, zipBuf);
  const stat = await fs.stat(zipPath);

  return { absolutePath: zipPath, fileName: zipName, size: stat.size };
});

ipcMain.handle(
  "zipFolder:zipManifestFiles",
  async (_e, files: Array<{ absolutePath: string; originalName: string }>) => {
    const zip = new JSZip();

    for (const file of files) {
      if (await pathExists(file.absolutePath)) {
        const buf = await fs.readFile(file.absolutePath);
        zip.file(file.originalName || path.basename(file.absolutePath), buf);
      }
    }

    const zipBuf = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    const zipName = `HSC-Export_${Date.now()}.zip`;
    const zipPath = path.join(
      app.getPath("documents"),
      "HSC-SESSIONS",
      zipName,
    );
    await fs.mkdir(path.dirname(zipPath), { recursive: true });
    await fs.writeFile(zipPath, zipBuf);
    const stat = await fs.stat(zipPath);

    return { absolutePath: zipPath, fileName: zipName, size: stat.size };
  },
);

// ── TileCache IPC ──
let tileCacheDir: string = "";

ipcMain.handle("tileCache:setTilesDirectory", async (_e, tilePath: string) => {
  tileCacheDir = tilePath;
  return { success: true };
});

ipcMain.handle(
  "tileCache:getTile",
  async (_e, z: string, x: string, y: string) => {
    if (!tileCacheDir) {
      throw new Error("Tiles directory not set");
    }
    const tilePath = path.join(tileCacheDir, z, x, `${y}.pbf`);
    if (!(await pathExists(tilePath))) {
      throw new Error(`Tile not found: ${z}/${x}/${y}`);
    }
    const buf = await fs.readFile(tilePath);
    return { data: buf.toString("base64"), fromCache: true };
  },
);

ipcMain.handle("tileCache:clearCache", async () => {
  return { success: true };
});

ipcMain.handle("tileCache:pickDirectory", async () => {
  const r = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openDirectory"],
  });
  if (r.filePaths.length > 0) {
    tileCacheDir = r.filePaths[0];
    return { path: tileCacheDir };
  }
  throw new Error("No directory selected");
});

// ── Udp IPC ──
let udpSocket: dgram.Socket | null = null;
const UDP_LISTEN_PORT = 40074; // Keep in sync with src/lib/constants.ts → UDP_PORT

ipcMain.handle("udp:create", async () => {
  if (udpSocket) {
    try {
      udpSocket.close();
    } catch {
      /* ignore */
    }
    udpSocket = null;
  }

  return new Promise<{ ok: boolean; port: number }>((resolve, reject) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    socket.on("error", (err) => {
      console.error("[UDP] Socket error:", err);
      socket.close();
      udpSocket = null;
      reject(err);
    });

    socket.on("message", (msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const bytes = new Uint8Array(
          msg.buffer,
          msg.byteOffset,
          msg.byteLength,
        );
        mainWindow.webContents.send("udp:message", {
          buffer: bytes,
          byteLength: bytes.byteLength,
        });
      }
    });

    socket.bind(UDP_LISTEN_PORT, () => {
      console.log(`[UDP] Listening on port ${UDP_LISTEN_PORT}`);
      udpSocket = socket;
      resolve({ ok: true, port: UDP_LISTEN_PORT });
    });
  });
});

ipcMain.handle("udp:send", async () => {
  return { ok: true };
});

ipcMain.handle("udp:closeAllSockets", async () => {
  if (udpSocket) {
    try {
      udpSocket.close();
    } catch {
      /* ignore */
    }
    udpSocket = null;
    console.log("[UDP] Socket closed");
  }
  return { ok: true };
});

// ── Local Tile Server ──
function getMimeType(ext: string): string {
  const types: Record<string, string> = {
    ".pbf": "application/x-protobuf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return types[ext.toLowerCase()] || "application/octet-stream";
}

function startTileServer(
  folder: string,
): Promise<{ baseUrl: string; port: number }> {
  return new Promise((resolve, reject) => {
    if (tileServer && tileServerFolder === folder) {
      resolve({
        baseUrl: `http://localhost:${tileServerPort}`,
        port: tileServerPort,
      });
      return;
    }

    if (tileServer) {
      tileServer.close();
      tileServer = null;
    }

    tileServerFolder = folder;

    const server = http.createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const urlPath = decodeURIComponent(req.url || "/");

      // ── /layers/<layerId>/{z}/{x}/{y}.webp — tiled raster route ──
      // Resolves the layerId via registry to its source raster, then
      // returns a cached WebP or asks the worker to render one.
      // (Legacy `.png` extension still accepted so in-flight requests
      // from a previously-loaded page don't 404 after a hot reload.)
      const layerMatch = urlPath.match(
        /^\/layers\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.(?:webp|png)$/,
      );
      if (layerMatch) {
        const layerId = layerMatch[1];
        const z = parseInt(layerMatch[2], 10);
        const x = parseInt(layerMatch[3], 10);
        const y = parseInt(layerMatch[4], 10);
        const sourcePath = lookupTiledLayerSource(layerId);
        if (!sourcePath) {
          res.writeHead(404);
          res.end("Layer not registered");
          return;
        }
        (async () => {
          const t0 = Date.now();
          // Tiles are content-addressed by (layerId, z, x, y) and never
          // mutate (each upload gets a fresh layerId). Tell the browser
          // it can cache forever — without this, Mapbox re-fetches the
          // same tile on every revisit, ballooning network traffic 5–10×.
          const tileHeaders: Record<string, string> = {
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=31536000, immutable",
          };
          try {
            const cached = await readCachedTile(sourcePath, z, x, y);
            if (cached) {
              console.log(
                `[Tiling] ${layerId} z=${z} x=${x} y=${y} cache-hit (${cached.length}B)`,
              );
              res.writeHead(200, tileHeaders);
              res.end(cached);
              return;
            }
            console.log(
              `[Tiling] ${layerId} z=${z} x=${x} y=${y} rendering…`,
            );
            const png = await workerRenderTile({ path: sourcePath, z, x, y });
            // Write-through to disk cache (best-effort).
            void writeCachedTile(sourcePath, z, x, y, png);
            console.log(
              `[Tiling] ${layerId} z=${z} x=${x} y=${y} rendered in ${Date.now() - t0}ms (${png.length}B)`,
            );
            res.writeHead(200, tileHeaders);
            res.end(png);
          } catch (err) {
            console.error(
              `[Tiling] ${layerId} z=${z} x=${x} y=${y} failed after ${Date.now() - t0}ms:`,
              err,
            );
            res.writeHead(500);
            res.end((err as Error).message || "Tile render failed");
          }
        })();
        return;
      }

      const filePath = path.join(folder, urlPath.replace(/^\//, ""));

      if (!fsSync.existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const stat = fsSync.statSync(filePath);
      if (stat.isDirectory()) {
        const indexPath = path.join(filePath, "index.json");
        if (fsSync.existsSync(indexPath)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          fsSync.createReadStream(indexPath).pipe(res);
          return;
        }
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const ext = path.extname(filePath);
      const mime = getMimeType(ext);
      const headers: Record<string, string> = { "Content-Type": mime };

      // Only add gzip header if the file is actually gzip-compressed (starts with 1f 8b)
      if (ext === ".pbf") {
        try {
          const fd = fsSync.openSync(filePath, "r");
          const buf = Buffer.alloc(2);
          fsSync.readSync(fd, buf, 0, 2, 0);
          fsSync.closeSync(fd);
          if (buf[0] === 0x1f && buf[1] === 0x8b) {
            headers["Content-Encoding"] = "gzip";
          }
        } catch {
          /* skip gzip header if can't read */
        }
      }

      res.writeHead(200, headers);
      fsSync.createReadStream(filePath).pipe(res);
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        tileServerPort = addr.port;
        tileServer = server;
        console.log(
          `[TileServer] Running at http://localhost:${tileServerPort} serving ${folder}`,
        );
        resolve({
          baseUrl: `http://localhost:${tileServerPort}`,
          port: tileServerPort,
        });
      } else {
        reject(new Error("Failed to start tile server"));
      }
    });

    server.on("error", (err) => {
      console.error("[TileServer] Error:", err);
      reject(err);
    });
  });
}

// Auto-start tile server. We always start it (even with no basemap folder)
// because tiled rasters use the `/layers/<id>/{z}/{x}/{y}.png` route which
// resolves through the in-memory tiling registry, not the folder.
app.whenReady().then(async () => {
  const defaultTileFolder = path.join(app.getPath("documents"), "tiles");
  try {
    if (!fsSync.existsSync(defaultTileFolder)) {
      await fs.mkdir(defaultTileFolder, { recursive: true });
    }
    const result = await startTileServer(defaultTileFolder);
    console.log(`[TileServer] Auto-started: ${result.baseUrl}`);
  } catch (err) {
    console.error("[TileServer] Failed to auto-start:", err);
  }

  // Configure tiling cache: scan the HSC sessions folder for *.tilecache dirs
  // when enforcing budget.
  configureCache({
    cacheRoots: [
      path.join(app.getPath("userData"), "HSC-SESSIONS", "FILES"),
    ],
    budgetBytes: 1024 * 1024 * 1024, // 1 GB
  });
  // Run a budget pass at startup (catches any leftover bloat from prior runs).
  enforceCacheBudget().catch((err) =>
    console.warn("[TileCache] enforceCacheBudget failed:", err),
  );
});

// Tile server IPC handlers
ipcMain.handle("tileServer:getServerUrl", async () => {
  if (tileServer && tileServerPort > 0) {
    return {
      baseUrl: `http://localhost:${tileServerPort}`,
      port: tileServerPort,
    };
  }
  const defaultFolder = path.join(app.getPath("documents"), "tiles");
  if (fsSync.existsSync(defaultFolder)) {
    return await startTileServer(defaultFolder);
  }
  throw new Error("No tile folder found");
});

ipcMain.handle(
  "tileServer:updateFolderPath",
  async (_e, folderPath: string) => {
    return await startTileServer(folderPath);
  },
);

ipcMain.handle("tileServer:checkStoragePermission", async () => {
  return { hasPermission: true };
});

ipcMain.handle("tileServer:selectTileFolder", async () => {
  const r = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openDirectory"],
  });
  if (r.filePaths.length > 0) {
    const folder = r.filePaths[0];
    await startTileServer(folder);
    return { uri: folder };
  }
  throw new Error("No folder selected");
});

ipcMain.handle("tileServer:getSavedFolderUri", async () => {
  return { uri: tileServerFolder || null };
});

// ── Raster tiling IPC (gdal-async via child Node worker) ─────────────────
ipcMain.handle("tiling:probe", async (_e, absolutePath: string) => {
  if (!absolutePath) throw new Error("tiling:probe requires absolutePath");
  return await workerProbe(absolutePath);
});

ipcMain.handle("tiling:buildOverviews", async (_e, absolutePath: string) => {
  if (!absolutePath) {
    throw new Error("tiling:buildOverviews requires absolutePath");
  }
  if (!fsSync.existsSync(absolutePath)) {
    throw new Error(`Source file not found: ${absolutePath}`);
  }
  const t0 = Date.now();
  const result = await workerBuildOverviews(absolutePath);
  console.log(
    `[Tiling] buildOverviews ${absolutePath}: ${JSON.stringify(result)} (${Date.now() - t0}ms)`,
  );
  return result;
});

ipcMain.handle(
  "tiling:registerLayer",
  async (_e, layerId: string, absolutePath: string) => {
    if (!layerId || !absolutePath) {
      throw new Error("tiling:registerLayer requires layerId and absolutePath");
    }
    if (!fsSync.existsSync(absolutePath)) {
      throw new Error(`Source file not found: ${absolutePath}`);
    }
    registerTiledLayer(layerId, absolutePath);
    return { ok: true };
  },
);

ipcMain.handle(
  "tiling:unregisterLayer",
  async (_e, layerId: string, fallbackPath?: string) => {
    // App-startup cleanup arrives BEFORE the worker registers the layer
    // (worker is fresh, registry is empty). Falls back to caller-provided
    // absolute path so the per-layer cache dir is still swept.
    const sourcePath = lookupTiledLayerSource(layerId) ?? fallbackPath ?? null;
    unregisterTiledLayer(layerId);
    if (sourcePath) {
      void deleteCacheDir(sourcePath);
    }
    return { ok: true };
  },
);

ipcMain.handle(
  "tiling:sampleAt",
  async (_e, args: { layerId: string; lon: number; lat: number }) => {
    if (!args || !args.layerId) {
      throw new Error("tiling:sampleAt requires {layerId, lon, lat}");
    }
    const sourcePath = lookupTiledLayerSource(args.layerId);
    if (!sourcePath) {
      throw new Error(`Layer ${args.layerId} not registered for tiling`);
    }
    return await workerSampleAt({
      path: sourcePath,
      lon: args.lon,
      lat: args.lat,
    });
  },
);

// URL the renderer should use to compose tile templates.
ipcMain.handle("tiling:getTileBaseUrl", async () => {
  return tileServerPort > 0 ? `http://localhost:${tileServerPort}` : null;
});

// Force the worker to release every cached gdal-async Dataset. Required
// before flushing the session — Windows refuses to unlink a `.tif` while
// the worker still holds an open file handle to it (EBUSY/EPERM).
ipcMain.handle("tiling:closeAll", async () => {
  return await workerCloseAllDatasets();
});

// Cleanup on quit
app.on("before-quit", () => {
  if (tileServer) {
    tileServer.close();
    tileServer = null;
  }
  shutdownWorker();
});
