import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useLayers } from "@/store/layers-store";
import { summarizeLayerLoad, type LoadStress } from "@/lib/layer-load";

const STRESS_LABEL: Record<LoadStress, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const STRESS_DOT: Record<LoadStress, string> = {
  low: "bg-emerald-500",
  medium: "bg-amber-500",
  high: "bg-red-600",
};

const STRESS_TEXT: Record<LoadStress, string> = {
  low: "text-slate-800",
  medium: "text-amber-700",
  high: "text-red-700",
};

const HIGH_LOAD_MESSAGE = "Please hide some layers to reduce the GPU load!";

/**
 * GPU load badge — always on screen beside the Storage Paths button, in every
 * basemap mode (it reads the layer store, which both renderers draw from).
 * Three stages, Low / Medium / High, from the visible feature count (see
 * lib/layer-load.ts). At High an "i" button appears at the chip's right end;
 * tapping it opens one message asking to hide layers. Same card styling as the
 * Storage Paths button and popover; everything is a tap. Hidden only together
 * with the tool bar (see index.tsx).
 */
export default function LayerLoadBadge() {
  const { layers } = useLayers();
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => summarizeLayerLoad(layers), [layers]);
  const { stress } = summary;
  const isHigh = stress === "high";

  return (
    <div className="absolute top-2 right-14 z-50 pointer-events-none">
      <Popover open={open && isHigh} onOpenChange={setOpen}>
        <div
          className={cn(
            "pointer-events-auto flex h-10 items-center gap-2 pl-3 rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm",
            !isHigh && "pr-3",
            STRESS_TEXT[stress],
          )}
          title={`${summary.visibleLayers} of ${summary.layers} layers visible`}
        >
          <span
            className={cn("h-2.5 w-2.5 rounded-full shrink-0", STRESS_DOT[stress])}
          />
          <span className="text-xs font-semibold whitespace-nowrap">
            GPU load: {STRESS_LABEL[stress]}
          </span>
          {isHigh && (
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-sm hover:bg-white text-slate-700"
                title="GPU load is high"
                aria-label="GPU load is high"
              >
                <Info className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          )}
        </div>
        <PopoverContent
          className="w-72 p-4 bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm"
          align="end"
          side="bottom"
        >
          <p className="text-sm text-slate-800">{HIGH_LOAD_MESSAGE}</p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
