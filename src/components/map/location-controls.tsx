import { MapPin, MapPinOff, Navigation } from "lucide-react";
import { Button } from "../ui/button";
import { useUserLocation, useMapZoom } from "@/store/layers-store";
import { toast } from "sonner";

interface LocationControlsProps {
  onViewStateChange: (viewState: {
    longitude: number;
    latitude: number;
    zoom: number;
  }) => void;
}

const LocationControls = ({ onViewStateChange }: LocationControlsProps) => {
  const {
    userLocation,
    userLocationError,
    showUserLocation,
    setShowUserLocation,
  } = useUserLocation();
  const { mapZoom } = useMapZoom();

  const handleCenterOnLocation = () => {
    if (!userLocation) {
      toast.error("Location not available. Please enable location tracking.");
      return;
    }

    if (userLocationError) {
      toast.error(`Location error: ${userLocationError}`);
      return;
    }

    try {
      // Use viewState pattern to center map on user location
      onViewStateChange({
        longitude: userLocation.lng,
        latitude: userLocation.lat,
        zoom: Math.max(mapZoom, 14),
      });
    } catch (error) {
      console.error("Error centering map on location:", error);
      toast.error("Failed to center map on location");
    }
  };

  return (
    <div className="absolute bottom-1 left-2 z-50 pointer-events-none">
      <div className="pointer-events-auto flex flex-row gap-2">
        {/* Location Toggle Button */}
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setShowUserLocation(!showUserLocation)}
          className="h-11 w-11 rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm text-slate-600 hover:text-foreground hover:bg-white"
          title={showUserLocation ? "Hide location" : "Show location"}
        >
          {showUserLocation ? (
            <MapPin className="h-4 w-4" />
          ) : (
            <MapPinOff className="h-4 w-4" />
          )}
        </Button>

        {/* Center on Location Button */}
        <Button
          size="icon"
          variant="ghost"
          onClick={handleCenterOnLocation}
          className="h-11 w-11 rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm text-slate-600 hover:text-foreground hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
          title="Center map on your location"
          disabled={!showUserLocation || !userLocation || !!userLocationError}
        >
          <Navigation className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default LocationControls;
