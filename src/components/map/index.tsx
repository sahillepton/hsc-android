// @ts-nocheck
import Map, { useControl, NavigationControl } from "react-map-gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { DeckGL } from "@deck.gl/react";
import { useEffect, useRef, useState } from "react";
import { useLayersContext } from "@/layers-provider";
import type { LayerProps } from "@/lib/definitions";
import { TextLayer } from "@deck.gl/layers";
import { indianStatesData } from "@/data/indian-states";
import IconSelector from "@/components/icon-selector";
import "mapbox-gl/dist/mapbox-gl.css";

// Utility functions for distance and area calculations
function calculateDistance(
  coord1: [number, number],
  coord2: [number, number]
): number {
  const R = 6371000; // Earth's radius in meters
  const lat1 = (coord1[1] * Math.PI) / 180;
  const lat2 = (coord2[1] * Math.PI) / 180;
  const deltaLat = ((coord2[1] - coord1[1]) * Math.PI) / 180;
  const deltaLon = ((coord2[0] - coord1[0]) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLon / 2) *
      Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

function calculatePolygonArea(coordinates: number[][]): number {
  if (!coordinates || coordinates.length < 3) return 0;

  // Convert to radians and use spherical excess formula for accurate area calculation
  const R = 6371000; // Earth's radius in meters
  let area = 0;

  for (let i = 0; i < coordinates.length; i++) {
    const j = (i + 1) % coordinates.length;
    const xi = (coordinates[i][0] * Math.PI) / 180;
    const yi = (coordinates[i][1] * Math.PI) / 180;
    const xj = (coordinates[j][0] * Math.PI) / 180;
    const yj = (coordinates[j][1] * Math.PI) / 180;

    area += (xj - xi) * (2 + Math.sin(yi) + Math.sin(yj));
  }

  area = (Math.abs(area) * R * R) / 2;
  return area; // Area in square meters
}

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${meters.toFixed(1)} m`;
  } else if (meters < 1000000) {
    return `${(meters / 1000).toFixed(2)} km`;
  } else {
    return `${(meters / 1000000).toFixed(2)} Mm`;
  }
}

function formatArea(squareMeters: number): string {
  if (squareMeters < 10000) {
    return `${squareMeters.toFixed(1)} m²`;
  } else if (squareMeters < 1000000) {
    return `${(squareMeters / 10000).toFixed(2)} ha`;
  } else {
    return `${(squareMeters / 1000000).toFixed(2)} km²`;
  }
}

function DeckGLOverlay({ layers }: { layers: any[] }) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({}));

  // Update overlay layers when `layers` changes
  useEffect(() => {
    overlay.setProps({ layers });
  }, [overlay, layers]);

  return null;
}

function Tooltip({
  hoverInfo,
  getLayerInfo,
}: {
  hoverInfo: any;
  getLayerInfo?: (layerId: string) => LayerProps | undefined;
}) {
  if (!hoverInfo || !hoverInfo.object || !hoverInfo.x || !hoverInfo.y) {
    return null;
  }

  const { object, x, y, layer } = hoverInfo;
  const layerInfo = layer?.id && getLayerInfo ? getLayerInfo(layer.id) : null;

  // Get tooltip content based on object type
  const getTooltipContent = () => {
    // Check if this is a direct Node object (from IconLayer)
    const isDirectNodeObject =
      object.hasOwnProperty("snr") &&
      object.hasOwnProperty("rssi") &&
      object.hasOwnProperty("userId") &&
      object.hasOwnProperty("hopCount");

    if (isDirectNodeObject) {
      return (
        <div className="bg-black bg-opacity-80 text-white p-3 rounded shadow-lg text-sm max-w-xs">
          {layerInfo && (
            <div className="font-semibold text-cyan-300 mb-2">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold text-blue-400 mb-1">Network Node</div>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-300">User ID:</span>
              <span className="font-mono">{object.userId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">SNR:</span>
              <span className="font-mono">{object.snr} dB</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">RSSI:</span>
              <span className="font-mono">{object.rssi} dBm</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">Distance:</span>
              <span className="font-mono">{object.distance?.toFixed(2)} m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">Hop Count:</span>
              <span className="font-mono">{object.hopCount}</span>
            </div>
            {object.connectedNodeIds && object.connectedNodeIds.length > 0 && (
              <div className="mt-2 pt-1 border-t border-gray-600">
                <div className="text-gray-300 text-xs mb-1">
                  Connected Nodes:
                </div>
                <div className="font-mono text-xs">
                  [{object.connectedNodeIds.join(", ")}]
                </div>
              </div>
            )}
            <div className="mt-2 pt-1 border-t border-gray-600">
              <div className="text-gray-300 text-xs">Location:</div>
              <div className="font-mono text-xs">
                [{object.longitude.toFixed(6)}, {object.latitude.toFixed(6)}]
              </div>
            </div>
            <div className="mt-2 pt-1 border-t border-gray-600">
              <div className="text-gray-300 text-xs mb-1">Icon:</div>
              <div className="text-xs text-gray-400">
                Click on the node to change its icon
              </div>
            </div>
          </div>
        </div>
      );
    }

    // For GeoJSON features
    if (object.geometry) {
      const geometryType = object.geometry.type;
      const properties = object.properties || {};

      // Check if this is a Node feature (has Node-specific properties)
      const isNodeFeature =
        properties.hasOwnProperty("snr") &&
        properties.hasOwnProperty("rssi") &&
        properties.hasOwnProperty("userId") &&
        properties.hasOwnProperty("hopCount");

      if (isNodeFeature) {
        return (
          <div className="bg-black bg-opacity-80 text-white p-3 rounded shadow-lg text-sm max-w-xs">
            {layerInfo && (
              <div className="font-semibold text-cyan-300 mb-2">
                {layerInfo.name}
              </div>
            )}
            <div className="font-semibold text-blue-400 mb-1">Network Node</div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-300">User ID:</span>
                <span className="font-mono">{properties.userId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">SNR:</span>
                <span className="font-mono">{properties.snr} dB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">RSSI:</span>
                <span className="font-mono">{properties.rssi} dBm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Distance:</span>
                <span className="font-mono">
                  {properties.distance?.toFixed(2)} m
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Hop Count:</span>
                <span className="font-mono">{properties.hopCount}</span>
              </div>
              {properties.connectedNodeIds &&
                properties.connectedNodeIds.length > 0 && (
                  <div className="mt-2 pt-1 border-t border-gray-600">
                    <div className="text-gray-300 text-xs mb-1">
                      Connected Nodes:
                    </div>
                    <div className="font-mono text-xs">
                      [{properties.connectedNodeIds.join(", ")}]
                    </div>
                  </div>
                )}
              {geometryType === "Point" && object.geometry.coordinates && (
                <div className="mt-2 pt-1 border-t border-gray-600">
                  <div className="text-gray-300 text-xs">Location:</div>
                  <div className="font-mono text-xs">
                    [{object.geometry.coordinates[0].toFixed(6)},{" "}
                    {object.geometry.coordinates[1].toFixed(6)}]
                  </div>
                </div>
              )}
              <div className="mt-2 pt-1 border-t border-gray-600">
                <div className="text-gray-300 text-xs mb-1">Icon:</div>
                <div className="text-xs text-gray-400">
                  Click on the node to change its icon
                </div>
              </div>
            </div>
          </div>
        );
      }

      // Regular GeoJSON feature (non-Node)
      let geometryInfo = null;

      // Calculate distance for LineString
      if (
        geometryType === "LineString" &&
        object.geometry.coordinates &&
        object.geometry.coordinates.length >= 2
      ) {
        let totalDistance = 0;
        for (let i = 0; i < object.geometry.coordinates.length - 1; i++) {
          totalDistance += calculateDistance(
            [
              object.geometry.coordinates[i][0],
              object.geometry.coordinates[i][1],
            ],
            [
              object.geometry.coordinates[i + 1][0],
              object.geometry.coordinates[i + 1][1],
            ]
          );
        }
        geometryInfo = (
          <div className="text-yellow-300 font-medium">
            Distance: {formatDistance(totalDistance)}
          </div>
        );
      }

      // Calculate area for Polygon
      if (
        geometryType === "Polygon" &&
        object.geometry.coordinates &&
        object.geometry.coordinates[0]
      ) {
        const area = calculatePolygonArea(object.geometry.coordinates[0]);
        geometryInfo = (
          <div className="text-orange-300 font-medium">
            Area: {formatArea(area)}
          </div>
        );
      }

      return (
        <div className="bg-black bg-opacity-80 text-white p-2 rounded shadow-lg text-sm max-w-xs">
          {layerInfo && (
            <div className="font-semibold text-blue-300 mb-1">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold">{geometryType} Feature</div>
          {properties.name && <div>Name: {properties.name}</div>}
          {geometryInfo}
          {geometryType === "Point" && object.geometry.coordinates && (
            <div>
              Coordinates: [{object.geometry.coordinates[0].toFixed(4)},{" "}
              {object.geometry.coordinates[1].toFixed(4)}]
            </div>
          )}
          {Object.keys(properties).length > 0 && (
            <div className="mt-1">
              <div className="text-gray-300 text-xs">Properties:</div>
              {Object.entries(properties)
                .slice(0, 3)
                .map(([key, value]) => (
                  <div key={key} className="ml-1">
                    {key}: {String(value)}
                  </div>
                ))}
              {Object.keys(properties).length > 3 && (
                <div className="text-gray-400 text-xs ml-1">
                  ...and {Object.keys(properties).length - 3} more
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    // For regular layers (points, lines, polygons)
    if (object.sourcePosition && object.targetPosition) {
      // Line segment
      const distance = calculateDistance(
        [object.sourcePosition[0], object.sourcePosition[1]],
        [object.targetPosition[0], object.targetPosition[1]]
      );

      return (
        <div className="bg-black bg-opacity-80 text-white p-2 rounded shadow-lg text-sm">
          {layerInfo && (
            <div className="font-semibold text-green-300 mb-1">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold">Line Segment</div>
          <div className="text-yellow-300 font-medium">
            Distance: {formatDistance(distance)}
          </div>
          <div>
            From: [{object.sourcePosition[0].toFixed(4)},{" "}
            {object.sourcePosition[1].toFixed(4)}]
          </div>
          <div>
            To: [{object.targetPosition[0].toFixed(4)},{" "}
            {object.targetPosition[1].toFixed(4)}]
          </div>
          {object.width && <div>Width: {object.width}</div>}
        </div>
      );
    }

    if (object.position) {
      // Point
      return (
        <div className="bg-black bg-opacity-80 text-white p-2 rounded shadow-lg text-sm">
          {layerInfo && (
            <div className="font-semibold text-red-300 mb-1">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold">Point</div>
          <div>
            Coordinates: [{object.position[0].toFixed(4)},{" "}
            {object.position[1].toFixed(4)}]
          </div>
          {object.radius && <div>Radius: {object.radius.toLocaleString()}</div>}
        </div>
      );
    }

    if (object.polygon) {
      // Polygon
      const area = calculatePolygonArea(object.polygon[0] || []);

      return (
        <div className="bg-black bg-opacity-80 text-white p-2 rounded shadow-lg text-sm">
          {layerInfo && (
            <div className="font-semibold text-purple-300 mb-1">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold">Polygon</div>
          <div className="text-orange-300 font-medium">
            Area: {formatArea(area)}
          </div>
          <div>Vertices: {object.polygon[0]?.length || 0}</div>
        </div>
      );
    }

    // Default fallback
    return (
      <div className="bg-black bg-opacity-80 text-white p-2 rounded shadow-lg text-sm">
        <div className="font-semibold">Map Feature</div>
        <div>Hover for details</div>
      </div>
    );
  };

  return (
    <div
      style={{
        position: "absolute",
        left: x + 10,
        top: y - 10,
        pointerEvents: "none",
        zIndex: 1000,
      }}
    >
      {getTooltipContent()}
    </div>
  );
}

const MapComponent = () => {
  const mapRef = useRef<any>(null);

  // Expose mapRef globally for mountain view navigation
  useEffect(() => {
    (window as any).mapRef = mapRef;
  }, []);

  // Listen for node click events
  useEffect(() => {
    const handleNodeClick = (event: CustomEvent) => {
      const { nodeId, nodeData } = event.detail;
      console.log("Node clicked:", nodeId, nodeData);
      setSelectedNodeForCall({ nodeId, ...nodeData });
    };

    window.addEventListener(
      "nodeIconSelection",
      handleNodeClick as EventListener
    );

    return () => {
      window.removeEventListener(
        "nodeIconSelection",
        handleNodeClick as EventListener
      );
    };
  }, []);

  const [isMapEnabled, setIsMapEnabled] = useState(true);
  const [pitch, setPitch] = useState(0);
  const [is3DTerrainMode, setIs3DTerrainMode] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(true);
  const [selectedNodeForIcon, setSelectedNodeForIcon] = useState<string | null>(
    null
  );
  const [selectedNodeForCall, setSelectedNodeForCall] = useState<any>(null);
  const [motherAircraftPosition, setMotherAircraftPosition] = useState<
    [number, number] | null
  >(null);

  const {
    allLayers,
    layers,
    handleClick,
    handleMouseMove,
    handleMouseUp,
    hoverInfo,
    createNodeLayer,
    networkLayersVisible,
    nodeIconMappings,
    setNodeIcon,
    getAvailableIcons,
  } = useLayersContext();

  // Generate dummy node data
  const generateDummyNodes = (count: number = 8) => {
    const nodes = [];
    const baseLocation = { lat: 28.4595, lng: 77.0266 }; // Gurgaon center

    for (let i = 1; i <= count; i++) {
      // Generate random position within ~10km radius around Gurgaon
      const radius = Math.random() * 0.1; // ~10km in degrees (smaller area)
      const angle = Math.random() * 2 * Math.PI;
      const latitude = baseLocation.lat + radius * Math.cos(angle);
      const longitude = baseLocation.lng + radius * Math.sin(angle);

      // Generate realistic but changing values
      const time = Date.now() / 1000;
      const snr = Math.sin(time / 10 + i) * 5 + 15 + Math.random() * 5; // 10-25 dB range
      const rssi = Math.cos(time / 8 + i) * 20 - 60 + Math.random() * 10; // -80 to -40 dBm range
      const distance = Math.abs(Math.sin(time / 15 + i)) * 1000 + 100; // 100-1100m range
      const hopCount = Math.floor(Math.random() * 4) + 1; // 1-4 hops

      // Generate connected node IDs
      const connectedNodeIds = [];
      const connectionCount = Math.floor(Math.random() * 3) + 1;
      for (let j = 0; j < connectionCount; j++) {
        const connectedId = Math.floor(Math.random() * count) + 1;
        if (connectedId !== i && !connectedNodeIds.includes(connectedId)) {
          connectedNodeIds.push(connectedId);
        }
      }

      nodes.push({
        userId: i,
        latitude: latitude,
        longitude: longitude,
        snr: parseFloat(snr.toFixed(1)),
        rssi: parseFloat(rssi.toFixed(1)),
        distance: parseFloat(distance.toFixed(2)),
        hopCount: hopCount,
        connectedNodeIds: connectedNodeIds,
        lastSeen: new Date().toISOString(),
        batteryLevel: Math.floor(Math.random() * 100),
        status: Math.random() > 0.1 ? "online" : "offline", // 90% online
      });
    }

    return nodes;
  };

  // Update dummy nodes every 200ms only if network layers are visible
  useEffect(() => {
    if (!networkLayersVisible) return;

    const interval = setInterval(() => {
      const dummyNodes = generateDummyNodes(8);
      // Call createNodeLayer with just nodes array and layer name
      createNodeLayer(dummyNodes, "Network Nodes");
    }, 8000); // Update every 8 seconds

    // Initial load
    const initialNodes = generateDummyNodes(8);
    createNodeLayer(initialNodes, "Network Nodes");

    return () => clearInterval(interval);
  }, [createNodeLayer, networkLayersVisible]);

  // Function to find layer info from layer ID
  const getLayerInfo = (layerId: string) => {
    return layers.find((layer) => layer.id === layerId);
  };

  // Custom click handler for closing dialogs
  const handleMapClick = (event: any) => {
    const { object } = event;

    // If clicking on empty space, close any open dialogs
    if ((selectedNodeForIcon || selectedNodeForCall) && !object) {
      setSelectedNodeForIcon(null);
      setSelectedNodeForCall(null);
      return;
    }

    // For other clicks, use the default handler
    handleClick(event);
  };

  // Create state names text layer
  const stateNamesLayer = new TextLayer({
    id: "state-names-layer",
    data: indianStatesData,
    pickable: false,
    getPosition: (d: any) => d.coordinates,
    getText: (d: any) => d.name,
    getSize: 16,
    getAngle: 0,
    getTextAnchor: "middle",
    getAlignmentBaseline: "center",
    getColor: [255, 255, 255, 200], // White text with slight transparency
    fontFamily: "Arial, sans-serif",
    fontWeight: "bold",
    outlineWidth: 2,
    outlineColor: [0, 0, 0, 255], // Black outline for better visibility
    billboard: true,
    sizeScale: 1,
    sizeMinPixels: 12,
    sizeMaxPixels: 20,
  });

  // Function to find mother aircraft (node with highest SNR, deterministic tie-breaking)
  const findMotherAircraft = () => {
    const nodeLayers = layers.filter(
      (layer) => layer.type === "nodes" && layer.nodes
    );

    if (nodeLayers.length === 0) return null;

    let allNodes: any[] = [];

    // Collect all nodes from all layers
    nodeLayers.forEach((layer) => {
      if (layer.nodes) {
        allNodes.push(...layer.nodes);
      }
    });

    if (allNodes.length === 0) return null;

    // Sort nodes by SNR (descending), then by userId (ascending) for deterministic tie-breaking
    const sortedNodes = allNodes
      .filter((node) => node.snr !== undefined && node.snr !== null)
      .sort((a, b) => {
        // Primary sort: SNR (highest first)
        if (b.snr !== a.snr) {
          return b.snr - a.snr;
        }
        // Secondary sort: userId (lowest first) for deterministic tie-breaking
        return a.userId - b.userId;
      });

    // Return the first node (highest SNR, or lowest userId if SNR is tied)
    return sortedNodes.length > 0 ? sortedNodes[0] : null;
  };

  // Update mother aircraft position when layers change (without auto-centering)
  useEffect(() => {
    const motherAircraft = findMotherAircraft();
    if (motherAircraft) {
      const newPosition: [number, number] = [
        motherAircraft.longitude,
        motherAircraft.latitude,
      ];
      setMotherAircraftPosition(newPosition);
      // Removed automatic centering - map will stay at current position
    }
  }, [layers]);

  // Enhanced tilt control component with mountain view support
  const TiltControl = () => {
    const angles = [0, 15, 30, 45, 60, 75, 85]; // Added 85° for extreme mountain views

    return (
      <div className="absolute top-4 right-4 z-50 bg-white rounded-lg shadow-lg p-3">
        <div className="text-xs font-medium text-gray-700 mb-3">
          Camera Controls
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

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        position: "relative",
        overflow: "hidden",
        backgroundColor: isMapEnabled ? "transparent" : "#000000",
      }}
    >
      <TiltControl />

      {/* Node Call Dialog */}
      {selectedNodeForCall && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-4 max-w-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-800">
              Node {selectedNodeForCall.nodeId}
            </h3>
            <button
              onClick={() => setSelectedNodeForCall(null)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div className="space-y-3">
            <div className="text-sm text-gray-600">
              <p>Do you want to initiate a call with this node?</p>
            </div>

            <div className="bg-gray-50 p-3 rounded-lg">
              <div className="text-xs text-gray-500 mb-1">Node Details:</div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span>SNR:</span>
                  <span className="font-mono">
                    {selectedNodeForCall.snr} dB
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>RSSI:</span>
                  <span className="font-mono">
                    {selectedNodeForCall.rssi} dBm
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Hop Count:</span>
                  <span className="font-mono">
                    {selectedNodeForCall.hopCount}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  // Initiate call
                  console.log(
                    "Initiating call with node:",
                    selectedNodeForCall.nodeId
                  );
                  alert(`Calling Node ${selectedNodeForCall.nodeId}...`);
                  setSelectedNodeForCall(null);
                }}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                📞 Call Node
              </button>
              <button
                onClick={() => {
                  // Show icon selection
                  setSelectedNodeForIcon(selectedNodeForCall.nodeId);
                  setSelectedNodeForCall(null);
                }}
                className="flex-1 bg-gray-500 hover:bg-gray-600 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                🎨 Change Icon
              </button>
            </div>

            <button
              onClick={() => setSelectedNodeForCall(null)}
              className="w-full px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Node Icon Selection Panel */}
      {selectedNodeForIcon && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-w-xs">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-800">
              Node {selectedNodeForIcon}
            </h3>
            <button
              onClick={() => setSelectedNodeForIcon(null)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-5 gap-1 mb-2">
            {getAvailableIcons().map((iconName) => (
              <button
                key={iconName}
                onClick={() => {
                  setNodeIcon(selectedNodeForIcon, iconName);
                  setSelectedNodeForIcon(null);
                }}
                className={`flex flex-col items-center p-1.5 rounded border transition-all ${
                  nodeIconMappings[selectedNodeForIcon] === iconName
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
                title={iconName.replace(/_/g, " ").replace(/-/g, " ")}
              >
                <img
                  src={`/icons/${iconName}.svg`}
                  alt={iconName}
                  className="w-4 h-4"
                />
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              // Set to null to remove custom mapping and use default
              setNodeIcon(selectedNodeForIcon, "");
              setSelectedNodeForIcon(null);
            }}
            className="w-full px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
          >
            Default
          </button>
        </div>
      )}

      {/* Offline Mode Status Indicator */}

      <Map
        ref={mapRef}
        style={{ width: "100%", height: "100%" }}
        mapboxAccessToken="pk.eyJ1IjoibmlraGlsc2FyYWYiLCJhIjoiY2xlc296YjRjMDA5dDNzcXphZjlzamFmeSJ9.7ZDaMZKecY3-70p9pX9-GQ"
        reuseMaps={true}
        initialViewState={{
          longitude: 77.0266, // Fixed Gurgaon center longitude
          latitude: 28.4595, // Fixed Gurgaon center latitude
          zoom: 12, // Fixed zoom level
          pitch: pitch,
          bearing: 0,
        }}
        maxPitch={85}
        onLoad={(map: any) => {
          // Add offline tile source
          if (!map.target.getSource("offline-tiles")) {
            map.target.addSource("offline-tiles", {
              type: "raster",
              tiles: ["/tile-final/{z}/{x}/{y}.png"],
              tileSize: 256,
              minzoom: 8,
              maxzoom: 15,
              bounds: [76.9, 27.8, 77.2, 28.8], // Gurgaon area bounds
            });
          }

          // Add error handling for tile loading
          map.target.on("sourcedata", (e: any) => {
            if (e.sourceId === "offline-tiles" && e.isSourceLoaded) {
              console.log("Offline tiles loaded successfully");
            }
          });

          map.target.on("error", (e: any) => {
            if (e.sourceId === "offline-tiles") {
              console.warn("Failed to load offline tiles:", e.error);
            }
          });

          // Add offline tile layer as base layer
          if (!map.target.getLayer("offline-tiles-layer")) {
            map.target.addLayer({
              id: "offline-tiles-layer",
              type: "raster",
              source: "offline-tiles",
              paint: {
                "raster-opacity": 1.0,
              },
            });
          }

          // Add DEM source for terrain
          // if (!map.target.getSource("mapbox-dem")) {
          //   map.target.addSource("mapbox-dem", {
          //     type: "raster-dem",
          //     url: "mapbox://mapbox.terrain-rgb", // Mapbox DEM tileset
          //     tileSize: 512,
          //     maxzoom: 14,
          //   });
          // }

          // Enable 3D terrain with ultra-high exaggeration for street view-like mountain experience
          map.target.setTerrain({
            source: "mapbox-dem",
            exaggeration: 4.0, // Ultra-high exaggeration for street view-like mountain experience
          });

          // Add enhanced sky layer for dramatic 3D atmosphere
          if (!map.target.getLayer("sky")) {
            map.target.addLayer({
              id: "sky",
              type: "sky",
              paint: {
                "sky-type": "atmosphere",
                "sky-atmosphere-sun": [0.0, 90.0], // Position sun higher for better lighting
                "sky-atmosphere-sun-intensity": 20, // Increased intensity for more dramatic shadows
                "sky-atmosphere-color": "rgba(85, 151, 210, 0.5)", // Slightly blue tint
                "sky-atmosphere-halo-color": "rgba(255, 255, 255, 0.8)",
              },
            });
          }

          // Set map bounds to match offline tile coverage
          map.target.setMaxBounds([76.9, 27.8, 77.2, 28.8]);
        }}
        onClick={handleMapClick}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <DeckGLOverlay layers={[...allLayers, stateNamesLayer]} />
        <NavigationControl
          position="bottom-right"
          showCompass={true}
          showZoom={true}
        />
      </Map>

      <Tooltip hoverInfo={hoverInfo} getLayerInfo={getLayerInfo} />
    </div>
  );
};

export default MapComponent;
