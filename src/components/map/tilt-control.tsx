import { CameraIcon } from "lucide-react";
import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const TiltControl = ({
  mapRef,
  pitch,
  setPitch,
  onCreatePoint,
}: {
  mapRef: React.RefObject<any>;
  pitch: number;
  setPitch: (pitch: number) => void;
  onCreatePoint?: (position: [number, number]) => void;
}) => {
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");

  const handleGoToLocation = () => {
    if (!mapRef.current) return;

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    // Validate coordinates
    if (isNaN(lat) || isNaN(lng)) {
      return;
    }

    // Validate latitude range (-90 to 90)
    if (lat < -90 || lat > 90) {
      return;
    }

    // Validate longitude range (-180 to 180)
    if (lng < -180 || lng > 180) {
      return;
    }

    const map = mapRef.current.getMap();
    map.flyTo({
      center: [lng, lat],
      zoom: Math.max(map.getZoom(), 10),
      duration: 1500,
      essential: true,
    });

    // Create a point layer at this location (normal point layer flow)
    if (onCreatePoint) {
      onCreatePoint([lng, lat]);
    }
  };

  return (
    <div className="w-full">
      <div className="font-medium text-gray-700 mb-2 flex flex-row items-center justify-start text-xs gap-1.5">
        <CameraIcon className="size-3.5" /> Camera Controls
      </div>

      {/* Tilt Angle Controls */}
      <div className="mb-2" style={{ zoom: 0.9 }}>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-sidebar-foreground/70">
            Tilt Angle
          </label>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              tabIndex={-1}
              min={0}
              max={85}
              step={1}
              value={pitch}
              onChange={(e) => {
                const value = Math.max(
                  0,
                  Math.min(85, Number(e.target.value) || 0)
                );
                setPitch(value);
                if (mapRef.current) {
                  mapRef.current.getMap().easeTo({ pitch: value });
                }
              }}
              className="w-14 h-6 text-xs text-center px-1"
            />
            <span className="text-xs text-muted-foreground">°</span>
          </div>
        </div>
        <Slider
          value={[pitch]}
          min={0}
          max={85}
          step={1}
          onValueChange={(values) => {
            const newPitch = values[0];
            setPitch(newPitch);
            if (mapRef.current) {
              mapRef.current.getMap().easeTo({ pitch: newPitch });
            }
          }}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
          <span>0°</span>
          <span>85°</span>
        </div>
      </div>

      {/* Go to Location */}
      <div className="mb-2 pt-2 border-gray-200">
        <div className="flex flex-col gap-2">
          <div className="flex gap-1.5" style={{ zoom: 0.85 }}>
            <div className="flex-1">
              <Input
                type="number"
                step="any"
                placeholder="Lat"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                className="h-7 text-[10px]"
              />
            </div>
            <div className="flex-1">
              <Input
                type="number"
                step="any"
                placeholder="Long"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                className="h-7 text-[10px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleGoToLocation();
                  }
                }}
              />
            </div>
            <div className="flex-1">
              <Button
                onClick={handleGoToLocation}
                className="h-7 text-xs bg-blue-500 rounded-sm hover:bg-blue-600 text-white w-full"
                disabled={!latitude || !longitude}
              >
                Go
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TiltControl;
