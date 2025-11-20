import {
  ChevronDown,
  ChevronRight,
  Circle,
  LineChart,
  Hexagon,
  Compass,
  LogOut,
} from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import { useAzimuthalAngle, useDrawingMode } from "@/store/layers-store";
import { Input } from "../ui/input";

const ToolsGroup = ({
  setIsDrawingToolsOpen,
  isDrawingToolsOpen,
}: {
  setIsDrawingToolsOpen: (isOpen: boolean) => void;
  isDrawingToolsOpen: boolean;
}) => {
  const { drawingMode, setDrawingMode } = useDrawingMode();
  const { azimuthalAngle, setAzimuthalAngle } = useAzimuthalAngle();

  const tools = [
    { key: "point", label: "Point", icon: <Circle size={8} /> },
    { key: "line", label: "Line", icon: <LineChart size={8} /> },
    { key: "polygon", label: "Polygon", icon: <Hexagon size={8} /> },
    { key: "azimuthal", label: "Azimuthal", icon: <Compass size={8} /> },
  ];

  return (
    <SidebarGroup>
      {/* Group Label */}
      <SidebarGroupLabel
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setIsDrawingToolsOpen(!isDrawingToolsOpen)}
      >
        <span className="text-sm">Drawing Tools</span>
        {isDrawingToolsOpen ? (
          <ChevronDown size={16} className="text-muted-foreground" />
        ) : (
          <ChevronRight size={16} className="text-muted-foreground" />
        )}
      </SidebarGroupLabel>

      {/* Collapsible Content */}
      <SidebarGroupContent
        className={`${isDrawingToolsOpen ? "block" : "hidden"} transition-all`}
      >
        <SidebarMenu className="space-y-2 mt-2">
          {tools.map((tool) => (
            <SidebarMenuItem key={tool.key}>
              <SidebarMenuButton
                isActive={drawingMode === tool.key}
                onClick={() => setDrawingMode(tool.key as any)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border border-transparent hover:bg-accent hover:text-accent-foreground ${
                  drawingMode === tool.key
                    ? "bg-accent text-accent-foreground border-border"
                    : ""
                }`}
              >
                {tool.icon}
                <span>{tool.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}

          {/* Azimuthal Controls */}
          {drawingMode === "azimuthal" && (
            <div className="px-3 pb-3 space-y-2 pt-3">
              <label className="text-xs font-medium text-muted-foreground block">
                Sector Angle (degrees)
              </label>

              <Input
                type="range"
                min={10}
                max={360}
                step={5}
                value={azimuthalAngle}
                onChange={(e) => setAzimuthalAngle(Number(e.target.value))}
              />

              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={360}
                  value={azimuthalAngle}
                  onChange={(e) =>
                    setAzimuthalAngle(
                      Number.isNaN(Number(e.target.value))
                        ? 60
                        : Number(e.target.value)
                    )
                  }
                  className="w-20 h-8"
                />
                <span className="text-sm text-muted-foreground">°</span>
              </div>
            </div>
          )}

          {/* Exit Drawing Mode */}
          {drawingMode && (
            <SidebarMenuItem key="exit-drawing">
              <SidebarMenuButton
                onClick={() => setDrawingMode(null)}
                className="text-red-600 hover:text-red-700 font-medium hover:bg-transparent cursor-pointer"
              >
                <LogOut size={16} />
                <span>Exit Drawing Mode</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default ToolsGroup;
