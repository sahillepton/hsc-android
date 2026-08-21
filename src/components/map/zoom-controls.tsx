import {
  CircleDot,
  Compass,
  ZoomOut,
  Pentagon,
  ZoomIn,
  Waypoints,
  LayersIcon,
  WifiOff,
  Ruler,
  Network,
  Plus,
  Download,
  Save,
  RotateCcw,
  Home,
  MapPin,
  Crop,
  Camera,
  Route,
  Trash,
} from "lucide-react";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { useDrawingMode } from "@/store/layers-store";
import type { DrawingMode } from "@/lib/definitions";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

const LONG_PRESS_DELAY = 500;

const LongPressHint = ({
  hint,
  children,
}: {
  hint: string;
  children: React.ReactNode;
}) => {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  const startTimer = useCallback(() => {
    clear();
    timerRef.current = setTimeout(() => setVisible(true), LONG_PRESS_DELAY);
  }, [clear]);

  useEffect(() => clear, [clear]);

  return (
    <div
      ref={containerRef}
      className="relative"
      onTouchStart={startTimer}
      onTouchEnd={clear}
      onTouchMove={clear}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
      {visible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded-md bg-gray-900 text-white text-[11px] font-medium whitespace-nowrap shadow-lg z-[100] pointer-events-none animate-in fade-in zoom-in-95 duration-150">
          {hint}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-gray-900" />
        </div>
      )}
    </div>
  );
};

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
  onToggleMeasurementBox,
  onToggleNetworkBox,
  onUpload,
  onExportLayers,
  onSaveSession,
  onFlushSession,
  onRestoreSession,
  onToggleUserLocation,
  onResetHome,
  onZoomIn,
  onZoomOut,
  onCaptureScreenshot,
  showUserLocation,
  isLayersBoxOpen,
  isMeasurementBoxOpen,
  isNetworkBoxOpen,
  isProcessingFiles = false,
  isExporting = false,
  alertButtonProps,
  igrsToggleProps,
  rubberBandMode,
  onToggleRubberBand,
  isRoutePanelOpen,
  onToggleRoutePanel,
  onCloseRoutePanel,
}: {
  mapRef: React.RefObject<any>;
  zoom: number;
  bearing?: number;
  onToggleLayersBox?: () => void;
  onToggleMeasurementBox?: () => void;
  onToggleNetworkBox?: () => void;
  onUpload?: () => void;
  onExportLayers?: () => void;
  onSaveSession?: () => void;
  onFlushSession?: () => void;
  onRestoreSession?: () => void;
  onToggleUserLocation?: () => void;
  onResetHome?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onCaptureScreenshot?: () => void;
  showUserLocation?: boolean;
  isLayersBoxOpen?: boolean;
  isMeasurementBoxOpen?: boolean;
  isNetworkBoxOpen?: boolean;
  isProcessingFiles?: boolean;
  isExporting?: boolean;
  cameraPopoverProps?: CameraPopoverProps;
  alertButtonProps?: AlertButtonProps;
  igrsToggleProps?: IgrsToggleProps;
  rubberBandMode?: boolean;
  onToggleRubberBand?: () => void;
  isRoutePanelOpen?: boolean;
  onToggleRoutePanel?: () => void;
  onCloseRoutePanel?: () => void;
}) => {
  const { drawingMode, setDrawingMode } = useDrawingMode();
  const [isSaving, setIsSaving] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);
  const [flushConfirmOpen, setFlushConfirmOpen] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const autoSaveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const onSaveSessionRef = useRef(onSaveSession);
  // Read by the auto-save interval, which must NOT be torn down and rebuilt every
  // time the upload flag flips — a ref lets the running timer see the current value
  // without restarting (and restarting would re-fire the immediate save below).
  const isProcessingFilesRef = useRef(isProcessingFiles);

  // Keep ref in sync
  useEffect(() => {
    onSaveSessionRef.current = onSaveSession;
  }, [onSaveSession]);

  useEffect(() => {
    isProcessingFilesRef.current = isProcessingFiles;
  }, [isProcessingFiles]);

  // Auto-save every 30 seconds (only when enabled)
  // Uses the new session save mechanism
  useEffect(() => {
    // Clear any existing interval
    if (autoSaveIntervalRef.current) {
      clearInterval(autoSaveIntervalRef.current);
      autoSaveIntervalRef.current = null;
    }

    // Only schedule auto-save if enabled and callback exists
    if (!autoSaveEnabled || !onSaveSessionRef.current) {
      return;
    }

    // Immediate save when auto-save is enabled, then start interval
    const performSave = async () => {
      // Skip this tick while files are still importing. Disabling the toggle only
      // stops a NEW auto-save being switched on — an interval already running keeps
      // firing every 30 s regardless, and would write a manifest describing a
      // half-imported session. Skipping rather than cancelling means auto-save
      // resumes by itself on the next tick once the upload finishes, with no need
      // to re-arm the timer.
      if (isProcessingFilesRef.current) return;
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
    };

    // Trigger immediate save
    performSave();

    // Then set up interval for subsequent saves (30 seconds)
    autoSaveIntervalRef.current = setInterval(performSave, 30000); // Fixed: 30 seconds

    // Cleanup on unmount or when disabled
    return () => {
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current);
        autoSaveIntervalRef.current = null;
      }
    };
  }, [autoSaveEnabled]);

  const handleZoomIn = () => {
    // Prefer the parent handler — it knows whether we're in geodetic (EPSG:4326)
    // mode and drives the OrthographicView; the mapbox easeTo below is inert there.
    if (onZoomIn) {
      onZoomIn();
      return;
    }
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      const currentZoom = map.getZoom();
      map.easeTo({ zoom: currentZoom + 1, duration: 300 });
    }
  };

  const handleZoomOut = () => {
    if (onZoomOut) {
      onZoomOut();
      return;
    }
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
    if (drawingMode !== mode && isRoutePanelOpen) {
      (onCloseRoutePanel ?? onToggleRoutePanel)?.();
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
          <LongPressHint hint={alertButtonProps.title}>
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                "h-11 w-11 rounded-sm bg-white shadow-2xl border border-black/10 backdrop-blur-sm",
              )}
              title={alertButtonProps.title}
              tabIndex={-1}
            >
              <WifiOff className="h-4 w-4" />
            </Button>
          </LongPressHint>
        )}
        <div className="flex items-center p-0.5 gap-0 rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm">
          {onUpload && (
            <LongPressHint hint="Upload File">
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10 text-slate-800 bg-white/80 hover:bg-white/80 rounded-none"
                title={
                  isExporting
                    ? "Exporting..."
                    : isProcessingFiles
                      ? "Processing files..."
                      : "Upload File"
                }
                onClick={onUpload}
                disabled={isProcessingFiles || isExporting}
                tabIndex={-1}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </LongPressHint>
          )}
          {onExportLayers && (
            <LongPressHint hint="Export Layers">
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10 text-slate-800 hover:text-foreground rounded-none"
                title={
                  isProcessingFiles ? "Processing files..." : "Export Layers"
                }
                onClick={onExportLayers}
                disabled={isProcessingFiles}
                tabIndex={-1}
              >
                <Download className="h-4 w-4" />
              </Button>
            </LongPressHint>
          )}
          {onRestoreSession && (
            <LongPressHint hint="Restore Session">
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10 text-slate-800 hover:text-foreground rounded-none"
                title={
                  isExporting
                    ? "Exporting..."
                    : isProcessingFiles
                      ? "Processing files..."
                      : "Restore Session"
                }
                onClick={onRestoreSession}
                disabled={isProcessingFiles || isExporting}
                tabIndex={-1}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </LongPressHint>
          )}
          {onSaveSession && (
            <LongPressHint hint="Save Session">
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10 text-slate-800 hover:text-foreground rounded-none"
                title={
                  isProcessingFiles
                    ? "Uploading files..."
                    : isExporting
                      ? "Exporting..."
                      : "Save Session"
                }
                onClick={async () => {
                  setIsSaving(true);
                  try {
                    await onSaveSession();
                  } finally {
                    setIsSaving(false);
                  }
                }}
                // Saving mid-upload writes a manifest describing a half-imported
                // session, so it is gated on the upload flag like the buttons
                // either side of it.
                disabled={isExporting || isProcessingFiles}
                tabIndex={-1}
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
            </LongPressHint>
          )}
          {onFlushSession && (
            <LongPressHint hint="Delete Session">
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10  hover:bg-red-50 rounded-none"
                title={
                  isProcessingFiles ? "Uploading files..." : "Delete Session"
                }
                onClick={() => setFlushConfirmOpen(true)}
                // Deleting the session while files are still being written is the
                // most destructive thing on this bar — it removes the manifest and
                // uploaded files out from under an in-flight import.
                disabled={isFlushing || isProcessingFiles}
                tabIndex={-1}
              >
                <Trash className="h-4 w-4" />
              </Button>
            </LongPressHint>
          )}

          {/* Flush confirmation dialog — rendered via portal so it's centered on screen */}
          {flushConfirmOpen &&
            createPortal(
              <div
                className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
                onClick={() => setFlushConfirmOpen(false)}
              >
                <div
                  className="bg-white rounded-lg shadow-xl p-5 max-w-sm mx-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="text-sm font-semibold text-slate-900 mb-2">
                    Delete Session?
                  </h3>
                  <p className="text-xs text-slate-600 mb-4">
                    This will permanently delete the manifest, sketch layers and
                    uploaded files. This action cannot be undone.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => setFlushConfirmOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="text-xs"
                      onClick={async () => {
                        setFlushConfirmOpen(false);
                        setIsFlushing(true);
                        try {
                          await onFlushSession?.();
                        } finally {
                          setIsFlushing(false);
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>,
              document.body,
            )}
          <div
            className="flex items-center gap-2 px-2 border-l border-slate-200"
            title={isProcessingFiles ? "Uploading files..." : undefined}
          >
            <span className="text-[10px] font-semibold text-slate-800 uppercase">
              Auto Save
            </span>
            <Switch
              checked={autoSaveEnabled}
              onCheckedChange={setAutoSaveEnabled}
              // Turning auto-save ON fires an IMMEDIATE save (see the effect
              // above), so during an upload this toggle is a save button.
              disabled={isProcessingFiles}
              aria-label="Toggle Auto Save"
            />
          </div>
        </div>
        <div className="flex items-center p-0.5 gap-0 rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm">
          {onToggleLayersBox && (
            <LongPressHint hint="Layers Panel">
              <Button
                size="icon"
                variant="ghost"
                className={cn(
                  "h-10 w-10 text-slate-800 hover:text-foreground rounded-none",
                  isLayersBoxOpen &&
                    "bg-blue-600/20 hover:bg-blue-600/20 rounded-sm",
                )}
                title="Layers Panel"
                onClick={onToggleLayersBox}
                tabIndex={-1}
              >
                <LayersIcon className="h-4 w-4" />
              </Button>
            </LongPressHint>
          )}

          {onToggleMeasurementBox && (
            <LongPressHint hint="Measurement Console">
              <Button
                size="icon"
                variant="ghost"
                className={cn(
                  "h-10 w-10 text-slate-800 hover:text-foreground rounded-none",
                  isMeasurementBoxOpen &&
                    "bg-blue-600/20 hover:bg-blue-600/20 rounded-sm",
                )}
                title="Measurement Console"
                onClick={onToggleMeasurementBox}
                tabIndex={-1}
              >
                <Ruler className="h-4 w-4" />
              </Button>
            </LongPressHint>
          )}

          {onToggleNetworkBox && (
            <LongPressHint hint="Network Console">
              <Button
                size="icon"
                variant="ghost"
                className={cn(
                  "h-10 w-10 text-slate-800 hover:text-foreground rounded-none",
                  isNetworkBoxOpen &&
                    "bg-blue-600/20 hover:bg-blue-600/20 rounded-sm",
                )}
                title="Network Console"
                onClick={onToggleNetworkBox}
                tabIndex={-1}
              >
                <Network className="h-4 w-4" />
              </Button>
            </LongPressHint>
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
            {onToggleUserLocation && !(window as any).electronAPI && (
              <LongPressHint
                hint={showUserLocation ? "Hide Location" : "Show Location"}
              >
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={onToggleUserLocation}
                  className={cn(
                    "h-10 w-10  hover:bg-white cursor-pointer mr-1",
                    showUserLocation &&
                      "bg-blue-600/20 hover:bg-blue-600/20 rounded-sm",
                  )}
                  title={
                    showUserLocation
                      ? "Hide Your Location"
                      : "Show Your Location"
                  }
                  tabIndex={-1}
                >
                  <MapPin className="h-4 w-4" />
                </Button>
              </LongPressHint>
            )}
            {toolConfigs.map((tool, index) => {
              const isActive = drawingMode === tool.key;
              const isLast = index === toolConfigs.length - 1;
              return (
                <div
                  key={tool.key}
                  className={cn(
                    "flex flex-col items-center gap-1 text-[11px] font-semibold text-muted-foreground",
                    !isLast && " border-slate-200",
                  )}
                >
                  <LongPressHint hint={`${tool.label} Sketch`}>
                    <Button
                      size="icon"
                      variant="ghost"
                      className={cn(
                        "h-10 w-10 p-0 rounded-none hover:text-foreground  bg-transparent cursor-pointer",
                        isActive
                          ? "text-zinc-950 bg-blue-600/20 hover:bg-blue-600/20 rounded-sm font-bold"
                          : "bg-white text-foreground hover:bg-white",
                      )}
                      title={
                        isActive
                          ? `Stop ${tool.label} sketch`
                          : `Start ${tool.label} sketch`
                      }
                      onClick={() => toggleMode(tool.key)}
                      tabIndex={-1}
                    >
                      {tool.icon}
                    </Button>
                  </LongPressHint>
                </div>
              );
            })}
            {onToggleRubberBand && (
              <div className="flex flex-col items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                <LongPressHint hint="Rubber Band Zoom">
                  <Button
                    size="icon"
                    variant="ghost"
                    className={cn(
                      "h-10 w-10 p-0 rounded-none hover:text-foreground bg-transparent cursor-pointer",
                      rubberBandMode
                        ? "text-zinc-950 bg-blue-600/20 hover:bg-blue-600/20 rounded-sm font-bold"
                        : "bg-white text-foreground hover:bg-white",
                    )}
                    title={
                      rubberBandMode
                        ? "Stop Rubber Band Zoom"
                        : "Start Rubber Band Zoom"
                    }
                    onClick={() => {
                      if (!rubberBandMode && drawingMode) {
                        setDrawingMode(null);
                      }
                      onToggleRubberBand();
                    }}
                    tabIndex={-1}
                  >
                    <Crop className="h-4 w-4" />
                  </Button>
                </LongPressHint>
              </div>
            )}
            {onToggleRoutePanel && (
              <div className="flex flex-col items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                <LongPressHint hint="Route Finder">
                  <Button
                    size="icon"
                    variant="ghost"
                    tabIndex={-1}
                    className={cn(
                      "h-10 w-10 p-0 rounded-none hover:text-foreground bg-transparent cursor-pointer",
                      isRoutePanelOpen
                        ? "text-zinc-950 bg-blue-600/20 hover:bg-blue-600/20 rounded-sm font-bold"
                        : "bg-white text-foreground hover:bg-white",
                    )}
                    title={
                      isRoutePanelOpen
                        ? "Close Route Finder"
                        : "Open Route Finder"
                    }
                    onClick={() => {
                      if (!isRoutePanelOpen && drawingMode) {
                        setDrawingMode(null);
                      }
                      if (
                        !isRoutePanelOpen &&
                        rubberBandMode &&
                        onToggleRubberBand
                      ) {
                        onToggleRubberBand();
                      }
                      onToggleRoutePanel();
                    }}
                  >
                    <Route className="h-4 w-4" />
                  </Button>
                </LongPressHint>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0 rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm">
          {onResetHome && (
            <LongPressHint hint="Home View">
              <Button
                size="icon"
                variant="ghost"
                onClick={onResetHome}
                className="h-10 w-10 hover:bg-white cursor-pointer"
                title="Reset to Home View"
                tabIndex={-1}
              >
                <Home className="h-4 w-4" />
              </Button>
            </LongPressHint>
          )}
          {onCaptureScreenshot && (
            <LongPressHint hint="Screenshot">
              <Button
                size="icon"
                variant="ghost"
                onClick={onCaptureScreenshot}
                className="h-10 w-10 hover:bg-white cursor-pointer"
                title="Capture Screenshot"
                tabIndex={-1}
              >
                <Camera className="h-4 w-4" />
              </Button>
            </LongPressHint>
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
          <LongPressHint hint="Zoom In">
            <Button
              size="icon"
              variant="ghost"
              onClick={handleZoomIn}
              className="h-10 w-10 hover:bg-transparent cursor-pointer"
              title="Zoom in"
              tabIndex={-1}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </LongPressHint>
          <div className="min-w-[36px] text-center text-xs font-semibold text-slate-800">
            {zoom.toFixed(2)}
          </div>
          <LongPressHint hint="Zoom Out">
            <Button
              size="icon"
              variant="ghost"
              onClick={handleZoomOut}
              className="h-9 w-9 hover:bg-transparent cursor-pointer"
              title="Zoom out"
              tabIndex={-1}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
          </LongPressHint>
        </div>
      </div>
    </div>
  );
};

export default ZoomControls;
