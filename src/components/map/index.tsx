import Map, { useControl, NavigationControl } from "react-map-gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLayersContext } from "@/layers-provider";
import { TextLayer } from "@deck.gl/layers";
import { indianStatesData } from "@/data/indian-states";
import placesData from "@/lib/places.json";
import "mapbox-gl/dist/mapbox-gl.css";
import TiltControl from "./tilt-control";
import IconSelection from "./icon-selection";
import ZoomControls from "./zoom-controls";
import Tooltip from "./tooltip";
import { useProgressiveNodes } from "@/hooks/use-progressive-nodes";

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
    focusLayerRequest,
    clearLayerFocusRequest,
  } = useLayersContext();
  const { nodeCoordinatesData, setNodeCoordinatesData } = useProgressiveNodes(
    networkLayersVisible,
    createNodeLayer
  );
  const [isMapEnabled, setIsMapEnabled] = useState(true);
  const [pitch, setPitch] = useState(0);

  const [selectedNodeForIcon, setSelectedNodeForIcon] = useState<string | null>(
    null
  );
  const [motherAircraftPosition, setMotherAircraftPosition] = useState<
    [number, number] | null
  >(null);
  const [mapZoom, setMapZoom] = useState(4);

  const cityLabelData = useMemo(() => {
    if (!Array.isArray(placesData)) {
      return [];
    }

    return placesData
      .filter(
        (place: any) =>
          place &&
          typeof place.longitude === "number" &&
          typeof place.latitude === "number" &&
          typeof place.city === "string"
      )
      .map((place: any) => ({
        city: place.city,
        position: [place.longitude, place.latitude] as [number, number],
      }));
  }, []);

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

  const getLayerInfo = (layerId: string) => {
    return layers.find((layer) => layer.id === layerId);
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

  const cityLabelBaseSize =
    mapZoom >= 5 ? Math.max(12, Math.min(26, 12 + (mapZoom - 5) * 2.2)) : 12;

  const cityNamesLayer = new TextLayer({
    id: "city-names-layer",
    data: cityLabelData,
    pickable: false,
    getPosition: (d: any) => d.position,
    getText: (d: any) => d.city,
    getColor: [255, 255, 255, 210],
    getSize: cityLabelBaseSize,
    getTextAnchor: "middle",
    getAlignmentBaseline: "center",
    sizeUnits: "pixels",
    sizeMinPixels: Math.max(10, Math.min(18, cityLabelBaseSize - 2)),
    sizeMaxPixels: Math.max(18, Math.min(28, cityLabelBaseSize + 4)),
    billboard: true,
    fontWeight: "200",
    collisionEnabled: true,
    visible: mapZoom >= 8,
  });

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
      clearLayerFocusRequest();
    }
  }, [focusLayerRequest, clearLayerFocusRequest]);

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
          getAvailableIcons={getAvailableIcons}
          setNodeIcon={setNodeIcon}
          nodeIconMappings={nodeIconMappings}
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
            ...allLayers,
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

      <Tooltip hoverInfo={hoverInfo} getLayerInfo={getLayerInfo} />
      <ZoomControls mapRef={mapRef} />
    </div>
  );
};

export default MapComponent;
