import { useState } from "react";

const TiltControl = ({
  mapRef,
  pitch,
  setPitch,
}: {
  mapRef: React.RefObject<any>;
  pitch: number;
  setPitch: (pitch: number) => void;
}) => {
  const angles = [0, 15, 30, 45, 60, 75, 85];
  const [is3DTerrainMode, setIs3DTerrainMode] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(true);

  return (
    <div className="absolute top-4 right-4 z-50 bg-white rounded-lg shadow-lg p-3">
      <div className="text-xs font-medium text-gray-700 mb-3">
        Camera Controls
      </div>

      {/* Reset to North Button */}
      <div className="mb-4">
        <button
          onClick={() => {
            if (mapRef.current) {
              mapRef.current.getMap().easeTo({ bearing: 0, duration: 500 });
            }
          }}
          className="w-full px-3 py-2 text-xs rounded transition-colors bg-indigo-500 text-white hover:bg-indigo-600 flex items-center justify-center gap-2"
          title="Reset map rotation to north"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2v20M2 12h20" />
            <path d="M12 2l3 3-3 3M12 2L9 5l3 3" />
          </svg>
          Reset to North
        </button>
      </div>

      {/* Tilt Angle Controls */}
      <div className="mb-4">
        <div className="text-xs text-gray-600 mb-2">Tilt Angle</div>
        <div className="flex flex-col space-y-1">
          {angles.map((angle) => (
            <button
              key={angle}
              onClick={() => {
                setPitch(angle);
                if (mapRef.current) {
                  mapRef.current.getMap().easeTo({ pitch: angle });
                }
              }}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                pitch === angle
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {angle}°{angle === 85 && <span className="ml-1">🏔️</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Offline Mode Toggle */}
      <div className="border-t pt-3">
        <div className="text-xs text-gray-600 mb-2">Map Mode</div>
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
          className={`w-full px-3 py-1 text-xs rounded transition-colors ${
            isOfflineMode
              ? "bg-blue-500 text-white hover:bg-blue-600"
              : "bg-blue-100 text-blue-700 hover:bg-blue-200"
          }`}
        >
          📱 {isOfflineMode ? "Offline Mode" : "Online Mode"}
        </button>
      </div>

      {/* 3D Terrain Mode */}
      <div className="border-t pt-3">
        <div className="text-xs text-gray-600 mb-2">3D Terrain Mode</div>
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
          className={`w-full px-3 py-1 text-xs rounded transition-colors ${
            is3DTerrainMode
              ? "bg-emerald-500 text-white hover:bg-emerald-600"
              : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
          }`}
        >
          🌍 {is3DTerrainMode ? "Disable 3D" : "Enable 3D"}
        </button>

        {/* 3D Terrain Controls - Only show when 3D mode is active */}
        {is3DTerrainMode && (
          <div className="space-y-1 mt-2">
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
              className="w-full px-3 py-1 text-xs rounded bg-orange-100 text-orange-700 hover:bg-orange-200 transition-colors"
            >
              🏔️ Extreme View
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
              className="w-full px-3 py-1 text-xs rounded bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors"
            >
              ⛰️ Boost Height
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TiltControl;
