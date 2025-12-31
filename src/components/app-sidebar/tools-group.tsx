import {
  ChevronDown,
  ChevronRight,
  Circle,
  Route,
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
import { useDrawingMode } from "@/store/layers-store";

const ToolsGroup = ({
  setIsDrawingToolsOpen,
  isDrawingToolsOpen,
}: {
  setIsDrawingToolsOpen: (isOpen: boolean) => void;
  isDrawingToolsOpen: boolean;
}) => {
  const { drawingMode, setDrawingMode } = useDrawingMode();

  const tools = [
    { key: "point", label: "Point", icon: <Circle size={8} /> },
    { key: "polyline", label: "Path", icon: <Route size={8} /> },
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
