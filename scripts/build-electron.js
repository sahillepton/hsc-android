// Build electron main + preload using esbuild (no electron-vite needed)
import { build } from "esbuild";
import { promises as fs } from "fs";

async function buildElectron() {
  // Build main process
  await build({
    entryPoints: ["electron/main.ts"],
    bundle: true,
    platform: "node",
    target: "node20",
    outfile: "dist-electron/main.cjs",
    format: "cjs",
    external: [
      "electron",
      // gdal-async is loaded by the child Node worker, not by Electron main.
      // It must remain external so esbuild doesn't try to bundle the native
      // .node binary.
      "gdal-async",
    ],
    sourcemap: true,
  });

  // Build preload script
  await build({
    entryPoints: ["electron/preload.ts"],
    bundle: true,
    platform: "node",
    target: "node20",
    outfile: "dist-electron/preload.js",
    format: "cjs",
    external: ["electron"],
    sourcemap: true,
  });

  // Copy the tiling worker script (loaded at runtime via child_process.spawn,
  // not via require) so it ships next to main.cjs and is reachable inside
  // a packaged build via process.resourcesPath / app.getAppPath().
  await fs.mkdir("dist-electron/tiling", { recursive: true });
  await fs.copyFile(
    "electron/tiling/worker.cjs",
    "dist-electron/tiling/worker.cjs",
  );
}

buildElectron().catch((err) => {
  console.error(err);
  process.exit(1);
});
