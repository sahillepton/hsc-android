import { X, Layers } from "lucide-react";
import LayersPanel from "@/components/app-sidebar/layers-panel";

const LayersBox = ({ onClose }: { onClose: () => void }) => {
  return (
    <div
      style={{ zoom: 0.87 }}
      className="absolute top-4 left-4 z-50 flex w-[400px] max-h-[calc(100vh-120px)] flex-col rounded-lg border border-border/70 bg-card shadow-2xl"
    >
      <div className="flex items-center justify-between px-4 py-3 pb-2 shrink-0">
        <div>
          <p className="flex items-center gap-4 text-base font-medium text-foreground">
            <Layers className="size-5" />
            Layers Console
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted"
          onClick={onClose}
          aria-label="Close layers box"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-2 pt-0 flex-1 overflow-hidden flex flex-col">
        <LayersPanel
          isOpen={true}
          setIsOpen={() => {}}
          variant="plain"
          enableSelection={true}
        />
      </div>
    </div>
  );
};

export default LayersBox;
