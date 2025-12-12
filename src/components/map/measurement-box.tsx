import { X, RulerDimensionLine } from "lucide-react";
import SketchLayersPanel from "@/components/app-sidebar/sketch-layers-panel";

const MeasurementBox = ({ onClose }: { onClose: () => void }) => {
  return (
    <div
      style={{ zoom: 0.9 }}
      className="absolute top-4 left-4 z-50 flex w-[400px] max-h-[calc(100vh-120px)] flex-col rounded-lg border border-border/70 bg-card shadow-2xl"
    >
      <div className="flex items-center justify-between px-4 py-3 pb-2 shrink-0">
        <div>
          <p className="flex items-center gap-4 text-base font-medium text-foreground">
            <RulerDimensionLine className="size-5" />
            Measurement Console
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted"
          onClick={onClose}
          aria-label="Close measurement box"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-2 pt-0 flex-1 overflow-hidden flex flex-col">
        <SketchLayersPanel
          isOpen={true}
          setIsOpen={() => {}}
          variant="plain"
          enableSelection
        />
      </div>
    </div>
  );
};

export default MeasurementBox;
