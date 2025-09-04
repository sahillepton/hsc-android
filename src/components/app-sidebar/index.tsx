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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LayerProps } from "../map";
import { Input } from "../ui/input";
import { hexToRgb, rgbToHex } from "@/lib/utils";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Button } from "../ui/button";

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
                  <SidebarMenuItem
                    key={layer.id}
                    className="flex items-center justify-between p-1"
                  >
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuButton className="flex-1 justify-start">
                        <span>{layer.name}</span>
                      </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <Button
                      variant={"ghost"}
                      size={"icon"}
                      className="h-6 w-6 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setLayers(
                          layers.map((l) =>
                            l.id === layer.id
                              ? {
                                  ...l,
                                  visible: l.visible !== false ? false : true,
                                }
                              : l
                          )
                        );
                      }}
                    >
                      {layer.visible !== false ? (
                        <EyeIcon size={12} />
                      ) : (
                        <EyeOffIcon size={12} />
                      )}
                    </Button>
                  </SidebarMenuItem>
                  <DropdownMenuContent className="w-64" align="start">
                    <DropdownMenuLabel>
                      <Input
                        defaultValue={layer.name}
                        className="border-none p-0 h-auto font-medium text-sm focus-visible:ring-0"
                        onBlur={(e) => {
                          const newName = e.target.value.trim();
                          if (newName && newName !== layer.name) {
                            setLayers(
                              layers.map((l) =>
                                l.id === layer.id ? { ...l, name: newName } : l
                              )
                            );
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                      />
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />

                    <Input
                      type="color"
                      value={rgbToHex(layer.color)}
                      className="w-full h-8"
                      onChange={(e) => {
                        const color = hexToRgb(e.target.value);
                        if (color) {
                          setLayers(
                            layers.map((l) =>
                              l.id === layer.id ? { ...l, color } : l
                            )
                          );
                        }
                      }}
                    />

                    <DropdownMenuSeparator />
                    {layer.type === "point" && (
                      <Input
                        type="range"
                        value={layer.radius}
                        min={100}
                        max={100000}
                        step={1000}
                        onChange={(e) => {
                          setLayers(
                            layers.map((l) =>
                              l.id === layer.id
                                ? { ...l, radius: parseInt(e.target.value) }
                                : l
                            )
                          );
                        }}
                      />
                    )}
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
