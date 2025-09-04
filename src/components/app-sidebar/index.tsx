import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LayerProps } from "../map";
import { Input } from "../ui/input";
import { hexToRgb, rgbToHex } from "@/lib/utils";

export function AppSidebar({
  layers,
  setLayers,
  setDrawingMode,
  drawingMode,
}: {
  layers: LayerProps[];
  setLayers: (layers: LayerProps[]) => void;
  setDrawingMode: (drawingMode: "point" | "polygon" | "line") => void;
  drawingMode: "point" | "polygon" | "line";
}) {
  return (
    <Sidebar variant="floating">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Drawing Tools</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem key="point">
                <SidebarMenuButton
                  isActive={drawingMode === "point"}
                  asChild
                  onClick={() => setDrawingMode("point")}
                >
                  <p>Point</p>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem key="line">
                <SidebarMenuButton
                  isActive={drawingMode === "line"}
                  asChild
                  onClick={() => setDrawingMode("line")}
                >
                  <p>Line</p>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem key="polygon">
                <SidebarMenuButton
                  isActive={drawingMode === "polygon"}
                  asChild
                  onClick={() => setDrawingMode("polygon")}
                >
                  <p>Polygon</p>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Layers</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {layers.map((layer) => (
                <DropdownMenu>
                  <DropdownMenuTrigger>
                    <SidebarMenuItem key={layer.id}>
                      <SidebarMenuButton>{layer.name}</SidebarMenuButton>
                    </SidebarMenuItem>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-64" align="start">
                    <DropdownMenuLabel>{layer.name}</DropdownMenuLabel>
                    <DropdownMenuSeparator />

                    <Input
                      type="color"
                      value={rgbToHex(layer.color)}
                      onChange={(e) => {
                        const color = hexToRgb(e.target.value);
                        console.log(color);
                        if (color) {
                          setLayers(
                            layers.map((l) =>
                              l.id === layer.id ? { ...l, color } : l
                            )
                          );
                        }
                      }}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter />
    </Sidebar>
  );
}
