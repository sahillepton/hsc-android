import { create } from "zustand";
import { persist } from "zustand/middleware";

export const FONT_OPTIONS = [
  { label: "System Default", value: "Inter, system-ui, sans-serif" },
  { label: "Roboto Mono", value: "'Roboto Mono', monospace" },
  { label: "JetBrains Mono", value: "'JetBrains Mono', monospace" },
  { label: "Georgia", value: "Georgia, serif" },
] as const;

interface TooltipConfigState {
  tooltipFontFamily: string;
  tooltipFontSize: number; // in px, range 10-18
  setTooltipFontFamily: (font: string) => void;
  setTooltipFontSize: (size: number) => void;
}

export const useTooltipConfigStore = create<TooltipConfigState>()(
  persist(
    (set) => ({
      tooltipFontFamily: "Inter, system-ui, sans-serif",
      tooltipFontSize: 12,
      setTooltipFontFamily: (font: string) =>
        set({ tooltipFontFamily: font }),
      setTooltipFontSize: (size: number) =>
        set({ tooltipFontSize: Math.max(10, Math.min(18, size)) }),
    }),
    {
      name: "tooltip-config-storage",
    }
  )
);

