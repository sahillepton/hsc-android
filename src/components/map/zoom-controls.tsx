import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Separator } from "@/components/ui/separator";

const ZoomControls = ({
  mapRef,
  zoom,
}: {
  mapRef: React.RefObject<any>;
  zoom: number;
}) => {
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

  return (
    <div className="absolute bottom-4 right-4 z-50 flex items-end gap-3">
      {/* Watermark to the left of zoom controls */}
      <div className="text-[10px] md:text-xs px-2 py-1 rounded font-bold bg-white text-black tracking-wider select-none pointer-events-none">
        IGRS WGS84
      </div>

      {/* Zoom Controls */}
      <div className="flex flex-col bg-white rounded-md shadow-md w-8 overflow-hidden">
        <Button
          size="icon"
          onClick={handleZoomIn}
          className="bg-white text-black h-8 w-8 rounded-none hover:bg-gray-100"
        >
          <PlusIcon className="w-3 h-3" />
        </Button>

        {/* <Separator
          orientation="horizontal"
          className="bg-[#e5e5e5] h-px w-5 self-center"
        /> */}

        {/* Zoom Level Display */}
        <div className="bg-white rounded-none px-2 py-1 flex items-center justify-center">
          <span className="text-[10px] md:text-xs text-[#797979] font-medium">
            {zoom.toFixed(1)}
          </span>
        </div>
        {/* 
        <Separator
          orientation="horizontal"
          className="bg-[#e5e5e5] h-px w-5 self-center"
        /> */}

        <Button
          size="icon"
          onClick={handleZoomOut}
          className="bg-white text-black h-8 w-8 rounded-none hover:bg-gray-100"
        >
          <MinusIcon className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
};

export default ZoomControls;
