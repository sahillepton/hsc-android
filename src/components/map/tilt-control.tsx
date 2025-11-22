import {
  CameraIcon,
  Globe,
  Mountain,
  TrendingUp,
  Wifi,
  WifiOff,
  Navigation,
} from "lucide-react";
import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";

const TiltControl = ({
  mapRef,
  pitch,
  setPitch,
}: {
  mapRef: React.RefObject<any>;
  pitch: number;
  setPitch: (pitch: number) => void;
}) => {
  const [is3DTerrainMode, setIs3DTerrainMode] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(true);

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

      {/* Offline Mode Toggle */}
      <div className="pt-1 flex flex-row gap-1.5" style={{ zoom: 0.85 }}>
        <button
          onClick={() => {
            setIsOfflineMode(!isOfflineMode);
            if (mapRef.current) {
              const map = mapRef.current.getMap();
              const offlineLayer = map.getLayer("offline-tiles-layer");

              if (isOfflineMode) {
                // Switch to online mode - hide offline tiles
                if (offlineLayer) {
                  map.setLayoutProperty(
                    "offline-tiles-layer",
                    "visibility",
                    "none"
                  );
                }
                map.setMaxBounds(null); // Remove bounds restriction
              } else {
                // Switch to offline mode - show offline tiles
                if (offlineLayer) {
                  map.setLayoutProperty(
                    "offline-tiles-layer",
                    "visibility",
                    "visible"
                  );
                }
                map.setMaxBounds([76.9, 27.8, 77.2, 28.8]); // Restore bounds
              }
            }
          }}
          className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors flex items-center justify-center gap-1.5 ${
            isOfflineMode
              ? "bg-blue-500 text-white hover:bg-blue-600"
              : "bg-blue-100 text-blue-700 hover:bg-blue-200"
          }`}
        >
          {isOfflineMode ? (
            <WifiOff className="size-3" />
          ) : (
            <Wifi className="size-3" />
          )}
          <span className="whitespace-nowrap">
            {isOfflineMode ? "Offline" : "Online"}
          </span>
        </button>
        <button
          onClick={() => {
            if (mapRef.current) {
              mapRef.current.getMap().easeTo({ bearing: 0, duration: 500 });
            }
          }}
          className="flex-1 px-2 py-1.5 text-xs rounded transition-colors bg-indigo-500 text-white hover:bg-indigo-600 flex items-center justify-center gap-1.5"
          title="Reset map rotation to north"
        >
          <Navigation className="size-3" />
          <span className="whitespace-nowrap">Reset</span>
        </button>
      </div>

      {/* 3D Terrain Mode */}
      <div className="pt-1 mt-1" style={{ zoom: 0.85 }}>
        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => {
              setIs3DTerrainMode(!is3DTerrainMode);
              if (mapRef.current) {
                const map = mapRef.current.getMap();
                if (!is3DTerrainMode) {
                  // Enable enhanced 3D terrain
                  map.setTerrain({
                    source: "mapbox-dem",
                    exaggeration: 5.0,
                  });
                  map.easeTo({
                    pitch: 60,
                    zoom: Math.max(map.getZoom(), 10),
                    duration: 1000,
                  });
                  setPitch(60);
                } else {
                  // Return to normal terrain
                  map.setTerrain({
                    source: "mapbox-dem",
                    exaggeration: 4.0,
                  });
                  map.easeTo({
                    pitch: 0,
                    duration: 1000,
                  });
                  setPitch(0);
                }
              }
            }}
            className={`w-full px-2.5 py-1.5 text-xs rounded transition-colors flex items-center justify-center gap-1.5 ${
              is3DTerrainMode
                ? "bg-emerald-500 text-white hover:bg-emerald-600"
                : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
            }`}
          >
            <Globe className="size-3" />
            {is3DTerrainMode ? "Disable 3D" : "Enable 3D"}
          </button>

          {is3DTerrainMode && (
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  if (mapRef.current) {
                    mapRef.current.getMap().easeTo({
                      pitch: 75,
                      zoom: Math.max(mapRef.current.getMap().getZoom(), 12),
                      duration: 1000,
                    });
                    setPitch(75);
                  }
                }}
                className="flex-1 px-2.5 py-1.5 text-xs rounded bg-orange-100 text-orange-700 hover:bg-orange-200 transition-colors flex items-center justify-center gap-1.5"
              >
                <Mountain className="size-3" />
                Extreme View
              </button>

              <button
                onClick={() => {
                  if (mapRef.current) {
                    mapRef.current.getMap().setTerrain({
                      source: "mapbox-dem",
                      exaggeration: 6.0,
                    });
                  }
                }}
                className="flex-1 px-2.5 py-1.5 text-xs rounded bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors flex items-center justify-center gap-1.5"
              >
                <TrendingUp className="size-3" />
                Boost Height
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TiltControl;
