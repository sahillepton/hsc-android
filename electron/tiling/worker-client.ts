// Spawns and talks to the long-running Node child that holds gdal-async.
// One worker per app session. Auto-restarts on unexpected exit.
//
// Wire protocol mirrors electron/tiling/worker.cjs:
//   request:  {"id": <number>, "cmd": "<verb>", ...args}\n
//   response: {"id": <number>, "ok": true|false, ...}\n
//
// Usage from main:
//   import { workerProbe, workerRenderTile, workerSampleAt } from './tiling/worker-client';
//   const meta = await workerProbe(absolutePath);
//   const png  = await workerRenderTile({ path, z, x, y });

import { spawn, type ChildProcess } from "child_process";
import { app } from "electron";
import path from "path";
import readline from "readline";

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
  cmd: string;
}

let child: ChildProcess | null = null;
let nextId = 1;
const pending = new Map<number, PendingRequest>();
let readyPromise: Promise<void> | null = null;
let restartAttempts = 0;
const MAX_RESTARTS = 5;

/** Resolve the worker script path in dev (repo), built (dist-electron), and prod (extraResources).
 *
 * IMPORTANT: must NOT return a path inside app.asar. Electron's fs shim
 * makes asar paths look readable from inside Electron, so fs.existsSync
 * returns true — but the spawned Node process has no asar shim and dies
 * with MODULE_NOT_FOUND. Production candidates therefore route through
 * app.asar.unpacked or the extraResources copy.
 */
function resolveWorkerScript(): string {
  const fs = require("fs") as typeof import("fs");
  const isInsideAsar = (p: string) =>
    p.includes(`${path.sep}app.asar${path.sep}`) ||
    p.endsWith(`${path.sep}app.asar`);

  const candidates = [
    // Prod packaged (preferred): asar.unpacked location. worker.cjs sits
    // adjacent to node_modules, so Node's upward module resolver finds
    // gdal-async naturally even without NODE_PATH (we set it anyway as
    // belt-and-suspenders).
    process.resourcesPath
      ? path.join(
          process.resourcesPath,
          "app.asar.unpacked",
          "dist-electron",
          "tiling",
          "worker.cjs",
        )
      : "",
    // Prod packaged fallback: extraResources copy at resources/tiling/.
    // Only reachable via NODE_PATH for module resolution.
    process.resourcesPath
      ? path.join(process.resourcesPath, "tiling", "worker.cjs")
      : "",
    // Dev: source tree (app.getAppPath() returns project root in dev,
    // not app.asar). Excluded automatically in prod by the asar guard.
    path.join(app.getAppPath(), "electron", "tiling", "worker.cjs"),
    // Built locally (yarn build:electron): copied next to main.cjs.
    path.join(app.getAppPath(), "dist-electron", "tiling", "worker.cjs"),
    // When main.cjs runs from inside dist-electron/, __dirname resolves there.
    path.join(__dirname, "tiling", "worker.cjs"),
  ];

  for (const c of candidates) {
    if (!c) continue;
    if (isInsideAsar(c)) continue; // Spawned Node can't read inside asar.
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `Tiling worker script not found (or only available inside app.asar). Looked in:\n  ${candidates.filter(Boolean).join("\n  ")}`,
  );
}

/**
 * Resolve the Node binary the worker runs in.
 *
 * Why we need a real Node (not Electron-as-Node):
 *   gdal-async@3.12.x ships ONLY Node-ABI prebuilds (NODE_MODULE_VERSION
 *   115/127/137/141 for Node 20/22/24/25). Electron 35.x's V8 reports
 *   ABI 133 — no published prebuild matches, so loading gdal-async via
 *   `process.execPath` + ELECTRON_RUN_AS_NODE crashes with
 *   "DLL initialization routine failed" / NODE_MODULE_VERSION mismatch.
 *
 * Production: scripts/fetch-gdal-electron-prebuild.mjs (run during
 *   `yarn prepackage`) copies the build-machine's Node 22.x binary to
 *   bundled-runtime/node.exe. electron-builder then ships it via
 *   extraResources at process.resourcesPath/node.exe. ABI 127 matches
 *   gdal-async/lib/binding/node-v127-win32-x64/gdal.node which is
 *   already in node_modules.
 *
 * Dev: falls back to system "node" on PATH (works because devs run
 *   under their own Node 22 install).
 */
