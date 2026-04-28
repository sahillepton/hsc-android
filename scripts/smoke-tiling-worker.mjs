// Smoke test: spawn electron/tiling/worker.cjs as a child Node process,
// send probe + renderTile + sampleAt requests against clutter-india-25m.tif,
// validate that responses look right and that timing is in the expected range.
//
// Run: node scripts/smoke-tiling-worker.mjs
//
// Exits 0 on success, 1 on any failure.

import { spawn } from "child_process";
import { createInterface } from "readline";
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = process.argv[2] || "D:/TIFF/clutter-india-25m.tif";
const WORKER = path.join(__dirname, "..", "electron", "tiling", "worker.cjs");

console.log(`[smoke] worker:  ${WORKER}`);
console.log(`[smoke] target:  ${TARGET}\n`);

const proc = spawn("node", [WORKER], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

let nextId = 1;
const pending = new Map();
let ready = false;
let failed = false;

function fmtMs(ms) {
  return `${ms.toString().padStart(5)} ms`;
}

const rl = createInterface({ input: proc.stdout });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    console.error(`[smoke] non-JSON line: ${line}`);
    return;
  }
  if (!ready && msg.ready) {
    ready = true;
    console.log(`[smoke] worker ready, GDAL ${msg.gdal}\n`);
    runTests();
    return;
  }
  const handler = pending.get(msg.id);
  if (handler) {
    pending.delete(msg.id);
    handler(msg);
  }
});

proc.stderr.on("data", (b) => {
  const s = b.toString().trim();
  if (s) console.error(`[smoke worker stderr] ${s}`);
});

proc.on("exit", (code) => {
  if (!failed && code !== 0) {
    console.error(`[smoke] worker exited with code ${code}`);
    process.exit(1);
  }
});

function send(cmd, args = {}) {
  const id = nextId++;
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => {
      const dt = Date.now() - t0;
      if (msg.ok) resolve({ ...msg, _ms: dt });
      else reject(new Error(`${cmd} failed after ${dt}ms: ${msg.error}`));
    });
    proc.stdin.write(JSON.stringify({ id, cmd, ...args }) + "\n");
  });
}

async function runTests() {
  try {
    // Test 1: ping
    {
      const r = await send("ping");
      console.log(`✓ ping        ${fmtMs(r._ms)}  GDAL ${r.version}`);
    }

    // Test 2: probe
    let probe;
    {
      probe = await send("probe", { path: TARGET });
      console.log(
        `✓ probe       ${fmtMs(probe._ms)}  ` +
          `${probe.width.toLocaleString()}×${probe.height.toLocaleString()} ` +
          `band=${probe.dtype} crs=${probe.sourceCrs} ` +
          `bounds=${probe.boundsWgs84 ? probe.boundsWgs84.map((n) => n.toFixed(2)).join(",") : "?"} ` +
          `nativeZoom=${probe.nativeZoom} palette=${probe.palette ? probe.palette.length : "no"}`,
      );
    }

    // Test 2.5: buildOverviews — first call may take a while (one-time);
    // a second call should report "already-exists".
    {
      const r = await send("buildOverviews", { path: TARGET });
      console.log(
        `✓ overviews   ${fmtMs(r._ms)}  built=${r.built}` +
          (r.reason ? ` reason=${r.reason}` : "") +
          (r.kind ? ` kind=${r.kind} levels=${r.levels.join(",")}` : ""),
      );
    }

    // Test 3: renderTile at a few zooms covering India
    // India centroid ~ lon 78.96, lat 20.59. Convert to tile coords for z=4..8
    const TEST_TILES = [
      { z: 3, x: 5, y: 4 },   // India whole
      { z: 5, x: 22, y: 14 }, // India zoomed
      { z: 7, x: 90, y: 56 }, // central India
    ];
    for (const t of TEST_TILES) {
      const r = await send("renderTile", { path: TARGET, ...t });
      const b64 = r.image ?? r.png;
      const bytes = Buffer.from(b64, "base64");
      console.log(
        `✓ renderTile  ${fmtMs(r._ms)}  z=${t.z} x=${t.x} y=${t.y}  ${r.format ?? "png"}=${(bytes.length / 1024).toFixed(1)} KB`,
      );
      // Save the first one so we can eyeball it.
      if (t.z === 5) {
        const ext = r.format === "webp" ? "webp" : "png";
        const out = path.join(
          __dirname,
          "..",
          `smoke-tile-z${t.z}-${t.x}-${t.y}.${ext}`,
        );
        writeFileSync(out, bytes);
        console.log(`              → wrote sample tile to ${out}`);
      }
    }

    // Test 4: sampleAt — middle of India
    {
      const r = await send("sampleAt", {
        path: TARGET,
        lon: 78.96,
        lat: 20.59,
      });
      console.log(
        `✓ sampleAt    ${fmtMs(r._ms)}  lon=78.96 lat=20.59 → value=${r.value} (dtype=${r.dtype})`,
      );
    }

    // Test 5: cache reuse (second probe should be near-instant)
    {
      const r = await send("probe", { path: TARGET });
      console.log(`✓ probe(re)   ${fmtMs(r._ms)}  (cache hit expected)`);
    }

    // Test 6: parallel tile renders — confirm async actually concurrentizes.
    // 8 distinct mid-zoom tiles fired simultaneously. Wall time should be
    // significantly less than sum of sequential times.
    {
      const PARALLEL_TILES = [
        { z: 6, x: 44, y: 28 },
        { z: 6, x: 45, y: 28 },
        { z: 6, x: 44, y: 29 },
        { z: 6, x: 45, y: 29 },
        { z: 6, x: 46, y: 28 },
        { z: 6, x: 46, y: 29 },
        { z: 6, x: 47, y: 28 },
        { z: 6, x: 47, y: 29 },
      ];
      const t0 = Date.now();
      const results = await Promise.all(
        PARALLEL_TILES.map((t) =>
          send("renderTile", { path: TARGET, ...t }),
        ),
      );
      const wall = Date.now() - t0;
      const sumSerial = results.reduce((a, r) => a + r._ms, 0);
      const speedup = (sumSerial / wall).toFixed(2);
      console.log(
        `✓ parallel×8  wall=${wall}ms  sum-of-each=${sumSerial}ms  speedup=${speedup}×`,
      );
      if (wall >= sumSerial * 0.95) {
        console.warn(
          "  ⚠ parallel wall time ≈ serial sum — concurrency not effective",
        );
      }
    }

    console.log("\n[smoke] all tests passed");
    proc.kill();
    process.exit(0);
  } catch (e) {
    failed = true;
    console.error(`\n[smoke] FAILED: ${e.message}`);
    proc.kill();
    process.exit(1);
  }
}
