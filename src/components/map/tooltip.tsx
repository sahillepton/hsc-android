import {
  formatArea,
  formatDistance,
  getDistance,
  getPolygonArea,
} from "@/lib/utils";
import { useHoverInfo, useLayers } from "@/store/layers-store";

const Tooltip = () => {
  const { hoverInfo } = useHoverInfo();
  const { layers } = useLayers();
  if (!hoverInfo || !hoverInfo.object || !hoverInfo.x || !hoverInfo.y) {
    return null;
  }

  const { object, x, y, layer } = hoverInfo;
  const layerInfo = layer?.id ? layers.find((l) => l.id === layer.id) : null;

  const getTooltipContent = () => {
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
        const areaKm2 = parseFloat(
          getPolygonArea(object.geometry.coordinates[0])
        );
        const areaMeters = areaKm2 * 1_000_000;
        geometryInfo = (
          <div className="text-orange-300 font-medium">
            Area: {formatArea(areaMeters)}
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

    if (object.sourcePosition && object.targetPosition) {
      const distance = getDistance(
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
            Distance: {formatDistance(parseFloat(distance))}
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
      const areaKm2 = parseFloat(getPolygonArea(object.polygon[0] || []));
      const areaMeters = areaKm2 * 1_000_000;

      return (
        <div className="bg-black bg-opacity-80 text-white p-2 rounded shadow-lg text-sm">
          {layerInfo && (
            <div className="font-semibold text-purple-300 mb-1">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold">Polygon</div>
          <div className="text-orange-300 font-medium">
            Area: {formatArea(areaMeters)}
          </div>
          <div>Vertices: {object.polygon[0]?.length || 0}</div>
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
        pointerEvents: "none",
        zIndex: 1000,
      }}
    >
      {getTooltipContent()}
    </div>
  );
};

export default Tooltip;