function resolveNodeBin(): string {
  const fs = require("fs") as typeof import("fs");
  if (process.resourcesPath) {
    const bundled = path.join(process.resourcesPath, "node.exe");
    if (fs.existsSync(bundled)) {
      return bundled;
    }
  }
  return "node";
}

/**
 * Build NODE_PATH for the spawned worker so require("gdal-async") resolves
 * in production. In packaged mode, gdal-async lives at
 *   resources/app.asar.unpacked/node_modules/gdal-async/
 * which is NOT on Node's default upward search path from
 * resources/tiling/worker.cjs. NODE_PATH bridges that gap.
 *
 * Dev mode: process.resourcesPath points at Electron's own resources dir,
 * not the project — but the worker.cjs there is in the project's
 * electron/tiling/, so node_modules/ resolves naturally via upward search.
 * Setting NODE_PATH here is harmless in dev (the path won't exist).
 */
function buildWorkerNodePath(): string | undefined {
  if (!process.resourcesPath) return undefined;
  const unpacked = path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    "node_modules",
  );
  // Preserve any existing NODE_PATH (semicolon separator on Windows).
  const sep = process.platform === "win32" ? ";" : ":";
  return process.env.NODE_PATH
    ? `${unpacked}${sep}${process.env.NODE_PATH}`
    : unpacked;
}

function startWorker(): Promise<void> {
  if (readyPromise) return readyPromise;

  readyPromise = new Promise((resolve, reject) => {
    const script = resolveWorkerScript();
    const nodeBin = resolveNodeBin();
    const workerNodePath = buildWorkerNodePath();

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (workerNodePath) env.NODE_PATH = workerNodePath;

    const proc = spawn(nodeBin, [script], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env,
    });
    child = proc;

    const rl = readline.createInterface({ input: proc.stdout! });
    let readyAcked = false;

    rl.on("line", (line) => {
      if (!line.trim()) return;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        console.error("[Tiling worker] bad JSON line:", line);
        return;
      }
      // First message from worker on successful start: {id:0, ok:true, ready:true, gdal:"3.x"}
      if (!readyAcked && msg.ready) {
        readyAcked = true;
        restartAttempts = 0;
        resolve();
        return;
      }
      // Routed responses
      const req = pending.get(msg.id);
      if (!req) {
        // Stray response (worker restart, races, etc.) — ignore.
        return;
      }
      pending.delete(msg.id);
      if (msg.ok) {
        const { id, ok, ...result } = msg;
        req.resolve(result);
      } else {
        req.reject(new Error(msg.error || `worker.${req.cmd} failed`));
      }
    });

    proc.stderr?.on("data", (b: Buffer) => {
      const s = b.toString("utf8").trim();
      if (s) console.error("[Tiling worker stderr]", s);
    });

    proc.on("error", (err) => {
      console.error("[Tiling worker spawn error]", err);
      if (!readyAcked) reject(err);
      cleanupAfterExit(err.message);
    });

    proc.on("exit", (code, signal) => {
      console.warn(`[Tiling worker] exited code=${code} signal=${signal}`);
      cleanupAfterExit(`worker exited (${code}/${signal})`);
    });
  });

  return readyPromise;
}

function cleanupAfterExit(reason: string) {
  child = null;
  readyPromise = null;
  // Reject any in-flight requests so the renderer doesn't hang.
  for (const [id, req] of pending) {
    req.reject(new Error(`Tiling worker died: ${reason}`));
    pending.delete(id);
  }
  // Auto-restart up to MAX_RESTARTS.
  if (restartAttempts < MAX_RESTARTS) {
    restartAttempts++;
    setTimeout(() => {
      startWorker().catch((e) =>
        console.error("[Tiling worker] restart failed", e),
      );
    }, 500);
  } else {
    console.error(
      `[Tiling worker] max restarts (${MAX_RESTARTS}) exceeded — disabling`,
    );
  }
}

