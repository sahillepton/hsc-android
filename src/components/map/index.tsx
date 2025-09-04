import Map, { useControl } from "react-map-gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer, PolygonLayer, LineLayer } from "@deck.gl/layers";
import { useRef, useState } from "react";
function DeckGLOverlay({ layers }: { layers: any[] }) {
  const overlay = useControl<MapboxOverlay>(
    () => new MapboxOverlay({ layers })
  );
  overlay.setProps({ layers });
  return null;
}

export interface LayerProps {
  type: "point" | "polygon" | "line";
  visible: boolean; // Default to true
  id: string;
  name: string;
  position?: [number, number]; // Optional for multi-point shapes
  color: [number, number, number] | [number, number, number, number]; // RGB or RGBA
  radius?: number;
  // For lines
  path?: [number, number][];
  lineWidth?: number;
  // For polygons
  polygon?: [number, number][][];
  // For rectangles
  bounds?: [[number, number], [number, number]];
}

const MapComponent = ({
  layers,
  setLayers,
  isDrawing,
  setIsDrawing,
  currentPath,
  setCurrentPath,
  dragStart,
  setDragStart,
  drawingMode,
}: {
  layers: LayerProps[];
  setLayers: (layers: LayerProps[]) => void;
  isDrawing: boolean;
  setIsDrawing: (isDrawing: boolean) => void;
  currentPath: [number, number][];
  setCurrentPath: (currentPath: [number, number][]) => void;
  dragStart: [number, number] | null;
  setDragStart: (dragStart: [number, number] | null) => void;
  drawingMode: "point" | "polygon" | "line";
}) => {
  const mapRef = useRef<any>(null);

  const [mousePosition, setMousePosition] = useState<[number, number] | null>(
    null
  );

  const generateLayerId = () =>
    `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const handleClick = (event: any) => {
    if (!event.lngLat) return;

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
    }
  };

  const createPointLayer = (position: [number, number]) => {
    const newLayer: LayerProps = {
      type: "point",
      id: generateLayerId(),
      name: `Point ${layers.filter((l) => l.type === "point").length + 1}`,
      position,
      color: [255, 0, 0],
      radius: 50000,
      visible: true,
    };
    setLayers([...layers, newLayer]);
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
        color: [0, 255, 0],
        lineWidth: 5,
        visible: true,
      };
      setLayers([...layers, newLayer]);
      setCurrentPath([]);
      setIsDrawing(false);
    }
  };

  const isPointNearFirstPoint = (
    point: [number, number],
    firstPoint: [number, number],
    threshold = 0.1
  ) => {
    const distance = Math.sqrt(
      Math.pow(point[0] - firstPoint[0], 2) +
        Math.pow(point[1] - firstPoint[1], 2)
    );
    return distance < threshold;
  };

  const handlePolygonDrawing = (point: [number, number]) => {
    if (!isDrawing) {
      setCurrentPath([point]);
      setIsDrawing(true);
    } else {
      if (
        currentPath.length >= 3 &&
        isPointNearFirstPoint(point, currentPath[0])
      ) {
        const closedPath = [...currentPath, currentPath[0]];
        const newLayer: LayerProps = {
          type: "polygon",
          id: generateLayerId(),
          name: `Polygon ${
            layers.filter((l) => l.type === "polygon").length + 1
          }`,
          polygon: [closedPath],
          color: [0, 0, 255],
          visible: true,
        };
        setLayers([...layers, newLayer]);
        setCurrentPath([]);
        setIsDrawing(false);
      } else {
        setCurrentPath((prev) => [...prev, point]);
      }
    }
  };

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

  const pointLayers = layers.filter((l) => l.type === "point" && l.visible);
  const lineLayers = layers.filter((l) => l.type === "line" && l.visible);
  const polygonLayers = layers.filter((l) => l.type === "polygon" && l.visible);

  const previewLayers: LayerProps[] = [];

  if (
    isDrawing &&
    drawingMode === "line" &&
    currentPath.length === 1 &&
    mousePosition
  ) {
    previewLayers.push({
      type: "line",
      id: "preview-line",
      name: "Preview Line",
      path: [currentPath[0], mousePosition],
      color: [0, 255, 0],
      lineWidth: 3,
      visible: true,
    });
  }

  if (
    isDrawing &&
    drawingMode === "polygon" &&
    currentPath.length >= 1 &&
    mousePosition
  ) {
    if (currentPath.length === 1) {
      previewLayers.push({
        type: "line",
        id: "preview-polygon-line",
        name: "Preview Polygon Line",
        path: [currentPath[0], mousePosition],
        color: [0, 0, 255], // Blue
        lineWidth: 2,
        visible: true,
      });
    } else if (currentPath.length >= 2) {
      // Show current polygon + line to mouse + closing line
      const previewPath = [...currentPath, mousePosition];
      previewLayers.push({
        type: "polygon",
        id: "preview-polygon",
        name: "Preview Polygon",
        polygon: [previewPath],
        color: [0, 0, 255], // Blue
        visible: true,
      });

      // Show closing line if near first point
      if (isPointNearFirstPoint(mousePosition, currentPath[0])) {
        previewLayers.push({
          type: "line",
          id: "preview-closing-line",
          name: "Preview Closing Line",
          path: [mousePosition, currentPath[0]],
          color: [255, 255, 0], // Yellow closing indicator
          lineWidth: 3,
          visible: true,
        });
      }
    }
  }
  if (isDrawing && currentPath.length > 0) {
    currentPath.forEach((point, index) => {
      previewLayers.push({
        type: "point",
        id: `preview-point-${index}`,
        name: `Preview Point ${index + 1}`,
        position: point,
        color: index === 0 ? [255, 255, 0] : [255, 0, 255], // First point yellow, others magenta
        radius: 30000,
        visible: true,
      });
    });
  }

  const scatterLayer = new ScatterplotLayer({
    id: "point-layer",
    data: pointLayers,
    getPosition: (d: LayerProps) => d.position!,
    getRadius: (d: LayerProps) => d.radius || 50000,
    getFillColor: (d: LayerProps) => d.color,
    pickable: true,
    visible: true,
  });

  const previewPointLayers = previewLayers.filter((l) => l.type === "point");
  const previewLineLayers = previewLayers.filter((l) => l.type === "line");
  const previewPolygonLayers = previewLayers.filter(
    (l) => l.type === "polygon"
  );

  const previewPointLayer = new ScatterplotLayer({
    id: "preview-point-layer",
    data: previewPointLayers,
    getPosition: (d: LayerProps) => d.position!,
    getRadius: (d: LayerProps) => d.radius || 30000,
    getFillColor: (d: LayerProps) => d.color,
    pickable: false,
  });

  const pathData = lineLayers.flatMap((layer) =>
    layer.path!.slice(0, -1).map((point, index) => ({
      sourcePosition: point,
      targetPosition: layer.path![index + 1],
      color: layer.color,
      width: layer.lineWidth || 5,
      layerId: layer.id,
    }))
  );

  const pathLayer = new LineLayer({
    id: "path-layer",
    data: pathData,
    getSourcePosition: (d: any) => d.sourcePosition,
    getTargetPosition: (d: any) => d.targetPosition,
    getColor: (d: any) => d.color,
    getWidth: (d: any) => d.width,
    pickable: true,
  });

  const previewPathData = previewLineLayers.flatMap((layer) =>
    layer.path!.slice(0, -1).map((point, index) => ({
      sourcePosition: point,
      targetPosition: layer.path![index + 1],
      color: layer.color,
      width: layer.lineWidth || 3,
      layerId: layer.id,
    }))
  );

  const previewPathLayer = new LineLayer({
    id: "preview-path-layer",
    data: previewPathData,
    getSourcePosition: (d: any) => d.sourcePosition,
    getTargetPosition: (d: any) => d.targetPosition,
    getColor: (d: any) => d.color,
    getWidth: (d: any) => d.width,
    pickable: false,
  });

  const previewPolygonLayer = new PolygonLayer({
    id: "preview-polygon-layer",
    data: previewPolygonLayers,
    getPolygon: (d: LayerProps) => d.polygon![0],
    getFillColor: (d: LayerProps) =>
      d.color.length === 4
        ? d.color
        : ([...d.color, 50] as [number, number, number, number]),
    getLineColor: (d: LayerProps) =>
      d.color.slice(0, 3) as [number, number, number],
    getLineWidth: 2,
    pickable: false,
  });

  const polygonLayer = new PolygonLayer({
    id: "polygon-layer",
    data: polygonLayers,
    getPolygon: (d: LayerProps) => d.polygon![0],
    getFillColor: (d: LayerProps) =>
      d.color.length === 4
        ? d.color
        : ([...d.color, 100] as [number, number, number, number]),
    getLineColor: (d: LayerProps) =>
      d.color.slice(0, 3) as [number, number, number],
    getLineWidth: 2,
    pickable: true,
  });

  // Combine all layers
  const allLayers = [
    scatterLayer,
    pathLayer,
    polygonLayer,
    previewPointLayer,
    previewPathLayer,
    previewPolygonLayer,
  ].filter((layer) => layer.props.data && layer.props.data.length > 0);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Map
        ref={mapRef}
        style={{ width: "100%", height: "100%" }}
        mapboxAccessToken="pk.eyJ1IjoibmlraGlsc2FyYWYiLCJhIjoiY2xlc296YjRjMDA5dDNzcXphZjlzamFmeSJ9.7ZDaMZKecY3-70p9pX9-GQ"
        reuseMaps={true}
        onLoad={(map) => {
          map.target.addSource("local-tiles", {
            type: "raster",
            tiles: ["/tiles2/{z}/{x}/{y}.png"],
            tileSize: 256,
          });

          map.target.addLayer({
            id: "local-tiles-layer",
            type: "raster",
            source: "local-tiles",
            paint: { "raster-opacity": 0.8 },
          });
        }}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <DeckGLOverlay layers={allLayers} />
      </Map>
    </div>
  );
};

export default MapComponent;
