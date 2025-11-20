import { formatArea, getDistance, getPolygonArea, rgbToHex } from "@/lib/utils";
import { useHoverInfo, useLayers } from "@/store/layers-store";
import { useUdpSymbolsStore } from "@/store/udp-symbols-store";

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

  if (!hoverInfo || !hoverInfo.object || !hoverInfo.x || !hoverInfo.y) {
    return null;
  }

  const { object, x, y, layer } = hoverInfo;

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
    // Handle UDP layers
    if (
      layer?.id === "udp-network-members-layer" ||
      layer?.id === "udp-targets-layer"
    ) {
      const userId = object.userId || object.id || 0;
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
            {object.longitude !== undefined &&
              object.latitude !== undefined && (
                <div className="flex justify-between gap-2">
                  <span className="text-gray-300">Location:</span>
                  <span className="font-mono text-xs mt-0.5">
                    [{object.latitude.toFixed(3)}, {object.longitude.toFixed(3)}
                    ]
                  </span>
                </div>
              )}
            {object.userId !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-300">User ID:</span>
                <span className="font-mono">{object.userId}</span>
              </div>
            )}
            {object.snr !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-300">SNR:</span>
                <span className="font-mono">{object.snr} dB</span>
              </div>
            )}
            {object.rssi !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-300">RSSI:</span>
                <span className="font-mono">{object.rssi} dBm</span>
              </div>
            )}
            {object.distance !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-300">Distance:</span>
                <span className="font-mono">
                  {object.distance.toFixed(2)} m
                </span>
              </div>
            )}
            {object.hopCount !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-300">Hop Count:</span>
                <span className="font-mono">{object.hopCount}</span>
              </div>
            )}
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
        <div className="bg-black bg-opacity-80 text-white p-2 rounded shadow-lg text-sm max-w-xs">
          {layerInfo?.name && (
            <div className="font-semibold text-blue-300 mb-1">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold">
            {geometryType === "Point" && layerInfo?.name
              ? `${layerInfo.name} - Point`
              : `${geometryType} Feature`}
          </div>
          {colorDisplay && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-gray-300">Color:</span>
              <div
                className="w-4 h-4 rounded border border-gray-500"
                style={{ backgroundColor: colorDisplay }}
              />
              <span className="font-mono text-xs">{colorDisplay}</span>
            </div>
          )}
          {geometryType === "Point" && layerInfo?.pointRadius && (
            <div className="mt-1">
              <span className="text-gray-300">Radius: </span>
              <span>{layerInfo.pointRadius.toLocaleString()}</span>
            </div>
          )}
          {geometryType === "LineString" && layerInfo?.lineWidth && (
            <div className="mt-1">
              <span className="text-gray-300">Width: </span>
              <span>{layerInfo.lineWidth} px</span>
            </div>
          )}
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

    if (object.sourcePosition && object.targetPosition) {
      const distance = getDistance(
        [object.sourcePosition[0], object.sourcePosition[1]],
        [object.targetPosition[0], object.targetPosition[1]]
      );
      const colorDisplay = layerInfo?.color
        ? rgbToHex(layerInfo.color.slice(0, 3) as [number, number, number])
        : null;

      return (
        <div className="bg-black bg-opacity-80 text-white p-2 rounded shadow-lg text-sm">
          {layerInfo?.name && (
            <div className="font-semibold text-green-300 mb-1">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold">Line Segment</div>
          {colorDisplay && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-gray-300">Color:</span>
              <div
                className="w-4 h-4 rounded border border-gray-500"
                style={{ backgroundColor: colorDisplay }}
              />
              <span className="font-mono text-xs">{colorDisplay}</span>
            </div>
          )}
          {(layerInfo?.lineWidth || object.width) && (
            <div className="mt-1">
              <span className="text-gray-300">Width: </span>
              <span>{layerInfo?.lineWidth || object.width}</span>
            </div>
          )}
          <div className="text-yellow-300 font-medium">
            Distance: {parseFloat(distance).toFixed(2)} km
          </div>
          <div>
            From (lat, lng): [{object.sourcePosition[1].toFixed(4)},{" "}
            {object.sourcePosition[0].toFixed(4)}]
          </div>
          <div>
            To (lat, lng): [{object.targetPosition[1].toFixed(4)},{" "}
            {object.targetPosition[0].toFixed(4)}]
          </div>
        </div>
      );
    }

    if (object.position) {
      const colorDisplay = layerInfo?.color
        ? rgbToHex(layerInfo.color.slice(0, 3) as [number, number, number])
        : null;

      return (
        <div className="bg-black bg-opacity-80 text-white p-2 rounded shadow-lg text-sm">
          {layerInfo?.name && (
            <div className="font-semibold text-red-300 mb-1">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold">
            {layerInfo?.name ? `${layerInfo.name} - Point` : "Point"}
          </div>
          {colorDisplay && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-gray-300">Color:</span>
              <div
                className="w-4 h-4 rounded border border-gray-500"
                style={{ backgroundColor: colorDisplay }}
              />
              <span className="font-mono text-xs">{colorDisplay}</span>
            </div>
          )}
          {(layerInfo?.radius || object.radius) && (
            <div className="mt-1">
              <span className="text-gray-300">Radius: </span>
              <span>
                {(layerInfo?.radius || object.radius).toLocaleString()}
              </span>
            </div>
          )}
          <div>
            Coordinates (lat, lng): [{object.position[1].toFixed(4)},{" "}
            {object.position[0].toFixed(4)}]
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
        <div className="bg-black bg-opacity-80 text-white p-2 rounded shadow-lg text-sm">
          {layerInfo?.name && (
            <div className="font-semibold text-purple-300 mb-1">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold">Polygon</div>
          {colorDisplay && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-gray-300">Color:</span>
              <div
                className="w-4 h-4 rounded border border-gray-500"
                style={{ backgroundColor: colorDisplay }}
              />
              <span className="font-mono text-xs">{colorDisplay}</span>
            </div>
          )}
          <div className="text-orange-300 font-medium">
            Area: {formatArea(areaMeters)}
          </div>
          <div>Vertices: {vertexCount}</div>
        </div>
      );
    }

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
        pointerEvents:
          layer?.id === "udp-network-members-layer" ||
          layer?.id === "udp-targets-layer"
            ? "auto"
            : "none",
        zIndex: 1000,
      }}
    >
      {getTooltipContent()}
    </div>
  );
};

export default Tooltip;
