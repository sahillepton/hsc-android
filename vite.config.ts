import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // Ensure workers build as ES modules (needed for import.meta.url usage)
  worker: {
    format: "es",
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  server: {
    watch: {
      ignored: [
        "**/public/tiles/**", // ✅ ignore offline tile folder
        "**/*.pbf", // ✅ ignore all vector tile files (optional but recommended)
      ],
    },
  },
});
