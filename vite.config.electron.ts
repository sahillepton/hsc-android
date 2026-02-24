/**
 * Vite config for Electron (desktop) builds.
 *
 * This config extends the base config with:
 * 1. @capacitor/* aliases → redirect to local shims (no real Capacitor on desktop)
 * 2. Same base config as the Android build (React, Tailwind, @ alias, etc.)
 *
 * Usage:
 *   vite --config vite.config.electron.ts          (dev)
 *   vite build --config vite.config.electron.ts     (production)
 */
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Use relative asset paths so packaged Electron app can load files via file://
  base: "./",
  plugins: [react(), tailwindcss()],

  worker: {
    format: "es",
  },

  resolve: {
    alias: [
      // Capacitor shims — redirect all @capacitor/* imports to desktop shims
      { find: "@capacitor/core", replacement: path.resolve(__dirname, "src/shims/capacitor-core.ts") },
      { find: "@capacitor/filesystem", replacement: path.resolve(__dirname, "src/shims/capacitor-filesystem.ts") },
      { find: "@capacitor/preferences", replacement: path.resolve(__dirname, "src/shims/capacitor-preferences.ts") },
      { find: "@capacitor/geolocation", replacement: path.resolve(__dirname, "src/shims/capacitor-geolocation.ts") },
      { find: "@capacitor/share", replacement: path.resolve(__dirname, "src/shims/capacitor-share.ts") },
      { find: "@capacitor/app", replacement: path.resolve(__dirname, "src/shims/capacitor-app.ts") },
      // capacitor-file-picker → redirect to shim (registerPlugin is shimmed)
      { find: "capacitor-file-picker", replacement: path.resolve(__dirname, "src/shims/capacitor-core.ts") },
      // Default @ alias (must come after more specific aliases)
      { find: "@", replacement: path.resolve(__dirname, "src") },
    ],
  },

  server: {
    watch: {
      ignored: [
        "**/public/tiles/**",
        "**/*.pbf",
      ],
    },
  },
});

