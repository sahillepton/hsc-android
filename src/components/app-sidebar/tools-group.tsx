import { ChevronDown, ChevronRight } from "lucide-react";
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
  return (
    <SidebarGroup className="space-y-3">
      <SidebarGroupLabel
        className="cursor-pointer hover:bg-accent rounded-lg px-3 py-2.5 flex items-center justify-between text-sm font-semibold transition-colors"
        onClick={() => setIsDrawingToolsOpen(!isDrawingToolsOpen)}
      >
        Drawing Tools
        {isDrawingToolsOpen ? (
          <ChevronDown size={16} />
        ) : (
          <ChevronRight size={16} />
        )}
      </SidebarGroupLabel>

      {isDrawingToolsOpen && (
        <SidebarGroupContent>
          <SidebarMenu className="space-y-2">
            <SidebarMenuItem key="point">
              <SidebarMenuButton
                isActive={drawingMode === "point"}
                asChild
                onClick={() => setDrawingMode("point")}
                className="h-10 px-3 rounded-lg font-medium"
              >
                <p>Point</p>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem key="line">
              <SidebarMenuButton
                isActive={drawingMode === "line"}
                asChild
                onClick={() => setDrawingMode("line")}
                className="h-10 px-3 rounded-lg font-medium"
              >
                <p>Line</p>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem key="polygon">
              <SidebarMenuButton
                isActive={drawingMode === "polygon"}
                asChild
                onClick={() => setDrawingMode("polygon")}
                className="h-10 px-3 rounded-lg font-medium"
              >
                <p>Polygon</p>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem key="azimuthal">
              <SidebarMenuButton
                isActive={drawingMode === "azimuthal"}
                asChild
                onClick={() => setDrawingMode("azimuthal")}
                className="h-10 px-3 rounded-lg font-medium"
              >
                <p>Azimuthal</p>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* Exit Drawing Mode Button - only show when a drawing mode is active */}
            {drawingMode && (
              <SidebarMenuItem key="exit-drawing">
                <SidebarMenuButton
                  asChild
                  onClick={() => setDrawingMode(null)}
                  className="h-10 px-3 rounded-lg font-medium bg-red-100 text-red-700 hover:bg-red-200 border border-red-300"
                >
                  <p>Exit Drawing Mode</p>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
};

export default ToolsGroup;
