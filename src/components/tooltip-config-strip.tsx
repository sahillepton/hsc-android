import {
  useTooltipConfigStore,
  FONT_OPTIONS,
} from "@/store/tooltip-config-store";
import { ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";

/**
 * Compact tooltip configuration strip — font family dropdown + font size stepper.
 * Drop this into any panel header to let the user customise map tooltip appearance.
 */
const TooltipConfigStrip = () => {
  const {
    tooltipFontFamily,
    tooltipFontSize,
    setTooltipFontFamily,
    setTooltipFontSize,
  } = useTooltipConfigStore();

  const [fontDropdownOpen, setFontDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!fontDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setFontDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [fontDropdownOpen]);

  const currentLabel =
    FONT_OPTIONS.find((f) => f.value === tooltipFontFamily)?.label ??
    "System Default";

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-zinc-50/60">
      <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider shrink-0">
        Annotations
      </span>

      {/* Font family dropdown */}
      <div ref={dropdownRef} className="relative flex-1 min-w-0">
        <button
          onClick={() => setFontDropdownOpen(!fontDropdownOpen)}
          className="w-full flex items-center justify-between gap-1 px-2 py-1 rounded-md border border-border/60 bg-white hover:bg-zinc-50 transition-colors text-[11px] text-zinc-700"
        >
          <span className="truncate" style={{ fontFamily: tooltipFontFamily }}>
            {currentLabel}
          </span>
          <ChevronDown
            size={12}
            className={`shrink-0 text-zinc-400 transition-transform ${
              fontDropdownOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        {fontDropdownOpen && (
          <div className="absolute top-full left-0 mt-1 w-full bg-white border border-border/60 rounded-md shadow-lg z-50 py-0.5 max-h-40 overflow-y-auto">
            {FONT_OPTIONS.map((opt) => {
              const isActive = tooltipFontFamily === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => {
                    setTooltipFontFamily(opt.value);
                    setFontDropdownOpen(false);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 text-[11px] transition-colors ${
                    isActive
                      ? "bg-blue-50 text-blue-700 font-medium"
                      : "text-zinc-700 hover:bg-zinc-50"
                  }`}
                  style={{ fontFamily: opt.value }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Font size stepper */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={() => setTooltipFontSize(tooltipFontSize - 1)}
          disabled={tooltipFontSize <= 10}
          className="w-5 h-5 flex items-center justify-center rounded border border-zinc-300 hover:bg-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed text-[11px] text-zinc-600 transition-colors"
          title="Decrease font size"
        >
          −
        </button>
        <span className="w-6 text-center text-[10px] font-mono font-semibold text-zinc-700">
          {tooltipFontSize}
        </span>
        <button
          onClick={() => setTooltipFontSize(tooltipFontSize + 1)}
          disabled={tooltipFontSize >= 18}
          className="w-5 h-5 flex items-center justify-center rounded border border-zinc-300 hover:bg-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed text-[11px] text-zinc-600 transition-colors"
          title="Increase font size"
        >
          +
        </button>
        <span className="text-[9px] text-zinc-400 ml-0.5">px</span>
      </div>
    </div>
  );
};

export default TooltipConfigStrip;

