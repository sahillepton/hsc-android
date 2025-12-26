import {
  formatArea,
  formatDistance,
  getDistance,
  formatLabel,
  calculateIgrs,
} from "@/lib/utils";
import {
  normalizeAngleSigned,
  computePolygonPerimeterMeters,
  computePolygonAreaMeters,
} from "@/lib/layers";
import {
  useHoverInfo,
  useLayers,
  useIgrsPreference,
  useUserLocation,
} from "@/store/layers-store";
import { useEffect, useState } from "react";
import { Video, Upload, MessageSquare, PhoneCall } from "lucide-react";
import {
  TooltipBox,
  TooltipHeading,
  TooltipProperties,
  TooltipDivider,
} from "@/lib/tooltip-components";

const Tooltip = () => {
  const { hoverInfo } = useHoverInfo();
  const { layers } = useLayers();
  const useIgrs = useIgrsPreference();
  const { showUserLocation } = useUserLocation();
  const [tooltipPosition, setTooltipPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [mapZoom, setMapZoom] = useState<number | null>(null);
  const mapRef = (window as any).mapRef;

  // Update tooltip position when map moves/zooms
  useEffect(() => {
    if (!hoverInfo || !mapRef?.current) {
      setTooltipPosition(null);
      return;
    }

    // Check if this is a DEM layer (may not have object)
    const deckLayerId = hoverInfo.layer?.id as string | undefined;
    let isDemLayer = false;
    if (deckLayerId) {
      const baseId = deckLayerId
        .replace(/-icon-layer$/, "")
        .replace(/-signal-overlay$/, "")
        .replace(/-bitmap$/, "")
        .replace(/-mesh$/, "");
      const matchingLayer = layers.find((l) => l.id === baseId);
      if (matchingLayer?.type === "dem") {
        isDemLayer = true;
      }
    }

    // For DEM layers, we might not have an object, but we should still position the tooltip
    if (!hoverInfo.object && !isDemLayer && !hoverInfo.coordinate) {
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

        // PRIORITY 1: Always use hoverInfo.coordinate if available
        // This is the actual hovered point on the map (works for raster, LineString, etc.)
        // This is especially important for DEM/raster layers and LineString layers
        if (hoverInfo.coordinate && hoverInfo.coordinate.length >= 2) {
          [lng, lat] = hoverInfo.coordinate;
        }
        // PRIORITY 2: Try to get coordinates from object geometry (only if object exists)
        else if (hoverInfo.object?.geometry?.coordinates) {
          // GeoJSON Point
          if (
            Array.isArray(hoverInfo.object.geometry.coordinates) &&
            hoverInfo.object.geometry.coordinates.length >= 2 &&
            !Array.isArray(hoverInfo.object.geometry.coordinates[0])
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
          } else if (
            hoverInfo.object.geometry.type === "LineString" &&
            Array.isArray(hoverInfo.object.geometry.coordinates) &&
            hoverInfo.object.geometry.coordinates.length > 0 &&
            Array.isArray(hoverInfo.object.geometry.coordinates[0])
          ) {
            // LineString - use first point as fallback (coordinate should be handled above)
            const firstPoint = hoverInfo.object.geometry.coordinates[0];
            if (firstPoint && firstPoint.length >= 2) {
              lng = firstPoint[0];
              lat = firstPoint[1];
            }
          }
        }
        // PRIORITY 3: Direct polygon layer (only if object exists)
        else if (
          hoverInfo.object?.polygon &&
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
        }
        // PRIORITY 4: Direct coordinates from object (only if object exists)
        else if (
          hoverInfo.object?.longitude !== undefined &&
          hoverInfo.object?.latitude !== undefined
        ) {
          // Direct coordinates
          lng = hoverInfo.object.longitude;
          lat = hoverInfo.object.latitude;
        }
        // PRIORITY 5: Position array (only if object exists)
        else if (
          hoverInfo.object?.position &&
          Array.isArray(hoverInfo.object.position)
        ) {
          // Position array [lng, lat]
          lng = hoverInfo.object.position[0];
          lat = hoverInfo.object.position[1];
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
      // Get initial zoom
      setMapZoom(map.getZoom());

      const handleZoom = () => {
        setMapZoom(map.getZoom());
        updatePosition();
      };

      map.on("move", updatePosition);
      map.on("zoom", handleZoom);

      return () => {
        map.off("move", updatePosition);
        map.off("zoom", handleZoom);
      };
    }
  }, [hoverInfo, mapRef]);

  if (!hoverInfo) {
    return null;
  }

  const { object, layer } = hoverInfo;

  // Check if user location is toggled off and this is user location layer
  if (layer?.id === "user-location-layer" && !showUserLocation) {
    return null;
  }

  // Use calculated position or fallback to original
  const x = tooltipPosition?.x ?? hoverInfo.x ?? 0;
  const y = tooltipPosition?.y ?? hoverInfo.y ?? 0;

  if (x === 0 && y === 0) {
    return null;
  }

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

  // If layer is found in store and is not visible, don't show tooltip
  // Exception: user-location-layer and other special layers that aren't in the store
  if (layerInfo && layerInfo.visible === false) {
    return null;
  }

  // Check if layer is outside its zoom range
  if (layerInfo && mapZoom !== null) {
    const minZoomCheck =
      layerInfo.minzoom === undefined || mapZoom >= layerInfo.minzoom;
    const maxZoomCheck = mapZoom <= (layerInfo.maxzoom ?? 20);
    if (!minZoomCheck || !maxZoomCheck) {
      return null;
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
    // Handle user location layer - show "Your Location" heading
    if (layer?.id === "user-location-layer") {
      if (!showUserLocation) return null;

      let lng: number | undefined;
      let lat: number | undefined;

      if (hoverInfo.coordinate) {
        [lng, lat] = hoverInfo.coordinate;
      } else if (
        (object as any)?.position &&
        Array.isArray((object as any).position)
      ) {
        [lng, lat] = (object as any).position;
      }

      return (
        <TooltipBox>
          <TooltipHeading title="Your Location" />
          {lng !== undefined && lat !== undefined && (
            <TooltipProperties
              properties={[
                {
                  label: coordinateLabel,
                  value: formatCoordinatePair([lng, lat]),
                },
              ]}
            />
          )}
        </TooltipBox>
      );
    }

    // Handle DEM (elevation raster) layers - show elevation at hovered point
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

          const hasValidElevation =
            Number.isFinite(elevation) &&
            elevation !== null &&
            elevation !== undefined;

          const properties = [
            {
              label: useIgrs ? "IGRS" : "Latitude",
              value: useIgrs
                ? calculateIgrs(lng, lat) ?? "—"
                : `${lat.toFixed(5)}°`,
            },
          ];

          if (!useIgrs) {
            properties.push({
              label: "Longitude",
              value: `${lng.toFixed(5)}°`,
            });
          }

          properties.push(
            { label: "Pixel Index", value: `(${x}, ${y})` },
            {
              label: "Elevation",
              value: hasValidElevation
                ? `${elevation.toFixed(2)} m`
                : "No data",
            },
            {
              label: "Elevation Range",
              value: `${min.toFixed(1)}–${max.toFixed(1)} m`,
            },
            {
              label: "Raster Size",
              value: `${width} × ${height} px`,
            }
          );

          return (
            <TooltipBox maxWidth="max-w-[200px]">
              {layerInfo.name && (
                <TooltipHeading title={layerInfo.name.toUpperCase()} />
              )}
              <TooltipProperties properties={properties} />
            </TooltipBox>
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

      const displayProperties = Object.entries(object)
        .filter(
          ([key, value]) =>
            importantKeys.includes(key) &&
            value !== undefined &&
            value !== null &&
            typeof value !== "object"
        )
        .map(([key, value]) => ({
          label: formatLabel(key),
          value:
            typeof value === "number" && !Number.isInteger(value)
              ? value.toFixed(2)
              : String(value),
        }));

      const useGridLayout = displayProperties.length > 8;

      const properties = [];
      if (object.longitude !== undefined && object.latitude !== undefined) {
        properties.push({
          label: "Location",
          value: useIgrs
            ? calculateIgrs(object.longitude, object.latitude) ||
              `[${object.latitude.toFixed(3)}, ${object.longitude.toFixed(3)}]`
            : `[${object.latitude.toFixed(3)}, ${object.longitude.toFixed(3)}]`,
        });
      }

      return (
        <TooltipBox
          maxWidth={useGridLayout ? "max-w-[320px]" : "max-w-[200px]"}
          style={{ maxHeight: "450px", overflowY: "auto" }}
        >
          <TooltipHeading
            title={
              layer.id === "udp-network-members-layer"
                ? "Network Member"
                : "Target"
            }
          />
          {properties.length > 0 && (
            <>
              <TooltipProperties properties={properties} />
              <TooltipDivider />
            </>
          )}
          <TooltipProperties
            properties={displayProperties}
            useGridLayout={useGridLayout}
          />
          <TooltipDivider />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                alert("Video call initiated");
              }}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-white rounded-md transition-all hover:opacity-90"
              style={{ backgroundColor: "#7F1D1D" }}
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
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-white rounded-md transition-all hover:opacity-90"
              style={{ backgroundColor: "#3F6212" }}
              title="File Transfer"
            >
              <Upload size={12} />
              <span>FTP</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                alert("Phone call initiated");
              }}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-white rounded-md transition-all hover:opacity-90"
              style={{ backgroundColor: "#1E3A8A" }}
              title="Voice Call"
            >
              <PhoneCall className="size-3" />
              <span>Call</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                alert("Message sent");
              }}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-white rounded-md transition-all hover:opacity-90"
              style={{ backgroundColor: "#A16207" }}
              title="Send Message"
            >
              <MessageSquare size={12} />
              <span>Message</span>
            </button>
          </div>
        </TooltipBox>
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

      const properties = [
        {
          label: "Bearing angle",
          value: isNorthSegment
            ? "0° (reference axis)"
            : `${angleDeg.toFixed(1)}°`,
        },
      ];

      if (distanceMeters !== undefined) {
        properties.push({
          label: "Distance",
          value: formatDistance(distanceMeters / 1000),
        });
      }

      properties.push(
        {
          label: `Center (${coordinateLabel})`,
          value: formatCoordinatePair(layerInfo.azimuthCenter),
        },
        {
          label: `Target (${coordinateLabel})`,
          value: formatCoordinatePair(layerInfo.azimuthTarget),
        }
      );

      return (
        <TooltipBox>
          <TooltipHeading
            title="Bearing Calculation"
            subtitle={layerInfo?.name}
          />
          <TooltipProperties properties={properties} />
        </TooltipBox>
      );
    }

    if (isDirectNodeObject) {
      const properties = [
        { label: "User ID", value: String(object.userId) },
        { label: "SNR", value: `${object.snr} dB` },
        { label: "RSSI", value: `${object.rssi} dBm` },
        {
          label: "Distance",
          value: `${object.distance?.toFixed(2)} m`,
        },
        { label: "Hop Count", value: String(object.hopCount) },
      ];

      if (object.connectedNodeIds && object.connectedNodeIds.length > 0) {
        properties.push({
          label: "Connected Nodes",
          value: `[${object.connectedNodeIds.join(", ")}]`,
        });
      }

      properties.push({
        label: `Location (${coordinateLabel})`,
        value: formatCoordinatePair([object.longitude, object.latitude]),
      });

      return (
        <TooltipBox>
          {layerInfo?.name && <TooltipHeading title={layerInfo.name} />}
          <TooltipHeading title="Network Node" />
          <TooltipProperties properties={properties} />
          <TooltipDivider />
          <div className="text-gray-600 text-xs">
            Click on the node to change its icon
          </div>
        </TooltipBox>
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
        const nodeProperties = [
          { label: "User ID", value: String(properties.userId) },
          { label: "SNR", value: `${properties.snr} dB` },
          { label: "RSSI", value: `${properties.rssi} dBm` },
          {
            label: "Distance",
            value: `${properties.distance?.toFixed(2)} m`,
          },
          { label: "Hop Count", value: String(properties.hopCount) },
        ];

        if (
          properties.connectedNodeIds &&
          properties.connectedNodeIds.length > 0
        ) {
          nodeProperties.push({
            label: "Connected Nodes",
            value: `[${properties.connectedNodeIds.join(", ")}]`,
          });
        }

        if (geometryType === "Point" && object.geometry.coordinates) {
          nodeProperties.push({
            label: `Location (${coordinateLabel})`,
            value: formatCoordinatePair(
              object.geometry.coordinates as [number, number]
            ),
          });
        }

        return (
          <TooltipBox>
            {layerInfo?.name && <TooltipHeading title={layerInfo.name} />}
            <TooltipHeading title="Network Node" />
            <TooltipProperties properties={nodeProperties} />
            <TooltipDivider />
            <div className="text-gray-600 text-xs">
              Click on the node to change its icon
            </div>
          </TooltipBox>
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
        geometryInfo = `Distance: ${totalDistance.toFixed(2)} km`;
      }

      // Calculate area for Polygon
      if (
        geometryType === "Polygon" &&
        object.geometry.coordinates &&
        object.geometry.coordinates[0]
      ) {
        const areaMeters = computePolygonAreaMeters(
          object.geometry.coordinates
        );
        geometryInfo = `Area: ${formatArea(areaMeters)}`;
      }

      const tooltipProperties = [];

      if (geometryType === "Point" && layerInfo?.pointRadius) {
        tooltipProperties.push({
          label: "Radius",
          value: `${layerInfo.pointRadius.toLocaleString()} px`,
        });
      }

      if (geometryType === "LineString" && layerInfo?.lineWidth) {
        tooltipProperties.push({
          label: "Width",
          value: `${layerInfo.lineWidth} px`,
        });
      }

      if (properties.name) {
        tooltipProperties.push({
          label: "Name",
          value: String(properties.name),
        });
      }

      if (geometryInfo) {
        tooltipProperties.push({
          label: geometryInfo.split(":")[0],
          value: geometryInfo.split(":")[1]?.trim() || "",
        });
      }

      if (geometryType === "Point" && object.geometry.coordinates) {
        tooltipProperties.push({
          label: `Coordinates (${coordinateLabel})`,
          value: formatCoordinatePair(
            object.geometry.coordinates as [number, number]
          ),
        });
      }

      // Add other properties
      const propertyEntries = Object.entries(properties).filter(
        ([key]) =>
          key.toLowerCase() !== "latitude" &&
          key.toLowerCase() !== "longitude" &&
          key.toLowerCase() !== "name"
      );

      propertyEntries.forEach(([key, value]) => {
        tooltipProperties.push({
          label: formatLabel(key),
          value: String(value),
        });
      });

      const useGridLayout = tooltipProperties.length > 6;

      return (
        <TooltipBox maxWidth="max-w-[200px]">
          {layerInfo?.name && (
            <TooltipHeading
              title={layerInfo.name}
              subtitle={`${geometryType} Feature`}
            />
          )}
          <TooltipProperties
            properties={tooltipProperties}
            useGridLayout={useGridLayout}
          />
        </TooltipBox>
      );
    }

    if (object.sourcePosition && object.targetPosition) {
      const distance = getDistance(
        [object.sourcePosition[0], object.sourcePosition[1]],
        [object.targetPosition[0], object.targetPosition[1]]
      );
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

      const properties = [];

      if (layerInfo?.lineWidth || object.width) {
        properties.push({
          label: "Width",
          value: `${layerInfo?.lineWidth || object.width} px`,
        });
      }

      properties.push({
        label: "Distance",
        value: `${parseFloat(distance).toFixed(2)} km`,
      });

      if (segmentCount) {
        properties.push({
          label: "Total Segments",
          value: String(segmentCount),
        });

        if (segmentCount > 1) {
          properties.push(
            {
              label: "Max segment",
              value: formatDistance(maxSegmentKm ?? 0),
            },
            {
              label: "Min segment",
              value: formatDistance(minSegmentKm ?? 0),
            },
            {
              label: "Avg segment",
              value: formatDistance(avgSegmentKm ?? 0),
            }
          );
        } else {
          properties.push({
            label: "Segment length",
            value: formatDistance(segmentDistances[0]),
          });
        }

        properties.push({
          label: "Total",
          value: formatDistance(segmentsTotalKm),
        });
      }

      properties.push(
        {
          label: `From (${coordinateLabel})`,
          value: formatCoordinatePair(
            object.sourcePosition as [number, number]
          ),
        },
        {
          label: `To (${coordinateLabel})`,
          value: formatCoordinatePair(
            object.targetPosition as [number, number]
          ),
        }
      );

      return (
        <TooltipBox>
          {layerInfo?.name && (
            <TooltipHeading title={layerInfo.name} subtitle="Line Segment" />
          )}
          <TooltipProperties properties={properties} />
        </TooltipBox>
      );
    }

    if (object.position) {
      const properties = [];

      if (layerInfo?.radius || object.radius) {
        properties.push({
          label: "Radius",
          value: `${(layerInfo?.radius || object.radius).toLocaleString()} px`,
        });
      }

      properties.push({
        label: `Coordinates (${coordinateLabel})`,
        value: formatCoordinatePair(object.position),
      });

      return (
        <TooltipBox>
          {layerInfo?.name && (
            <TooltipHeading title={layerInfo.name} subtitle="Point" />
          )}
          <TooltipProperties properties={properties} />
        </TooltipBox>
      );
    }

    if (object.polygon) {
      // object.polygon from deck.gl PolygonLayer is a single ring [number, number][]
      // computePolygonAreaMeters expects [number, number][][] (array of rings), so wrap it
      const polygonRings =
        Array.isArray(object.polygon[0]) && Array.isArray(object.polygon[0][0])
          ? object.polygon // Already array of rings [[[lng, lat], ...], ...]
          : [object.polygon]; // Single ring [[lng, lat], ...], wrap it
      const areaMeters = computePolygonAreaMeters(polygonRings);
      const perimeterMeters = computePolygonPerimeterMeters(polygonRings);

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

      const properties = [
        { label: "Area", value: formatArea(areaMeters) },
        {
          label: "Perimeter",
          value: formatDistance(perimeterMeters / 1000),
        },
        { label: "Vertices", value: String(vertexCount) },
      ];

      return (
        <TooltipBox>
          {layerInfo?.name && (
            <TooltipHeading title={layerInfo.name} subtitle="Polygon" />
          )}
          <TooltipProperties properties={properties} />
        </TooltipBox>
      );
    }

    return (
      <TooltipBox>
        <TooltipHeading title="Map Feature" />
        <div className="text-gray-600 text-sm">Hover for details</div>
      </TooltipBox>
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
