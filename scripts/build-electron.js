// Build electron main + preload using esbuild (no electron-vite needed)
import { build } from "esbuild";

async function buildElectron() {
  // Build main process
  await build({
    entryPoints: ["electron/main.ts"],
    bundle: true,
    platform: "node",
    target: "node20",
    outfile: "dist-electron/main.cjs",
    format: "cjs",
    external: ["electron"],
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

  console.log("✅ Electron main & preload built to dist-electron/");
}

buildElectron().catch((err) => {
  console.error(err);
  process.exit(1);
});

