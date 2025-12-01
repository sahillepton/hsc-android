import Map, { useControl, NavigationControl } from "react-map-gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { PickingInfo } from "@deck.gl/core";
import {
  GeoJsonLayer,
  IconLayer,
  LineLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer,
  BitmapLayer,
} from "@deck.gl/layers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import IconSelection from "./icon-selection";
import ZoomControls from "./zoom-controls";
import Tooltip from "./tooltip";
import { useUdpLayers } from "./udp-layers";
import UdpConfigDialog from "./udp-config-dialog";
import TiltControl from "./tilt-control";
import { useUdpConfigStore } from "@/store/udp-config-store";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { useDefaultLayers } from "@/hooks/use-default-layers";
import {
  useCurrentPath,
  useDragStart,
  useDrawingMode,
  useFocusLayerRequest,
  useIsDrawing,
  useLayers,
  useMousePosition,
  useNetworkLayersVisible,
  useNodeIconMappings,
  useAzimuthalAngle,
  useHoverInfo,
  usePendingPolygon,
} from "@/store/layers-store";
import {
  calculateBearingDegrees,
  calculateDistanceMeters,
  generateLayerId,
  isPointNearFirstPoint,
  makeSectorPolygon,
} from "@/lib/layers";
import type { LayerProps, Node } from "@/lib/definitions";
import { LayersIcon, CameraIcon, WifiPen, XIcon, PenIcon } from "lucide-react";

function DeckGLOverlay({ layers }: { layers: any[] }) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({}));
  useEffect(() => {
    overlay.setProps({ layers });
  }, [overlay, layers]);

  return null;
}

