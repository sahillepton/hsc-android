// @ts-nocheck
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "../ui/input";
import { getDistance, getPolygonArea, hexToRgb, rgbToHex } from "@/lib/utils";
import {
  EyeIcon,
  EyeOffIcon,
  ChevronDown,
  ChevronRight,
  X,
  Phone,
  Video,
  MessageSquare,
} from "lucide-react";
import { Button } from "../ui/button";
import { useLayersContext } from "@/layers-provider";
import { useState, useEffect } from "react";

export function AppSidebar() {
  const {
    layers,
    handleLayerVisibility,
    toggleDrawingMode,
    drawingMode,
    handleLayerName,
    handleLayerColor,
    handleLayerRadius,
    handleLayerPointRadius,
    clearAllLayers,
    downloadAllLayers,
    deleteLayer,
    createNodeLayer,
    selectedNode,
    isNodeDialogOpen,
    handleVoiceCall,
    handleVideoCall,
    handleSendMessage,
    closeNodeDialog,
    networkLayersVisible,
    toggleNetworkLayersVisibility,
  } = useLayersContext();
  const [isDrawingToolsOpen, setIsDrawingToolsOpen] = useState(true);
  const [isLayersOpen, setIsLayersOpen] = useState(true);
  const [isNetworkControlsOpen, setIsNetworkControlsOpen] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  return (
    <div className="flex">
      <Sidebar variant="floating" collapsible={"offcanvas"} className="w-80">
        <SidebarContent className="px-4 py-6 space-y-6">
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
                      onClick={() => toggleDrawingMode("point")}
                      className="h-10 px-3 rounded-lg font-medium"
                    >
                      <p>Point</p>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem key="line">
                    <SidebarMenuButton
                      isActive={drawingMode === "line"}
                      asChild
                      onClick={() => toggleDrawingMode("line")}
                      className="h-10 px-3 rounded-lg font-medium"
                    >
                      <p>Line</p>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem key="polygon">
                    <SidebarMenuButton
                      isActive={drawingMode === "polygon"}
                      asChild
                      onClick={() => toggleDrawingMode("polygon")}
                      className="h-10 px-3 rounded-lg font-medium"
                    >
                      <p>Polygon</p>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  {/* Exit Drawing Mode Button - only show when a drawing mode is active */}
                  {drawingMode && (
                    <SidebarMenuItem key="exit-drawing">
                      <SidebarMenuButton
                        asChild
                        onClick={() => toggleDrawingMode(null)}
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

          {/* Network Controls Section */}
          <SidebarGroup className="space-y-3">
            <SidebarGroupLabel
              className="cursor-pointer hover:bg-accent rounded-lg px-3 py-2.5 flex items-center justify-between text-sm font-semibold transition-colors"
              onClick={() => setIsNetworkControlsOpen(!isNetworkControlsOpen)}
            >
              Network Controls
              {isNetworkControlsOpen ? (
                <ChevronDown size={16} />
              ) : (
                <ChevronRight size={16} />
              )}
            </SidebarGroupLabel>

            {isNetworkControlsOpen && (
              <SidebarGroupContent>
                <SidebarMenu className="space-y-2">
                  <SidebarMenuItem>
                    <div className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-accent">
                      <span className="text-sm font-medium">
                        Show Network Layers
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleNetworkLayersVisibility}
                        className={`h-8 w-14 px-1 ${
                          networkLayersVisible
                            ? "bg-blue-500 hover:bg-blue-600 text-white"
                            : "bg-gray-200 hover:bg-gray-300 text-gray-600"
                        }`}
                        style={{
                          borderRadius: "12px",
                          position: "relative",
                          transition: "all 0.2s ease-in-out",
                        }}
                      >
                        <div
                          className="w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-200 ease-in-out"
                          style={{
                            transform: networkLayersVisible
                              ? "translateX(24px)"
                              : "translateX(0)",
                            position: "absolute",
                            left: "2px",
                            top: "2px",
                          }}
                        />
                      </Button>
                    </div>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>

          <SidebarGroup className="space-y-3">
            <SidebarGroupLabel
              className="cursor-pointer hover:bg-accent rounded-lg px-3 py-2.5 flex items-center justify-between text-sm font-semibold transition-colors"
              onClick={() => setIsLayersOpen(!isLayersOpen)}
            >
              Layers
              {isLayersOpen ? (
                <ChevronDown size={16} />
              ) : (
                <ChevronRight size={16} />
              )}
            </SidebarGroupLabel>
            {isLayersOpen && (
              <SidebarGroupContent>
                <SidebarMenu className="space-y-2">
                  {layers.map((layer) => {
                    console.log("Rendering layer:", layer.id, layer.name);
                    return (
                      <DropdownMenu>
                        <SidebarMenuItem
                          key={layer.id}
                          className="flex items-center justify-between p-0 rounded-lg border border-border/50 hover:border-border transition-colors"
                        >
                          <DropdownMenuTrigger asChild>
                            <SidebarMenuButton className="flex justify-between flex-1 h-12 px-3 rounded-lg">
                              <div className="flex flex-col items-start">
                                <span className="font-medium text-sm truncate">
                                  {layer.name}
                                </span>
                                {layer.type === "polygon" && layer.polygon ? (
                                  <span className="text-xs text-muted-foreground">
                                    {getPolygonArea(layer.polygon)} km²
                                  </span>
                                ) : layer.type === "line" &&
                                  layer.path &&
                                  layer.path.length >= 2 ? (
                                  <span className="text-xs text-muted-foreground">
                                    {getDistance(
                                      layer.path[0],
                                      layer.path[layer.path.length - 1]
                                    )}{" "}
                                    km
                                  </span>
                                ) : null}
                              </div>
                            </SidebarMenuButton>
                          </DropdownMenuTrigger>
                          <div className="flex gap-1 px-2">
                            <Button
                              variant={"ghost"}
                              size={"icon"}
                              className="h-8 w-8 shrink-0 hover:bg-accent"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                handleLayerVisibility(
                                  layer.id,
                                  layer.visible !== false ? false : true
                                );
                              }}
                            >
                              {layer.visible !== false ? (
                                <EyeIcon size={14} />
                              ) : (
                                <EyeOffIcon size={14} />
                              )}
                            </Button>
                            <Button
                              variant={"ghost"}
                              size={"icon"}
                              className="h-8 w-8 shrink-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                if (
                                  confirm(
                                    `Are you sure you want to delete "${layer.name}"?`
                                  )
                                ) {
                                  deleteLayer(layer.id);
                                }
                              }}
                            >
                              <X size={14} />
                            </Button>
                          </div>
                        </SidebarMenuItem>
                        <DropdownMenuContent className="w-72" align="start">
                          <DropdownMenuLabel className="px-3 py-2">
                            <Input
                              defaultValue={layer.name}
                              className="border-none p-0 h-auto font-medium text-sm focus-visible:ring-0"
                              onBlur={(e) => {
                                const newName = e.target.value.trim();
                                if (newName && newName !== layer.name) {
                                  handleLayerName(layer.id, newName);
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

                          <div className="p-3">
                            <label className="text-xs font-medium text-muted-foreground mb-2 block">
                              Color
                            </label>
                            <Input
                              type="color"
                              value={rgbToHex(layer.color)}
                              className="w-full h-10 rounded-lg"
                              onChange={(e) => {
                                const color = hexToRgb(e.target.value);
                                if (color) {
                                  handleLayerColor(layer.id, color);
                                }
                              }}
                            />
                          </div>

                          <DropdownMenuSeparator />
                          {layer.type === "point" && (
                            <div className="p-3 space-y-3">
                              <label className="text-xs font-medium text-muted-foreground block">
                                Point Radius
                              </label>
                              <div className="space-y-2">
                                <Input
                                  type="range"
                                  value={layer.radius || 50000}
                                  min={100}
                                  max={100000}
                                  step={1000}
                                  className="w-full"
                                  onChange={(e) => {
                                    handleLayerRadius(
                                      layer.id,
                                      parseInt(e.target.value)
                                    );
                                  }}
                                />
                                <div className="flex justify-between text-xs text-muted-foreground">
                                  <span>100</span>
                                  <span className="font-medium">
                                    {layer.radius || 50000}
                                  </span>
                                  <span>100k</span>
                                </div>
                              </div>
                            </div>
                          )}
                          {layer.type === "geojson" && (
                            <div className="p-3 space-y-3">
                              <label className="text-xs font-medium text-muted-foreground block">
                                Point Radius (for point features)
                              </label>
                              <div className="space-y-2">
                                <Input
                                  type="range"
                                  value={layer.pointRadius || 50000}
                                  min={100}
                                  max={100000}
                                  step={1000}
                                  className="w-full"
                                  onChange={(e) => {
                                    handleLayerPointRadius(
                                      layer.id,
                                      parseInt(e.target.value)
                                    );
                                  }}
                                />
                                <div className="flex justify-between text-xs text-muted-foreground">
                                  <span>100</span>
                                  <span className="font-medium">
                                    {layer.pointRadius || 50000}
                                  </span>
                                  <span>100k</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>

          <SidebarGroup className="space-y-3">
            <SidebarGroupLabel className="px-3 py-2 text-sm font-semibold">
              Layer Management
            </SidebarGroupLabel>
            <SidebarGroupContent className="space-y-4">
              <Button
                onClick={async () => {
                  try {
                    await downloadAllLayers();
                  } catch (error) {
                    console.error("Failed to download layers:", error);
                  }
                }}
                disabled={layers.length === 0}
                className="w-full h-10 font-medium"
                variant="default"
              >
                📥 Download All Layers
              </Button>

              <Button
                onClick={() => {
                  if (
                    confirm(
                      "Are you sure you want to clear all layers? This cannot be undone."
                    )
                  ) {
                    clearAllLayers();
                  }
                }}
                disabled={layers.length === 0}
                className="w-full h-10 font-medium"
                variant="destructive"
              >
                Clear All Layers
              </Button>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="px-4 py-4" />
      </Sidebar>

      {/* Node Action Dialog */}
      <Dialog open={isNodeDialogOpen} onOpenChange={closeNodeDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="pb-4">
            <DialogTitle className="flex items-center gap-3 text-lg">
              <div className="w-4 h-4 bg-blue-500 rounded-full"></div>
              Node {selectedNode?.userId}
            </DialogTitle>
          </DialogHeader>

          {selectedNode && (
            <div className="space-y-6">
              {/* Node Information */}
              <div className="grid grid-cols-2 gap-6 text-sm">
                <div className="space-y-1">
                  <span className="font-medium text-gray-600">SNR:</span>
                  <p className="font-mono text-base">{selectedNode.snr} dB</p>
                </div>
                <div className="space-y-1">
                  <span className="font-medium text-gray-600">RSSI:</span>
                  <p className="font-mono text-base">{selectedNode.rssi} dBm</p>
                </div>
                <div className="space-y-1">
                  <span className="font-medium text-gray-600">Distance:</span>
                  <p className="font-mono text-base">
                    {selectedNode.distance?.toFixed(2)} m
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="font-medium text-gray-600">Hop Count:</span>
                  <p className="font-mono text-base">{selectedNode.hopCount}</p>
                </div>
              </div>

              {/* Location */}
              <div className="border-t pt-6 space-y-2">
                <span className="font-medium text-gray-600 text-sm">
                  Location:
                </span>
                <p className="font-mono text-sm text-gray-800 bg-gray-50 p-3 rounded-lg">
                  {selectedNode.latitude.toFixed(6)},{" "}
                  {selectedNode.longitude.toFixed(6)}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <Button
                  onClick={() => {
                    handleVoiceCall(selectedNode);
                    closeNodeDialog();
                  }}
                  className="flex-1 bg-green-500 hover:bg-green-600 h-11"
                  size="default"
                >
                  <Phone size={18} className="mr-2" />
                  Voice Call
                </Button>

                <Button
                  onClick={() => {
                    handleVideoCall(selectedNode);
                    closeNodeDialog();
                  }}
                  className="flex-1 bg-blue-500 hover:bg-blue-600 h-11"
                  size="default"
                >
                  <Video size={18} className="mr-2" />
                  Video Call
                </Button>

                <Button
                  onClick={() => {
                    handleSendMessage(selectedNode);
                    closeNodeDialog();
                  }}
                  className="flex-1 bg-purple-500 hover:bg-purple-600 h-11"
                  size="default"
                >
                  <MessageSquare size={18} className="mr-2" />
                  Message
                </Button>
              </div>

              {/* Connected Nodes (if any) */}
              {selectedNode.connectedNodeIds &&
                selectedNode.connectedNodeIds.length > 0 && (
                  <div className="border-t pt-6 space-y-2">
                    <span className="font-medium text-gray-600 text-sm">
                      Connected Nodes:
                    </span>
                    <p className="font-mono text-sm text-gray-800 bg-gray-50 p-3 rounded-lg">
                      {selectedNode.connectedNodeIds.join(", ")}
                    </p>
                  </div>
                )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
