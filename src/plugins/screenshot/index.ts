import { registerPlugin } from "@capacitor/core";

export interface ScreenshotPlugin {
  captureAndSave(): Promise<{ success: boolean; path?: string; error?: string }>;
}

// ── Platform detection ──
function isElectron(): boolean {
  return typeof window !== "undefined" && !!(window as any).electronAPI;
}

// ── Electron desktop implementation ──
function createDesktopPlugin(): ScreenshotPlugin {
  const api = () => (window as any).electronAPI;
  return {
    async captureAndSave() {
      try {
        return await api().captureScreenshot();
      } catch (err: any) {
        return { success: false, error: err?.message || "Screenshot failed" };
      }
    },
  };
}

// ── Export: Electron uses IPC, Android uses Capacitor native plugin ──
export const Screenshot: ScreenshotPlugin = isElectron()
  ? createDesktopPlugin()
  : registerPlugin<ScreenshotPlugin>("Screenshot");
