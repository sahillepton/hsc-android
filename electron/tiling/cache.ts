// On-disk WebP tile cache. Each layer's tiles live next to its source raster:
//   <stem>.tilecache/<z>/<x>/<y>.webp
// Older builds wrote .png at the same paths — the budget walker still
// counts those so existing caches keep working until they get re-rendered.
//
// Reads/writes are best-effort — a failed read just means we re-render
// the tile, a failed write just means the next request also re-renders.
//
// Optional LRU-by-mtime eviction caps total cache size. Eviction runs on
// a background timer and on explicit `enforceCacheBudget()` calls.

import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { spawn } from "child_process";

const DEFAULT_BUDGET_BYTES = 1024 * 1024 * 1024; // 1 GB

/** Derive the per-layer cache root from the source raster's absolute path. */
export function tileCacheDirFor(sourcePath: string): string {
  // Replace the .tif/.tiff extension with .tilecache/
  const stem = sourcePath.replace(/\.(tif|tiff|TIF|TIFF)$/, "");
  return `${stem}.tilecache`;
}

/** Path to a single cached tile (WebP). */
export function tileCachePath(sourcePath: string, z: number, x: number, y: number): string {
  return path.join(tileCacheDirFor(sourcePath), String(z), String(x), `${y}.webp`);
}

/** Read a cached tile PNG buffer if present. */
export async function readCachedTile(
  sourcePath: string,
  z: number,
  x: number,
  y: number,
): Promise<Buffer | null> {
  const p = tileCachePath(sourcePath, z, x, y);
  try {
    return await fsp.readFile(p);
  } catch {
    return null;
  }
}

/** Write a tile PNG to the cache (mkdir -p as needed). */
export async function writeCachedTile(
  sourcePath: string,
  z: number,
  x: number,
  y: number,
  png: Buffer,
): Promise<void> {
  const p = tileCachePath(sourcePath, z, x, y);
  try {
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, png);
    bumpAccessedSince();
  } catch (err) {
    console.warn(`[TileCache] write failed ${p}: ${(err as Error).message}`);
  }
}

/** Recursively delete a layer's cache dir. Uses cmd /c rmdir on Windows for speed. */
export async function deleteCacheDir(sourcePath: string): Promise<void> {
  const dir = tileCacheDirFor(sourcePath);
  if (!fs.existsSync(dir)) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const c = spawn("cmd", ["/c", "rmdir", "/S", "/Q", dir], {
        windowsHide: true,
      });
      c.on("close", () => resolve());
      c.on("error", () => resolve());
    });
    if (!fs.existsSync(dir)) return;
  }
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

// ── Budget enforcement ───────────────────────────────────────────────────

let cacheRoots: string[] = [];
let budgetBytes = DEFAULT_BUDGET_BYTES;
let recentChangeCount = 0;

export function configureCache(opts: {
  cacheRoots?: string[];
  budgetBytes?: number;
}): void {
  if (opts.cacheRoots) cacheRoots = opts.cacheRoots;
  if (typeof opts.budgetBytes === "number") budgetBytes = opts.budgetBytes;
}

function bumpAccessedSince() {
  recentChangeCount++;
  // Trigger background eviction every ~200 writes to avoid scanning on
  // every tile.
  if (recentChangeCount >= 200) {
    recentChangeCount = 0;
    enforceCacheBudget().catch(() => {
      /* swallow */
    });
  }
}

interface CacheFile {
  path: string;
  size: number;
  mtimeMs: number;
}

async function walkCache(dir: string): Promise<CacheFile[]> {
  const out: CacheFile[] = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        // only recurse into <root>/<*.tilecache>/<z>/<x>/
        stack.push(full);
      } else if (entry.name.endsWith(".webp") || entry.name.endsWith(".png")) {
        // .png is legacy from earlier worker builds — still count toward
        // budget so old caches get evicted instead of growing forever.
        try {
          const s = await fsp.stat(full);
          out.push({ path: full, size: s.size, mtimeMs: s.mtimeMs });
        } catch {
          /* ignore */
        }
      }
    }
  }
  return out;
}

/**
 * Walk all configured cache roots, sum sizes; if over budget, delete
 * least-recently-used tiles until under.
 */
export async function enforceCacheBudget(): Promise<{
  scanned: number;
  totalBytes: number;
  evicted: number;
  evictedBytes: number;
}> {
  if (!cacheRoots.length) {
    return { scanned: 0, totalBytes: 0, evicted: 0, evictedBytes: 0 };
  }
  const all: CacheFile[] = [];
  for (const root of cacheRoots) {
    // root may contain many *.tilecache dirs; walk each.
    if (!fs.existsSync(root)) continue;
    let names: string[];
    try {
      names = await fsp.readdir(root);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.endsWith(".tilecache")) {
        const sub = path.join(root, name);
        const files = await walkCache(sub);
        all.push(...files);
      }
    }
  }

  const totalBytes = all.reduce((a, f) => a + f.size, 0);
  if (totalBytes <= budgetBytes) {
    return { scanned: all.length, totalBytes, evicted: 0, evictedBytes: 0 };
  }

  // Sort oldest-first (LRU by mtime) and evict until under budget.
  all.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let bytes = totalBytes;
  let evicted = 0;
  let evictedBytes = 0;
  for (const f of all) {
    if (bytes <= budgetBytes) break;
    try {
      await fsp.unlink(f.path);
      bytes -= f.size;
      evicted++;
      evictedBytes += f.size;
    } catch {
      /* ignore */
    }
  }
  return { scanned: all.length, totalBytes, evicted, evictedBytes };
}
