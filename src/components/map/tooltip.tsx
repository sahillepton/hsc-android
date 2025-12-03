import {
  formatArea,
  formatDistance,
  getDistance,
  getPolygonArea,
  rgbToHex,
  formatLabel,
  calculateIgrs,
} from "@/lib/utils";
import { normalizeAngleSigned } from "@/lib/layers";
import {
  useHoverInfo,
  useLayers,
  useIgrsPreference,
} from "@/store/layers-store";
import { useEffect, useState } from "react";
import {
  Phone,
  Video,
  Upload,
  MessageSquare,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

const Tooltip = () => {
  const { hoverInfo } = useHoverInfo();
  const { layers } = useLayers();
  const useIgrs = useIgrsPreference();
  const [tooltipPosition, setTooltipPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [expandedProperties, setExpandedProperties] = useState<
    Record<string, boolean>
  >({});
  const mapRef = (window as any).mapRef;

  // Reset expanded properties when hover changes
  useEffect(() => {
    setExpandedProperties({});
  }, [hoverInfo?.object]);

  // Update tooltip position when map moves/zooms
  useEffect(() => {
    if (!hoverInfo || !hoverInfo.object || !mapRef?.current) {
      setTooltipPosition(null);
      return;
    }

    const updatePosition = () => {
      try {
        const map = mapRef.current.getMap();
        if (!map) return;

        // Get object coordinates
        let lng: number | undefined;
        let lat: number | undefined;

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
  }, [hoverInfo, mapRef]);

  if (!hoverInfo) {
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
    // If not found, check if it's a sub-layer (e.g., `${layer.id}-icon-layer`, `${layer.id}-bitmap`)
    if (!layerInfo) {
      // Try to extract the base layer ID by removing common suffixes
      const baseId = deckLayerId
        .replace(/-icon-layer$/, "")
        .replace(/-signal-overlay$/, "")
        .replace(/-bitmap$/, "")
        .replace(/-mesh$/, "");
      layerInfo = layers.find((l) => l.id === baseId);
    }
  }

  const formatCoordinatePair = (point?: [number, number]) => {
    if (!point || point.length < 2) return "—";
    if (useIgrs) {
      const igrs = calculateIgrs(point[0], point[1]);
      if (igrs) return igrs;
    }
    return `[${point[1]?.toFixed(4)}, ${point[0]?.toFixed(4)}]`;
  };
  const coordinateLabel = useIgrs ? "IGRS" : "lat, lng";
  const getTooltipContent = () => {
    // Handle DEM (elevation raster) layers - show elevation at hovered point
    // Supports .tiff, .tif, .dett, and .hgt files
    if (
      layerInfo?.type === "dem" &&
      layerInfo.elevationData &&
      layerInfo.bounds
    ) {
      const demObject: any = object || {};

      // Try to get coordinates from multiple sources
      let lng: number | undefined;
      let lat: number | undefined;

      if (hoverInfo.coordinate) {
        [lng, lat] = hoverInfo.coordinate;
      } else if (demObject.geometry?.coordinates) {
        // GeoJSON Point
        if (
          Array.isArray(demObject.geometry.coordinates) &&
          demObject.geometry.coordinates.length >= 2
        ) {
          lng = demObject.geometry.coordinates[0];
          lat = demObject.geometry.coordinates[1];
        }
      } else if (
        demObject.longitude !== undefined &&
        demObject.latitude !== undefined
      ) {
        lng = demObject.longitude;
        lat = demObject.latitude;
      } else if (demObject.position && Array.isArray(demObject.position)) {
        lng = demObject.position[0];
        lat = demObject.position[1];
      }

      if (lng !== undefined && lat !== undefined) {
        const [[minLng, minLat], [maxLng, maxLat]] = layerInfo.bounds;

        // Ensure the hover point is within the DEM bounds
        if (lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat) {
          const { width, height, data, min, max } = layerInfo.elevationData;

          // Map geographic coordinates to raster pixel indices
          const col = ((lng - minLng) / (maxLng - minLng || 1)) * (width - 1);
          const row = ((maxLat - lat) / (maxLat - minLat || 1)) * (height - 1);

          const x = Math.min(width - 1, Math.max(0, Math.round(col)));
          const y = Math.min(height - 1, Math.max(0, Math.round(row)));
          const index = y * width + x;

          const elevation = data[index];

          // Debug: log sampled DEM elevation information
          console.log("DEM hover sample", {
            layerId: layerInfo.id,
            layerName: layerInfo.name,
            lng,
            lat,
            pixel: { x, y, index },
            elevation,
            elevationRange: { min, max },
            size: { width, height },
          });
          const hasValidElevation =
            Number.isFinite(elevation) &&
            elevation !== null &&
            elevation !== undefined;

          // Detect file type from layer name
          const layerName = (layerInfo.name || "").toLowerCase();
          const fileType =
            layerName.endsWith(".tiff") ||
            layerName.endsWith(".tif") ||
            layerName.endsWith(".dett")
              ? "GeoTIFF"
              : layerName.endsWith(".hgt")
              ? "SRTM HGT"
              : "DEM";

          return (
            <div className="bg-black bg-opacity-80 text-white p-3 rounded shadow-lg text-sm max-w-xs">
              {layerInfo.name && (
                <div className="font-semibold text-blue-300 mb-2">
                  {layerInfo.name}
                </div>
              )}
              <div className="font-semibold mb-1 flex items-center gap-2">
                <span>Elevation Data</span>
                <span className="text-xs text-gray-400 font-normal">
                  ({fileType})
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="text-gray-300 text-xs">Latitude:</span>
                  <span className="font-mono text-xs">{lat.toFixed(5)}°</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-gray-300 text-xs">Longitude:</span>
                  <span className="font-mono text-xs">{lng.toFixed(5)}°</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-gray-300 text-xs">Pixel Index:</span>
                  <span className="font-mono text-xs">
                    ({x}, {y})
                  </span>
                </div>
                <div className="mt-2 pt-1 border-t border-gray-600">
                  <div className="flex justify-between gap-2">
                    <span className="text-yellow-300 text-xs font-medium">
                      Elevation:
                    </span>
                    <span className="font-mono text-xs text-yellow-300 font-semibold">
                      {hasValidElevation
                        ? `${elevation.toFixed(2)} m`
                        : "No data"}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between gap-2 text-[10px] text-gray-500 mt-1">
                  <span>Elevation Range:</span>
                  <span className="font-mono">
                    {min.toFixed(1)}–{max.toFixed(1)} m
                  </span>
                </div>
                <div className="flex justify-between gap-2 text-[10px] text-gray-500">
                  <span>Raster Size:</span>
                  <span className="font-mono">
                    {width} × {height} px
                  </span>
                </div>
              </div>
            </div>
          );
        }
      }
    }

    // For non-DEM content, we require a valid object to render a tooltip
    if (!object) {
      return null;
    }

    // Handle UDP layers
    if (
      layer?.id === "udp-network-members-layer" ||
      layer?.id === "udp-targets-layer"
    ) {
      // Only show these important properties
      const importantKeys = [
        "globalId",
        "callsign",
        "altitude",
        "heading",
        "trueHeading",
        "groundSpeed",
        "range",
        "displayId",
        "role",
        "controllingNodeId",
      ];

      const displayProperties = Object.entries(object).filter(
        ([key, value]) =>
          importantKeys.includes(key) &&
          value !== undefined &&
          value !== null &&
          typeof value !== "object"
      );

      const useGridLayout = displayProperties.length > 8;

      return (
        <div
          className="bg-white text-gray-900 p-2 rounded shadow-lg text-sm border border-gray-200"
          style={{
            zoom: 0.9,
            maxWidth: useGridLayout ? "480px" : "280px",
            maxHeight: "450px",
            overflowY: "auto",
          }}
        >
          <div className="font-semibold text-blue-600 mb-1">
            {layer.id === "udp-network-members-layer"
              ? "Network Member"
              : "Target"}
          </div>

          {/* Location - full width */}
          {object.longitude !== undefined && object.latitude !== undefined && (
            <div className="flex justify-between gap-2 mb-1.5 pb-1.5 border-b border-gray-200">
              <span className="text-gray-600">Location:</span>
              <span className="font-mono text-xs text-gray-800">
                [{object.latitude.toFixed(3)}, {object.longitude.toFixed(3)}]
              </span>
            </div>
          )}

          {/* Properties - Grid layout for many items, single column for few */}
          {useGridLayout ? (
            <div className="flex gap-0">
              {/* Left column */}
              <div className="flex-1 pr-2 border-r border-gray-200 space-y-0.5">
                {displayProperties
                  .slice(0, Math.ceil(displayProperties.length / 2))
                  .map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-2">
                      <span className="text-gray-600 text-xs">
                        {formatLabel(key)}:
                      </span>
                      <span className="font-mono text-xs text-gray-800">
                        {typeof value === "number" && !Number.isInteger(value)
                          ? value.toFixed(2)
                          : String(value)}
                      </span>
                    </div>
                  ))}
              </div>
              {/* Right column */}
              <div className="flex-1 pl-2 space-y-0.5">
                {displayProperties
                  .slice(Math.ceil(displayProperties.length / 2))
                  .map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-2">
                      <span className="text-gray-600 text-xs">
                        {formatLabel(key)}:
                      </span>
                      <span className="font-mono text-xs text-gray-800">
                        {typeof value === "number" && !Number.isInteger(value)
                          ? value.toFixed(2)
                          : String(value)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {displayProperties.map(([key, value]) => (
                <div key={key} className="flex justify-between gap-2">
                  <span className="text-gray-600">{formatLabel(key)}:</span>
                  <span className="font-mono text-xs text-gray-800">
                    {typeof value === "number" && !Number.isInteger(value)
                      ? value.toFixed(2)
                      : String(value)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-2 pt-1.5 border-t border-gray-200">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  alert("Phone call initiated");
                }}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-500 hover:bg-emerald-600 text-white rounded-md transition-all"
                title="Voice Call"
              >
                <Phone size={12} />
                <span>Call</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  alert("Video call initiated");
                }}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-all"
                title="Video Call"
              >
                <Video size={12} />
                <span>Video</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  alert("FTP connection initiated");
                }}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded-md transition-all"
                title="File Transfer"
              >
                <Upload size={12} />
                <span>FTP</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  alert("Message sent");
                }}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-purple-500 hover:bg-purple-600 text-white rounded-md transition-all"
                title="Send Message"
              >
                <MessageSquare size={12} />
                <span>Message</span>
              </button>
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

    if (layerInfo?.type === "azimuth") {
      const isNorthSegment = (object as any)?.segmentType === "north";
      let angleDeg = isNorthSegment
        ? 0
        : normalizeAngleSigned(layerInfo.azimuthAngleDeg ?? 0);
      if (angleDeg === -180) angleDeg = 180;
      const distanceMeters = isNorthSegment
        ? undefined
        : layerInfo.distanceMeters;

      return (
        <div
          className="bg-white text-gray-900 border border-gray-200 p-3 rounded shadow-lg text-sm max-w-xs"
          style={{ zoom: 0.9 }}
        >
          <div className="font-semibold text-blue-600 mb-1">
            Azimuth Measurement
          </div>
          <div className="space-y-1.5">
            {layerInfo?.name && (
              <div className="flex justify-between gap-3">
                <span className="text-gray-600">Name:</span>
                <span className="font-semibold text-right">
                  {layerInfo.name}
                </span>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <span className="text-gray-600">Bearing angle:</span>
              <span className="font-mono text-right text-gray-800">
                {isNorthSegment
                  ? "0° (reference axis)"
                  : `${angleDeg.toFixed(2)}°`}
              </span>
            </div>
            {distanceMeters !== undefined && (
              <div className="flex justify-between gap-3">
                <span className="text-gray-600">Distance:</span>
                <span className="font-mono text-right text-gray-800">
                  {formatDistance(distanceMeters / 1000)}
                </span>
              </div>
            )}
            <div className="mt-2 pt-1.5 border-t border-gray-200 space-y-1">
              <div className="flex justify-between gap-3 text-xs">
                <span className="text-gray-600">
                  Center ({coordinateLabel}):
                </span>
                <span className="font-mono text-right text-gray-800">
                  {formatCoordinatePair(layerInfo.azimuthCenter)}
                </span>
              </div>
              <div className="flex justify-between gap-3 text-xs">
                <span className="text-gray-600">
                  Target ({coordinateLabel}):
                </span>
                <span className="font-mono text-right text-gray-800">
                  {formatCoordinatePair(layerInfo.azimuthTarget)}
                </span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (isDirectNodeObject) {
      return (
        <div
          className="bg-white text-gray-900 border border-gray-200 p-2 rounded shadow-lg text-sm max-w-xs"
          style={{ zoom: 0.9 }}
        >
          {layerInfo?.name && (
            <div className="font-semibold text-blue-600 mb-1">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold text-blue-600 mb-1">Network Node</div>
          <div className="space-y-1.5">
            <div className="flex justify-between items-center gap-3">
              <span className="text-gray-600">User ID:</span>
              <span className="font-mono text-right text-gray-800">
                {object.userId}
              </span>
            </div>
            <div className="flex justify-between items-center gap-3">
              <span className="text-gray-600">SNR:</span>
              <span className="font-mono text-right text-gray-800">
                {object.snr} dB
              </span>
            </div>
            <div className="flex justify-between items-center gap-3">
              <span className="text-gray-600">RSSI:</span>
              <span className="font-mono text-right text-gray-800">
                {object.rssi} dBm
              </span>
            </div>
            <div className="flex justify-between items-center gap-3">
              <span className="text-gray-600">Distance:</span>
              <span className="font-mono text-right text-gray-800">
                {object.distance?.toFixed(2)} m
              </span>
            </div>
            <div className="flex justify-between items-center gap-3">
              <span className="text-gray-600">Hop Count:</span>
              <span className="font-mono text-right text-gray-800">
                {object.hopCount}
              </span>
            </div>
            {object.connectedNodeIds && object.connectedNodeIds.length > 0 && (
              <div className="mt-2 pt-1.5">
                <div className="flex justify-between items-start gap-4 mb-1">
                  <span className="text-gray-600 text-xs">
                    Connected Nodes:
                  </span>
                </div>
                <div className="font-mono text-xs text-right text-gray-800">
                  [{object.connectedNodeIds.join(", ")}]
                </div>
              </div>
            )}
            <div className="mt-2 pt-1.5">
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600 text-xs">
                  Location ({coordinateLabel}):
                </span>
                <span className="font-mono text-xs text-right text-gray-800">
                  {formatCoordinatePair([object.longitude, object.latitude])}
                </span>
              </div>
            </div>
            <div className="mt-2 pt-1.5">
              <div className="text-gray-600 text-xs mb-1">Icon:</div>
              <div className="text-xs text-gray-500">
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
          <div
            className="bg-white text-gray-900 border border-gray-200 p-2 rounded shadow-lg text-sm max-w-xs"
            style={{ zoom: 0.9 }}
          >
            {layerInfo?.name && (
              <div className="font-semibold text-blue-600 mb-1">
                {layerInfo.name}
              </div>
            )}
            <div className="font-semibold text-blue-600 mb-1">Network Node</div>
            <div className="space-y-1.5">
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600">User ID:</span>
                <span className="font-mono text-right text-gray-800">
                  {properties.userId}
                </span>
              </div>
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600">SNR:</span>
                <span className="font-mono text-right text-gray-800">
                  {properties.snr} dB
                </span>
              </div>
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600">RSSI:</span>
                <span className="font-mono text-right text-gray-800">
                  {properties.rssi} dBm
                </span>
              </div>
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600">Distance:</span>
                <span className="font-mono text-right text-gray-800">
                  {properties.distance?.toFixed(2)} m
                </span>
              </div>
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600">Hop Count:</span>
                <span className="font-mono text-right text-gray-800">
                  {properties.hopCount}
                </span>
              </div>
              {properties.connectedNodeIds &&
                properties.connectedNodeIds.length > 0 && (
                  <div className="mt-2 pt-1.5">
                    <div className="flex justify-between items-start gap-4 mb-1">
                      <span className="text-gray-600 text-xs">
                        Connected Nodes:
                      </span>
                    </div>
                    <div className="font-mono text-xs text-right text-gray-800">
                      [{properties.connectedNodeIds.join(", ")}]
                    </div>
                  </div>
                )}
              {geometryType === "Point" && object.geometry.coordinates && (
                <div className="mt-2 pt-1.5">
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-gray-600 text-xs">
                      Location ({coordinateLabel}):
                    </span>
                    <span className="font-mono text-xs text-right text-gray-800">
                      {formatCoordinatePair(
                        object.geometry.coordinates as [number, number]
                      )}
                    </span>
                  </div>
                </div>
              )}
              <div className="mt-2 pt-1.5">
                <div className="text-gray-600 text-xs mb-1">Icon:</div>
                <div className="text-xs text-gray-500">
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
          <div className="text-gray-600">
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
          <div className="text-gray-600">Area: {formatArea(areaMeters)}</div>
        );
      }

      const colorDisplay = layerInfo?.color
        ? rgbToHex(layerInfo.color.slice(0, 3) as [number, number, number])
        : null;

      return (
        <div
          className="bg-white text-gray-900 border border-gray-200 p-2 rounded shadow-lg text-sm max-w-xs"
          style={{ zoom: 0.9 }}
        >
          {layerInfo?.name && (
            <div className="font-semibold text-blue-600 mb-1">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold mb-1">
            {geometryType === "Point" && layerInfo?.name
              ? `${layerInfo.name} - Point`
              : `${geometryType} Feature`}
          </div>
          <div className="space-y-1.5">
            {colorDisplay && (
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600">Color:</span>
                <div className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded border border-gray-500"
                    style={{ backgroundColor: colorDisplay }}
                  />
                  <span className="font-mono text-xs text-right text-gray-800">
                    {colorDisplay}
                  </span>
                </div>
              </div>
            )}
            {geometryType === "Point" && layerInfo?.pointRadius && (
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600">Radius:</span>
                <span className="text-right text-gray-800">
                  {layerInfo.pointRadius.toLocaleString()} px
                </span>
              </div>
            )}
            {geometryType === "LineString" && layerInfo?.lineWidth && (
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600">Width:</span>
                <span className="text-right text-gray-800">
                  {layerInfo.lineWidth} px
                </span>
              </div>
            )}
            {properties.name && (
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600">Name:</span>
                <span className="text-right text-gray-800">
                  {properties.name}
                </span>
              </div>
            )}
            {geometryInfo && <div className="mt-2 pt-1.5">{geometryInfo}</div>}
            {geometryType === "Point" && object.geometry.coordinates && (
              <div className="mt-2 pt-1.5">
                <div className="flex justify-between items-center gap-3">
                  <span className="text-gray-600 text-xs">
                    Coordinates ({coordinateLabel}):
                  </span>
                  <span className="font-mono text-xs text-right">
                    {formatCoordinatePair(
                      object.geometry.coordinates as [number, number]
                    )}
                  </span>
                </div>
              </div>
            )}
            {Object.keys(properties).length > 0 && (
              <div className="mt-2 pt-1.5">
                <div className="text-gray-600 text-xs mb-1">Properties:</div>
                <div className="space-y-1">
                  {Object.entries(properties)
                    .slice(
                      0,
                      expandedProperties[`${layer?.id}-${object?.id}`]
                        ? properties.length
                        : 3
                    )
                    .map(([key, value]) => (
                      <div
                        key={key}
                        className="flex justify-between items-center gap-4"
                      >
                        <span className="text-gray-600 text-xs">
                          {formatLabel(key)}:
                        </span>
                        <span className="font-mono text-xs text-right text-gray-800">
                          {String(value)}
                        </span>
                      </div>
                    ))}
                  {Object.keys(properties).length > 3 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const key = `${layer?.id}-${object?.id}`;
                        setExpandedProperties((prev) => ({
                          ...prev,
                          [key]: !prev[key],
                        }));
                      }}
                      className="flex items-center justify-center gap-1 w-full text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2 py-1 rounded mt-1 transition-colors"
                    >
                      {expandedProperties[`${layer?.id}-${object?.id}`] ? (
                        <>
                          <ChevronUp size={12} />
                          <span>Show Less</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown size={12} />
                          <span>
                            View {Object.keys(properties).length - 3} More
                          </span>
                        </>
                      )}
                    </button>
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
      const segmentDistances = Array.isArray(layerInfo?.segmentDistancesKm)
        ? layerInfo.segmentDistancesKm
        : [];
      const segmentsTotalKm =
        layerInfo?.totalDistanceKm ??
        segmentDistances.reduce((sum, dist) => sum + dist, 0);
      const segmentCount = segmentDistances.length;
      const maxSegmentKm =
        segmentCount > 0 ? Math.max(...segmentDistances) : null;
      const minSegmentKm =
        segmentCount > 0 ? Math.min(...segmentDistances) : null;
      const avgSegmentKm =
        segmentCount > 0 ? segmentsTotalKm / segmentCount : null;

      // Check if this is an azimuthal line (has bearing or name starts with "Azimuthal")
      const isAzimuthal =
        layerInfo?.name?.startsWith("Azimuthal") ||
        layerInfo?.bearing !== undefined ||
        (object as any).bearing !== undefined;

      // Get bearing from layer info or object, or calculate it
      let bearing: number | undefined =
        layerInfo?.bearing ?? (object as any).bearing;
      if (isAzimuthal && bearing === undefined) {
        // Calculate bearing from coordinates
        bearing = calculateBearingDegrees(
          [object.sourcePosition[0], object.sourcePosition[1]],
          [object.targetPosition[0], object.targetPosition[1]]
        );
      }

      return (
        <div
          className="bg-white text-gray-900 border border-gray-200 p-2 rounded shadow-lg text-sm max-w-xs"
          style={{ zoom: 0.9 }}
        >
          {layerInfo?.name && (
            <div className="font-semibold text-blue-600 mb-1">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold text-blue-600 mb-1">Line Segment</div>
          <div className="space-y-1.5">
            {typeof (object as any)?.segmentIndex === "number" && (
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600">Segment #:</span>
                <span className="text-right text-gray-800 font-mono">
                  {((object as any).segmentIndex as number) + 1}
                </span>
              </div>
            )}
            {colorDisplay && (
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600">Color:</span>
                <div className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded border border-gray-500"
                    style={{ backgroundColor: colorDisplay }}
                  />
                  <span className="font-mono text-xs text-right text-gray-800">
                    {colorDisplay}
                  </span>
                </div>
              </div>
            )}
            {(layerInfo?.lineWidth || object.width) && (
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600">Width:</span>
                <span className="text-right">
                  {layerInfo?.lineWidth || object.width} px
                </span>
              </div>
            )}
            <div className="mt-2 pt-1.5">
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600">Distance:</span>
                <span className="text-gray-800 text-right">
                  {parseFloat(distance).toFixed(2)} km
                </span>
              </div>
            </div>
            {segmentCount ? (
              <div className="mt-2 pt-1.5 border-t border-gray-200 space-y-1 text-xs">
                <div className="flex justify-between items-center gap-3">
                  <span className="text-gray-600 font-semibold">Segments:</span>
                  <span className="font-mono text-gray-800">
                    {segmentCount}
                  </span>
                </div>
                {segmentCount > 1 ? (
                  <>
                    <div className="flex justify-between items-center gap-3">
                      <span className="text-gray-600">Max segment:</span>
                      <span className="font-mono text-gray-800">
                        {formatDistance(maxSegmentKm ?? 0)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center gap-3">
                      <span className="text-gray-600">Min segment:</span>
                      <span className="font-mono text-gray-800">
                        {formatDistance(minSegmentKm ?? 0)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center gap-3">
                      <span className="text-gray-600">Avg segment:</span>
                      <span className="font-mono text-gray-800">
                        {formatDistance(avgSegmentKm ?? 0)}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-gray-600">Segment length:</span>
                    <span className="font-mono text-gray-800">
                      {formatDistance(segmentDistances[0])}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center gap-3 font-semibold pt-1">
                  <span className="text-gray-600">Total:</span>
                  <span className="font-mono text-gray-800">
                    {formatDistance(segmentsTotalKm)}
                  </span>
                </div>
              </div>
            ) : null}
            <div className="mt-2 pt-1.5">
              <div className="flex justify-between items-center gap-4 mb-1">
                <span className="text-gray-600 text-xs">
                  From ({coordinateLabel}):
                </span>
                <span className="font-mono text-xs text-right">
                  {formatCoordinatePair(
                    object.sourcePosition as [number, number]
                  )}
                </span>
              </div>
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600 text-xs">
                  To ({coordinateLabel}):
                </span>
                <span className="font-mono text-xs text-right">
                  {formatCoordinatePair(
                    object.targetPosition as [number, number]
                  )}
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
        <div
          className="bg-white text-gray-900 border border-gray-200 p-2 rounded shadow-lg text-sm max-w-xs"
          style={{ zoom: 0.9 }}
        >
          {layerInfo?.name && (
            <div className="font-semibold text-blue-600 mb-1">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold mb-1">
            {layerInfo?.name ? `${layerInfo.name} - Point` : "Point"}
          </div>
          <div className="space-y-1.5">
            {colorDisplay && (
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600">Color:</span>
                <div className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded border border-gray-500"
                    style={{ backgroundColor: colorDisplay }}
                  />
                  <span className="font-mono text-xs text-right text-gray-800">
                    {colorDisplay}
                  </span>
                </div>
              </div>
            )}
            {(layerInfo?.radius || object.radius) && (
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600">Radius:</span>
                <span className="text-right">
                  {(layerInfo?.radius || object.radius).toLocaleString()} px
                </span>
              </div>
            )}
            <div className="mt-2 pt-1.5">
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600 text-xs">
                  Coordinates ({coordinateLabel}):
                </span>
                <span className="font-mono text-xs text-right">
                  {formatCoordinatePair(object.position)}
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
        <div
          className="bg-white text-gray-900 border border-gray-200 p-2 rounded shadow-lg text-sm max-w-xs"
          style={{ zoom: 0.9 }}
        >
          {layerInfo?.name && (
            <div className="font-semibold text-blue-600 mb-1">
              {layerInfo.name}
            </div>
          )}
          <div className="font-semibold mb-1">Polygon</div>
          <div className="space-y-1.5">
            {colorDisplay && (
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600">Color:</span>
                <div className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded border border-gray-500"
                    style={{ backgroundColor: colorDisplay }}
                  />
                  <span className="font-mono text-xs text-right text-gray-800">
                    {colorDisplay}
                  </span>
                </div>
              </div>
            )}
            <div className="mt-2 pt-1.5">
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-600">Area:</span>
                <span className="text-gray-800 text-right">
                  {formatArea(areaMeters)}
                </span>
              </div>
            </div>
            <div className="flex justify-between items-center gap-3">
              <span className="text-gray-600">Vertices:</span>
              <span className="text-right">{vertexCount}</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        className="bg-white text-gray-900 border border-gray-200 p-2 rounded shadow-lg text-sm max-w-xs"
        style={{ zoom: 0.9 }}
      >
        <div className="font-semibold mb-1">Map Feature</div>
        <div className="text-gray-600">Hover for details</div>
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
