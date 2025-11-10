import Map, { useControl, NavigationControl } from "react-map-gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { useEffect, useRef, useState } from "react";
import { useLayersContext } from "@/layers-provider";
import { TextLayer } from "@deck.gl/layers";
import { indianStatesData } from "@/data/indian-states";
import "mapbox-gl/dist/mapbox-gl.css";
import TiltControl from "./tilt-control";
import IconSelection from "./icon-selection";
import ZoomControls from "./zoom-controls";
import Tooltip from "./tooltip";
import { useProgressiveNodes } from "@/hooks/use-progressive-nodes";
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
} from "@/store/layers-store";
import {
  calculateBearingDegrees,
  calculateDistanceMeters,
  generateLayerId,
  isPointNearFirstPoint,
  makeSectorPolygon,
} from "@/lib/layers";
import type { LayerProps } from "@/lib/definitions";

function DeckGLOverlay({ layers }: { layers: any[] }) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({}));
  useEffect(() => {
    overlay.setProps({ layers });
  }, [overlay, layers]);

  return null;
}

const MapComponent = () => {
  const mapRef = useRef<any>(null);
  useEffect(() => {
    (window as any).mapRef = mapRef;
  }, []);

  const { networkLayersVisible } = useNetworkLayersVisible();
  const { dragStart, setDragStart } = useDragStart();
  const { mousePosition, setMousePosition } = useMousePosition();
  const { layers, addLayer } = useLayers();
  const { focusLayerRequest, setFocusLayerRequest } = useFocusLayerRequest();
  const { drawingMode, setDrawingMode } = useDrawingMode();
  const { isDrawing, setIsDrawing } = useIsDrawing();
  const { currentPath, setCurrentPath } = useCurrentPath();
  const { nodeCoordinatesData, setNodeCoordinatesData } =
    useProgressiveNodes(networkLayersVisible);
  const [isMapEnabled, setIsMapEnabled] = useState(true);
  const [pitch, setPitch] = useState(0);

  const [selectedNodeForIcon, setSelectedNodeForIcon] = useState<string | null>(
    null
  );
  const [mapZoom, setMapZoom] = useState(4);

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

  const createPointLayer = (position: [number, number]) => {
    const newLayer: LayerProps = {
      type: "point",
      id: generateLayerId(),
      name: `Point ${layers.filter((l) => l.type === "point").length + 1}`,
      position,
      color: [255, 0, 0],
      radius: 200,
      visible: true,
    };
    addLayer(newLayer);
  };

  const handleLineDrawing = (point: [number, number]) => {
    if (!isDrawing) {
      setCurrentPath([point]);
      setIsDrawing(true);
    } else {
      const finalPath = [currentPath[0], point];
      const newLayer: LayerProps = {
        type: "line",
        id: generateLayerId(),
        name: `Line ${layers.filter((l) => l.type === "line").length + 1}`,
        path: finalPath,
        color: [96, 96, 96],
        lineWidth: 5,
        visible: true,
      };
      addLayer(newLayer);
      setCurrentPath([]);
      setIsDrawing(false);
    }
  };

  const handlePolygonDrawing = (point: [number, number]) => {
    //   console.log("handlePolygonDrawing called with:", { point, isDrawing, currentPathLength: currentPath.length });

    if (!isDrawing) {
      //  console.log("Starting new polygon at:", point);
      setCurrentPath([point]);
      setIsDrawing(true);
      // Add persistent point marker at first click
      const pointLayer: LayerProps = {
        type: "point",
        id: generateLayerId(),
        name: `Polygon Point ${
          layers.filter((l) => l.type === "point").length + 1
        }`,
        position: point,
        color: [32, 32, 32],
        radius: 5000,
        visible: true,
      };
      addLayer(pointLayer);
    } else {
      //  console.log("Adding point to polygon. Current path length:", currentPath.length);

      if (
        currentPath.length >= 3 &&
        isPointNearFirstPoint(point, currentPath[0])
      ) {
        //    console.log("Closing polygon with", currentPath.length, "points");
        const closedPath = [...currentPath, currentPath[0]];
        const newLayer: LayerProps = {
          type: "polygon",
          id: generateLayerId(),
          name: `Polygon ${
            layers.filter((l) => l.type === "polygon").length + 1
          }`,
          polygon: [closedPath],
          color: [32, 32, 32, 180], // Default to dark, higher-opacity fill
          visible: true,
        };
        //    console.log("Creating polygon layer:", newLayer);
        addLayer(newLayer);
        setCurrentPath([]);
        setIsDrawing(false);
      } else {
        //    console.log("Adding point to current path");
        // Add persistent point marker on each subsequent click
        const pointLayer: LayerProps = {
          type: "point",
          id: generateLayerId(),
          name: `Polygon Point ${
            layers.filter((l) => l.type === "point").length + 1
          }`,
          position: point,
          color: [32, 32, 32],
          radius: 5000,
          visible: true,
        };
        addLayer(pointLayer);
        setCurrentPath([...currentPath, point]);
      }
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

    const sectorAngleDeg = 60; // default sector width
    const sector = makeSectorPolygon(
      center,
      radiusMeters,
      bearing,
      sectorAngleDeg
    );

    // Build GeoJSON with only the sector polygon (no point or azimuth line)
    const featureCollection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [sector] },
          properties: { kind: "sector", radiusMeters, bearing, sectorAngleDeg },
        },
      ],
    };

    const newLayer: LayerProps = {
      type: "geojson",
      id: generateLayerId(),
      name: `Azimuthal ${
        layers.filter((l) => l.name?.startsWith("Azimuthal")).length + 1
      }`,
      geojson: featureCollection,
      color: [32, 32, 32, 180],
      pointRadius: 40000,
      visible: true,
    };

    addLayer(newLayer);
    setCurrentPath([]);
    setIsDrawing(false);
  };

  const handleClick = (event: any) => {
    if (!event.lngLat || !drawingMode) {
      return;
    }

    const { lng: longitude, lat: latitude } = event.lngLat;
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
      return;
    }

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
            maxZoom: 16,
          }
        );
      }
    } catch (error) {
      console.error("Failed to focus layer:", error);
    } finally {
      setFocusLayerRequest(null);
    }
  }, [focusLayerRequest]);

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

  return (
    <div
      className={`relative h-screen w-screen overflow-hidden ${
        isMapEnabled ? "bg-transparent" : "bg-black"
      }`}
    >
      <TiltControl mapRef={mapRef} pitch={pitch} setPitch={setPitch} />
      {selectedNodeForIcon && (
        <IconSelection
          selectedNodeForIcon={selectedNodeForIcon}
          setSelectedNodeForIcon={setSelectedNodeForIcon}
        />
      )}

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
          longitude: 76.2711,
          latitude: 10.8505,
          zoom: 4,
          pitch: pitch,
          bearing: 0,
        }}
        minZoom={0}
        maxZoom={12}
        maxPitch={85}
        onLoad={(map: any) => {
          if (!map.target.getSource("offline-tiles")) {
            map.target.addSource("offline-tiles", {
              type: "raster",
              tiles: ["/tiles-map/{z}/{x}/{y}.png"],

              minzoom: 0,
              maxzoom: 12,
            });
          }

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
            ...layers,
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
      <ZoomControls mapRef={mapRef} />
    </div>
  );
};

export default MapComponent;
