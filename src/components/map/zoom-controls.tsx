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
  PanelBottomClose,
  PanelBottomOpen,
  Crosshair,
} from "lucide-react";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { useDrawingMode } from "@/store/layers-store";
import type { DrawingMode } from "@/lib/definitions";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

const LONG_PRESS_DELAY = 500;

/** Side of the square toggle card (w-12). Used for on-screen clamping. */
const TOGGLE_SIZE = 48;
/** Movement before a press becomes a drag rather than a tap (px). */
const TOGGLE_DRAG_SLOP = 10;
const TOGGLE_POS_KEY = "gis.toolbarToggle.pos";

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
  onPlotCoordinate,
  maxLatitude = 90,
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
  /** Plot a sketch point at typed coordinates. Returns an error message, or null. */
  onPlotCoordinate?: (lat: number, lng: number) => string | null;
  /** Latitude the ACTIVE projection can display: 90 for 4326, 85.0511 for Mercator. */
  maxLatitude?: number;
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
  // Collapse the bottom tool bars so the map is unobstructed. The compass, zoom
  // stack and this toggle deliberately STAY visible — hiding them too would leave
  // no way back, and they are the controls you still want while inspecting.
  const [toolbarHidden, setToolbarHidden] = useState(false);
  /**
   * Free position of the collapsed toggle, in viewport pixels. `null` = parked in
   * its default bottom-right corner.
   *
   * Draggable ONLY while collapsed: expanded, the button is one card in a fixed
   * stack with the compass and zoom column, and letting it wander would break that
   * alignment. Collapsed it is the single thing on screen, so wherever it sits is
   * wherever the user wants it — typically out of the way of whatever they are
   * inspecting, which is the entire point of collapsing the bar.
   */
  const [togglePos, setTogglePos] = useState<{ x: number; y: number } | null>(
    () => {
      try {
        const raw = localStorage.getItem(TOGGLE_POS_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        return typeof p?.x === "number" && typeof p?.y === "number" ? p : null;
      } catch {
        return null; // private mode / blocked storage — just use the default corner
      }
    },
  );
  // Drag bookkeeping. Refs, not state: a re-render per pointermove would fight the
  // drag, and `moved` has to be readable from onClick in the same gesture.
  const dragRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  /** Keep the button fully on screen — after a drag, a rotate, or a resize. */
  const clampToggle = useCallback((x: number, y: number) => {
    const pad = 4;
    const maxX = Math.max(pad, window.innerWidth - TOGGLE_SIZE - pad);
    const maxY = Math.max(pad, window.innerHeight - TOGGLE_SIZE - pad);
    return {
      x: Math.min(Math.max(x, pad), maxX),
      y: Math.min(Math.max(y, pad), maxY),
    };
  }, []);

  // Rotation / split-screen can leave a stored position off screen; pull it back.
  useEffect(() => {
    const onResize = () =>
      setTogglePos((p) => (p ? clampToggle(p.x, p.y) : p));
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [clampToggle]);

  const onTogglePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!toolbarHidden) return; // only draggable while collapsed
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      originX: rect.left,
      originY: rect.top,
    };
    // Capture so the drag keeps tracking even when the pointer leaves the button,
    // and stop the map underneath from treating this as a pan.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.stopPropagation();
  };

  const onTogglePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    // ~10px of slop before this counts as a drag, matching the map's own pan
    // threshold. Without it a tap with any finger tremor would move the button
    // instead of expanding the bar.
    if (!d.moved && Math.hypot(dx, dy) < TOGGLE_DRAG_SLOP) return;
    d.moved = true;
    setTogglePos(clampToggle(d.originX + dx, d.originY + dy));
    e.stopPropagation();
  };

  const onTogglePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    d.active = false;
    const wasDrag = d.moved;
    d.moved = false;

    if (wasDrag) {
      // End of a reposition — remember it, and do NOT toggle.
      try {
        setTogglePos((p) => {
          if (p) localStorage.setItem(TOGGLE_POS_KEY, JSON.stringify(p));
          return p;
        });
      } catch {
        /* storage blocked — position still applies for this session */
      }
    } else {
      // A TAP. Handled here rather than in the button's onClick because this
      // wrapper calls setPointerCapture on pointerdown, and while a pointer is
      // captured the follow-up `click` is retargeted to the CAPTURING element —
      // so the inner Button's onClick never ran and the bar could not be
      // reopened after the button had been dragged. pointerup always fires on
      // the capture target, so deciding it here is deterministic.
      setToolbarHidden(false);
    }
    e.stopPropagation();
  };
  const [coordDialogOpen, setCoordDialogOpen] = useState(false);
  const [coordLat, setCoordLat] = useState("");
  const [coordLng, setCoordLng] = useState("");
  const [coordError, setCoordError] = useState<string | null>(null);
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
        {/* Everything in here collapses when the tool bar is hidden. The compass,
            zoom stack and the hide toggle live OUTSIDE it (absolutely positioned
            below), so they stay reachable — otherwise there would be no way back. */}
        <div
          className={cn(
            "flex flex-row gap-2",
            toolbarHidden && "hidden",
          )}
        >
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
            {onPlotCoordinate && (
              <div className="flex flex-col items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                <LongPressHint hint="Plot by Coordinates">
                  <Button
                    size="icon"
                    variant="ghost"
                    className={cn(
                      "h-10 w-10 p-0 rounded-none hover:text-foreground bg-transparent cursor-pointer",
                      coordDialogOpen
                        ? "text-zinc-950 bg-blue-600/20 hover:bg-blue-600/20 rounded-sm font-bold"
                        : "bg-white text-foreground hover:bg-white",
                    )}
                    title="Plot a point by latitude / longitude"
                    onClick={() => {
                      // Typing coordinates is an alternative to tapping, so leave
                      // any active sketch/zoom mode the way the other tools do.
                      if (drawingMode) setDrawingMode(null);
                      if (rubberBandMode && onToggleRubberBand) onToggleRubberBand();
                      setCoordError(null);
                      setCoordDialogOpen(true);
                    }}
                    tabIndex={-1}
                  >
                    <Crosshair className="h-4 w-4" />
                  </Button>
                </LongPressHint>
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
        </div>

        {/* Plot-by-coordinates dialog. Same portal/backdrop/card as the Delete
            Session dialog above so confirmations and prompts look identical. */}
        {coordDialogOpen &&
          createPortal(
            <div
              className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
              onClick={() => setCoordDialogOpen(false)}
            >
              <div
                className="bg-white rounded-lg shadow-xl p-5 w-[320px] max-w-[92vw] mx-4"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Plot a point by coordinates"
              >
                <h3 className="text-sm font-semibold text-slate-900 mb-1">
                  Plot Point by Coordinates
                </h3>
                <p className="text-xs text-slate-600 mb-3">
                  Adds a point to the sketch layers and focuses the map on it.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const lat = Number(coordLat.trim());
                    const lng = Number(coordLng.trim());
                    if (coordLat.trim() === "" || coordLng.trim() === "") {
                      setCoordError("Enter both latitude and longitude.");
                      return;
                    }
                    const err = onPlotCoordinate?.(lat, lng) ?? null;
                    if (err) {
                      setCoordError(err);
                      return;
                    }
                    setCoordDialogOpen(false);
                    setCoordLat("");
                    setCoordLng("");
                    setCoordError(null);
                  }}
                >
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-xs font-medium text-muted-foreground">
                        Latitude
                      </label>
                      <input
                        // `inputMode=decimal` gives Android the numeric keypad WITH
                        // a minus sign and decimal point; type=number would spawn
                        // spinners and reject partial input like "-" mid-typing.
                        inputMode="decimal"
                        autoFocus
                        value={coordLat}
                        onChange={(e) => {
                          setCoordLat(e.target.value);
                          setCoordError(null);
                        }}
                        placeholder={`-${maxLatitude} to ${maxLatitude}`}
                        className="mt-1 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs font-medium text-muted-foreground">
                        Longitude
                      </label>
                      <input
                        inputMode="decimal"
                        value={coordLng}
                        onChange={(e) => {
                          setCoordLng(e.target.value);
                          setCoordError(null);
                        }}
                        placeholder="-180 to 180"
                        className="mt-1 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                      />
                    </div>
                  </div>
                  {/* The limit is projection-dependent, so state it up front rather
                      than only failing after the user has typed a pole latitude. */}
                  <p className="mt-2 text-[10px] leading-snug text-slate-500">
                    This base map can display latitudes up to ±
                    {maxLatitude === 90 ? "90" : maxLatitude.toFixed(4)}°.
                  </p>
                  {coordError && (
                    <p className="mt-2 text-[11px] leading-snug text-red-600">
                      {coordError}
                    </p>
                  )}
                  <div className="flex justify-end gap-2 mt-4">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => setCoordDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" className="text-xs">
                      Plot Point
                    </Button>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )}

        {/* Show/hide the bottom tool bar. Anchored above the compass when the bar
            is open; free-floating and DRAGGABLE once collapsed. */}
        <div
          onPointerDown={onTogglePointerDown}
          onPointerMove={onTogglePointerMove}
          onPointerUp={onTogglePointerUp}
          onPointerCancel={onTogglePointerUp}
          style={
            // Only once collapsed AND actually moved does it leave the corner.
            // `fixed` (not absolute) so the stored coordinates are plain viewport
            // pixels — no dependence on this container's own offset, which changes
            // as the bars collapse.
            toolbarHidden && togglePos
              ? {
                  position: "fixed",
                  left: togglePos.x,
                  top: togglePos.y,
                  right: "auto",
                  bottom: "auto",
                  // Stops Android treating the drag as a page/map gesture.
                  touchAction: "none",
                }
              : toolbarHidden
                ? { touchAction: "none" }
                : undefined
          }
          className={cn(
            // w-12 on all three stacked cards so the toggle, compass and zoom
            // column line up. Their natural widths differed — 40px (w-10 button),
            // 46.4px (compass: (18+80+18) x zoom 0.4) and 44px (w-10 + px-0.5) —
            // which read as a ragged right edge.
            "absolute right-0.5 w-12 flex items-center justify-center rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm",
            // Collapsed: the compass and zoom column are gone, so sit at the
            // bottom instead of floating 228px up where they used to be.
            toolbarHidden ? "bottom-0" : "-top-57",
            // A subtle affordance that this one is grabbable, and only when it is.
            toolbarHidden && "cursor-grab active:cursor-grabbing z-50",
          )}
        >
          <LongPressHint
            hint={
              toolbarHidden ? "Show Tool Bar · drag to move" : "Hide Tool Bar"
            }
          >
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                // Only the COLLAPSE direction. While collapsed the wrapper owns
                // the gesture (pointer capture retargets click away from here), so
                // expanding is done in onTogglePointerUp; doing it in both places
                // would toggle twice on a single tap.
                if (toolbarHidden) return;
                setToolbarHidden(true);
              }}
              className="h-10 w-10 hover:bg-transparent cursor-pointer"
              title={
                toolbarHidden
                  ? "Show tool bar (drag to reposition)"
                  : "Hide tool bar"
              }
              aria-pressed={toolbarHidden}
              tabIndex={-1}
            >
              {toolbarHidden ? (
                <PanelBottomOpen className="h-4 w-4" />
              ) : (
                <PanelBottomClose className="h-4 w-4" />
              )}
            </Button>
          </LongPressHint>
        </div>

        <div
          className={cn(
            "absolute -top-45 right-0.5 w-12 flex items-center justify-center rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm",
            toolbarHidden && "hidden",
          )}
        >
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
        <div
          className={cn(
            "absolute -top-31 right-0.5 w-12 flex flex-col items-center gap-2 rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm py-1",
            toolbarHidden && "hidden",
          )}
        >
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