const MapComponent = ({
  onToggleLayersPanel,
}: {
  onToggleLayersPanel?: () => void;
}) => {
  const mapRef = useRef<any>(null);
  const zoomUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    (window as any).mapRef = mapRef;

    // Cleanup timeout on unmount
    return () => {
      if (zoomUpdateTimeoutRef.current) {
        clearTimeout(zoomUpdateTimeoutRef.current);
      }
    };
  }, []);

  // Show UDP config dialog on app start (only once) if no config exists
  useEffect(() => {
    const hasShownConfig = sessionStorage.getItem("udp-config-shown");
    const { host, port } = useUdpConfigStore.getState();
    // Only auto-show if we haven't shown it before AND no config is set
    if (!hasShownConfig && (!host || !host.trim() || !port || port <= 0)) {
      setIsUdpConfigDialogOpen(true);
      sessionStorage.setItem("udp-config-shown", "true");
    }
  }, []);

  const { networkLayersVisible } = useNetworkLayersVisible();
  const { dragStart, setDragStart } = useDragStart();
  const { mousePosition, setMousePosition } = useMousePosition();
  const { layers, addLayer } = useLayers();
  const { focusLayerRequest, setFocusLayerRequest } = useFocusLayerRequest();
  const { drawingMode, setDrawingMode } = useDrawingMode();
  const { isDrawing, setIsDrawing } = useIsDrawing();
  const { currentPath, setCurrentPath } = useCurrentPath();
  const { nodeIconMappings } = useNodeIconMappings();
  const { azimuthalAngle } = useAzimuthalAngle();
  const { hoverInfo, setHoverInfo } = useHoverInfo();
  const { pendingPolygonPoints, setPendingPolygonPoints } = usePendingPolygon();
  const previousDrawingModeRef = useRef(drawingMode);

  // const { nodeCoordinatesData, setNodeCoordinatesData } =
  //   useProgressiveNodes(networkLayersVisible);
  const [isMapEnabled] = useState(true);
  const [pitch, setPitch] = useState(0);

  const [selectedNodeForIcon, setSelectedNodeForIcon] = useState<string | null>(
    null
  );
  const [mapZoom, setMapZoom] = useState(4);
  const [isUdpConfigDialogOpen, setIsUdpConfigDialogOpen] = useState(false);
  const [configKey, setConfigKey] = useState(0);
  const [showConnectionError, setShowConnectionError] = useState(false);
  const [isCameraPopoverOpen, setIsCameraPopoverOpen] = useState(false);
  const lastLayerCreationTimeRef = useRef<number>(0);

  // useEffect(() => {
  //   const loadNodeData = async () => {
  //     try {
  //       const coordinates: Array<{ lat: number; lng: number }[]> = [];

  //       // Load JSON files for each of the 8 nodes
  //       for (let i = 1; i <= 8; i++) {
  //         try {
  //           const response = await fetch(`/node-data/node-${i}.json`);
  //           if (!response.ok) {
  //             console.warn(
  //               `Failed to load node-${i}.json:`,
  //               response.statusText
  //             );
  //             continue;
  //           }
  //           const data = await response.json();
  //           if (Array.isArray(data) && data.length > 0) {
  //             coordinates.push(data);
  //             console.log(`Loaded node-${i}.json: ${data.length} coordinates`);
  //           }
  //         } catch (error) {
  //           console.error(`Error loading node-${i}.json:`, error);
  //         }
  //       }

  //       // Store all coordinates for each node
  //       if (coordinates.length === 8) {
  //         setNodeCoordinatesData(coordinates);
  //         console.log(
  //           "Loaded coordinates from JSON files:",
  //           coordinates.map((tab, idx) => `Node ${idx + 1}: ${tab.length} rows`)
  //         );
  //       } else {
  //         console.warn("Expected 8 node files, found:", coordinates.length);
  //         if (coordinates.length > 0) {
  //           // Use what we have
  //           setNodeCoordinatesData(coordinates);
  //         }
  //       }
  //     } catch (error) {
  //       console.error("Error loading node data files:", error);
  //     }
  //   };

  //   loadNodeData();
  // }, []);

  const createPointLayer = (position: [number, number]) => {
    const newLayer: LayerProps = {
      type: "point",
      id: generateLayerId(),
      name: `Point ${layers.filter((l) => l.type === "point").length + 1}`,
      position,
      color: [59, 130, 246], // Beautiful blue color
      radius: 5,
      visible: true,
    };
    addLayer(newLayer);
    lastLayerCreationTimeRef.current = Date.now();
    setHoverInfo(undefined); // Clear tooltip when creating a layer
  };

  const handleLineDrawing = (point: [number, number]) => {
    if (!isDrawing) {
      setCurrentPath([point]);
      setIsDrawing(true);
    } else {
      // Safety check: ensure currentPath exists and has at least one point
      if (!currentPath || currentPath.length === 0) {
        console.warn("currentPath is empty, resetting line drawing");
        setCurrentPath([point]);
        setIsDrawing(true);
        return;
      }

      const finalPath = [currentPath[0], point];
      const newLayer: LayerProps = {
        type: "line",
        id: generateLayerId(),
        name: `Line ${layers.filter((l) => l.type === "line").length + 1}`,
        path: finalPath,
        color: [0, 0, 0], // Black color
        lineWidth: 5,
        visible: true,
      };
      addLayer(newLayer);
      lastLayerCreationTimeRef.current = Date.now();
      setHoverInfo(undefined); // Clear tooltip when creating a layer
      setCurrentPath([]);
      setIsDrawing(false);
    }
  };

  const handlePolygonDrawing = (point: [number, number]) => {
    //   console.log("handlePolygonDrawing called with:", { point, isDrawing, currentPathLength: currentPath.length });

    if (!isDrawing) {
      setCurrentPath([point]);
      setPendingPolygonPoints([point]);
      setIsDrawing(true);
      return;
    }

    const updatedPath = [...pendingPolygonPoints, point];
    setPendingPolygonPoints(updatedPath);
    setCurrentPath(updatedPath);

    if (
      updatedPath.length >= 3 &&
      isPointNearFirstPoint(point, updatedPath[0])
    ) {
      const closedPath = [...updatedPath.slice(0, -1), updatedPath[0]];
      const newLayer: LayerProps = {
        type: "polygon",
        id: generateLayerId(),
        name: `Polygon ${
          layers.filter((l) => l.type === "polygon").length + 1
        }`,
        polygon: [closedPath],
        color: [32, 32, 32, 180],
        visible: true,
      };
      addLayer(newLayer);
      lastLayerCreationTimeRef.current = Date.now();
      setHoverInfo(undefined); // Clear tooltip when creating a layer
      setCurrentPath([]);
      setPendingPolygonPoints([]);
      setIsDrawing(false);
    }
  };

  const handleAzimuthalDrawing = (point: [number, number]) => {
    if (!isDrawing) {
      // First click sets the center
      setCurrentPath([point]);
      setIsDrawing(true);
      return;
    }

    // Second click sets the azimuth and radius
    const center = currentPath[0];
    const end = point;
    const radiusMeters = calculateDistanceMeters(center, end);
    const bearing = calculateBearingDegrees(center, end);

    const sectorAngleDeg = azimuthalAngle || 60; // default sector width
    const sector = makeSectorPolygon(
      center,
      radiusMeters,
      bearing,
      sectorAngleDeg
    );

    // Build GeoJSON with only the sector polygon (no point or azimuth line)
    const newLayer: LayerProps = {
      type: "polygon",
      id: generateLayerId(),
      name: `Azimuthal ${
        layers.filter((l) => l.name?.startsWith("Azimuthal")).length + 1
      }`,
      polygon: [sector],
      color: [32, 32, 32, 180],
      visible: true,
      sectorAngleDeg,
      radiusMeters,
      bearing,
    };

    addLayer(newLayer);
    lastLayerCreationTimeRef.current = Date.now();
    setHoverInfo(undefined); // Clear tooltip when creating a layer
    setCurrentPath([]);
    setIsDrawing(false);
  };

  useEffect(() => {
    const previousMode = previousDrawingModeRef.current;
    if (
      previousMode === "polygon" &&
      drawingMode !== "polygon" &&
      pendingPolygonPoints.length >= 3
    ) {
      const closedPath = [...pendingPolygonPoints, pendingPolygonPoints[0]];
      const newLayer: LayerProps = {
        type: "polygon",
        id: generateLayerId(),
        name: `Polygon ${
          layers.filter((l) => l.type === "polygon").length + 1
        }`,
        polygon: [closedPath],
        color: [32, 32, 32, 180],
        visible: true,
      };
      addLayer(newLayer);
      lastLayerCreationTimeRef.current = Date.now();
      setHoverInfo(undefined); // Clear tooltip when creating a layer
      setPendingPolygonPoints([]);
      setCurrentPath([]);
      setIsDrawing(false);
    }

    if (drawingMode !== "polygon" && pendingPolygonPoints.length === 0) {
      setCurrentPath([]);
    }

    previousDrawingModeRef.current = drawingMode;
  }, [
    drawingMode,
    pendingPolygonPoints,
    addLayer,
    layers,
    setPendingPolygonPoints,
    setCurrentPath,
    setIsDrawing,
  ]);

  const handleClick = (event: any) => {
    if (!drawingMode) {
      return;
    }

    // Try to get coordinates from event.lngLat first
    let longitude: number | undefined;
    let latitude: number | undefined;

    if (event.lngLat) {
      longitude = event.lngLat.lng;
      latitude = event.lngLat.lat;
    } else if (event.point && mapRef.current) {
      // Fallback: unproject screen coordinates to geographic coordinates
      // This is needed when the map is tilted and lngLat might be undefined
      try {
        const map = mapRef.current.getMap();
        const coords = map.unproject(event.point);
        longitude = coords.lng;
        latitude = coords.lat;
      } catch (error) {
        console.error("Error unprojecting coordinates:", error);
        return;
      }
    } else {
      // If neither method works, return early
      console.warn("Could not determine click coordinates");
      return;
    }

    // Validate coordinates before proceeding
    if (
      typeof longitude !== "number" ||
      typeof latitude !== "number" ||
      isNaN(longitude) ||
      isNaN(latitude)
    ) {
      console.warn("Invalid coordinates:", { longitude, latitude });
      return;
    }

    const clickPoint: [number, number] = [longitude, latitude];

    switch (drawingMode) {
      case "point":
        createPointLayer(clickPoint);
        break;
      case "line":
        handleLineDrawing(clickPoint);
        break;
      case "polygon":
        handlePolygonDrawing(clickPoint);
        break;
      case "azimuthal":
        handleAzimuthalDrawing(clickPoint);
        break;
    }
  };

  const handleMapClick = (event: any) => {
    const { object } = event;

    // If clicking on empty space, close any open dialogs
    if (selectedNodeForIcon && !object) {
      setSelectedNodeForIcon(null);
    }

    // Close tooltip when clicking anywhere on the map
    setHoverInfo(undefined);

    // For other clicks, use the default handler
    handleClick(event);
  };
  useEffect(() => {
    if (!focusLayerRequest || !mapRef.current) {
      return;
    }

    const map = mapRef.current.getMap();
    const [minLng, minLat, maxLng, maxLat] = focusLayerRequest.bounds;
    const { center, isSinglePoint } = focusLayerRequest;

    try {
      if (isSinglePoint) {
        map.easeTo({
          center,
          zoom: Math.max(map.getZoom(), 14),
          duration: 800,
        });
      } else {
        map.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          {
            padding: { top: 120, bottom: 120, left: 160, right: 160 },
            duration: 800,
            maxZoom: 20,
          }
        );
      }
    } catch (error) {
      console.error("Failed to focus layer:", error);
    } finally {
      setFocusLayerRequest(null);
    }
  }, [focusLayerRequest]);

  // Close tooltip when the hovered layer becomes hidden
  useEffect(() => {
    if (!hoverInfo || !hoverInfo.object) {
      return;
    }

    // Check if hovered layer is a UDP layer (by checking layer ID)
    const hoveredLayerId = hoverInfo.layer?.id;
    if (
      hoveredLayerId &&
      (hoveredLayerId.includes("udp-") ||
        hoveredLayerId.includes("network-members") ||
        hoveredLayerId.includes("targets"))
    ) {
      // If UDP layers are hidden, clear the tooltip
      if (!networkLayersVisible) {
        setHoverInfo(undefined);
        return;
      }
    }

    // Find the layer ID from the hover info
    const hoveredObject = hoverInfo.object;
    let layerId: string | undefined;

    if ((hoveredObject as any)?.layerId) {
      layerId = (hoveredObject as any).layerId;
    } else if ((hoveredObject as any)?.id && (hoveredObject as any)?.type) {
      layerId = (hoveredObject as any).id;
    } else if (hoverInfo.layer?.id) {
      const deckLayerId = hoverInfo.layer.id;
      const matchingLayer = layers.find((l) => l.id === deckLayerId);
      layerId = matchingLayer?.id;
      if (!layerId) {
        const baseId = deckLayerId
          .replace(/-icon-layer$/, "")
          .replace(/-signal-overlay$/, "")
          .replace(/-bitmap$/, "");
        layerId = layers.find((l) => l.id === baseId)?.id;
      }
    }

    // Check if the hovered layer is now hidden or deleted
    if (layerId) {
      const hoveredLayer = layers.find((l) => l.id === layerId);
      if (!hoveredLayer || hoveredLayer.visible === false) {
        setHoverInfo(undefined);
      }
    }
  }, [layers, hoverInfo, setHoverInfo, networkLayersVisible]);

  const {
    cityNamesLayer,
    indiaPlacesLayer,
    indiaDistrictsLayer,
    stateNamesLayer,
  } = useDefaultLayers(mapZoom);

  const handleMouseMove = (event: any) => {
    if (!event.lngLat) return;

    const { lng: longitude, lat: latitude } = event.lngLat;
    const currentPoint: [number, number] = [longitude, latitude];
    setMousePosition(currentPoint);
  };

  const handleMouseUp = () => {
    if (!isDrawing || !dragStart) return;

    setIsDrawing(false);
    setDragStart(null);
  };

  const handleLayerHover = useCallback(
    (info: PickingInfo<unknown>) => {
      // Prevent tooltip from showing immediately after layer creation (especially on tablets)
      const timeSinceLastCreation =
        Date.now() - lastLayerCreationTimeRef.current;
      if (timeSinceLastCreation < 500) {
        // Don't show tooltip if layer was created less than 500ms ago
        setHoverInfo(undefined);
        return;
      }

      if (info && info.object) {
        setHoverInfo(info);
      } else {
        setHoverInfo(undefined);
      }
    },
    [setHoverInfo]
  );

  // UDP layers from separate component
  const { udpLayers, connectionError, noDataWarning, isConnected } =
    useUdpLayers(handleLayerHover);
  const { host, port } = useUdpConfigStore();

  const handleNodeIconClick = useCallback(
    (info: PickingInfo<unknown>) => {
      if (!info || !info.object) {
        return;
      }

      const node = info.object as Node;
      const nodeId = node?.userId?.toString();
      if (nodeId) {
        setSelectedNodeForIcon(nodeId);
      }
      setHoverInfo(undefined);
    },
    [setHoverInfo]
  );

  const deckGlLayers = useMemo(() => {
    const isLayerVisible = (layer: LayerProps) => {
      if (layer.visible === false) return false;
      const name = layer.name || "";
      const isNetworkLayer =
        name.includes("Network") ||
        name.includes("Connection") ||
        layer.type === "nodes";
      if (isNetworkLayer && !networkLayersVisible) {
        return false;
      }
      return true;
    };

    const guardColor = (color: number[] = [0, 0, 0]) =>
      color.length === 4 ? color : [...color, 255];

    const getSignalColor = (
      snr: number | undefined,
      rssi: number | undefined
    ): [number, number, number] => {
      if (
        typeof snr !== "number" ||
        Number.isNaN(snr) ||
        typeof rssi !== "number" ||
        Number.isNaN(rssi)
      ) {
        return [128, 128, 128];
      }
      const normalizedSNR = Math.max(0, Math.min(1, snr / 30));
      const normalizedRSSI = Math.max(0, Math.min(1, (rssi + 100) / 70));
      const signalStrength = normalizedSNR * 0.7 + normalizedRSSI * 0.3;
      if (signalStrength >= 0.7) return [0, 255, 0];
      if (signalStrength >= 0.4) return [255, 165, 0];
      return [255, 0, 0];
    };

    const getNodeIcon = (node: Node, allNodes: Node[] = []) => {
      const nodeId = node.userId?.toString();
      if (nodeId && nodeIconMappings[nodeId]) {
        const iconName = nodeIconMappings[nodeId];
        const isRectangularIcon = [
          "ground_unit",
          "command_post",
          "naval_unit",
        ].includes(iconName);
        return {
          url: `/icons/${iconName}.svg`,
          width: isRectangularIcon ? 28 : 24,
          height: isRectangularIcon ? 20 : 24,
          anchorY: isRectangularIcon ? 10 : 12,
          anchorX: isRectangularIcon ? 14 : 12,
          mask: false,
        };
      }

      let iconName = "neutral_aircraft";

      const getMotherAircraft = () => {
        if (!allNodes.length) return null;
        const sortedNodes = allNodes
          .filter((n) => typeof n.snr === "number")
          .sort((a, b) => {
            const snrA = a.snr ?? -Infinity;
            const snrB = b.snr ?? -Infinity;
            if (snrB !== snrA) return snrB - snrA;
            return a.userId - b.userId;
          });
        return sortedNodes[0] ?? null;
      };

      const motherAircraft = getMotherAircraft();

      if (motherAircraft && node.userId === motherAircraft.userId) {
        iconName = "mother-aircraft";
      } else if (node.hopCount === 0) {
        iconName = "command_post";
      } else if ((node.snr ?? 0) > 20) {
        iconName = "friendly_aircraft";
      } else if ((node.snr ?? 0) > 10) {
        iconName = "ground_unit";
      } else if ((node.snr ?? 0) > 0) {
        iconName = "neutral_aircraft";
      } else {
        iconName = "unknown_aircraft";
      }

      const isRectangularIcon = [
        "ground_unit",
        "command_post",
        "naval_unit",
      ].includes(iconName);
      return {
        url: `/icons/${iconName}.svg`,
        width: isRectangularIcon ? 28 : 24,
        height: isRectangularIcon ? 20 : 24,
        anchorY: isRectangularIcon ? 10 : 12,
        anchorX: isRectangularIcon ? 14 : 12,
        mask: false,
      };
    };

    const visibleLayers = layers
      .filter(isLayerVisible)
      .filter(
        (layer) =>
          !(layer.type === "point" && layer.name?.startsWith("Polygon Point"))
      );
    const pointLayers = visibleLayers.filter((l) => l.type === "point");
    const lineLayers = visibleLayers.filter(
      (l) => l.type === "line" && !(l.name || "").includes("Connection")
    );
    const connectionLayers = visibleLayers.filter(
      (l) => l.type === "line" && (l.name || "").includes("Connection")
    );
    const polygonLayers = visibleLayers.filter((l) => l.type === "polygon");
    const geoJsonLayers = visibleLayers.filter((l) => l.type === "geojson");
    const demLayers = visibleLayers.filter((l) => l.type === "dem");
    const annotationLayers = visibleLayers.filter(
      (l) => l.type === "annotation"
    );
    const nodeLayers = visibleLayers.filter((l) => l.type === "nodes");

    const deckLayers: any[] = [];

    if (pointLayers.length) {
      // Create a unique key based on all radius values to force update
      const radiusKey = pointLayers
        .map((l) => `${l.id}:${l.radius ?? 5}`)
        .join("|");

      deckLayers.push(
        new ScatterplotLayer({
          id: "point-layer",
          data: pointLayers,
          getPosition: (d: LayerProps) => d.position!,
          getRadius: (d: LayerProps) => d.radius ?? 5, // Use radius for point layers
          radiusUnits: "pixels", // Use pixels instead of meters
          getFillColor: (d: LayerProps) => {
            const color = d.color ? [...d.color] : [59, 130, 246];
            return (color.length === 3 ? [...color, 255] : color) as [
              number,
              number,
              number,
              number
            ];
          },
          getLineColor: (d: LayerProps) => {
            const color = d.color ? d.color.slice(0, 3) : [59, 130, 246];
            return color.map((c) => Math.max(0, c - 40)) as [
              number,
              number,
              number
            ];
          },
          getLineWidth: 1,
          stroked: true,
          pickable: true,
          pickingRadius: 300, // Larger picking radius for touch devices
          radiusMinPixels: 1,
          radiusMaxPixels: 50,
          onHover: handleLayerHover,
          updateTriggers: {
            getRadius: [radiusKey], // Update when any radius changes
            getFillColor: [
              pointLayers.map((l) => l.color?.join(",")).join("|"),
            ],
          },
        })
      );
    }

    if (lineLayers.length) {
      const pathData = lineLayers.flatMap((layer) => {
        const path = layer.path ?? [];
        if (path.length < 2) return []; // Need at least 2 points for a line
        return path.slice(0, -1).map((point, index) => ({
          sourcePosition: point,
          targetPosition: path[index + 1],
          color: layer.color ? [...layer.color] : [0, 0, 0], // Black default
          width: layer.lineWidth ?? 5,
          layerId: layer.id,
          layer: layer,
        }));
      });

      if (pathData.length) {
        deckLayers.push(
          new LineLayer({
            id: "line-layer",
            data: pathData,
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => {
              const color = d.color || [0, 0, 0]; // Black default
              return color.length === 3 ? [...color, 255] : color;
            },
            getWidth: (d: any) => Math.max(1, d.width), // Minimum width of 1
            widthUnits: "pixels", // Use pixels instead of meters
            widthMinPixels: 1, // Minimum width of 1 pixel
            widthMaxPixels: 50, // Maximum width of 50 pixels
            pickable: true,
            pickingRadius: 300, // Larger picking radius for touch devices
            onHover: handleLayerHover,
          })
        );
      }
    }

    if (connectionLayers.length) {
      const connectionPathData = connectionLayers.flatMap((layer) =>
        (layer.path ?? []).slice(0, -1).map((point, index) => ({
          sourcePosition: point,
          targetPosition: layer.path![index + 1],
          color: layer.color ? [...layer.color] : [128, 128, 128], // Create a copy of the color array
          width: layer.lineWidth ?? 5,
        }))
      );

      if (connectionPathData.length) {
        deckLayers.push(
          new LineLayer({
            id: "connection-line-layer",
            data: connectionPathData,
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => Math.max(1, d.width), // Minimum width of 1
            widthUnits: "pixels", // Use pixels instead of meters
            widthMinPixels: 1, // Minimum width of 1 pixel
            widthMaxPixels: 50, // Maximum width of 50 pixels
            pickable: true,
            pickingRadius: 300, // Larger picking radius for touch devices
            onHover: handleLayerHover,
          })
        );
      }
    }

    if (polygonLayers.length) {
      deckLayers.push(
        new PolygonLayer({
          id: "polygon-layer",
          data: polygonLayers,
          getPolygon: (d: LayerProps) => d.polygon?.[0] ?? [],
          getFillColor: (d: LayerProps) =>
            d.color && d.color.length === 4
              ? [...d.color] // Create a copy to avoid reference sharing
              : [...(d.color ?? [32, 32, 32]), 100],
          getLineColor: (d: LayerProps) =>
            d.color
              ? ([...d.color.slice(0, 3)] as [number, number, number])
              : [32, 32, 32], // Create a copy
          getLineWidth: 2,
          pickable: true,
          pickingRadius: 300, // Larger picking radius for touch devices
          onHover: handleLayerHover,
        })
      );
    }

    geoJsonLayers.forEach((layer) => {
      if (!layer.geojson) return;
      const lineWidth = layer.lineWidth ?? 5;
      deckLayers.push(
        new GeoJsonLayer({
          id: layer.id,
          data: layer.geojson,
          pickable: true,
          pickingRadius: 300, // Larger picking radius for touch devices
          stroked: true,
          filled: true,
          pointRadiusUnits: "pixels", // Use pixels for point radius
          lineWidthUnits: "pixels", // Use pixels for line width
          getFillColor: (f: any) =>
            f.properties?.color ?? [...(layer.color ?? [0, 150, 255]), 120],
          getLineColor: (f: any) =>
            f.properties?.lineColor ?? guardColor(layer.color ?? [0, 150, 255]),
          getPointRadius: (f: any) =>
            f.geometry?.type === "Point" ? layer.pointRadius ?? 5 : 0,
          getLineWidth: (f: any) => {
            const type = f.geometry?.type;
            if (type === "LineString" || type === "MultiLineString") {
              return lineWidth;
            }
            return 2;
          },
          updateTriggers: {
            getFillColor: [layer.color],
            getLineColor: [layer.color],
            getPointRadius: [layer.pointRadius],
            getLineWidth: [layer.lineWidth],
          },
          onHover: handleLayerHover,
        })
      );
    });

    demLayers.forEach((layer) => {
      if (!layer.bounds) return;
      const [minLng, minLat] = layer.bounds[0];
      const [maxLng, maxLat] = layer.bounds[1];

      // Get the image source (canvas, bitmap, or texture)
      const image: any = layer.bitmap ?? layer.texture ?? undefined;

      if (!image) {
        console.warn("DEM layer missing image source:", {
          id: layer.id,
          name: layer.name,
          hasBitmap: !!layer.bitmap,
          hasTexture: !!layer.texture,
        });
        return;
      }

      // BitmapLayer expects bounds as [left, bottom, right, top]
      // Our bounds format is [[minLng, minLat], [maxLng, maxLat]]
      deckLayers.push(
        new BitmapLayer({
          id: `${layer.id}-bitmap`,
          image: image,
          bounds: [minLng, minLat, maxLng, maxLat],
          pickable: true,
          pickingRadius: 300, // Larger picking radius for touch devices
          visible: layer.visible !== false,
        })
      );
    });

    annotationLayers.forEach((layer) => {
      if (!layer.annotations?.length) return;
      deckLayers.push(
        new TextLayer({
          id: layer.id,
          data: layer.annotations,
          getPosition: (d: any) => d.position,
          getText: (d: any) => d.text,
          getColor: (d: any) => d.color ?? layer.color ?? [0, 0, 0],
          getSize: (d: any) => d.fontSize ?? 14,
          getAngle: 0,
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          pickable: true,
          pickingRadius: 300, // Larger picking radius for touch devices
          sizeScale: 1,
          fontFamily: "Arial, sans-serif",
          fontWeight: "normal",
          onHover: handleLayerHover,
        })
      );
    });

    nodeLayers.forEach((layer) => {
      if (!layer.nodes?.length) return;
      const nodes = [...layer.nodes];

      deckLayers.push(
        new IconLayer({
          id: `${layer.id}-icon-layer`,
          data: nodes,
          pickable: true,
          pickingRadius: 300, // Larger picking radius for touch devices
          getIcon: (node: Node) => getNodeIcon(node, nodes),
          getPosition: (node: Node) => [node.longitude, node.latitude],
          getSize: 24,
          sizeScale: 1,
          getPixelOffset: [0, -10],
          alphaCutoff: 0.001,
          billboard: true,
          sizeUnits: "pixels",
          sizeMinPixels: 16,
          sizeMaxPixels: 32,
          updateTriggers: {
            getIcon: [nodes.length, Object.values(nodeIconMappings).join(",")],
          },
          onHover: handleLayerHover,
          onClick: handleNodeIconClick,
        })
      );

      deckLayers.push(
        new ScatterplotLayer({
          id: `${layer.id}-signal-overlay`,
          data: nodes,
          getPosition: (node: Node) => [node.longitude, node.latitude],
          getRadius: 12000,
          getFillColor: (node: Node) => getSignalColor(node.snr, node.rssi),
          getLineColor: [255, 255, 255, 200],
          getLineWidth: 2,
          radiusMinPixels: 8,
          radiusMaxPixels: 32,
          pickable: true,
          pickingRadius: 300, // Larger picking radius for touch devices
          onHover: handleLayerHover,
          onClick: handleNodeIconClick,
        })
      );
    });

    // --- Preview layers ---
    const previewLayers: any[] = [];

    // Add UDP layers to the deck layers
    if (udpLayers && udpLayers.length > 0) {
      deckLayers.push(...udpLayers);
    }
    if (
      isDrawing &&
      drawingMode === "line" &&
      currentPath.length === 1 &&
      mousePosition
    ) {
      const previewLineData = [
        {
          sourcePosition: currentPath[0],
          targetPosition: mousePosition,
          color: [160, 160, 160],
          width: 3,
        },
      ];
      previewLayers.push(
        new LineLayer({
          id: "preview-line-layer",
          data: previewLineData,
          getSourcePosition: (d: any) => d.sourcePosition,
          getTargetPosition: (d: any) => d.targetPosition,
          getColor: (d: any) => d.color,
          getWidth: (d: any) => d.width,
          pickable: false,
        })
      );
    }

    if (
      isDrawing &&
      drawingMode === "polygon" &&
      currentPath.length >= 1 &&
      mousePosition
    ) {
      if (currentPath.length === 1) {
        const previewLineData = [
          {
            sourcePosition: currentPath[0],
            targetPosition: mousePosition,
            color: [160, 160, 160],
            width: 2,
          },
        ];
        previewLayers.push(
          new LineLayer({
            id: "preview-polygon-edge",
            data: previewLineData,
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => d.width,
            pickable: false,
          })
        );
      } else {
        const previewPath = [...currentPath, mousePosition];
        previewLayers.push(
          new PolygonLayer({
            id: "preview-polygon-layer",
            data: [previewPath],
            getPolygon: (d: [number, number][]) => d,
            getFillColor: [32, 32, 32, 100],
            getLineColor: [32, 32, 32],
            getLineWidth: 2,
            pickable: false,
          })
        );

        if (isPointNearFirstPoint(mousePosition, currentPath[0])) {
          const closingLineData = [
            {
              sourcePosition: mousePosition,
              targetPosition: currentPath[0],
              color: [255, 255, 0],
              width: 3,
            },
          ];
          previewLayers.push(
            new LineLayer({
              id: "preview-polygon-closing",
              data: closingLineData,
              getSourcePosition: (d: any) => d.sourcePosition,
              getTargetPosition: (d: any) => d.targetPosition,
              getColor: (d: any) => d.color,
              getWidth: (d: any) => d.width,
              pickable: false,
            })
          );
        }
      }
    }

    if (
      isDrawing &&
      drawingMode === "azimuthal" &&
      currentPath.length === 1 &&
      mousePosition
    ) {
      const center = currentPath[0];
      const radiusMeters = calculateDistanceMeters(center, mousePosition);
      const bearing = calculateBearingDegrees(center, mousePosition);
      const sector = makeSectorPolygon(
        center,
        radiusMeters,
        bearing,
        azimuthalAngle || 60
      );
      previewLayers.push(
        new PolygonLayer({
          id: "preview-azimuthal-layer",
          data: [sector],
          getPolygon: (d: [number, number][]) => d,
          getFillColor: [32, 32, 32, 100],
          getLineColor: [32, 32, 32],
          getLineWidth: 2,
          pickable: false,
        })
      );
    }

    if (isDrawing && currentPath.length > 0) {
      const previewPointData = currentPath.map((point, index) => ({
        position: point,
        radius: 150,
        color: index === 0 ? [255, 255, 0] : [255, 0, 255],
      }));
      previewLayers.push(
        new ScatterplotLayer({
          id: "preview-point-layer",
          data: previewPointData,
          getPosition: (d: any) => d.position,
          getRadius: (d: any) => d.radius,
          getFillColor: (d: any) => d.color,
          pickable: false,
          radiusMinPixels: 4,
        })
      );
    }

    return [...deckLayers, ...previewLayers];
  }, [
    layers,
    networkLayersVisible,
    nodeIconMappings,
    isDrawing,
    drawingMode,
    currentPath,
    mousePosition,
    azimuthalAngle,
    handleLayerHover,
    handleNodeIconClick,
    udpLayers,
  ]);

  return (
    <div
      className={`relative h-screen w-screen overflow-hidden ${
        isMapEnabled ? "bg-transparent" : "bg-black"
      }`}
    >
      {selectedNodeForIcon && (
        <IconSelection
          selectedNodeForIcon={selectedNodeForIcon}
          setSelectedNodeForIcon={setSelectedNodeForIcon}
        />
      )}

      {/* Connection Error/No Data Indicator Button */}
      {(connectionError || noDataWarning) && (
        <div className="absolute top-4 right-4 z-50">
          <Button
            onClick={() => setShowConnectionError(!showConnectionError)}
            variant="outline"
            size="icon"
            className="bg-white hover:bg-gray-50 text-red-500 border-0 shadow-lg"
            title={
              connectionError
                ? "Connection Error - Click to view details"
                : "No Data Warning - Click to view details"
            }
          >
            <span className="text-lg font-bold">!</span>
          </Button>
        </div>
      )}

      {/* UDP Connection Error Banner */}
      {connectionError && showConnectionError && (
        <div className="absolute top-16 right-4 z-50 bg-white rounded-lg shadow-lg p-3 max-w-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="font-semibold mb-1.5 text-sm text-red-600">
                Connection Error
              </div>
              <div className="text-xs space-y-1 text-gray-700">
                <div>Failed to connect to UDP server</div>
                <div className="text-gray-600">
                  Host: {host}:{port}
                </div>
                <div className="text-gray-500 text-[10px] mt-1">
                  {connectionError.includes("Error:")
                    ? connectionError.split("Error:")[1]?.trim()
                    : "Please check your configuration"}
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowConnectionError(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
              title="Close"
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
        </div>
      )}

      {/* UDP No Data Warning Banner */}
      {noDataWarning && showConnectionError && (
        <div className="absolute top-16 right-4 z-50 bg-white rounded-lg shadow-lg p-3 max-w-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="font-semibold mb-1.5 text-sm text-orange-600">
                No Data Warning
              </div>
              <div className="text-xs space-y-1 text-gray-700">
                <div>{noDataWarning}</div>
                <div className="text-gray-600">
                  Host: {host}:{port}
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowConnectionError(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
              title="Close"
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
        </div>
      )}

      {/* UDP Connection Status Indicator */}
      {isConnected && !connectionError && (
        <div
          className="absolute bottom-4 left-4 z-50 rounded-sm shadow-lg px-2 py-1 flex items-center gap-2"
          style={{
            background: "rgba(0, 0, 0, 0.4)",
            pointerEvents: "none",
          }}
        >
          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
          <span
            className="text-[10px] md:text-xs font-mono text-gray-700 font-bold capitalize "
            style={{ color: "rgb(255, 255, 255)", letterSpacing: "0.08em" }}
          >
            {host}:{port}
          </span>
        </div>
      )}

      <Map
        ref={mapRef}
        style={{ width: "100%", height: "100%" }}
        mapboxAccessToken="pk.eyJ1IjoibmlraGlsc2FyYWYiLCJhIjoiY2xlc296YjRjMDA5dDNzcXphZjlzamFmeSJ9.7ZDaMZKecY3-70p9pX9-GQ"
        renderWorldCopies={false}
        reuseMaps={true}
        attributionControl={false}
        dragRotate={true}
        touchZoomRotate={true}
        pitchWithRotate={true}
        initialViewState={{
          longitude: 81.5, // Center of India (between 63.5°E and 99.5°E)
          latitude: 20.5, // Center of India (between 2.5°N and 38.5°N)
          zoom: 6, // Zoom level to show India's bounding box
          pitch: pitch,
          bearing: 0,
        }}
        minZoom={0}
        maxZoom={20}
        maxPitch={85}
        onLoad={async (map: any) => {
          // Fit map to India's bounding box
          const mapInstance = map.target;
          mapInstance.fitBounds(
            [
              [63.5, 2.5], // Southwest corner (West, South)
              [99.5, 38.5], // Northeast corner (East, North)
            ],
            {
              padding: { top: 50, bottom: 50, left: 50, right: 50 },
              duration: 0, // Instant fit
            }
          );

          if (!mapInstance.getSource("offline-tiles")) {
            mapInstance.addSource("offline-tiles", {
              type: "raster",
              tiles: ["/tiles-map/{z}/{x}/{y}.png"],

              minzoom: 0,
              maxzoom: 20,
            });
          }

          mapInstance.on("sourcedata", (e: any) => {
            if (e.sourceId === "offline-tiles" && e.isSourceLoaded) {
            }
          });

          mapInstance.on("error", (e: any) => {
            if (e.sourceId === "offline-tiles") {
              console.warn("Failed to load offline tiles:", e.error);
            }
          });

          if (!mapInstance.getLayer("offline-tiles-layer")) {
            mapInstance.addLayer({
              id: "offline-tiles-layer",
              type: "raster",
              source: "offline-tiles",
              paint: {
                "raster-opacity": 0.8,
              },
            });
          }

          mapInstance.setMaxBounds(null);
        }}
        onClick={handleMapClick}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMove={(e: any) => {
          if (e && e.viewState && typeof e.viewState.zoom === "number") {
            // Throttle zoom updates to reduce re-renders during zoom operations
            if (zoomUpdateTimeoutRef.current) {
              clearTimeout(zoomUpdateTimeoutRef.current);
            }
            zoomUpdateTimeoutRef.current = setTimeout(() => {
              setMapZoom(e.viewState.zoom);
            }, 100); // Update zoom at most every 100ms
          }
        }}
      >
        <DeckGLOverlay
          layers={[
            ...deckGlLayers,
            stateNamesLayer,
            cityNamesLayer,
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

      <Tooltip />
      <ZoomControls mapRef={mapRef} zoom={mapZoom} />

      {/* Bottom Floating Island */}
      <div
        className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-100 cursor-pointer flex items-center justify-center bg-white shadow-lg py-2 px-4 gap-6 rounded-md w-auto"
        style={{ pointerEvents: "auto" }}
      >
        <Button
          size="icon"
          className="bg-transparent shadow-none w-auto m-0 hover:bg-transparent"
          onClick={() => onToggleLayersPanel?.()}
        >
          <div className="flex flex-col gap-0.5 items-center justify-center">
            <LayersIcon className="h-8 w-8 text-black shadow-none" />
            <span className="text-xs text-black whitespace-nowrap">Layers</span>
          </div>
        </Button>
        <Popover
          open={isCameraPopoverOpen}
          onOpenChange={setIsCameraPopoverOpen}
        >
          <PopoverTrigger asChild>
            <Button
              size="icon"
              className="bg-transparent shadow-none w-auto m-0 hover:bg-transparent"
            >
              <div className="flex flex-col gap-0.5 items-center justify-center">
                <CameraIcon className="h-8 w-8 text-black shadow-none" />
                <span className="text-xs text-black whitespace-nowrap">
                  Camera
                </span>
              </div>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[220px] ml-6 p-0 relative"
            align="center"
            side="top"
            sideOffset={12}
            alignOffset={0}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <Button
              onClick={() => setIsCameraPopoverOpen(false)}
              variant="ghost"
              size="icon"
              className="absolute top-1.5 -right-1 z-50 bg-transparent hover:bg-transparent"
              title="Close"
              style={{ zoom: 0.85 }}
            >
              <XIcon className="h-1 w-1 text-gray-600" />
            </Button>
            <div className="w-full p-3">
              <TiltControl
                mapRef={mapRef}
                pitch={pitch}
                setPitch={setPitch}
                onCreatePoint={createPointLayer}
              />
            </div>
          </PopoverContent>
        </Popover>
        <Button
          size="icon"
          className="bg-transparent shadow-none w-auto m-0 hover:bg-transparent relative z-50"
          onClick={() => setIsUdpConfigDialogOpen(true)}
          title="Configure UDP Server"
          style={{ pointerEvents: "auto" }}
        >
          <div className="flex flex-col gap-0.5 items-center justify-center pointer-events-none">
            <WifiPen className="h-8 w-8 text-black shadow-none" />
            <span className="text-xs text-black whitespace-nowrap">
              Connection
            </span>
          </div>
        </Button>
        {drawingMode && (
          <Button
            size="icon"
            className="bg-transparent shadow-none w-auto m-0 hover:bg-transparent"
            onClick={() => {
              // If polygon mode with 3+ points, save the polygon before exiting
              if (
                drawingMode === "polygon" &&
                pendingPolygonPoints.length >= 3
              ) {
                const closedPath = [
                  ...pendingPolygonPoints,
                  pendingPolygonPoints[0],
                ];
                const newLayer: LayerProps = {
                  type: "polygon",
                  id: generateLayerId(),
                  name: `Polygon ${
                    layers.filter((l) => l.type === "polygon").length + 1
                  }`,
                  polygon: [closedPath],
                  color: [32, 32, 32, 180],
                  visible: true,
                };
                addLayer(newLayer);
                lastLayerCreationTimeRef.current = Date.now();
                setHoverInfo(undefined);
              }
              // Exit drawing mode
              setDrawingMode(null);
              setIsDrawing(false);
              setCurrentPath([]);
              setPendingPolygonPoints([]);
            }}
          >
            <div className="flex flex-col gap-0.5 items-center justify-center">
              <PenIcon className="h-8 w-8 text-red-600 shadow-none" />
              <span className="text-xs text-red-600 whitespace-nowrap">
                Exit Drawing
              </span>
            </div>
          </Button>
        )}
      </div>

      {/* UDP Config Dialog */}
      <UdpConfigDialog
        key={configKey}
        isOpen={isUdpConfigDialogOpen}
        onClose={() => setIsUdpConfigDialogOpen(false)}
        onConfigSet={() => {
          // Trigger reconnection by updating key
          setConfigKey((prev) => prev + 1);
        }}
      />
    </div>
  );
};

export default MapComponent;
