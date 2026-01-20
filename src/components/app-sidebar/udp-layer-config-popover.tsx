import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { Settings2 } from "lucide-react";
import { useUdpSymbolsStore } from "@/store/udp-symbols-store";
import { useState } from "react";

// All available icons (including fighters 11-14 and helicopters)
const allAvailableIcons = [
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
  "fighter11",
  "fighter12",
  "fighter13",
  "fighter14",
  "helicopter1",
];

interface UdpLayerConfigPopoverProps {
  layerId: string;
  layerName: string;
}

const UdpLayerConfigPopover = ({
  layerId,
  layerName,
}: UdpLayerConfigPopoverProps) => {
  const { getLayerSymbol, setLayerSymbol, getGroupSymbol, setGroupSymbol } =
    useUdpSymbolsStore();

  const [open, setOpen] = useState(false);

  // Check if this is a topology group (starts with "topology-group-")
  const isTopologyGroup = layerId.startsWith("topology-group-");
  const groupId = isTopologyGroup
    ? layerId.replace("topology-group-", "")
    : null;

  // Default icons for each group (fighter1, fighter2, etc.)
  const defaultGroupIcons: Record<string, string> = {
    A: "fighter1",
    B: "fighter2",
    C: "fighter3",
    D: "fighter4",
    E: "fighter5",
    F: "fighter6",
    G: "fighter7",
    H: "fighter8",
    I: "fighter9",
    J: "fighter10",
  };

  const defaultSymbol =
    layerId === "udp-network-members-layer" ? "fighter1" : "fighter3";

  // Get current symbol - for groups use groupSymbol, for layers use layerSymbol
  const currentSymbol =
    isTopologyGroup && groupId
      ? getGroupSymbol(groupId) || defaultGroupIcons[groupId] || "fighter1"
      : getLayerSymbol(layerId) || defaultSymbol;

  const displaySymbol = currentSymbol;

  const handleIconClick = (iconName: string) => {
    // Close popover first
    setOpen(false);
    // Then update the symbol after a small delay to ensure popover closes first
    setTimeout(() => {
      if (isTopologyGroup && groupId) {
        setGroupSymbol(groupId, iconName);
      } else {
        setLayerSymbol(layerId, iconName);
      }
    }, 150);
  };

  const handleReset = () => {
    setOpen(false);
    setTimeout(() => {
      if (isTopologyGroup && groupId) {
        setGroupSymbol(groupId, "");
      } else {
        setLayerSymbol(layerId, "");
      }
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
                {isTopologyGroup
                  ? "Select icon for this group"
                  : "Select icon for all nodes in this layer"}
              </div>
              <div className="grid grid-cols-5 gap-1 max-h-64 overflow-y-auto">
                {allAvailableIcons.map((iconName) => {
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
              <button
                onClick={handleReset}
                className="w-full px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors mt-2"
              >
                Reset to Default
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default UdpLayerConfigPopover;