async function request<T = any>(cmd: string, args: object = {}): Promise<T> {
  // renderTile is the only verb that can blow up GDAL mutex contention.
  // Other verbs (probe, sampleAt, ping, close) are fast — let them through.
  const throttle = cmd === "renderTile";
  if (throttle) await acquireRenderSlot();
  try {
    await startWorker();
    if (!child || !child.stdin || !child.stdin.writable) {
      throw new Error("Tiling worker not available");
    }
    const id = nextId++;
    const payload = JSON.stringify({ id, cmd, ...args }) + "\n";
    return await new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve, reject, cmd });
      child!.stdin!.write(payload, (err) => {
        if (err) {
          pending.delete(id);
          reject(err);
        }
      });
    });
  } finally {
    if (throttle) releaseRenderSlot();
  }
}

// ── Concurrency throttle for renderTile ──────────────────────────────────
// Without this, Mapbox spraying 30+ tile requests at once keeps the GDAL
// global mutex held continuously. Sync GDAL calls (close, vsimem.release,
// srs setter) then block the worker's event loop for 10-20 seconds, which
// stops responses from flowing back. Result: tiles render but main never
// hears about it, Mapbox times out, retries, snowballs.
//
// Capping in-flight renders at 4 lets the mutex breathe between batches so
// sync calls finish quickly and responses get back to main promptly.
const MAX_INFLIGHT_RENDERS = 4;
let renderInflight = 0;
const renderQueue: Array<() => void> = [];

function acquireRenderSlot(): Promise<void> {
  if (renderInflight < MAX_INFLIGHT_RENDERS) {
    renderInflight++;
    return Promise.resolve();
  }
  return new Promise((resolve) =>
    renderQueue.push(() => {
      renderInflight++;
      resolve();
    }),
  );
}

function releaseRenderSlot() {
  renderInflight--;
  const next = renderQueue.shift();
  if (next) next();
}

// In-flight tile dedup: if the same (path,z,x,y) is already rendering,
// piggy-back on its promise instead of dispatching a fresh worker request.
// Mapbox often re-requests tiles after small timeouts; without dedup, every
// retry doubles the worker load.
const inFlightTiles = new Map<string, Promise<Buffer>>();

// ── Public API ────────────────────────────────────────────────────────────

export interface ProbeResult {
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

export interface SampleResult {
  value: number | null;
  dtype: string;
}

export function workerPing() {
  return request<{ pong: boolean; version: string }>("ping");
}

export function workerProbe(path: string): Promise<ProbeResult> {
  return request<ProbeResult>("probe", { path });
}

export async function workerRenderTile(args: {
  path: string;
  z: number;
  x: number;
  y: number;
}): Promise<Buffer> {
  // Dedup: if the exact same tile is already rendering, share its result.
  // Mapbox often re-requests tiles on map idle / after timeout, and without
  // dedup every retry would spawn a fresh render.
  const key = `${args.path}|${args.z}/${args.x}/${args.y}`;
  let p = inFlightTiles.get(key);
  if (!p) {
    p = (async () => {
      // Worker now returns { image, format } (WebP). The legacy `png` field
      // is read as a fallback so older worker builds still work.
      const r = await request<{
        image?: string;
        png?: string;
        format?: string;
      }>("renderTile", args);
      const b64 = r.image ?? r.png;
      if (!b64) throw new Error("renderTile returned no image bytes");
      return Buffer.from(b64, "base64");
    })();
    inFlightTiles.set(key, p);
    void p.finally(() => {
      // Only clear if it's still the same promise (defensive — couldn't be
      // overwritten while in flight, but just in case of races).
      if (inFlightTiles.get(key) === p) inFlightTiles.delete(key);
    });
  }
  return p;
}

export interface BuildOverviewsResult {
  built: boolean;
  reason?: "already-exists" | "too-small";
  kind?: string;
  levels?: number[];
  count?: number;
  width?: number;
  height?: number;
}

/** Build internal overview pyramid for a raster (one-time per file). */
export function workerBuildOverviews(
  path: string,
): Promise<BuildOverviewsResult> {
  return request<BuildOverviewsResult>("buildOverviews", { path });
}

export function workerSampleAt(args: {
  path: string;
  lon: number;
  lat: number;
}): Promise<SampleResult> {
  return request<SampleResult>("sampleAt", args);
}

export function workerCloseAllDatasets() {
  return request<{ closed: boolean }>("close");
}

/** Best-effort shutdown on app quit. */
export function shutdownWorker() {
  if (child) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* noop */
    }
    child = null;
  }
}
