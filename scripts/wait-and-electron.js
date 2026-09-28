// Wait for Vite dev server to start, then build electron and launch it
import { build } from "esbuild";
import { spawn } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const VITE_URL = "http://localhost:5173";
const MAX_WAIT = 30000;
const POLL_INTERVAL = 500;

async function waitForVite() {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT) {
    try {
      const res = await fetch(VITE_URL);
      if (res.ok) return true;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error("Vite dev server did not start in time");
}

async function buildElectron() {
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
}

async function main() {
  await waitForVite();
  await buildElectron();

  // Get the path to the electron binary directly from the package
  const electronPath = String(require("electron"));

  const child = spawn(
    `"${electronPath}"`,
    ["."],
    {
      stdio: "inherit",
      env: { ...process.env, VITE_DEV_SERVER_URL: VITE_URL },
      shell: true,
    }
  );

  child.on("close", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

