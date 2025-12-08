import Map, { useControl, NavigationControl } from "react-map-gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { PickingInfo } from "@deck.gl/core";
import {
  BitmapLayer,
  GeoJsonLayer,
  IconLayer,
  LineLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer,
} from "@deck.gl/layers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import IconSelection from "./icon-selection";
import ZoomControls from "./zoom-controls";
import Tooltip from "./tooltip";
import { useUdpLayers } from "./udp-layers";
import UdpConfigDialog from "./udp-config-dialog";
import OfflineLocationTracker from "./offline-location-tracker";
import LocationControls from "./location-controls";
import { useUdpConfigStore } from "@/store/udp-config-store";
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
  useHoverInfo,
  usePendingPolygon,
  useIgrsPreference,
  useSetIgrsPreference,
  useUserLocation,
  useMapZoom,
} from "@/store/layers-store";
import {
  calculateBearingDegrees,
  calculateDistanceMeters,
  destinationPoint,
  generateLayerId,
  isPointNearFirstPoint,
  normalizeAngleSigned,
  computePolygonAreaMeters,
  computePolygonPerimeterMeters,
} from "@/lib/layers";
import { formatArea, formatDistance } from "@/lib/utils";
import { generateMeshFromElevation } from "@/lib/utils";
import type { LayerProps, Node } from "@/lib/definitions";

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
  const computeSegmentDistancesKm = useCallback((path: [number, number][]) => {
    if (!Array.isArray(path) || path.length < 2) return [] as number[];
    return path.slice(0, -1).map((point, idx) => {
      const next = path[idx + 1];
      return calculateDistanceMeters(point, next) / 1000;
    });
  }, []);

  const arePointsClose = useCallback(
    (a: [number, number], b: [number, number], thresholdMeters = 25) => {
      return calculateDistanceMeters(a, b) <= thresholdMeters;
    },
    []
  );

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
  const { drawingMode } = useDrawingMode();
  const { isDrawing, setIsDrawing } = useIsDrawing();
  const { currentPath, setCurrentPath } = useCurrentPath();
  const { nodeIconMappings } = useNodeIconMappings();
  const { hoverInfo, setHoverInfo } = useHoverInfo();
  const { pendingPolygonPoints, setPendingPolygonPoints } = usePendingPolygon();
  const useIgrs = useIgrsPreference();
  const setUseIgrs = useSetIgrsPreference();
  const { userLocation, userLocationError, showUserLocation } =
    useUserLocation();
  const previousDrawingModeRef = useRef(drawingMode);

  // Cache for DEM meshes to avoid regenerating on every render
  const demMeshCache = useRef<{ [key: string]: any }>({});

  // Debug: Log user location changes
  useEffect(() => {
    if (userLocation) {
      console.log("User location in map component:", userLocation);
    }
    if (userLocationError) {
      console.error("User location error:", userLocationError);
    }
  }, [userLocation, userLocationError]);

  // const { nodeCoordinatesData, setNodeCoordinatesData } =
  //   useProgressiveNodes(networkLayersVisible);
  const [isMapEnabled] = useState(true);
  const [pitch, setPitch] = useState(0);
  const [viewState, setViewState] = useState<any>({
    longitude: 81.5,
    latitude: 20.5,
    zoom: 6,
    pitch: pitch,
    bearing: 0,
  });

  const [selectedNodeForIcon, setSelectedNodeForIcon] = useState<string | null>(
    null
  );
  const { mapZoom, setMapZoom } = useMapZoom();

  // Update viewState pitch when pitch changes
  useEffect(() => {
    setViewState((prev: any) => ({ ...prev, pitch }));
  }, [pitch]);
  const [isUdpConfigDialogOpen, setIsUdpConfigDialogOpen] = useState(false);
  const [configKey, setConfigKey] = useState(0);
  const [showConnectionError, setShowConnectionError] = useState(false);
  const [isCameraPopoverOpen, setIsCameraPopoverOpen] = useState(false);
  const lastLayerCreationTimeRef = useRef<number>(0);
  const [hoveredDemSquare, setHoveredDemSquare] = useState<{
    layerId: string;
    polygon: [number, number][];
  } | null>(null);

  const measurementPreview = useMemo(() => {
    if (!isDrawing) return null;

    if (drawingMode === "polyline" && currentPath.length >= 1) {
      const path = [...currentPath];
      if (mousePosition) path.push(mousePosition);
      if (path.length < 2) return null;

      const segmentDistances = computeSegmentDistancesKm(path);
      const totalKm = segmentDistances.reduce((sum, dist) => sum + dist, 0);
      const segments = segmentDistances.map((dist, idx) => ({
        label: `Segment ${idx + 1}`,
        lengthKm: dist,
      }));

      return {
        type: "polyline" as const,
        segments,
        totalKm,
      };
    }

    if (drawingMode === "polygon") {
      const path = [...pendingPolygonPoints];
      if (mousePosition) path.push(mousePosition);
      if (path.length < 3) return null;
      const closedPath = [...path, path[0]];
      const areaMeters = computePolygonAreaMeters([closedPath]);
      const perimeterMeters = computePolygonPerimeterMeters([closedPath]);
      return {
        type: "polygon" as const,
        areaMeters,
        perimeterMeters,
      };
    }

    return null;
  }, [
    isDrawing,
    drawingMode,
    currentPath,
    mousePosition,
    pendingPolygonPoints,
    computeSegmentDistancesKm,
  ]);

  const polylinePreviewStats = useMemo(() => {
    if (!measurementPreview || measurementPreview.type !== "polyline") {
      return null;
    }
    const segments = measurementPreview.segments ?? [];
    if (!segments.length) return null;
    const max = Math.max(...segments.map((segment) => segment.lengthKm));
    const min = Math.min(...segments.map((segment) => segment.lengthKm));
    const avg =
      segments.reduce((sum, segment) => sum + segment.lengthKm, 0) /
      segments.length;
    return {
      count: segments.length,
      max,
      min,
      avg,
    };
  }, [measurementPreview]);

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

  const finalizePolyline = useCallback(() => {
    if (!currentPath || currentPath.length < 2) {
      setCurrentPath([]);
      setIsDrawing(false);
      return;
    }

    const path = [...currentPath];
    const segmentDistancesKm = computeSegmentDistancesKm(path);
    const totalDistanceKm = segmentDistancesKm.reduce(
      (sum, dist) => sum + dist,
      0
    );

    const newLayer: LayerProps = {
      type: "line",
      id: generateLayerId(),
      name: `Path ${
        layers.filter(
          (l) => l.type === "line" && !(l.name || "").includes("Connection")
        ).length + 1
      }`,
      path,
      color: [68, 68, 68],
      lineWidth: 4,
      visible: true,
      segmentDistancesKm,
      totalDistanceKm,
    };

    addLayer(newLayer);
    lastLayerCreationTimeRef.current = Date.now();
    setHoverInfo(undefined);
    setCurrentPath([]);
    setIsDrawing(false);
  }, [
    currentPath,
    computeSegmentDistancesKm,
    addLayer,
    layers,
    setCurrentPath,
    setIsDrawing,
    setHoverInfo,
  ]);

  const handlePolylineDrawing = useCallback(
    (point: [number, number]) => {
      if (!isDrawing) {
        setCurrentPath([point]);
        setIsDrawing(true);
        return;
      }

      const lastPoint = currentPath[currentPath.length - 1];
      if (
        lastPoint &&
        arePointsClose(lastPoint, point) &&
        currentPath.length >= 2
      ) {
        finalizePolyline();
        return;
      }

      setCurrentPath([...currentPath, point]);
    },
    [
      isDrawing,
      currentPath,
      setCurrentPath,
      setIsDrawing,
      arePointsClose,
      finalizePolyline,
    ]
  );

  const handleAzimuthalDrawing = (point: [number, number]) => {
    if (!isDrawing) {
      setCurrentPath([point]);
      setIsDrawing(true);
      return;
    }

    const center = currentPath[0];
    if (!center) {
      setIsDrawing(false);
      setCurrentPath([]);
      return;
    }

    const target = point;
    const distanceMeters = calculateDistanceMeters(center, target);
    const azimuthAngle = calculateBearingDegrees(center, target);
    const referenceDistance = Math.max(distanceMeters, 1000);
    const northPoint = destinationPoint(center, referenceDistance, 0);

    const azimuthCount = layers.filter((l) => l.type === "azimuth").length;
    const newLayer: LayerProps = {
      type: "azimuth",
      id: generateLayerId(),
      name: `Azimuth ${azimuthCount + 1}`,
      color: [59, 130, 246],
      visible: true,
      azimuthCenter: center,
      azimuthTarget: target,
      azimuthNorth: northPoint,
      azimuthAngleDeg: azimuthAngle,
      distanceMeters,
    };

    addLayer(newLayer);
    lastLayerCreationTimeRef.current = Date.now();
    setHoverInfo(undefined);
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

    if (
      previousMode === "polygon" &&
      drawingMode !== "polygon" &&
      pendingPolygonPoints.length === 0 &&
      currentPath.length > 0
    ) {
      setCurrentPath([]);
    }

    if (
      previousMode === "polyline" &&
      drawingMode !== "polyline" &&
      currentPath.length >= 2
    ) {
      finalizePolyline();
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
    currentPath,
    finalizePolyline,
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
      case "polyline":
        handlePolylineDrawing(clickPoint);
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
        setHoveredDemSquare(null);
        return;
      }

      if (!info) {
        setHoverInfo(undefined);
        setHoveredDemSquare(null);
        return;
      }

      const deckLayerId = (info.layer as any)?.id as string | undefined;

      // Special handling for DEM BitmapLayers (.tif, .tiff, .dett, .hgt)
      // BitmapLayer hover info often has no `object`, but we still want a tooltip
      let isDemHover = false;
      let demLayer: LayerProps | undefined;
      if (deckLayerId) {
        const baseId = deckLayerId
          .replace(/-icon-layer$/, "")
          .replace(/-signal-overlay$/, "")
          .replace(/-bitmap$/, "")
          .replace(/-mesh$/, "");

        const matchingLayer = layers.find((l) => l.id === baseId);
        if (matchingLayer?.type === "dem") {
          isDemHover = true;
          demLayer = matchingLayer;
        }
      }

      if (info.object || (isDemHover && info.coordinate)) {
        setHoverInfo(info);

        // Calculate and store hovered DEM square polygon
        if (
          isDemHover &&
          demLayer &&
          info.coordinate &&
          demLayer.bounds &&
          demLayer.elevationData
        ) {
          const [lng, lat] = info.coordinate;
          const [[minLng, minLat], [maxLng, maxLat]] = demLayer.bounds;
          const { width, height } = demLayer.elevationData;

          // Ensure the hover point is within the DEM bounds
          if (
            lng >= minLng &&
            lng <= maxLng &&
            lat >= minLat &&
            lat <= maxLat
          ) {
            // Map geographic coordinates to raster pixel indices
            const col = ((lng - minLng) / (maxLng - minLng || 1)) * (width - 1);
            const row =
              ((maxLat - lat) / (maxLat - minLat || 1)) * (height - 1);

            const x = Math.min(width - 1, Math.max(0, Math.round(col)));
            const y = Math.min(height - 1, Math.max(0, Math.round(row)));

            // Calculate the geographic bounds of this pixel square
            const pixelWidth = (maxLng - minLng) / width;
            const pixelHeight = (maxLat - minLat) / height;

            const squareMinLng = minLng + x * pixelWidth;
            const squareMaxLng = minLng + (x + 1) * pixelWidth;
            const squareMinLat = maxLat - (y + 1) * pixelHeight;
            const squareMaxLat = maxLat - y * pixelHeight;

            // Create polygon rectangle (clockwise: top-left, top-right, bottom-right, bottom-left, back to top-left)
            const polygon: [number, number][] = [
              [squareMinLng, squareMaxLat], // top-left
              [squareMaxLng, squareMaxLat], // top-right
              [squareMaxLng, squareMinLat], // bottom-right
              [squareMinLng, squareMinLat], // bottom-left
              [squareMinLng, squareMaxLat], // close the polygon
            ];

            setHoveredDemSquare({
              layerId: demLayer.id,
              polygon,
            });
          } else {
            setHoveredDemSquare(null);
          }
        } else {
          setHoveredDemSquare(null);
        }
      } else {
        setHoverInfo(undefined);
        setHoveredDemSquare(null);
      }
    },
    [setHoverInfo, layers]
  );

  // UDP layers from separate component
  const { udpLayers, connectionError, noDataWarning, isConnected } =
    useUdpLayers(handleLayerHover);

  const notificationsActive =
    networkLayersVisible && (connectionError || noDataWarning);
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
      // Check zoomState: layer is visible only if current zoom >= layer's zoomState
      if (layer.zoomState !== undefined && mapZoom < layer.zoomState) {
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
    const azimuthLayers = visibleLayers.filter((l) => l.type === "azimuth");
    const geoJsonLayers = visibleLayers.filter((l) => l.type === "geojson");
    const demLayers = visibleLayers.filter((l) => l.type === "dem");
    const annotationLayers = visibleLayers.filter(
      (l) => l.type === "annotation"
    );
    const nodeLayers = visibleLayers.filter((l) => l.type === "nodes");

    const deckLayers: any[] = [];
    const measurementCharacterSet = [
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      ".",
      "-",
      "°",
      "k",
      "m",
      "A",
      "P",
      ":",
      "•",
      "²",
      "h",
      "a",
      " ",
    ];

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

    // Add user location as a point layer (only if showUserLocation is true)
    if (userLocation && showUserLocation) {
      console.log("Rendering user location:", userLocation);

      // Add accuracy circle (in meters)
      if (userLocation.accuracy > 0) {
        deckLayers.push(
          new ScatterplotLayer({
            id: "user-location-accuracy",
            data: [{ position: [userLocation.lng, userLocation.lat] }],
            getPosition: (d: any) => d.position,
            getRadius: userLocation.accuracy,
            radiusUnits: "meters",
            getFillColor: [34, 197, 94, 30], // Light green with transparency
            getLineColor: [34, 197, 94, 100], // Green border
            getLineWidth: 1,
            stroked: true,
            filled: true,
            pickable: false,
            radiusMinPixels: 0,
            radiusMaxPixels: 1000,
          })
        );
      }

      // Add user location point
      deckLayers.push(
        new ScatterplotLayer({
          id: "user-location-layer",
          data: [{ position: [userLocation.lng, userLocation.lat] }],
          getPosition: (d: any) => d.position,
          getRadius: 12,
          radiusUnits: "pixels",
          getFillColor: [34, 197, 94, 255], // Green color
          getLineColor: [22, 163, 74, 255], // Darker green border
          getLineWidth: 3,
          stroked: true,
          pickable: true,
          pickingRadius: 300,
          radiusMinPixels: 10,
          radiusMaxPixels: 20,
          onHover: handleLayerHover,
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
          bearing: layer.bearing, // Include bearing for azimuthal lines
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

      // Polygon labels now shown only in side panel while drawing.
      // No on-map labels for finalized polygons per latest request.
    }

    if (lineLayers.length) {
      const pathData = lineLayers.flatMap((layer) => {
        const path = layer.path ?? [];
        if (path.length < 2) return [];
        return path.slice(0, -1).map((point, index) => ({
          sourcePosition: point,
          targetPosition: path[index + 1],
          color: layer.color ? [...layer.color] : [0, 0, 0],
          width: layer.lineWidth ?? 5,
          layerId: layer.id,
          layerName: layer.name,
          segmentIndex: index,
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
              const color = d.color || [0, 0, 0];
              return color.length === 3 ? [...color, 255] : color;
            },
            getWidth: (d: any) => Math.max(1, d.width),
            widthUnits: "pixels",
            widthMinPixels: 1,
            widthMaxPixels: 50,
            pickable: true,
            pickingRadius: 300,
            onHover: handleLayerHover,
            capRounded: true,
            jointRounded: true,
            parameters: { depthTest: false },
          })
        );

        const vertexData = lineLayers.flatMap((layer) => {
          const path = layer.path ?? [];
          if (!path.length) return [];
          return path.map((point, index) => ({
            position: point,
            color: index === 0 ? [255, 213, 79, 255] : [236, 72, 153, 255],
            radius: index === 0 ? 200 : 180,
          }));
        });

        if (vertexData.length) {
          deckLayers.push(
            new ScatterplotLayer({
              id: "line-vertex-layer",
              data: vertexData,
              getPosition: (d: any) => d.position,
              getRadius: (d: any) => d.radius,
              radiusUnits: "meters",
              getFillColor: (d: any) => d.color,
              getLineColor: [255, 255, 255, 200],
              getLineWidth: 2,
              stroked: true,
              pickable: false,
              radiusMinPixels: 4,
              radiusMaxPixels: 10,
              parameters: { depthTest: false },
            })
          );
        }

        // Per-request, no on-map labels for finalized lines; side panel handles display.
      }
    }

    if (azimuthLayers.length) {
      const azimuthLineData = azimuthLayers.flatMap((layer) => {
        const segments: any[] = [];
        const center = layer.azimuthCenter;
        if (center && layer.azimuthNorth) {
          segments.push({
            sourcePosition: center,
            targetPosition: layer.azimuthNorth,
            color: [148, 163, 184, 220],
            width: 2,
            dashArray: [6, 4],
            layerId: layer.id,
            segmentType: "north",
          });
        }
        if (center && layer.azimuthTarget) {
          const baseColor = layer.color
            ? layer.color.length === 4
              ? [...layer.color]
              : [...layer.color, 255]
            : [59, 130, 246, 255];
          segments.push({
            sourcePosition: center,
            targetPosition: layer.azimuthTarget,
            color: baseColor,
            width: 3,
            layerId: layer.id,
            segmentType: "target",
          });
        }
        return segments;
      });

      const azimuthLabelData = azimuthLayers
        .map((layer) => {
          if (
            !layer.azimuthCenter ||
            !layer.azimuthTarget ||
            typeof layer.azimuthAngleDeg !== "number"
          ) {
            return null;
          }
          const [cLng, cLat] = layer.azimuthCenter;
          const [tLng, tLat] = layer.azimuthTarget;
          const labelLng = cLng + (tLng - cLng) * 0.4;
          const labelLat = cLat + (tLat - cLat) * 0.4;
          let signedAngle = normalizeAngleSigned(layer.azimuthAngleDeg);
          if (signedAngle === -180) signedAngle = 180;
          return {
            position: [labelLng, labelLat] as [number, number],
            text: `${signedAngle.toFixed(1)}°`,
          };
        })
        .filter(Boolean);

      if (azimuthLineData.length) {
        deckLayers.push(
          new LineLayer({
            id: "azimuth-lines-layer",
            data: azimuthLineData,
            pickable: true,
            pickingRadius: 200,
            onHover: handleLayerHover,
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => d.width,
            getDashArray: (d: any) => d.dashArray ?? [0, 0],
            dashJustified: true,
          })
        );
      }

      if (azimuthLabelData.length) {
        deckLayers.push(
          new TextLayer({
            id: "azimuth-angle-labels",
            data: azimuthLabelData as Array<{
              position: [number, number];
              text: string;
            }>,
            pickable: false,
            getPosition: (d) => d.position,
            getText: (d) => d.text,
            getSize: 14,
            getColor: [59, 130, 246, 255],
            getTextAnchor: "middle",
            getAlignmentBaseline: "center",
            fontWeight: 600,
            background: true,
            getBackgroundColor: [255, 255, 255, 200],
            padding: [2, 4],
            characterSet: measurementCharacterSet,
          })
        );
      }
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
      if (!layer.bounds || !layer.elevationData) {
        console.warn("DEM layer missing bounds or elevationData:", {
          id: layer.id,
          name: layer.name,
          hasBounds: !!layer.bounds,
          hasElevationData: !!layer.elevationData,
        });
        return;
      }

      try {
        // Check if mesh is already cached to avoid regenerating on every render
        const cacheKey = `${layer.id}-${layer.elevationData.width}-${layer.elevationData.height}`;
        let mesh = demMeshCache.current[cacheKey];

        if (!mesh) {
          console.log("Generating mesh for DEM layer (first time):", {
            id: layer.id,
            name: layer.name,
            bounds: layer.bounds,
            elevationDataSize:
              layer.elevationData.width * layer.elevationData.height,
          });

          // Generate mesh from elevation data
          // Use a smaller elevation scale for better visibility (100 meters instead of 1000)
          mesh = generateMeshFromElevation(
            layer.elevationData,
            layer.bounds,
            100 // elevation scale in meters (reduced for better visibility)
          );

          console.log("Generated mesh:", {
            positions: mesh.positions.length,
            normals: mesh.normals.length,
            indices: mesh.indices.length,
          });

          // Cache the mesh to avoid regenerating on every render
          demMeshCache.current[cacheKey] = mesh;
        } else {
          // Mesh already cached, skip generation
          console.log("Using cached mesh for DEM layer:", layer.id);
        }

        // Always render as BitmapLayer (more reliable and visible than 3D mesh)
        if (layer.bitmap) {
          const bounds: [number, number, number, number] = [
            layer.bounds[0][0], // minLng
            layer.bounds[0][1], // minLat
            layer.bounds[1][0], // maxLng
            layer.bounds[1][1], // maxLat
          ];

          console.log("Rendering DEM as BitmapLayer:", {
            id: layer.id,
            name: layer.name,
            bounds,
            hasBitmap: !!layer.bitmap,
            visible: layer.visible !== false,
          });

          deckLayers.push(
            new BitmapLayer({
              id: `${layer.id}-bitmap`,
              image: layer.bitmap,
              bounds: bounds,
              pickable: true,
              visible: layer.visible !== false,
              onHover: handleLayerHover,
            })
          );
          console.log(
            "Successfully added DEM bitmap layer to deck.gl:",
            layer.id
          );
        } else {
          console.warn("DEM layer missing bitmap:", {
            id: layer.id,
            name: layer.name,
            hasBitmap: !!layer.bitmap,
            hasTexture: !!layer.texture,
          });
        }

        // Optionally try to add as 3D mesh layer (may not always work)
        // Commented out for now since BitmapLayer is more reliable
        /*
        try {
          deckLayers.push(
            new SimpleMeshLayer({
              id: `${layer.id}-mesh`,
              data: [{}], // Single data point - mesh positions are already in world coords
              mesh: meshData as any,
              getPosition: () => [0, 0, 0], // Mesh positions are already in world coordinates
              getColor: layer.color
                ? ((layer.color.length === 4
                    ? layer.color
                    : [...layer.color, 255]) as [
                    number,
                    number,
                    number,
                    number
                  ])
                : [128, 128, 128, 255],
              getOrientation: [0, 0, 0],
              getScale: [1, 1, 1],
              getTranslation: [0, 0, 0],
              coordinateSystem: 1, // Use LNGLAT coordinate system
              wireframe: false,
              material: {
                ambient: 0.5,
                diffuse: 0.6,
                shininess: 32,
                specularColor: [60, 60, 60],
              },
              pickable: true,
              pickingRadius: 300,
              visible: layer.visible !== false,
              onHover: handleLayerHover,
            } as any)
          );
          console.log("Added DEM 3D mesh layer to deck.gl:", layer.id);
        } catch (meshError) {
          console.warn("Failed to create 3D mesh:", meshError);
        }
        */
      } catch (error) {
        console.error(`Error creating mesh for DEM layer ${layer.id}:`, error);
        console.warn("DEM layer missing elevation data:", {
          id: layer.id,
          name: layer.name,
          hasElevationData: !!layer.elevationData,
        });
      }
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

        if (
          isPointNearFirstPoint(mousePosition, currentPath[0]) &&
          previewPath.length >= 3
        ) {
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

    if (isDrawing && drawingMode === "polyline" && currentPath.length >= 1) {
      const segments =
        currentPath.length > 1
          ? currentPath.slice(0, -1).map((point, index) => ({
              sourcePosition: point,
              targetPosition: currentPath[index + 1],
              color: [96, 96, 96],
              width: 3,
            }))
          : [];

      if (segments.length) {
        previewLayers.push(
          new LineLayer({
            id: "preview-polyline-existing",
            data: segments,
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => d.width,
            pickable: false,
          })
        );
      }

      if (mousePosition) {
        const lastPoint = currentPath[currentPath.length - 1];
        previewLayers.push(
          new LineLayer({
            id: "preview-polyline-next",
            data: [
              {
                sourcePosition: lastPoint,
                targetPosition: mousePosition,
                color: [96, 96, 96],
                width: 3,
              },
            ],
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => d.width,
            pickable: false,
          })
        );
      }
    }

    if (
      isDrawing &&
      drawingMode === "azimuthal" &&
      currentPath.length === 1 &&
      mousePosition
    ) {
      const center = currentPath[0];
      const distanceMeters = calculateDistanceMeters(center, mousePosition);
      const referenceDistance = Math.max(distanceMeters, 1000);
      const northPoint = destinationPoint(center, referenceDistance, 0);
      const angleDeg = calculateBearingDegrees(center, mousePosition);
      const labelLng = center[0] + (mousePosition[0] - center[0]) * 0.4;
      const labelLat = center[1] + (mousePosition[1] - center[1]) * 0.4;
      const previewAzimuthData = [
        {
          sourcePosition: center,
          targetPosition: northPoint,
          color: [148, 163, 184],
          width: 2,
          dashArray: [6, 4],
        },
        {
          sourcePosition: center,
          targetPosition: mousePosition,
          color: [59, 130, 246],
          width: 3,
        },
      ];
      previewLayers.push(
        new LineLayer({
          id: "preview-azimuth-lines",
          data: previewAzimuthData,
          getSourcePosition: (d: any) => d.sourcePosition,
          getTargetPosition: (d: any) => d.targetPosition,
          getColor: (d: any) => d.color,
          getWidth: (d: any) => d.width,
          getDashArray: (d: any) => d.dashArray ?? [0, 0],
          dashJustified: true,
          pickable: false,
        })
      );
      if (distanceMeters > 5) {
        let signedPreviewAngle = normalizeAngleSigned(angleDeg);
        if (signedPreviewAngle === -180) signedPreviewAngle = 180;
        previewLayers.push(
          new TextLayer({
            id: "preview-azimuth-angle-label",
            data: [
              {
                position: [labelLng, labelLat] as [number, number],
                text: `${signedPreviewAngle.toFixed(1)}°`,
              },
            ],
            pickable: false,
            getPosition: (d: any) => d.position,
            getText: (d: any) => d.text,
            getSize: 14,
            getColor: [59, 130, 246, 255],
            getTextAnchor: "middle",
            getAlignmentBaseline: "center",
            fontWeight: 600,
            background: true,
            getBackgroundColor: [255, 255, 255, 220],
            padding: [2, 4],
            characterSet: measurementCharacterSet,
          })
        );
      }
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

    // Add DEM hover highlight rectangle (red border)
    if (hoveredDemSquare) {
      deckLayers.push(
        new PolygonLayer({
          id: "dem-hover-highlight",
          data: [{ polygon: hoveredDemSquare.polygon }],
          getPolygon: (d: any) => d.polygon,
          getFillColor: [255, 0, 0, 30], // Red with transparency
          getLineColor: [255, 0, 0, 255], // Red border
          getLineWidth: 2,
          lineWidthMinPixels: 2,
          pickable: false,
          stroked: true,
          filled: true,
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
    handleLayerHover,
    handleNodeIconClick,
    udpLayers,
    userLocation,
    showUserLocation,
    mapZoom,
    hoveredDemSquare,
  ]);

  return (
    <div
      className={`relative h-screen w-screen overflow-hidden ${
        isMapEnabled ? "bg-transparent" : "bg-black"
      }`}
    >
      <OfflineLocationTracker />
      {selectedNodeForIcon && (
        <IconSelection
          selectedNodeForIcon={selectedNodeForIcon}
          setSelectedNodeForIcon={setSelectedNodeForIcon}
        />
      )}

      {measurementPreview && (
        <div
          className="absolute right-4 z-40 w-64 rounded-lg border border-black/10 bg-white shadow-xl p-3 space-y-2"
          style={{ top: notificationsActive ? 40 : 16 }}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <span>Drawing Measurements</span>
            <span className="text-[10px] font-semibold text-slate-500">
              {useIgrs ? "IGRS" : "LAT / LNG"}
            </span>
          </div>
          {measurementPreview.type === "polygon" ? (
            <div className="space-y-1 text-sm text-gray-700">
              <div className="flex justify-between">
                <span>Area</span>
                <span className="font-mono">
                  {formatArea(measurementPreview.areaMeters)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Perimeter</span>
                <span className="font-mono">
                  {formatDistance(measurementPreview.perimeterMeters / 1000)}
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="text-xs text-gray-500">Segments</div>
              <div className="space-y-1 max-h-64 overflow-y-auto text-sm text-gray-700">
                {measurementPreview.segments.map((segment, idx) => (
                  <div
                    key={`${segment.label}-${idx}`}
                    className="flex justify-between"
                  >
                    <span>{segment.label}</span>
                    <span className="font-mono">
                      {segment.lengthKm.toFixed(2)} km
                    </span>
                  </div>
                ))}
              </div>
              {polylinePreviewStats && (
                <div className="mt-2 space-y-1 border-t border-dashed border-slate-200 pt-2 text-xs text-gray-700">
                  <div className="flex justify-between">
                    <span>Count</span>
                    <span className="font-mono">
                      {polylinePreviewStats.count}
                    </span>
                  </div>
                  {polylinePreviewStats.count > 1 && (
                    <>
                      <div className="flex justify-between">
                        <span>Max segment</span>
                        <span className="font-mono">
                          {polylinePreviewStats.max.toFixed(2)} km
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Min segment</span>
                        <span className="font-mono">
                          {polylinePreviewStats.min.toFixed(2)} km
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Avg segment</span>
                        <span className="font-mono">
                          {polylinePreviewStats.avg.toFixed(2)} km
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )}
              <div className="text-xs font-semibold text-gray-800">
                Total: {measurementPreview.totalKm.toFixed(2)} km
              </div>
            </>
          )}
        </div>
      )}

      {/* UDP Connection Error Banner */}
      {networkLayersVisible && connectionError && showConnectionError && (
        <div className="absolute bottom-14 right-78 z-50 bg-white rounded-lg shadow-lg p-3 max-w-sm">
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
      {networkLayersVisible && noDataWarning && showConnectionError && (
        <div className="absolute bottom-32 right-4 z-50 bg-white rounded-lg shadow-lg p-3 max-w-sm">
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
      {networkLayersVisible && isConnected && !connectionError && (
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
        viewState={viewState as any}
        onMove={(e: any) => {
          if (e && e.viewState) {
            setViewState(e.viewState);
            if (typeof e.viewState.zoom === "number") {
              // Throttle zoom updates to reduce re-renders during zoom operations
              if (zoomUpdateTimeoutRef.current) {
                clearTimeout(zoomUpdateTimeoutRef.current);
              }
              zoomUpdateTimeoutRef.current = setTimeout(() => {
                setMapZoom(e.viewState.zoom);
              }, 100); // Update zoom at most every 100ms
            }
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

      {/* Location Controls - Bottom Left */}
      <LocationControls
        onViewStateChange={(newViewState) => {
          setViewState((prev: any) => ({
            ...prev,
            ...newViewState,
          }));
        }}
      />

      <ZoomControls
        mapRef={mapRef}
        zoom={mapZoom}
        onToggleLayersPanel={onToggleLayersPanel}
        onOpenConnectionConfig={() => setIsUdpConfigDialogOpen(true)}
        cameraPopoverProps={{
          isOpen: isCameraPopoverOpen,
          onOpenChange: setIsCameraPopoverOpen,
          pitch,
          setPitch,
          onCreatePoint: createPointLayer,
        }}
        alertButtonProps={{
          visible: Boolean(
            networkLayersVisible && (connectionError || noDataWarning)
          ),
          severity: connectionError ? "error" : "warning",
          title: connectionError
            ? "Connection Error - Click to view details"
            : "No Data Warning - Click to view details",
          onClick: () => setShowConnectionError((prev) => !prev),
        }}
        igrsToggleProps={{
          value: useIgrs,
          onToggle: (checked) => setUseIgrs(checked),
        }}
      />

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
