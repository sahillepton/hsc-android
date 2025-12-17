import {
  CircleDot,
  Compass,
  ZoomOut,
  Pentagon,
  ZoomIn,
  Waypoints,
  LayersIcon,
  WifiPen,
  WifiOff,
  Ruler,
  Network,
  FileUp,
  FileDown,
  Save,
  RotateCcw,
  Home,
  MapPin,
} from "lucide-react";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { useDrawingMode } from "@/store/layers-store";
import type { DrawingMode } from "@/lib/definitions";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";

type CameraPopoverProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  pitch: number;
  setPitch: (pitch: number) => void;
  onCreatePoint: (point: [number, number]) => void;
};

type AlertButtonProps = {
  visible: boolean;
  severity: "error" | "warning";
  title: string;
  onClick: () => void;
};

type IgrsToggleProps = {
  value: boolean;
  onToggle: (checked: boolean) => void;
};

const ZoomControls = ({
  mapRef,
  zoom,
  onToggleLayersBox,
  onOpenConnectionConfig,
  onToggleMeasurementBox,
  onToggleNetworkBox,
  onUpload,
  onExportLayers,
  onSaveSession,
  onRestoreSession,
  onToggleUserLocation,
  onResetHome,
  showUserLocation,
  isLayersBoxOpen,
  isMeasurementBoxOpen,
  isNetworkBoxOpen,
  alertButtonProps,
  igrsToggleProps,
}: {
  mapRef: React.RefObject<any>;
  zoom: number;
  onToggleLayersBox?: () => void;
  onOpenConnectionConfig?: () => void;
  onToggleMeasurementBox?: () => void;
  onToggleNetworkBox?: () => void;
  onUpload?: () => void;
  onExportLayers?: () => void;
  onSaveSession?: () => void;
  onRestoreSession?: () => void;
  onToggleUserLocation?: () => void;
  onResetHome?: () => void;
  showUserLocation?: boolean;
  isLayersBoxOpen?: boolean;
  isMeasurementBoxOpen?: boolean;
  isNetworkBoxOpen?: boolean;
  cameraPopoverProps?: CameraPopoverProps;
  alertButtonProps?: AlertButtonProps;
  igrsToggleProps?: IgrsToggleProps;
}) => {
  const { drawingMode, setDrawingMode } = useDrawingMode();
  const [isSaving, setIsSaving] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const autoSaveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const onSaveSessionRef = useRef(onSaveSession);

  // Keep ref in sync
  useEffect(() => {
    onSaveSessionRef.current = onSaveSession;
  }, [onSaveSession]);

  // Auto-save every 30 seconds (only when enabled)
  // Uses the new session save mechanism
  useEffect(() => {
    // Clear any existing interval
    if (autoSaveIntervalRef.current) {
      clearInterval(autoSaveIntervalRef.current);
      autoSaveIntervalRef.current = null;
    }

    // Only schedule auto-save if enabled and callback exists
    if (!autoSaveEnabled || !onSaveSession) {
      return;
    }

    // Use setInterval for more reliable timing on tablets
    autoSaveIntervalRef.current = setInterval(async () => {
      // Check if still enabled before saving
      if (onSaveSessionRef.current) {
        setIsSaving(true);
        try {
          await onSaveSessionRef.current();
        } catch (error) {
          console.error("Auto-save error:", error);
        } finally {
          setIsSaving(false);
        }
      }
    }, 60000); // 30 seconds

    // Cleanup on unmount or when disabled
    return () => {
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current);
        autoSaveIntervalRef.current = null;
      }
    };
  }, [autoSaveEnabled, onSaveSession]);

  const handleZoomIn = () => {
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      const currentZoom = map.getZoom();
      map.easeTo({ zoom: currentZoom + 1, duration: 300 });
    }
  };

  const handleZoomOut = () => {
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      const currentZoom = map.getZoom();
      map.easeTo({ zoom: currentZoom - 1, duration: 300 });
    }
  };

  const toggleMode = (mode: DrawingMode) => {
    setDrawingMode(drawingMode === mode ? null : mode);
  };

  const toolConfigs: Array<{
    key: DrawingMode;
    label: string;
    icon: React.ReactNode;
  }> = [
    { key: "point", label: "Point", icon: <CircleDot className="h-4 w-4" /> },
    {
      key: "polyline",
      label: "Path",
      icon: <Waypoints className="h-4 w-4" />,
    },
    {
      key: "polygon",
      label: "Polygon",
      icon: <Pentagon className="h-4 w-4" />,
    },
    {
      key: "azimuthal",
      label: "Azimuth",
      icon: <Compass className="h-4 w-4" />,
    },
  ];

  return (
    <div className="absolute bottom-1 right-2 z-50 pointer-events-none">
      <div className="relative pointer-events-auto flex flex-row gap-2">
        {alertButtonProps?.visible && (
          <Button
            size="icon"
            variant="ghost"
            className={cn(
              "h-11 w-11 rounded-sm bg-white shadow-2xl border border-black/10 backdrop-blur-sm"
            )}
            title={alertButtonProps.title}
            // onClick={alertButtonProps.onClick}
          >
            <WifiOff className="h-4 w-4" />
          </Button>
        )}
        <div className="flex items-center p-0.5 gap-0 rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm">
          {onUpload && (
            <div className="flex items-center gap-0">
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10 text-slate-800 hover:text-foreground rounded-none"
                title="Upload File"
                onClick={onUpload}
              >
                <FileUp className="h-4 w-4" />
              </Button>
            </div>
          )}
          {onSaveSession && (
            <Button
              size="icon"
              variant="ghost"
              className="h-10 w-10 text-slate-800 hover:text-foreground rounded-none"
              title="Save Session"
              onClick={async () => {
                setIsSaving(true);
                try {
                  await onSaveSession();
                } finally {
                  setIsSaving(false);
                }
              }}
            >
              {isSaving ? (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 80 80"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <style>
                    {`.loader-bg{fill:none;stroke:#e5e7eb;stroke-width:4}.loader-ring{fill:none;stroke:#4f46e5;stroke-width:4;stroke-linecap:round;stroke-dasharray:60 188;transform-origin:50% 50%;animation:spin 1.1s linear infinite}.offline-icon{stroke:#374151;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}.offline-x{stroke:#ef4444;stroke-width:2;stroke-linecap:round}.offline-text{font-size:8px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#4b5563}@keyframes spin{0%{stroke-dashoffset:0;transform:rotate(0deg)}100%{stroke-dashoffset:-248;transform:rotate(360deg)}}`}
                  </style>
                  <circle className="loader-bg" cx="40" cy="40" r="26" />
                  <circle className="loader-ring" cx="40" cy="40" r="26" />
                </svg>
              ) : (
                <Save className="h-4 w-4" />
              )}
            </Button>
          )}
          {onRestoreSession && (
            <Button
              size="icon"
              variant="ghost"
              className="h-10 w-10 text-slate-800 hover:text-foreground rounded-none"
              title="Restore Session"
              onClick={onRestoreSession}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
          {onExportLayers && (
            <div className="flex items-center gap-0 p-0">
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10 text-slate-800 hover:text-foreground rounded-none"
                title="Export Layers"
                onClick={onExportLayers}
              >
                <FileDown className="h-4 w-4" />
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2 px-2 border-l border-slate-200">
            <span className="text-[10px] font-semibold text-slate-800 uppercase">
              Auto Save
            </span>
            <Switch
              checked={autoSaveEnabled}
              onCheckedChange={setAutoSaveEnabled}
              aria-label="Toggle Auto Save"
            />
          </div>
        </div>
        <div className="flex items-center p-0.5 gap-0 rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm">
          {onToggleLayersBox && (
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                "h-10 w-10 text-slate-800 hover:text-foreground rounded-none",
                isLayersBoxOpen &&
                  "bg-blue-600/20 hover:bg-blue-600/20 rounded-sm"
              )}
              title="Layers Panel"
              onClick={onToggleLayersBox}
            >
              <LayersIcon className="h-4 w-4" />
            </Button>
          )}

          {onToggleMeasurementBox && (
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                "h-10 w-10 text-slate-800 hover:text-foreground rounded-none",
                isMeasurementBoxOpen &&
                  "bg-blue-600/20 hover:bg-blue-600/20 rounded-sm"
              )}
              title="Measurement Box"
              onClick={onToggleMeasurementBox}
            >
              <Ruler className="h-4 w-4" />
            </Button>
          )}

          {onToggleNetworkBox && (
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                "h-10 w-10 text-slate-800 hover:text-foreground rounded-none",
                isNetworkBoxOpen &&
                  "bg-blue-600/20 hover:bg-blue-600/20 rounded-sm"
              )}
              title="Network Layers"
              onClick={onToggleNetworkBox}
            >
              <Network className="h-4 w-4" />
            </Button>
          )}

          {onResetHome && (
            <div>
              <Button
                size="icon"
                variant="ghost"
                onClick={onResetHome}
                className="h-10 w-10 hover:bg-white cursor-pointer"
                title="Reset to Home View"
              >
                <Home className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* {cameraPopoverProps && (
            <Popover
              open={cameraPopoverProps.isOpen}
              onOpenChange={cameraPopoverProps.onOpenChange}
            >
              <PopoverTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-10 w-10 text-slate-800 hover:text-foreground  rounded-none"
                  title="Camera Controls"
                >
                  <CameraIcon className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[240px] p-3"
                align="end"
                side="top"
                sideOffset={10}
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                <TiltControl
                  mapRef={mapRef}
                  pitch={cameraPopoverProps.pitch}
                  setPitch={cameraPopoverProps.setPitch}
                  onCreatePoint={cameraPopoverProps.onCreatePoint}
                />
              </PopoverContent>
            </Popover>
          )} */}

          {onOpenConnectionConfig && (
            <Button
              size="icon"
              variant="ghost"
              className="h-10 w-10 text-slate-800 hover:text-foreground  rounded-none"
              title="Connection Settings"
              onClick={onOpenConnectionConfig}
            >
              <WifiPen className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-0 rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm">
          <div className="flex items-center p-0.5 ">
            {onToggleUserLocation && (
              <div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={onToggleUserLocation}
                  className={cn(
                    "h-10 w-10  hover:bg-white cursor-pointer mr-1",
                    showUserLocation &&
                      "bg-blue-600/20 hover:bg-blue-600/20 rounded-sm"
                  )}
                  title={
                    showUserLocation
                      ? "Hide Your Location"
                      : "Show Your Location"
                  }
                >
                  <MapPin className="h-4 w-4" />
                </Button>
              </div>
            )}
            {toolConfigs.map((tool, index) => {
              const isActive = drawingMode === tool.key;
              const isLast = index === toolConfigs.length - 1;
              return (
                <div
                  key={tool.key}
                  className={cn(
                    "flex flex-col items-center gap-1 text-[11px] font-semibold text-muted-foreground",
                    !isLast && " border-slate-200"
                  )}
                >
                  <Button
                    size="icon"
                    variant="ghost"
                    className={cn(
                      "h-10 w-10 p-0 rounded-none hover:text-foreground  bg-transparent cursor-pointer",
                      isActive
                        ? "text-zinc-950 bg-blue-600/20 hover:bg-blue-600/20 rounded-sm font-bold"
                        : "bg-white text-foreground hover:bg-white"
                    )}
                    title={
                      isActive
                        ? `Stop ${tool.label} sketch`
                        : `Start ${tool.label} sketch`
                    }
                    onClick={() => toggleMode(tool.key)}
                  >
                    {tool.icon}
                  </Button>
                </div>
              );
            })}
          </div>

          {igrsToggleProps && (
            <div className="flex items-center gap-2 px-3 border-l border-slate-200">
              <span className="text-[10px] font-semibold text-slate-800 uppercase">
                IGRS
              </span>
              <Switch
                checked={igrsToggleProps.value}
                onCheckedChange={igrsToggleProps.onToggle}
                aria-label="Toggle IGRS coordinates"
              />
            </div>
          )}
        </div>
        <div className="absolute -top-31 right-0.5 flex flex-col items-center gap-2 rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm px-0.5 py-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={handleZoomIn}
            className="h-10 w-10 hover:bg-transparent cursor-pointer"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <div className="min-w-[36px] text-center text-xs font-semibold text-slate-800">
            {zoom.toFixed(1)}
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleZoomOut}
            className="h-9 w-9 hover:bg-transparent cursor-pointer"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ZoomControls;
