import {
  CircleDot,
  Compass,
  ZoomOut,
  Pentagon,
  ZoomIn,
  Waypoints,
  LayersIcon,
  CameraIcon,
  WifiPen,
  AlertTriangle,
  Ruler,
  Network,
  FileUp,
} from "lucide-react";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { useDrawingMode } from "@/store/layers-store";
import type { DrawingMode } from "@/lib/definitions";
import { cn } from "@/lib/utils";
import TiltControl from "./tilt-control";

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
  cameraPopoverProps,
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
  cameraPopoverProps?: CameraPopoverProps;
  alertButtonProps?: AlertButtonProps;
  igrsToggleProps?: IgrsToggleProps;
}) => {
  const { drawingMode, setDrawingMode } = useDrawingMode();

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

  const alertColor =
    alertButtonProps?.severity === "error" ? "text-red-600" : "text-amber-500";

  return (
    <div className="absolute bottom-1 right-2 z-50 pointer-events-none">
      <div className="relative pointer-events-auto flex flex-row gap-2">
        {alertButtonProps?.visible && (
          <Button
            size="icon"
            variant="ghost"
            className={cn(
              "h-11 w-11 rounded-sm bg-white shadow-2xl border border-black/10 backdrop-blur-sm",
              alertColor,
              "hover:text-current"
            )}
            title={alertButtonProps.title}
            onClick={alertButtonProps.onClick}
          >
            <AlertTriangle className="h-4 w-4" />
          </Button>
        )}
        <div className="flex items-center p-0.5 gap-0 rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm">
          {onToggleLayersBox && (
            <Button
              size="icon"
              variant="ghost"
              className="h-10 w-10 text-slate-600 hover:text-foreground  rounded-none"
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
              className="h-10 w-10 text-slate-600 hover:text-foreground  rounded-none"
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
              className="h-10 w-10 text-slate-600 hover:text-foreground  rounded-none"
              title="Network Layers"
              onClick={onToggleNetworkBox}
            >
              <Network className="h-4 w-4" />
            </Button>
          )}

          {cameraPopoverProps && (
            <Popover
              open={cameraPopoverProps.isOpen}
              onOpenChange={cameraPopoverProps.onOpenChange}
            >
              <PopoverTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-10 w-10 text-slate-600 hover:text-foreground  rounded-none"
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
          )}

          {onOpenConnectionConfig && (
            <Button
              size="icon"
              variant="ghost"
              className="h-10 w-10 text-slate-600 hover:text-foreground  rounded-none"
              title="Connection Settings"
              onClick={onOpenConnectionConfig}
            >
              <WifiPen className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-0 rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm">
          {onUpload && (
            <div className="flex items-center gap-0 p-0.5">
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10 text-slate-600 hover:text-foreground rounded-none"
                title="Upload File"
                onClick={onUpload}
              >
                <FileUp className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="flex items-center gap-0 p-0.5 ">
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
                        ? "text-zinc-950 bg-blue-600/20 font-bold"
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
              <span className="text-[10px] font-semibold text-slate-600 uppercase">
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
          <div className="min-w-[36px] text-center text-xs font-semibold text-slate-600">
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
