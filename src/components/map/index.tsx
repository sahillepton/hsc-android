// @ts-nocheck
import Map, { useControl, NavigationControl } from "react-map-gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { DeckGL } from "@deck.gl/react";
import { useEffect, useRef, useState } from "react";
import { useLayersContext } from "@/layers-provider";
import type { LayerProps } from "@/lib/definitions";
import { TextLayer } from "@deck.gl/layers";
import { indianStatesData } from "@/data/indian-states";
import placesData from "@/lib/places.json";
import IconSelector from "@/components/icon-selector";
import "mapbox-gl/dist/mapbox-gl.css";

// TODO: use turf.js for calculations, it will be more correct, your code is not tested
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
              <div className="text-gray-300 text-xs">Location (lat, lng):</div>
              <div className="font-mono text-xs">
                [{object.latitude.toFixed(6)}, {object.longitude.toFixed(6)}]
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
                  <div className="text-gray-300 text-xs">
                    Location (lat, lng):
                  </div>
                  <div className="font-mono text-xs">
                    [{object.geometry.coordinates[1].toFixed(6)},{" "}
                    {object.geometry.coordinates[0].toFixed(6)}]
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
              Coordinates (lat, lng): [
              {object.geometry.coordinates[1].toFixed(4)},{" "}
              {object.geometry.coordinates[0].toFixed(4)}]
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
            From (lat, lng): [{object.sourcePosition[1].toFixed(4)},{" "}
            {object.sourcePosition[0].toFixed(4)}]
          </div>
          <div>
            To (lat, lng): [{object.targetPosition[1].toFixed(4)},{" "}
            {object.targetPosition[0].toFixed(4)}]
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
            Coordinates (lat, lng): [{object.position[1].toFixed(4)},{" "}
            {object.position[0].toFixed(4)}]
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
  // TODO: Explain why an effect is needed here?????????
  useEffect(() => {
    (window as any).mapRef = mapRef;
  }, []);

  // Node click events are now handled directly in use-layers.ts
  // The dialog is shown through the sidebar component

  // TODO: Most of this state should be part of the global store.
  const [isMapEnabled, setIsMapEnabled] = useState(true);
  const [pitch, setPitch] = useState(0);
  const [is3DTerrainMode, setIs3DTerrainMode] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(true);
  const [selectedNodeForIcon, setSelectedNodeForIcon] = useState<string | null>(
    null
  );
  const [motherAircraftPosition, setMotherAircraftPosition] = useState<
    [number, number] | null
  >(null);
  const [mapZoom, setMapZoom] = useState(4);

  // State to track network progression
  const [networkState, setNetworkState] = useState({
    nodeCount: 8, // 8 nodes from XLSX tabs
    basePosition: { lat: 10.8505, lng: 76.2711 }, // Kerala starting position
    movementDirection: 0, // Direction in degrees (0 = North towards Kashmir)
    updateCount: 0, // Track number of updates
  });

  // State to store node coordinates from XLSX (all rows from each tab)
  const [nodeCoordinatesData, setNodeCoordinatesData] = useState<
    Array<Array<{ lat: number; lng: number }>>
  >([]);
  const [currentRowIndex, setCurrentRowIndex] = useState(0);

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

  // India bounds for network layer validation
  const indiaBounds = {
    north: 37.1,
    south: 6.5,
    east: 97.4,
    west: 68.1,
  };

  // Validate if coordinates are within India bounds
  const isWithinIndiaBounds = (lat: number, lng: number) => {
    return (
      lat >= indiaBounds.south &&
      lat <= indiaBounds.north &&
      lng >= indiaBounds.west &&
      lng <= indiaBounds.east
    );
  };

  // Load JSON files for node coordinates (converted from XLSX)
  // TODO: This should be a separate hook, in a separate file, this XLSX logic is temporary
  // How can you think ki Ill jjust put it here, you will need to remove it eventually, so
  // put it in a place where it can be easily removed later.
  useEffect(() => {
    const loadNodeData = async () => {
      try {
        const coordinates: Array<{ lat: number; lng: number }[]> = [];

        // Load JSON files for each of the 8 nodes
        for (let i = 1; i <= 8; i++) {
          try {
            const response = await fetch(`/node-data/node-${i}.json`);
            if (!response.ok) {
              console.warn(
                `Failed to load node-${i}.json:`,
                response.statusText
              );
              continue;
            }
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
              coordinates.push(data);
              console.log(`Loaded node-${i}.json: ${data.length} coordinates`);
            }
          } catch (error) {
            console.error(`Error loading node-${i}.json:`, error);
          }
        }

        // Store all coordinates for each node
        if (coordinates.length === 8) {
          setNodeCoordinatesData(coordinates);
          console.log(
            "Loaded coordinates from JSON files:",
            coordinates.map((tab, idx) => `Node ${idx + 1}: ${tab.length} rows`)
          );
        } else {
          console.warn("Expected 8 node files, found:", coordinates.length);
          if (coordinates.length > 0) {
            // Use what we have
            setNodeCoordinatesData(coordinates);
          }
        }
      } catch (error) {
        console.error("Error loading node data files:", error);
      }
    };

    loadNodeData();
  }, []);

  // Generate progressive network nodes using JSON coordinates (converted from XLSX)
  const generateProgressiveNodes = () => {
    const nodes: any[] = [];
    const time = Date.now() / 1000;

    // If we have coordinates from JSON files, use them
    if (nodeCoordinatesData.length === 8) {
      // Use coordinates from JSON files, cycling through rows based on currentRowIndex
      for (let i = 0; i < 8; i++) {
        const tabData = nodeCoordinatesData[i];
        if (!tabData || tabData.length === 0) continue;

        // Cycle through rows, wrapping around if needed
        const rowIndex = currentRowIndex % tabData.length;
        const coord = tabData[rowIndex];

        // Generate realistic but changing values
        const snr = Math.sin(time / 10 + i) * 5 + 15 + Math.random() * 5; // 10-25 dB range
        const rssi = Math.cos(time / 8 + i) * 20 - 60 + Math.random() * 10; // -80 to -40 dBm range
        const distance = Math.abs(Math.sin(time / 15 + i)) * 100000 + 50000;
        const hopCount = i === 0 ? 0 : Math.floor(Math.random() * 4) + 1;

        // Generate connected node IDs (connect to nearby nodes)
        const connectedNodeIds = [];
        const connectionCount = Math.min(Math.floor(Math.random() * 3) + 1, 7);
        for (let j = 0; j < connectionCount; j++) {
          const connectedId = Math.floor(Math.random() * 8) + 1;
          if (
            connectedId !== i + 1 &&
            !connectedNodeIds.includes(connectedId)
          ) {
            connectedNodeIds.push(connectedId);
          }
        }

        nodes.push({
          userId: i + 1,
          latitude: coord.lat,
          longitude: coord.lng,
          snr: parseFloat(snr.toFixed(1)),
          rssi: parseFloat(rssi.toFixed(1)),
          distance: parseFloat(distance.toFixed(2)),
          hopCount: hopCount,
          connectedNodeIds: connectedNodeIds,
          lastSeen: new Date().toISOString(),
          batteryLevel: Math.floor(Math.random() * 100),
          status: Math.random() > 0.1 ? "online" : "offline",
          isCenterNode: i === 0, // First node is center
        });
      }
    } else {
      // Fallback to default behavior if XLSX not loaded yet
      for (let i = 1; i <= 8; i++) {
        nodes.push({
          userId: i,
          latitude: 10.8505 + i * 0.1,
          longitude: 76.2711 + i * 0.1,
          snr: 20,
          rssi: -50,
          distance: 10000 * i,
          hopCount: i === 1 ? 0 : 1,
          connectedNodeIds: [],
          lastSeen: new Date().toISOString(),
          batteryLevel: 100,
          status: "online",
          isCenterNode: i === 1,
        });
      }
    }

    return nodes;
  };

  // Update progressive network nodes every 1 second with XLSX coordinates
  useEffect(() => {
    if (!networkLayersVisible) return;
    if (nodeCoordinatesData.length === 0) return; // Wait for XLSX to load

    const interval = setInterval(() => {
      // Increment row index to cycle through XLSX data rows
      setCurrentRowIndex((prev) => prev + 1);

      // Generate and create the progressive nodes using XLSX coordinates
      const progressiveNodes = generateProgressiveNodes();
      createNodeLayer(progressiveNodes, "Progressive Network");
    }, 1000); // Update every 1 second

    // Initial load
    const initialNodes = generateProgressiveNodes();
    createNodeLayer(initialNodes, "Progressive Network");

    return () => clearInterval(interval);
  }, [
    createNodeLayer,
    networkLayersVisible,
    nodeCoordinatesData,
    currentRowIndex,
  ]);

  // Function to find layer info from layer ID
  const getLayerInfo = (layerId: string) => {
    return layers.find((layer) => layer.id === layerId);
  };

  // Custom click handler for closing dialogs
  const handleMapClick = (event: any) => {
    const { object } = event;

    // If clicking on empty space, close any open dialogs
    if (selectedNodeForIcon && !object) {
      setSelectedNodeForIcon(null);
      return;
    }

    // For other clicks, use the default handler
    handleClick(event);
  };

  // Create state names text layer with zoom-responsive sizing
  // Text size scales smoothly from 12px at zoom 0 to 28px at zoom 12
  // Always visible regardless of zoom level
  // TODO: Why are these deckgl layers being created here, shouldn't they be created when something changes, and
  // added to the layers state
  const stateTextSize = Math.max(12, Math.min(28, 12 + (mapZoom - 0) * 1.33));
  const stateNamesLayer = new TextLayer({
    id: "state-names-layer",
    data: indianStatesData,
    pickable: false,
    getPosition: (d: any) => d.coordinates,
    getText: (d: any) => d.name,
    getSize: stateTextSize,
    getAngle: 0,
    getTextAnchor: "middle",
    getAlignmentBaseline: "center",
    getColor: [255, 0, 0, 255], // Bright red for states
    fontFamily: "Arial, sans-serif",
    fontWeight: "bold",
    outlineWidth: Math.max(1.2, Math.min(3, 1.2 + (mapZoom - 0) * 0.15)), // Scale outline with zoom
    outlineColor: [0, 0, 0, 255], // Black outline for better visibility
    billboard: true,
    sizeScale: 1,
    sizeMinPixels: Math.max(10, 10 + (mapZoom - 0) * 1.2), // Dynamic min based on zoom
    sizeMaxPixels: Math.max(20, 20 + (mapZoom - 0) * 2), // Dynamic max based on zoom
    // Avoid label overlaps
    collisionEnabled: true,
    collisionPadding: Math.max(2, 2 + (mapZoom - 0) * 0.35), // Scale padding with zoom
    visible: true, // Always visible
  });

  // Build map of state name -> coordinates from indianStatesData
  const stateCenterByName: Record<string, [number, number]> = (
    indianStatesData as any[]
  ).reduce((acc: Record<string, [number, number]>, item: any) => {
    const key = String(item.name || "")
      .trim()
      .toLowerCase();
    if (item.coordinates && Array.isArray(item.coordinates)) {
      acc[key] = item.coordinates as [number, number];
    }
    return acc;
  }, {});

  // Create India places text layer from all cities (if places exist)
  const indiaPlacesData = Object.entries(placesData as any).flatMap(
    ([cityName, city]: [string, any]) =>
      (city?.districts || []).flatMap((district: any) =>
        Array.isArray(district?.places)
          ? district.places.map((place: any) => ({
              name: place.name,
              coordinates: [place.lng, place.lat],
              city: cityName,
            }))
          : []
      )
  );

  // Create India places text layer with zoom-responsive sizing
  // Text size scales smoothly from 11px at zoom 8 to 20px at zoom 12
  const placesTextSize =
    mapZoom >= 8 ? Math.max(11, Math.min(20, 9 + (mapZoom - 8) * 2.25)) : 11;
  const indiaPlacesLayer = new TextLayer({
    id: "india-places-layer",
    data: indiaPlacesData,
    pickable: false,
    getPosition: (d: any) => d.coordinates,
    getText: (d: any) => d.name,
    getSize: placesTextSize,
    getAngle: 0,
    getTextAnchor: "middle",
    getAlignmentBaseline: "center",
    getColor: [255, 255, 0, 255], // Bright yellow text
    fontFamily: "Arial, sans-serif",
    fontWeight: "bold",
    outlineWidth:
      mapZoom >= 8
        ? Math.max(1.2, Math.min(2.5, 0.8 + (mapZoom - 8) * 0.43))
        : 1.2, // Scale outline with zoom
    outlineColor: [0, 0, 0, 255], // Black outline for better visibility
    billboard: true,
    sizeScale: 1,
    sizeMinPixels: mapZoom >= 8 ? Math.max(9, 7 + (mapZoom - 8) * 1.5) : 9, // Dynamic min based on zoom
    sizeMaxPixels: mapZoom >= 8 ? Math.max(16, 13 + (mapZoom - 8) * 2.25) : 16, // Dynamic max based on zoom
    // Avoid label overlaps
    collisionEnabled: true,
    collisionPadding:
      mapZoom >= 8 ? Math.max(1.5, 1 + (mapZoom - 8) * 0.5) : 1.5, // Scale padding with zoom
    visible: mapZoom >= 8, // Show at slightly lower zoom for better visibility
  });

  // Create India districts text layer (from places.json districts, positioned near state center)
  const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~2.399
  const districtsLabelData = Object.entries(placesData as any).flatMap(
    ([stateName, stateObj]: [string, any]) => {
      const stateKey = stateName.trim().toLowerCase();
      const base = stateCenterByName[stateKey];
      if (!base) return [] as any[];
      const districts = Array.isArray(stateObj?.districts)
        ? stateObj.districts
        : [];
      return districts.map((d: any, idx: number) => {
        const rDeg = 0.05 + 0.015 * Math.floor(idx / 6); // small radial spread in degrees
        const theta = idx * goldenAngle;
        const dx = rDeg * Math.cos(theta);
        const dy = rDeg * Math.sin(theta);
        const lng = base[0] + dx;
        const lat = base[1] + dy;
        return {
          name: String(d?.name || ""),
          coordinates: [lng, lat] as [number, number],
          state: stateName,
        };
      });
    }
  );

  // Create India districts text layer with zoom-responsive sizing
  // Text size scales smoothly from 12px at zoom 7 to 22px at zoom 12
  const districtsTextSize =
    mapZoom >= 7 ? Math.max(12, Math.min(22, 10 + (mapZoom - 7) * 2.4)) : 12;
  const indiaDistrictsLayer = new TextLayer({
    id: "india-districts-layer",
    data: districtsLabelData,
    pickable: false,
    getPosition: (d: any) => d.coordinates,
    getText: (d: any) => d.name,
    getSize: districtsTextSize,
    getAngle: 0,
    getTextAnchor: "middle",
    getAlignmentBaseline: "center",
    getColor: [255, 165, 0, 255], // Bright orange for districts
    fontFamily: "Arial, sans-serif",
    fontWeight: "bold",
    outlineWidth:
      mapZoom >= 7
        ? Math.max(1.3, Math.min(2.5, 1 + (mapZoom - 7) * 0.3))
        : 1.3, // Scale outline with zoom
    outlineColor: [0, 0, 0, 255],
    billboard: true,
    sizeScale: 1,
    sizeMinPixels: mapZoom >= 7 ? Math.max(10, 8 + (mapZoom - 7) * 1.6) : 10, // Dynamic min based on zoom
    sizeMaxPixels: mapZoom >= 7 ? Math.max(18, 15 + (mapZoom - 7) * 2.4) : 18, // Dynamic max based on zoom
    collisionEnabled: true,
    collisionPadding: mapZoom >= 7 ? Math.max(2, 1.5 + (mapZoom - 7) * 0.5) : 2, // Scale padding with zoom
    visible: mapZoom >= 7, // Show at slightly lower zoom for better visibility
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
  // TODO: HOW THE FUCK DO YOU CREATE A COMPONENT INSIDE A COMPONENT?
  const TiltControl = () => {
    const angles = [0, 15, 30, 45, 60, 75, 85]; // Added 85° for extreme mountain views

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

  // TODO: why is suddenly tailwindcss not being used here?
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

      {/* Node Call Dialog - Removed: TODO: Why is this here if removed? Don't accept any AI code aise hi. Now handled by sidebar component */}

      {/* Node Icon Selection Panel: TODO: should be a separate component */}
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
        attributionControl={false}
        dragRotate={true}
        touchZoomRotate={true}
        pitchWithRotate={true}
        initialViewState={{
          longitude: 76.2711, // Kerala starting longitude
          latitude: 10.8505, // Kerala starting latitude
          zoom: 4, // Initial zoom level for Kerala to Kashmir view
          pitch: pitch,
          bearing: 0,
        }}
        minZoom={0}
        maxZoom={12}
        maxPitch={85}
        onLoad={(map: any) => {
          // Add offline tile source
          if (!map.target.getSource("offline-tiles")) {
            map.target.addSource("offline-tiles", {
              type: "raster",
              tiles: ["/tiles-map/{z}/{x}/{y}.png"],

              minzoom: 0,
              maxzoom: 12,
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
                "raster-opacity": 0.5,
              },
            });
          }
          map.target.setMaxBounds(null);
        }}
        onClick={handleMapClick}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMove={(e: any) => {
          if (e && e.viewState && typeof e.viewState.zoom === "number") {
            setMapZoom(e.viewState.zoom);
          }
        }}
      >
        <DeckGLOverlay
          layers={[
            ...allLayers,
            stateNamesLayer,
            indiaPlacesLayer,
            indiaDistrictsLayer,
          ]}
        />
        <NavigationControl
          position="bottom-right"
          showCompass={true}
          showZoom={true}
        />
      </Map>

      <Tooltip hoverInfo={hoverInfo} getLayerInfo={getLayerInfo} />

      {/* Watermark and Zoom Controls */}
      <div className="absolute bottom-4 right-4 z-50 flex items-end gap-3">
        {/* Watermark to the left of zoom controls */}
        <div
          className="text-[10px] md:text-xs px-2 py-1 rounded font-bold"
          style={{
            background: "rgba(0,0,0,0.4)",
            color: "#ffffff",
            letterSpacing: "0.08em",
            userSelect: "none",
            pointerEvents: "none",
          }}
        >
          IGRS WGS84
        </div>

        {/* Zoom Controls */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => {
              if (mapRef.current) {
                const map = mapRef.current.getMap();
                const currentZoom = map.getZoom();
                map.easeTo({ zoom: currentZoom + 1, duration: 300 });
              }
            }}
            className="w-10 h-10 bg-white border border-gray-300 rounded-lg shadow-lg hover:bg-gray-50 transition-colors flex items-center justify-center text-gray-700 hover:text-gray-900"
            title="Zoom In"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
              <line x1="11" y1="8" x2="11" y2="14"></line>
              <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
          </button>

          <button
            onClick={() => {
              if (mapRef.current) {
                const map = mapRef.current.getMap();
                const currentZoom = map.getZoom();
                map.easeTo({ zoom: currentZoom - 1, duration: 300 });
              }
            }}
            className="w-10 h-10 bg-white border border-gray-300 rounded-lg shadow-lg hover:bg-gray-50 transition-colors flex items-center justify-center text-gray-700 hover:text-gray-900"
            title="Zoom Out"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
              <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default MapComponent;
