import { ChevronDown, ChevronRight } from "lucide-react";
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
            {drawingMode === "azimuthal" && (
              <div className="px-3 pb-3 space-y-2">
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
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">degrees</span>
                </div>
              </div>
            )}

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
