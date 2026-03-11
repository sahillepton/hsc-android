import { registerPlugin } from "@capacitor/core";

export interface ScreenshotPlugin {
  captureAndSave(): Promise<{ success: boolean; path?: string; error?: string }>;
}

export const Screenshot = registerPlugin<ScreenshotPlugin>("Screenshot");
