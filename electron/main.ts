import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import http from "http";
import dgram from "dgram";
import JSZip from "jszip";

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
    case "DOCUMENTS": return app.getPath("documents");
    case "DATA":      return app.getPath("userData");
    case "CACHE":     return app.getPath("temp");
    case "DESKTOP":   return app.getPath("desktop");
    case "DOWNLOADS": return app.getPath("downloads");
    default:          return app.getPath("documents");
  }
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
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

ipcMain.handle("fs:readFileInDir", async (_e, rel: string, dir: string, enc?: string) => {
  const full = path.join(resolveDirectory(dir), rel);
  if (!(await pathExists(full))) return null;
  if (enc === "base64") {
    const buf = await fs.readFile(full);
    return buf.toString("base64");
  }
  return await fs.readFile(full, "utf-8");
});

ipcMain.handle("fs:readFileInDirBinary", async (_e, rel: string, dir: string) => {
  const full = path.join(resolveDirectory(dir), rel);
  if (!(await pathExists(full))) return null;
  return await fs.readFile(full); // raw Buffer
});

ipcMain.handle("fs:writeFile", async (_e, p: string, data: string) => {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, data, "utf-8");
  return p;
});

ipcMain.handle("fs:writeFileInDir", async (_e, rel: string, dir: string, data: string, enc?: string) => {
  const full = path.join(resolveDirectory(dir), rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  if (enc === "base64") await fs.writeFile(full, Buffer.from(data, "base64"));
  else await fs.writeFile(full, data, "utf-8");
  return full;
});

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

ipcMain.handle("fs:readdirInDir", async (_e, rel: string, dir: string) => {
  const full = path.join(resolveDirectory(dir), rel || "");
  if (!(await pathExists(full))) return [];
  const entries = await fs.readdir(full, { withFileTypes: true });
  return entries.map(d => ({
    name: d.name, type: d.isDirectory() ? "directory" : "file",
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
const prefsFilePath = () => path.join(app.getPath("userData"), "hsc-prefs.json");

async function loadPrefs(): Promise<Record<string, string>> {
  try {
    const data = await fs.readFile(prefsFilePath(), "utf-8");
    return JSON.parse(data);
  } catch { return {}; }
}

async function savePrefs(p: Record<string, string>) {
  await fs.mkdir(path.dirname(prefsFilePath()), { recursive: true });
  await fs.writeFile(prefsFilePath(), JSON.stringify(p, null, 2), "utf-8");
}

ipcMain.handle("prefs:get", async (_e, k: string) => (await loadPrefs())[k] ?? null);
ipcMain.handle("prefs:set", async (_e, k: string, v: string) => {
  const p = await loadPrefs(); p[k] = v; await savePrefs(p);
});
ipcMain.handle("prefs:remove", async (_e, k: string) => {
  const p = await loadPrefs(); delete p[k]; await savePrefs(p);
});

// ── Dialog IPC ──
ipcMain.handle("dialog:openFile", async (_e, opts?: any) => {
  const r = await dialog.showOpenDialog(mainWindow!, {
    properties: opts?.multiSelections ? ["openFile", "multiSelections"] : ["openFile"],
    filters: opts?.filters || [
      { name: "GIS Files", extensions: ["json","geojson","csv","shp","zip","tif","tiff","xlsx","gpx","kml","kmz","hgt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  return r.filePaths;
});

ipcMain.handle("dialog:openFolder", async () => {
  const r = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory"] });
  return r.filePaths[0] || null;
});

ipcMain.handle("dialog:saveFile", async (_e, defaultPath: string, filters?: any[]) => {
  const r = await dialog.showSaveDialog(mainWindow!, {
    defaultPath,
    filters: filters || [{ name: "All Files", extensions: ["*"] }],
  });
  return r.filePath || null;
});

// ── App paths ──
ipcMain.handle("app:getPath", async (_e, name: string) => app.getPath(name as any));
ipcMain.handle("app:getDocumentsPath", async () => app.getPath("documents"));
ipcMain.handle("app:resolveDirectory", async (_e, dir: string) => resolveDirectory(dir));

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

ipcMain.handle("shell:showItemInFolder", async (_e, p: string) => shell.showItemInFolder(p));

// ── NativeUploader IPC (async) ──
function getMimeTypeFromExt(ext: string): string {
  const mimes: Record<string, string> = {
    ".json": "application/json", ".geojson": "application/geo+json",
    ".csv": "text/csv", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".shp": "application/x-shapefile", ".zip": "application/zip",
    ".tif": "image/tiff", ".tiff": "image/tiff",
    ".gpx": "application/gpx+xml", ".kml": "application/vnd.google-earth.kml+xml",
    ".kmz": "application/vnd.google-earth.kmz", ".hgt": "application/octet-stream",
    ".pbf": "application/x-protobuf", ".png": "image/png", ".jpg": "image/jpeg",
  };
  return mimes[ext.toLowerCase()] || "application/octet-stream";
}

function getSessionFilesDir(): string {
  return path.join(app.getPath("documents"), "HSC-SESSIONS", "FILES");
}

ipcMain.handle("nativeUploader:pickAndStageMany", async (_e, maxFiles?: number) => {
  const r = await dialog.showOpenDialog(mainWindow!, {
    properties: maxFiles === 1 ? ["openFile"] : ["openFile", "multiSelections"],
    filters: [
      { name: "GIS Files", extensions: ["json", "geojson", "csv", "shp", "zip", "tif", "tiff", "xlsx", "gpx", "kml", "kmz", "hgt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (r.canceled || r.filePaths.length === 0) {
    return { files: [] };
  }

  const filePaths = maxFiles ? r.filePaths.slice(0, maxFiles) : r.filePaths;
  const filesDir = getSessionFilesDir();
  await fs.mkdir(filesDir, { recursive: true });

  const staged: Array<{absolutePath: string; logicalPath: string; size: number; mimeType: string; status: "staged"; originalName: string}> = [];
  for (let i = 0; i < filePaths.length; i++) {
    const src = filePaths[i];
    const originalName = path.basename(src);
    const stamp = `${Date.now()}_${i}_${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const dest = path.join(filesDir, stamp);

    await fs.copyFile(src, dest);
    const stat = await fs.stat(dest);
    const ext = path.extname(originalName);

    staged.push({
      absolutePath: dest,
      logicalPath: `DOCUMENTS/HSC-SESSIONS/FILES/${stamp}`,
      size: stat.size,
      mimeType: getMimeTypeFromExt(ext),
      status: "staged" as const,
      originalName,
    });
  }

  return { files: staged };
});

ipcMain.handle("nativeUploader:deleteFile", async (_e, absolutePath: string) => {
  if (absolutePath && (await pathExists(absolutePath))) {
    await fs.unlink(absolutePath);
  }
});

ipcMain.handle("nativeUploader:saveExtractedFile", async (_e, base64Data: string, fileName: string, mimeType?: string) => {
  const filesDir = getSessionFilesDir();
  await fs.mkdir(filesDir, { recursive: true });

  const stamp = `${Date.now()}_0_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const dest = path.join(filesDir, stamp);

  await fs.writeFile(dest, Buffer.from(base64Data, "base64"));
  const stat = await fs.stat(dest);

  return {
    absolutePath: dest,
    logicalPath: `DOCUMENTS/HSC-SESSIONS/FILES/${stamp}`,
    size: stat.size,
    mimeType: mimeType || getMimeTypeFromExt(path.extname(fileName)),
  };
});

// ── ZipFolder IPC ──
const ALLOWED_EXTENSIONS = new Set([
  "tif", "tiff", "hgt", "dett",
  "geojson", "json", "csv", "gpx", "kml", "kmz", "wkt",
  "shp", "shx", "dbf", "prj", "cpg",
  "zip",
]);

type ExtractedFileInfo = {
  absolutePath: string;
  name: string;
  type: "vector" | "tiff" | "shapefile_component" | "shapefile";
  size: number;
};

function getFileType(lowerName: string): "vector" | "tiff" | "shapefile_component" {
  if (lowerName.endsWith(".tif") || lowerName.endsWith(".tiff") ||
      lowerName.endsWith(".hgt") || lowerName.endsWith(".dett")) {
    return "tiff";
  }
  if (lowerName.endsWith(".shp") || lowerName.endsWith(".shx") ||
      lowerName.endsWith(".dbf") || lowerName.endsWith(".prj") ||
      lowerName.endsWith(".cpg")) {
    return "shapefile_component";
  }
  return "vector";
}

async function extractZipRecursive(
  zipBuf: Buffer,
  destDir: string,
  depth: number,
  maxDepth: number
): Promise<ExtractedFileInfo[]> {
  if (depth > maxDepth) return [];

  const zip = await JSZip.loadAsync(zipBuf);
  const results: ExtractedFileInfo[] = [];

  for (const [relativeName, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;

    const fileName = path.basename(relativeName);
    const lowerName = fileName.toLowerCase();
    const ext = lowerName.lastIndexOf(".") > 0
      ? lowerName.substring(lowerName.lastIndexOf(".") + 1)
      : "";

    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) continue;

    const data = await entry.async("nodebuffer");

    if (lowerName.endsWith(".zip")) {
      const nested = await extractZipRecursive(data, destDir, depth + 1, maxDepth);
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
  destDir: string
): Promise<ExtractedFileInfo[]> {
  const shapefileGroups = new Map<string, ExtractedFileInfo[]>();

  for (const file of files) {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith(".shp") || lowerName.endsWith(".shx") ||
        lowerName.endsWith(".dbf") || lowerName.endsWith(".prj") ||
        lowerName.endsWith(".cpg")) {
      const baseName = lowerName.replace(/\.(shp|shx|dbf|prj|cpg)$/, "");
      const group = shapefileGroups.get(baseName) || [];
      group.push(file);
      shapefileGroups.set(baseName, group);
    }
  }

  const result: ExtractedFileInfo[] = [];
  const processedPaths = new Set<string>();

  for (const [baseName, components] of shapefileGroups.entries()) {
    const hasShp = components.some(c => c.name.toLowerCase().endsWith(".shp"));
    const hasDbf = components.some(c => c.name.toLowerCase().endsWith(".dbf"));

    if (hasShp && hasDbf) {
      const zip = new JSZip();
      for (const comp of components) {
        const buf = await fs.readFile(comp.absolutePath);
        zip.file(comp.name, buf);
      }

      const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
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
        try { await fs.unlink(comp.absolutePath); } catch { /* ignore */ }
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

ipcMain.handle("zipFolder:extractZipRecursive", async (_e, zipPath: string, outputDir?: string) => {
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
    files: finalFiles.map(f => ({
      absolutePath: f.absolutePath,
      name: f.name,
      type: f.type === "shapefile_component" ? "vector" : f.type,
      size: f.size,
    })),
  };
});

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

  const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const zipName = `HSC-SESSIONS_${Date.now()}.zip`;
  const zipPath = path.join(app.getPath("documents"), zipName);
  await fs.writeFile(zipPath, zipBuf);
  const stat = await fs.stat(zipPath);

  return { absolutePath: zipPath, fileName: zipName, size: stat.size };
});

ipcMain.handle("zipFolder:zipManifestFiles", async (_e, files: Array<{ absolutePath: string; originalName: string }>) => {
  const zip = new JSZip();

  for (const file of files) {
    if (await pathExists(file.absolutePath)) {
      const buf = await fs.readFile(file.absolutePath);
      zip.file(file.originalName || path.basename(file.absolutePath), buf);
    }
  }

  const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const zipName = `HSC-Export_${Date.now()}.zip`;
  const zipPath = path.join(app.getPath("documents"), "HSC-SESSIONS", zipName);
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  await fs.writeFile(zipPath, zipBuf);
  const stat = await fs.stat(zipPath);

  return { absolutePath: zipPath, fileName: zipName, size: stat.size };
});

// ── TileCache IPC ──
let tileCacheDir: string = "";

ipcMain.handle("tileCache:setTilesDirectory", async (_e, tilePath: string) => {
  tileCacheDir = tilePath;
  return { success: true };
});

ipcMain.handle("tileCache:getTile", async (_e, z: string, x: string, y: string) => {
  if (!tileCacheDir) {
    throw new Error("Tiles directory not set");
  }
  const tilePath = path.join(tileCacheDir, z, x, `${y}.pbf`);
  if (!(await pathExists(tilePath))) {
    throw new Error(`Tile not found: ${z}/${x}/${y}`);
  }
  const buf = await fs.readFile(tilePath);
  return { data: buf.toString("base64"), fromCache: true };
});

ipcMain.handle("tileCache:clearCache", async () => {
  return { success: true };
});

ipcMain.handle("tileCache:pickDirectory", async () => {
  const r = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory"] });
  if (r.filePaths.length > 0) {
    tileCacheDir = r.filePaths[0];
    return { path: tileCacheDir };
  }
  throw new Error("No directory selected");
});

// ── Udp IPC ──
let udpSocket: dgram.Socket | null = null;
const UDP_LISTEN_PORT = 40074;

ipcMain.handle("udp:create", async () => {
  if (udpSocket) {
    try { udpSocket.close(); } catch { /* ignore */ }
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
        const bytes = new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
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
    try { udpSocket.close(); } catch { /* ignore */ }
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

function startTileServer(folder: string): Promise<{ baseUrl: string; port: number }> {
  return new Promise((resolve, reject) => {
    if (tileServer && tileServerFolder === folder) {
      resolve({ baseUrl: `http://localhost:${tileServerPort}`, port: tileServerPort });
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
        } catch { /* skip gzip header if can't read */ }
      }

      res.writeHead(200, headers);
      fsSync.createReadStream(filePath).pipe(res);
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        tileServerPort = addr.port;
        tileServer = server;
        console.log(`[TileServer] Running at http://localhost:${tileServerPort} serving ${folder}`);
        resolve({ baseUrl: `http://localhost:${tileServerPort}`, port: tileServerPort });
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

// Auto-start tile server
app.whenReady().then(async () => {
  const defaultTileFolder = path.join(app.getPath("documents"), "tiles");
  if (fsSync.existsSync(defaultTileFolder)) {
    try {
      const result = await startTileServer(defaultTileFolder);
      console.log(`[TileServer] Auto-started: ${result.baseUrl}`);
    } catch (err) {
      console.error("[TileServer] Failed to auto-start:", err);
    }
  } else {
    console.warn(`[TileServer] Default tile folder not found: ${defaultTileFolder}`);
  }
});

// Tile server IPC handlers
ipcMain.handle("tileServer:getServerUrl", async () => {
  if (tileServer && tileServerPort > 0) {
    return { baseUrl: `http://localhost:${tileServerPort}`, port: tileServerPort };
  }
  const defaultFolder = path.join(app.getPath("documents"), "tiles");
  if (fsSync.existsSync(defaultFolder)) {
    return await startTileServer(defaultFolder);
  }
  throw new Error("No tile folder found");
});

ipcMain.handle("tileServer:updateFolderPath", async (_e, folderPath: string) => {
  return await startTileServer(folderPath);
});

ipcMain.handle("tileServer:checkStoragePermission", async () => {
  return { hasPermission: true };
});

ipcMain.handle("tileServer:selectTileFolder", async () => {
  const r = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory"] });
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

// Cleanup on quit
app.on("before-quit", () => {
  if (tileServer) {
    tileServer.close();
    tileServer = null;
  }
});

