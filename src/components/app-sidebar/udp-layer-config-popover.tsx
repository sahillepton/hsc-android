import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { Settings2 } from "lucide-react";
import { useUdpSymbolsStore } from "@/store/udp-symbols-store";
import { useState } from "react";

const availableIcons = [
  "fighter1",
  "fighter2",
  "fighter3",
  "fighter4",
  "fighter5",
  "fighter6",
  "fighter7",
  "fighter8",
  "fighter9",
  "fighter10",
];

interface UdpLayerConfigPopoverProps {
  layerId: string;
  layerName: string;
}

const UdpLayerConfigPopover = ({
  layerId,
  layerName,
}: UdpLayerConfigPopoverProps) => {
  const { getLayerSymbol, setLayerSymbol } = useUdpSymbolsStore();

  const [open, setOpen] = useState(false);

  const defaultSymbol =
    layerId === "udp-network-members-layer" ? "fighter1" : "fighter3";

  const currentSymbol = getLayerSymbol(layerId);
  const displaySymbol = currentSymbol || defaultSymbol;

  const handleIconClick = (iconName: string) => {
    // Close popover first
    setOpen(false);
    // Then update the symbol after a small delay to ensure popover closes first
    setTimeout(() => {
      setLayerSymbol(layerId, iconName);
    }, 150);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-accent"
          title={`Configure ${layerName}`}
        >
          <Settings2 size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-70 -ml-60"
        align="center"
        side="bottom"
        sideOffset={20}
        alignOffset={-200}
        style={{ zoom: 0.95 }}
      >
        <div className="space-y-4">
          <div className="font-semibold text-sm">{layerName} Configuration</div>
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                Select icon for all nodes in this layer
              </div>
              <div className="grid grid-cols-5 gap-1">
                {availableIcons.map((iconName) => {
                  const isSelected = displaySymbol === iconName;
                  return (
                    <button
                      key={iconName}
                      onClick={() => handleIconClick(iconName)}
                      className={`flex flex-col items-center justify-center p-1.5 rounded border transition-all ${
                        isSelected
                          ? "border-blue-500 bg-blue-100 ring-2 ring-blue-400"
                          : "border-gray-300 hover:border-blue-400 hover:bg-gray-50"
                      }`}
                      title={iconName.replace(/_/g, " ").replace(/-/g, " ")}
                    >
                      <img
                        src={`/icons/${iconName}.svg`}
                        alt={iconName}
                        className="w-4 h-4"
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default UdpLayerConfigPopover;
