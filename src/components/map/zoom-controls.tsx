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
  Plus,
  Download,
  Save,
  RotateCcw,
  Home,
  MapPin,
  FolderOpen,
  Crop,
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
  bearing = 0,
  onToggleLayersBox,
  onOpenConnectionConfig,
  onOpenTileFolder,
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
  isProcessingFiles = false,
  alertButtonProps,
  igrsToggleProps,
  rubberBandMode,
  onToggleRubberBand,
}: {
  mapRef: React.RefObject<any>;
  zoom: number;
  bearing?: number;
  onToggleLayersBox?: () => void;
  onOpenConnectionConfig?: () => void;
  onOpenTileFolder?: () => void;
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
  isProcessingFiles?: boolean;
  cameraPopoverProps?: CameraPopoverProps;
  alertButtonProps?: AlertButtonProps;
  igrsToggleProps?: IgrsToggleProps;
  rubberBandMode?: boolean;
  onToggleRubberBand?: () => void;
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

  const handleResetToNorth = () => {
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      map.easeTo({ bearing: 0, duration: 300 });
    }
  };

  const toggleMode = (mode: DrawingMode) => {
    // If enabling a drawing mode, disable rubber band mode if active
    if (drawingMode !== mode && rubberBandMode && onToggleRubberBand) {
      onToggleRubberBand();
    }
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
                title={
                  isProcessingFiles ? "Processing files..." : "Upload File"
                }
                onClick={onUpload}
                disabled={isProcessingFiles}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
          {onExportLayers && (
            <div className="flex items-center gap-0 p-0">
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10 text-slate-800 hover:text-foreground rounded-none"
                title={
                  isProcessingFiles ? "Processing files..." : "Export Layers"
                }
                onClick={onExportLayers}
                disabled={isProcessingFiles}
              >
                <Download className="h-4 w-4" />
              </Button>
            </div>
          )}
          {onRestoreSession && (
            <Button
              size="icon"
              variant="ghost"
              className="h-10 w-10 text-slate-800 hover:text-foreground rounded-none"
              title={
                isProcessingFiles ? "Processing files..." : "Restore Session"
              }
              onClick={onRestoreSession}
              disabled={isProcessingFiles}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
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
            {onToggleRubberBand && (
              <div className="flex flex-col items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                <Button
                  size="icon"
                  variant="ghost"
                  className={cn(
                    "h-10 w-10 p-0 rounded-none hover:text-foreground bg-transparent cursor-pointer",
                    rubberBandMode
                      ? "text-zinc-950 bg-blue-600/20 hover:bg-blue-600/20 rounded-sm font-bold"
                      : "bg-white text-foreground hover:bg-white"
                  )}
                  title={
                    rubberBandMode
                      ? "Stop Rubber Band Zoom"
                      : "Start Rubber Band Zoom"
                  }
                  onClick={() => {
                    // If enabling rubber band mode, disable any active drawing mode
                    if (!rubberBandMode && drawingMode) {
                      setDrawingMode(null);
                    }
                    onToggleRubberBand();
                  }}
                >
                  <Crop className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0 rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm">
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
          {onOpenTileFolder && (
            <Button
              size="icon"
              variant="ghost"
              className="h-10 w-10 text-slate-800 hover:text-foreground rounded-none"
              title="Select Offline Tiles Folder"
              onClick={onOpenTileFolder}
            >
              <FolderOpen className="h-4 w-4" />
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
        <div className="absolute -top-45 right-0.5 rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm">
          <div
            style={{ zoom: 0.4 }}
            className="cursor-pointer px-4.5 pt-5 pb-5"
            onClick={handleResetToNorth}
          >
            <div
              className="relative w-20 h-20 flex items-center justify-center"
              title={`Bearing: ${bearing.toFixed(0)}°`}
            >
              {/* Compass background circle */}
              <svg
                width="80"
                height="80"
                viewBox="0 0 80 80"
                className="absolute inset-0 overflow-visible"
              >
                <circle
                  cx="42"
                  cy="42"
                  r="28"
                  fill="none"
                  stroke="#e5e7eb"
                  strokeWidth="3"
                />

                {/* Direction labels on outer boundary (fixed, don't rotate) */}
                {/* Cardinal directions */}
                <text
                  x="40"
                  y="6"
                  fontSize="22"
                  fill="#ef4444"
                  textAnchor="middle"
                  fontWeight="bold"
                >
                  N
                </text>
                <text
                  x="42"
                  y="92"
                  fontSize="22"
                  fill="#6b7280"
                  textAnchor="middle"
                  fontWeight="bold"
                >
                  S
                </text>
                <text
                  x="82"
                  y="48"
                  fontSize="22"
                  fill="#6b7280"
                  textAnchor="middle"
                  fontWeight="bold"
                >
                  E
                </text>
                <text
                  x="-2"
                  y="48"
                  fontSize="22"
                  fill="#6b7280"
                  textAnchor="middle"
                  fontWeight="bold"
                >
                  W
                </text>

                {/* Compass needle - red kite/diamond shape pointing north (rotates with bearing) */}
                <g transform={`rotate(${-bearing} 42 42)`}>
                  {/* North-pointing red diamond/kite - larger and more prominent */}
                  <path
                    d="M 42 8 L 50 32 L 42 26 L 34 32 Z"
                    fill="#ef4444"
                    stroke="#dc2626"
                    strokeWidth="1"
                  />
                  {/* Center pivot point */}
                  <circle cx="42" cy="42" r="3" fill="#1f2937" />
                </g>
              </svg>
            </div>
          </div>
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
