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
  tooltipHeadingColor: string;
  tooltipValueColor: string;
  setTooltipFontFamily: (font: string) => void;
  setTooltipFontSize: (size: number) => void;
  setTooltipHeadingColor: (color: string) => void;
  setTooltipValueColor: (color: string) => void;
}

export const useTooltipConfigStore = create<TooltipConfigState>()(
  persist(
    (set) => ({
      tooltipFontFamily: "Inter, system-ui, sans-serif",
      tooltipFontSize: 12,
      tooltipHeadingColor: "#2563eb",
      tooltipValueColor: "#111827",
      setTooltipFontFamily: (font: string) =>
        set({ tooltipFontFamily: font }),
      setTooltipFontSize: (size: number) =>
        set({ tooltipFontSize: Math.max(10, Math.min(18, size)) }),
      setTooltipHeadingColor: (color: string) =>
        set({ tooltipHeadingColor: color }),
      setTooltipValueColor: (color: string) =>
        set({ tooltipValueColor: color }),
    }),
    {
      name: "tooltip-config-storage",
    }
  )
);

