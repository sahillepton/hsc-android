import { formatArea, getDistance, getPolygonArea, rgbToHex } from "@/lib/utils";
import { useHoverInfo, useLayers } from "@/store/layers-store";
import { useUdpSymbolsStore } from "@/store/udp-symbols-store";
import { useEffect, useState } from "react";

const availableIcons = [
  "alert",
  "command_post",
  "friendly_aircraft",
  "ground_unit",
  "hostile_aircraft",
  "mother-aircraft",
  "naval_unit",
  "neutral_aircraft",
  "sam_site",
  "unknown_aircraft",
];

const Tooltip = () => {
  const { hoverInfo } = useHoverInfo();
  const { layers } = useLayers();
  const { getNodeSymbol, setNodeSymbol } = useUdpSymbolsStore();
  const [tooltipPosition, setTooltipPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [udpDataUpdateTrigger, setUdpDataUpdateTrigger] = useState(0);
  const mapRef = (window as any).mapRef;

  // Poll for UDP data updates when showing UDP layer tooltip (to avoid rerenders)
  const isUdpLayerTooltip =
    hoverInfo?.layer?.id === "udp-network-members-layer" ||
    hoverInfo?.layer?.id === "udp-targets-layer";

  useEffect(() => {
    if (!isUdpLayerTooltip) return;

    const interval = setInterval(() => {
      // Just trigger a state update to force tooltip re-render
      setUdpDataUpdateTrigger((prev) => prev + 1);
    }, 100); // Check every 100ms for UDP data updates

    return () => clearInterval(interval);
  }, [isUdpLayerTooltip]);

  // Update tooltip position when map moves/zooms or UDP data changes
  useEffect(() => {
    if (!hoverInfo || !hoverInfo.object || !mapRef?.current) {
      setTooltipPosition(null);
      return;
    }

    const updatePosition = () => {
      try {
        const map = mapRef.current.getMap();
        if (!map) return;

        // Get object coordinates - for UDP layers, use latest data from stream
        let lng: number | undefined;
        let lat: number | undefined;

        // Check if this is a UDP layer - get latest coordinates from stream
        const currentUdpData = (window as any).udpData || {
          targets: [],
          networkMembers: [],
        };
        if (
          hoverInfo.layer?.id === "udp-network-members-layer" ||
          hoverInfo.layer?.id === "udp-targets-layer"
        ) {
          const userId =
            hoverInfo.object.userId ||
            hoverInfo.object.id ||
            hoverInfo.object.globalId;
          const isNetworkLayer =
            hoverInfo.layer.id === "udp-network-members-layer";
          const dataArray = isNetworkLayer
            ? currentUdpData.networkMembers || []
            : currentUdpData.targets || [];

          // Find the latest data for this node
          const latestNodeData = dataArray.find((item: any) => {
            if (!item) return false;
            return (
              item.userId === userId ||
              item.id === userId ||
              item.globalId === userId ||
              String(item.userId) === String(userId) ||
              String(item.id) === String(userId) ||
              String(item.globalId) === String(userId)
            );
          });

          if (
            latestNodeData &&
            latestNodeData.longitude !== undefined &&
            latestNodeData.latitude !== undefined
          ) {
            lng = latestNodeData.longitude;
            lat = latestNodeData.latitude;
          }
        }

        // Fallback to object coordinates if not found in latest data
        if (lng === undefined || lat === undefined) {
          // Try to get coordinates from different object structures
          if (hoverInfo.object.geometry?.coordinates) {
            // GeoJSON Point
            if (
              Array.isArray(hoverInfo.object.geometry.coordinates) &&
              hoverInfo.object.geometry.coordinates.length >= 2
            ) {
              lng = hoverInfo.object.geometry.coordinates[0];
              lat = hoverInfo.object.geometry.coordinates[1];
            } else if (
              hoverInfo.object.geometry.type === "Polygon" &&
              Array.isArray(hoverInfo.object.geometry.coordinates[0])
            ) {
              // Polygon - use first point of first ring as reference
              const firstRing = hoverInfo.object.geometry.coordinates[0];
              if (
                firstRing &&
                firstRing.length > 0 &&
                Array.isArray(firstRing[0])
              ) {
                lng = firstRing[0][0];
                lat = firstRing[0][1];
              }
            }
          } else if (
            hoverInfo.object.polygon &&
            Array.isArray(hoverInfo.object.polygon)
          ) {
            // Direct polygon layer - use first point as reference
            const firstRing =
              Array.isArray(hoverInfo.object.polygon[0]) &&
              Array.isArray(hoverInfo.object.polygon[0][0])
                ? hoverInfo.object.polygon[0] // Array of rings
                : hoverInfo.object.polygon; // Single ring
            if (
              firstRing &&
              firstRing.length > 0 &&
              Array.isArray(firstRing[0])
            ) {
              lng = firstRing[0][0];
              lat = firstRing[0][1];
            }
          } else if (
            hoverInfo.object.longitude !== undefined &&
            hoverInfo.object.latitude !== undefined
          ) {
            // Direct coordinates
            lng = hoverInfo.object.longitude;
            lat = hoverInfo.object.latitude;
          } else if (
            hoverInfo.object.position &&
            Array.isArray(hoverInfo.object.position)
          ) {
            // Position array [lng, lat]
            lng = hoverInfo.object.position[0];
            lat = hoverInfo.object.position[1];
          } else if (hoverInfo.coordinate) {
            // PickingInfo coordinate
            lng = hoverInfo.coordinate[0];
            lat = hoverInfo.coordinate[1];
          }
        }

        if (lng !== undefined && lat !== undefined) {
          // Project geographic coordinates to screen coordinates
          const point = map.project([lng, lat]);
          setTooltipPosition({ x: point.x, y: point.y });
        } else {
          // Fallback to original x, y if coordinates can't be determined
          setTooltipPosition({ x: hoverInfo.x || 0, y: hoverInfo.y || 0 });
        }
      } catch (error) {
        // Fallback to original x, y on error
        setTooltipPosition({ x: hoverInfo.x || 0, y: hoverInfo.y || 0 });
      }
    };

    updatePosition();

    // Listen to map move events
    const map = mapRef.current?.getMap();
    if (map) {
      map.on("move", updatePosition);
      map.on("zoom", updatePosition);

      return () => {
        map.off("move", updatePosition);
        map.off("zoom", updatePosition);
      };
    }
  }, [hoverInfo, mapRef, udpDataUpdateTrigger]);

  if (!hoverInfo || !hoverInfo.object) {
    return null;
  }

  // Use calculated position or fallback to original
  const x = tooltipPosition?.x ?? hoverInfo.x ?? 0;
  const y = tooltipPosition?.y ?? hoverInfo.y ?? 0;

  if (x === 0 && y === 0) {
    return null;
  }

  const { object, layer } = hoverInfo;

  // Find the layer from the store using multiple strategies
  let layerInfo: (typeof layers)[0] | undefined = undefined;

  // Check if the object has a layerId (for line layers)
  if ((object as any)?.layerId) {
    layerInfo = layers.find((l) => l.id === (object as any).layerId);
  }
  // Check if the object is a LayerProps itself (for point/polygon layers)
  else if ((object as any)?.id && (object as any)?.type) {
    layerInfo = layers.find((l) => l.id === (object as any).id);
  }
  // Check if the deck.gl layer has an id that matches a store layer (for GeoJSON layers, node layers, etc.)
  else if (layer?.id) {
    const deckLayerId = layer.id;
    // Check if this ID matches a layer in the store directly
    layerInfo = layers.find((l) => l.id === deckLayerId);
    // If not found, check if it's a sub-layer (e.g., `${layer.id}-icon-layer`)
    if (!layerInfo) {
      // Try to extract the base layer ID by removing common suffixes
      const baseId = deckLayerId
        .replace(/-icon-layer$/, "")
        .replace(/-signal-overlay$/, "")
        .replace(/-bitmap$/, "");
      layerInfo = layers.find((l) => l.id === baseId);
    }
  }
  const getTooltipContent = () => {
    // Handle UDP layers - get latest data from stream
    if (
      layer?.id === "udp-network-members-layer" ||
      layer?.id === "udp-targets-layer"
    ) {
      const userId = object.userId || object.id || object.globalId || 0;
      const isNetworkLayer = layer.id === "udp-network-members-layer";

      // Get latest data from UDP stream
      const currentUdpData = (window as any).udpData || {
        targets: [],
        networkMembers: [],
      };
      const dataArray = isNetworkLayer
        ? currentUdpData.networkMembers || []
        : currentUdpData.targets || [];
      const latestNodeData =
        dataArray.find((item: any) => {
          if (!item) return false;
          return (
            item.userId === userId ||
            item.id === userId ||
            item.globalId === userId ||
            String(item.userId) === String(userId) ||
            String(item.id) === String(userId) ||
            String(item.globalId) === String(userId)
          );
        }) || object; // Fallback to original object if not found

      const currentSymbol = getNodeSymbol(layer.id, userId);
      const defaultSymbol =
        layer.id === "udp-network-members-layer"
          ? "friendly_aircraft"
          : "alert";
      const displaySymbol = currentSymbol || defaultSymbol;

      return (
        <div className="bg-black bg-opacity-80 text-white p-3 rounded shadow-lg text-sm max-w-xs">
          <div className="font-semibold text-blue-400 mb-1">
            {layer.id === "udp-network-members-layer"
              ? "Network Member"
              : "Target"}
          </div>
          <div className="space-y-1">
            {latestNodeData.longitude !== undefined &&
              latestNodeData.latitude !== undefined && (
                <div className="flex justify-between gap-2">
                  <span className="text-gray-300">Location:</span>
                  <span className="font-mono text-xs mt-0.5">
                    [{latestNodeData.latitude.toFixed(6)},{" "}
                    {latestNodeData.longitude.toFixed(6)}]
                  </span>
                </div>
              )}
            {(latestNodeData.userId !== undefined ||
              latestNodeData.globalId !== undefined) && (
              <div className="flex justify-between">
                <span className="text-gray-300">User ID:</span>
                <span className="font-mono">
                  {latestNodeData.userId || latestNodeData.globalId}
                </span>
              </div>
            )}
            {latestNodeData.altitude !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-300">Altitude:</span>
                <span className="font-mono">{latestNodeData.altitude} m</span>
              </div>
            )}
            {latestNodeData.trueHeading !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-300">Heading:</span>
                <span className="font-mono">{latestNodeData.trueHeading}°</span>
              </div>
            )}
            {latestNodeData.heading !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-300">Heading:</span>
                <span className="font-mono">{latestNodeData.heading}°</span>
              </div>
            )}
            {latestNodeData.groundSpeed !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-300">Speed:</span>
                <span className="font-mono">
                  {latestNodeData.groundSpeed} m/s
                </span>
              </div>
            )}
            {latestNodeData.range !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-300">Range:</span>
                <span className="font-mono">{latestNodeData.range} m</span>
              </div>
            )}
            {latestNodeData.snr !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-300">SNR:</span>
                <span className="font-mono">{latestNodeData.snr} dB</span>
              </div>
            )}
            {latestNodeData.rssi !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-300">RSSI:</span>
                <span className="font-mono">{latestNodeData.rssi} dBm</span>
              </div>
            )}
            {latestNodeData.distance !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-300">Distance:</span>
                <span className="font-mono">
                  {latestNodeData.distance.toFixed(2)} m
                </span>
              </div>
            )}
            {latestNodeData.hopCount !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-300">Hop Count:</span>
                <span className="font-mono">{latestNodeData.hopCount}</span>
              </div>
            )}
            {latestNodeData.connectedNodeIds &&
              latestNodeData.connectedNodeIds.length > 0 && (
                <div className="mt-2 pt-1 border-t border-gray-600">
                  <div className="text-gray-300 text-xs mb-1">
                    Connected Nodes:
                  </div>
                  <div className="font-mono text-xs">
                    [{latestNodeData.connectedNodeIds.join(", ")}]
                  </div>
                </div>
              )}
            {/* Symbol Selection for UDP Layers - Per Node */}
            <div className="mt-2 pt-1 border-t border-gray-600">
              <div className="text-gray-300 text-xs mb-2">Symbol:</div>
              <div className="grid grid-cols-5 gap-1 mb-2">
                {availableIcons.map((iconName) => {
                  const isSelected = displaySymbol === iconName;
                  return (
                    <button
                      key={iconName}
                      onClick={(e) => {
                        e.stopPropagation();
                        setNodeSymbol(layer.id, userId, iconName);
                      }}
                      className={`flex flex-col items-center justify-center p-1.5 rounded border transition-all bg-white ${
                        isSelected
                          ? "border-blue-500 bg-blue-100 ring-2 ring-blue-400"
                          : "border-gray-300 hover:border-blue-400 hover:bg-gray-50"
                      }`}
                      title={iconName.replace(/_/g, " ").replace(/-/g, " ")}
                    >
                      <img
                        src={`/icons/${iconName}.svg`}
                        alt={iconName}
                        className="w-4 h-4"
                      />
                    </button>
                  );
                })}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setNodeSymbol(layer.id, userId, "");
                }}
                className="w-full px-2 py-1 text-xs text-gray-300 hover:text-white hover:bg-gray-700 rounded transition-colors"
              >
                Default ({defaultSymbol.replace(/_/g, " ").replace(/-/g, " ")})
              </button>
            </div>
            {/* Display any other properties */}
            {Object.keys(object)
              .filter(
                (key) =>
                  ![
                    "longitude",
                    "latitude",
                    "userId",
                    "snr",
                    "rssi",
                    "distance",
                    "hopCount",
                    "connectedNodeIds",
                    "opcode",
                    "id",
                  ].includes(key)
              )
              .map((key) => (
                <div key={key} className="flex justify-between">
                  <span className="text-gray-300">{key}:</span>
                  <span className="font-mono text-xs">
                    {String(object[key])}
                  </span>
                </div>
              ))}
            {/* Action Buttons */}
            <div className="mt-3 pt-2 border-t border-gray-600">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    alert("Phone call initiated");
                  }}
                  className="px-3 py-2 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                >
                  Phone
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    alert("Video call initiated");
                  }}
                  className="px-3 py-2 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
                >
                  Video Call
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    alert("FTP connection initiated");
                  }}
                  className="px-3 py-2 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors"
                >
                  FTP
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    alert("Message sent");
                  }}
                  className="px-3 py-2 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded transition-colors"
                >
                  Message
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    const isDirectNodeObject =
      object.hasOwnProperty("snr") &&
      object.hasOwnProperty("rssi") &&
      object.hasOwnProperty("userId") &&
      object.hasOwnProperty("hopCount");

    if (isDirectNodeObject) {
      return (
        <div className="bg-black bg-opacity-80 text-white p-3 rounded shadow-lg text-sm max-w-xs">
          {layerInfo?.name && (
            <div className="font-semibold text-cyan-300 mb-2">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold text-blue-400 mb-2">Network Node</div>
          <div className="space-y-2">
            <div className="flex justify-between items-center gap-4">
              <span className="text-gray-300">User ID:</span>
              <span className="font-mono text-right">{object.userId}</span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-gray-300">SNR:</span>
              <span className="font-mono text-right">{object.snr} dB</span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-gray-300">RSSI:</span>
              <span className="font-mono text-right">{object.rssi} dBm</span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-gray-300">Distance:</span>
              <span className="font-mono text-right">
                {object.distance?.toFixed(2)} m
              </span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-gray-300">Hop Count:</span>
              <span className="font-mono text-right">{object.hopCount}</span>
            </div>
            {object.connectedNodeIds && object.connectedNodeIds.length > 0 && (
              <div className="mt-3 pt-2 border-t border-gray-600">
                <div className="flex justify-between items-start gap-4 mb-1">
                  <span className="text-gray-300 text-xs">
                    Connected Nodes:
                  </span>
                </div>
                <div className="font-mono text-xs text-right">
                  [{object.connectedNodeIds.join(", ")}]
                </div>
              </div>
            )}
            <div className="mt-3 pt-2 border-t border-gray-600">
              <div className="flex justify-between items-center gap-4">
                <span className="text-gray-300 text-xs">
                  Location (lat, lng):
                </span>
                <span className="font-mono text-xs text-right">
                  [{object.latitude.toFixed(6)}, {object.longitude.toFixed(6)}]
                </span>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-gray-600">
              <div className="text-gray-300 text-xs mb-1">Icon:</div>
              <div className="text-xs text-gray-400">
                Click on the node to change its icon
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (object.geometry) {
      const geometryType = object.geometry.type;
      const properties = object.properties || {};

      const isNodeFeature =
        properties.hasOwnProperty("snr") &&
        properties.hasOwnProperty("rssi") &&
        properties.hasOwnProperty("userId") &&
        properties.hasOwnProperty("hopCount");

      if (isNodeFeature) {
        return (
          <div className="bg-black bg-opacity-80 text-white p-3 rounded shadow-lg text-sm max-w-xs">
            {layerInfo?.name && (
              <div className="font-semibold text-cyan-300 mb-2">
                {layerInfo.name}
              </div>
            )}
            <div className="font-semibold text-blue-400 mb-2">Network Node</div>
            <div className="space-y-2">
              <div className="flex justify-between items-center gap-4">
                <span className="text-gray-300">User ID:</span>
                <span className="font-mono text-right">
                  {properties.userId}
                </span>
              </div>
              <div className="flex justify-between items-center gap-4">
                <span className="text-gray-300">SNR:</span>
                <span className="font-mono text-right">
                  {properties.snr} dB
                </span>
              </div>
              <div className="flex justify-between items-center gap-4">
                <span className="text-gray-300">RSSI:</span>
                <span className="font-mono text-right">
                  {properties.rssi} dBm
                </span>
              </div>
              <div className="flex justify-between items-center gap-4">
                <span className="text-gray-300">Distance:</span>
                <span className="font-mono text-right">
                  {properties.distance?.toFixed(2)} m
                </span>
              </div>
              <div className="flex justify-between items-center gap-4">
                <span className="text-gray-300">Hop Count:</span>
                <span className="font-mono text-right">
                  {properties.hopCount}
                </span>
              </div>
              {properties.connectedNodeIds &&
                properties.connectedNodeIds.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-gray-600">
                    <div className="flex justify-between items-start gap-4 mb-1">
                      <span className="text-gray-300 text-xs">
                        Connected Nodes:
                      </span>
                    </div>
                    <div className="font-mono text-xs text-right">
                      [{properties.connectedNodeIds.join(", ")}]
                    </div>
                  </div>
                )}
              {geometryType === "Point" && object.geometry.coordinates && (
                <div className="mt-3 pt-2 border-t border-gray-600">
                  <div className="flex justify-between items-center gap-4">
                    <span className="text-gray-300 text-xs">
                      Location (lat, lng):
                    </span>
                    <span className="font-mono text-xs text-right">
                      [{object.geometry.coordinates[1].toFixed(6)},{" "}
                      {object.geometry.coordinates[0].toFixed(6)}]
                    </span>
                  </div>
                </div>
              )}
              <div className="mt-3 pt-2 border-t border-gray-600">
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
          totalDistance += parseFloat(
            getDistance(
              [
                object.geometry.coordinates[i][0],
                object.geometry.coordinates[i][1],
              ],
              [
                object.geometry.coordinates[i + 1][0],
                object.geometry.coordinates[i + 1][1],
              ]
            )
          );
        }
        geometryInfo = (
          <div className="text-yellow-300 font-medium">
            Distance: {totalDistance.toFixed(2)} km
          </div>
        );
      }

      // Calculate area for Polygon
      if (
        geometryType === "Polygon" &&
        object.geometry.coordinates &&
        object.geometry.coordinates[0]
      ) {
        // object.geometry.coordinates is already [number, number][][] (array of rings)
        const areaKm2 = parseFloat(getPolygonArea(object.geometry.coordinates));
        const areaMeters = areaKm2 * 1_000_000;
        geometryInfo = (
          <div className="text-orange-300 font-medium">
            Area: {formatArea(areaMeters)}
          </div>
        );
      }

      const colorDisplay = layerInfo?.color
        ? rgbToHex(layerInfo.color.slice(0, 3) as [number, number, number])
        : null;

      return (
        <div className="bg-black bg-opacity-80 text-white p-3 rounded shadow-lg text-sm max-w-xs">
          {layerInfo?.name && (
            <div className="font-semibold text-blue-300 mb-2">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold mb-2">
            {geometryType === "Point" && layerInfo?.name
              ? `${layerInfo.name} - Point`
              : `${geometryType} Feature`}
          </div>
          <div className="space-y-2">
            {colorDisplay && (
              <div className="flex justify-between items-center gap-4">
                <span className="text-gray-300">Color:</span>
                <div className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded border border-gray-500"
                    style={{ backgroundColor: colorDisplay }}
                  />
                  <span className="font-mono text-xs text-right">
                    {colorDisplay}
                  </span>
                </div>
              </div>
            )}
            {geometryType === "Point" && layerInfo?.pointRadius && (
              <div className="flex justify-between items-center gap-4">
                <span className="text-gray-300">Radius:</span>
                <span className="text-right">
                  {layerInfo.pointRadius.toLocaleString()} px
                </span>
              </div>
            )}
            {geometryType === "LineString" && layerInfo?.lineWidth && (
              <div className="flex justify-between items-center gap-4">
                <span className="text-gray-300">Width:</span>
                <span className="text-right">{layerInfo.lineWidth} px</span>
              </div>
            )}
            {properties.name && (
              <div className="flex justify-between items-center gap-4">
                <span className="text-gray-300">Name:</span>
                <span className="text-right">{properties.name}</span>
              </div>
            )}
            {geometryInfo && (
              <div className="mt-3 pt-2 border-t border-gray-600">
                {geometryInfo}
              </div>
            )}
            {geometryType === "Point" && object.geometry.coordinates && (
              <div className="mt-3 pt-2 border-t border-gray-600">
                <div className="flex justify-between items-center gap-4">
                  <span className="text-gray-300 text-xs">
                    Coordinates (lat, lng):
                  </span>
                  <span className="font-mono text-xs text-right">
                    [{object.geometry.coordinates[1].toFixed(4)},{" "}
                    {object.geometry.coordinates[0].toFixed(4)}]
                  </span>
                </div>
              </div>
            )}
            {Object.keys(properties).length > 0 && (
              <div className="mt-3 pt-2 border-t border-gray-600">
                <div className="text-gray-300 text-xs mb-2">Properties:</div>
                <div className="space-y-1">
                  {Object.entries(properties)
                    .slice(0, 3)
                    .map(([key, value]) => (
                      <div
                        key={key}
                        className="flex justify-between items-center gap-4"
                      >
                        <span className="text-gray-300 text-xs">{key}:</span>
                        <span className="font-mono text-xs text-right">
                          {String(value)}
                        </span>
                      </div>
                    ))}
                  {Object.keys(properties).length > 3 && (
                    <div className="text-gray-400 text-xs text-right mt-1">
                      ...and {Object.keys(properties).length - 3} more
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (object.sourcePosition && object.targetPosition) {
      const distance = getDistance(
        [object.sourcePosition[0], object.sourcePosition[1]],
        [object.targetPosition[0], object.targetPosition[1]]
      );
      const colorDisplay = layerInfo?.color
        ? rgbToHex(layerInfo.color.slice(0, 3) as [number, number, number])
        : null;

      return (
        <div className="bg-black bg-opacity-80 text-white p-3 rounded shadow-lg text-sm max-w-xs">
          {layerInfo?.name && (
            <div className="font-semibold text-green-300 mb-2">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold mb-2">Line Segment</div>
          <div className="space-y-2">
            {colorDisplay && (
              <div className="flex justify-between items-center gap-4">
                <span className="text-gray-300">Color:</span>
                <div className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded border border-gray-500"
                    style={{ backgroundColor: colorDisplay }}
                  />
                  <span className="font-mono text-xs text-right">
                    {colorDisplay}
                  </span>
                </div>
              </div>
            )}
            {(layerInfo?.lineWidth || object.width) && (
              <div className="flex justify-between items-center gap-4">
                <span className="text-gray-300">Width:</span>
                <span className="text-right">
                  {layerInfo?.lineWidth || object.width} px
                </span>
              </div>
            )}
            <div className="mt-3 pt-2 border-t border-gray-600">
              <div className="flex justify-between items-center gap-4">
                <span className="text-yellow-300 font-medium">Distance:</span>
                <span className="text-yellow-300 font-medium text-right">
                  {parseFloat(distance).toFixed(2)} km
                </span>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-gray-600">
              <div className="flex justify-between items-center gap-4 mb-1">
                <span className="text-gray-300 text-xs">From (lat, lng):</span>
                <span className="font-mono text-xs text-right">
                  [{object.sourcePosition[1].toFixed(4)},{" "}
                  {object.sourcePosition[0].toFixed(4)}]
                </span>
              </div>
              <div className="flex justify-between items-center gap-4">
                <span className="text-gray-300 text-xs">To (lat, lng):</span>
                <span className="font-mono text-xs text-right">
                  [{object.targetPosition[1].toFixed(4)},{" "}
                  {object.targetPosition[0].toFixed(4)}]
                </span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (object.position) {
      const colorDisplay = layerInfo?.color
        ? rgbToHex(layerInfo.color.slice(0, 3) as [number, number, number])
        : null;

      return (
        <div className="bg-black bg-opacity-80 text-white p-3 rounded shadow-lg text-sm max-w-xs">
          {layerInfo?.name && (
            <div className="font-semibold text-red-300 mb-2">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold mb-2">
            {layerInfo?.name ? `${layerInfo.name} - Point` : "Point"}
          </div>
          <div className="space-y-2">
            {colorDisplay && (
              <div className="flex justify-between items-center gap-4">
                <span className="text-gray-300">Color:</span>
                <div className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded border border-gray-500"
                    style={{ backgroundColor: colorDisplay }}
                  />
                  <span className="font-mono text-xs text-right">
                    {colorDisplay}
                  </span>
                </div>
              </div>
            )}
            {(layerInfo?.radius || object.radius) && (
              <div className="flex justify-between items-center gap-4">
                <span className="text-gray-300">Radius:</span>
                <span className="text-right">
                  {(layerInfo?.radius || object.radius).toLocaleString()} px
                </span>
              </div>
            )}
            <div className="mt-3 pt-2 border-t border-gray-600">
              <div className="flex justify-between items-center gap-4">
                <span className="text-gray-300 text-xs">
                  Coordinates (lat, lng):
                </span>
                <span className="font-mono text-xs text-right">
                  [{object.position[1].toFixed(4)},{" "}
                  {object.position[0].toFixed(4)}]
                </span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (object.polygon) {
      // object.polygon from deck.gl PolygonLayer is a single ring [number, number][]
      // getPolygonArea expects [number, number][][] (array of rings), so wrap it
      const polygonRings =
        Array.isArray(object.polygon[0]) && Array.isArray(object.polygon[0][0])
          ? object.polygon // Already array of rings [[[lng, lat], ...], ...]
          : [object.polygon]; // Single ring [[lng, lat], ...], wrap it
      const areaKm2 = parseFloat(getPolygonArea(polygonRings));
      const areaMeters = areaKm2 * 1_000_000;
      const colorDisplay = layerInfo?.color
        ? rgbToHex(layerInfo.color.slice(0, 3) as [number, number, number])
        : null;

      // Calculate actual vertex count (excluding closing point if polygon is closed)
      const polygonRing = object.polygon[0] || [];
      let vertexCount = polygonRing.length;
      // Check if polygon is closed (last point equals first point)
      if (
        vertexCount > 0 &&
        polygonRing[0] &&
        polygonRing[vertexCount - 1] &&
        Math.abs(polygonRing[0][0] - polygonRing[vertexCount - 1][0]) < 1e-10 &&
        Math.abs(polygonRing[0][1] - polygonRing[vertexCount - 1][1]) < 1e-10
      ) {
        vertexCount -= 1; // Subtract the closing point
      }

      return (
        <div className="bg-black bg-opacity-80 text-white p-3 rounded shadow-lg text-sm max-w-xs">
          {layerInfo?.name && (
            <div className="font-semibold text-purple-300 mb-2">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold mb-2">Polygon</div>
          <div className="space-y-2">
            {colorDisplay && (
              <div className="flex justify-between items-center gap-4">
                <span className="text-gray-300">Color:</span>
                <div className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded border border-gray-500"
                    style={{ backgroundColor: colorDisplay }}
                  />
                  <span className="font-mono text-xs text-right">
                    {colorDisplay}
                  </span>
                </div>
              </div>
            )}
            <div className="mt-3 pt-2 border-t border-gray-600">
              <div className="flex justify-between items-center gap-4">
                <span className="text-orange-300 font-medium">Area:</span>
                <span className="text-orange-300 font-medium text-right">
                  {formatArea(areaMeters)}
                </span>
              </div>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-gray-300">Vertices:</span>
              <span className="text-right">{vertexCount}</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="bg-black bg-opacity-80 text-white p-3 rounded shadow-lg text-sm max-w-xs">
        <div className="font-semibold mb-2">Map Feature</div>
        <div className="text-gray-300">Hover for details</div>
      </div>
    );
  };

  return (
    <div
      style={{
        position: "absolute",
        left: x + 10,
        top: y - 10,
        pointerEvents:
          layer?.id === "udp-network-members-layer" ||
          layer?.id === "udp-targets-layer"
            ? "auto"
            : "none",
        zIndex: 5,
      }}
    >
      {getTooltipContent()}
    </div>
  );
};

export default Tooltip;
