import type { LayerProps, Node } from "@/lib/definitions";
import { create } from "zustand";
import type { PickingInfo } from "@deck.gl/core";
import { computeLayerBounds } from "@/lib/layers";

interface LayerState {
  layers: LayerProps[];
  setLayers: (layers: LayerProps[]) => void;
  addLayer: (layer: LayerProps) => void;
  deleteLayer: (layerId: string) => void;
  updateLayer: (layerId: string, layer: LayerProps) => void;
  bringLayerToTop: (layerId: string) => void;
  isDrawing: boolean;
  setIsDrawing: (isDrawing: boolean) => void;
  currentPath: [number, number][];
  setCurrentPath: (currentPath: [number, number][]) => void;
  dragStart: [number, number] | null;
  setDragStart: (dragStart: [number, number] | null) => void;
  drawingMode: "point" | "polygon" | "line" | "azimuthal" | null;
  setDrawingMode: (
    drawingMode: "point" | "polygon" | "line" | "azimuthal" | null
  ) => void;
  selectedNode: Node | null;
  setSelectedNode: (selectedNode: Node | null) => void;
  isNodeDialogOpen: boolean;
  setIsNodeDialogOpen: (isNodeDialogOpen: boolean) => void;
  hoverInfo: PickingInfo<any> | undefined;
  setHoverInfo: (hoverInfo: PickingInfo<any> | undefined) => void;
  mousePosition: [number, number] | null;
  setMousePosition: (mousePosition: [number, number] | null) => void;
  networkLayersVisible: boolean;
  setNetworkLayersVisible: (networkLayersVisible: boolean) => void;
  nodeIconMappings: Record<string, string>;
  setNodeIconMappings: (nodeIconMappings: Record<string, string>) => void;
  getNodeIcon: (nodeId: string) => string | undefined;
  setNodeIcon: (nodeId: string, iconName: string) => void;
  focusLayerRequest: {
    layerId: string;
    bounds: [number, number, number, number];
    center: [number, number];
    isSinglePoint: boolean;
    timestamp: number;
  } | null;
  setFocusLayerRequest: (
    focusLayerRequest: {
      layerId: string;
      bounds: [number, number, number, number];
      center: [number, number];
      isSinglePoint: boolean;
      timestamp: number;
    } | null
  ) => void;
  focusLayer: (layerId: string) => void;
  clearLayerFocusRequest: () => void;
  azimuthalAngle: number;
  setAzimuthalAngle: (angle: number) => void;
  pendingPolygonPoints: [number, number][];
  setPendingPolygonPoints: (points: [number, number][]) => void;
}

const useLayerStore = create<LayerState>()((set, get) => ({
  layers: [],
  setLayers: (layers) => set({ layers }),
  addLayer: (layer) => set((state) => ({ layers: [...state.layers, layer] })),
  deleteLayer: (layerId: string) =>
    set((state) => {
      // Check if the deleted layer is the one being hovered
      let shouldClearHoverInfo = false;
      if (state.hoverInfo) {
        const hoveredObject = state.hoverInfo.object;
        let hoveredLayerId: string | undefined;

        if ((hoveredObject as any)?.layerId) {
          hoveredLayerId = (hoveredObject as any).layerId;
        } else if ((hoveredObject as any)?.id && (hoveredObject as any)?.type) {
          hoveredLayerId = (hoveredObject as any).id;
        } else if (state.hoverInfo.layer?.id) {
          const deckLayerId = state.hoverInfo.layer.id;
          hoveredLayerId = state.layers.find((l) => l.id === deckLayerId)?.id;
          if (!hoveredLayerId) {
            const baseId = deckLayerId
              .replace(/-icon-layer$/, "")
              .replace(/-signal-overlay$/, "")
              .replace(/-bitmap$/, "");
            hoveredLayerId = state.layers.find((l) => l.id === baseId)?.id;
          }
        }

        if (hoveredLayerId === layerId) {
          shouldClearHoverInfo = true;
        }
      }

      return {
        layers: state.layers.filter((layer) => layer.id !== layerId),
        hoverInfo: shouldClearHoverInfo ? undefined : state.hoverInfo,
      };
    }),
  updateLayer: (layerId: string, updatedLayer: LayerProps) =>
    set((state) => ({
      layers: state.layers.map((layer) => {
        if (layer.id === layerId) {
          // Ensure color array is a new reference to avoid sharing
          const newColor = updatedLayer.color
            ? ([...updatedLayer.color] as typeof updatedLayer.color)
            : updatedLayer.color;
          // Create a completely new layer object to ensure React/deck.gl detects the change
          return {
            ...updatedLayer,
            color: newColor,
            // Explicitly include geometry properties to ensure they're updated
            radius: updatedLayer.radius,
            pointRadius: updatedLayer.pointRadius,
            lineWidth: updatedLayer.lineWidth,
          };
        }
        return layer;
      }),
    })),
  bringLayerToTop: (layerId: string) =>
    set((state) => {
      const layerIndex = state.layers.findIndex(
        (layer) => layer.id === layerId
      );
      if (layerIndex === -1 || layerIndex === state.layers.length - 1) {
        // Layer not found or already at top
        return state;
      }
      const layer = state.layers[layerIndex];
      const newLayers = [
        ...state.layers.slice(0, layerIndex),
        ...state.layers.slice(layerIndex + 1),
        layer, // Move to end (top of rendering stack)
      ];
      return { layers: newLayers };
    }),
  isDrawing: false,
  setIsDrawing: (isDrawing) => set({ isDrawing }),
  currentPath: [],
  setCurrentPath: (currentPath) => set({ currentPath }),
  dragStart: null,
  setDragStart: (dragStart) => set({ dragStart }),
  drawingMode: null,
  setDrawingMode: (drawingMode) => set({ drawingMode }),
  selectedNode: null,
  setSelectedNode: (selectedNode) => set({ selectedNode }),
  isNodeDialogOpen: false,
  setIsNodeDialogOpen: (isNodeDialogOpen) => set({ isNodeDialogOpen }),
  hoverInfo: undefined,
  setHoverInfo: (hoverInfo) => set({ hoverInfo }),
  mousePosition: null,
  setMousePosition: (mousePosition) => set({ mousePosition }),
  networkLayersVisible: true,
  setNetworkLayersVisible: (networkLayersVisible) =>
    set({ networkLayersVisible }),
  nodeIconMappings: {},
  setNodeIconMappings: (nodeIconMappings) => set({ nodeIconMappings }),
  getNodeIcon: (nodeId: string) => get().nodeIconMappings[nodeId],
  setNodeIcon: (nodeId: string, iconName: string) =>
    set((state) => ({
      nodeIconMappings: { ...state.nodeIconMappings, [nodeId]: iconName },
    })),
  focusLayerRequest: null,
  setFocusLayerRequest: (focusLayerRequest) => set({ focusLayerRequest }),
  focusLayer: (layerId) => {
    const targetLayer = get().layers.find((layer) => layer.id === layerId);
    if (!targetLayer) {
      throw new Error(`Layer with id ${layerId} not found`);
    }
    const boundsData = computeLayerBounds(targetLayer);
    if (!boundsData) {
      throw new Error(`Layer with id ${layerId} has no geometry to focus`);
    }
    set({
      focusLayerRequest: {
        layerId,
        bounds: boundsData.bounds,
        center: boundsData.center,
        isSinglePoint: boundsData.isSinglePoint,
        timestamp: Date.now(),
      },
    });
  },
  clearLayerFocusRequest: () => set({ focusLayerRequest: null }),
  azimuthalAngle: 60,
  setAzimuthalAngle: (angle) =>
    set({ azimuthalAngle: Math.max(1, Math.min(angle, 360)) }),
  pendingPolygonPoints: [],
  setPendingPolygonPoints: (points) => set({ pendingPolygonPoints: points }),
}));

export const useLayers = () => {
  const layers = useLayerStore((state) => state.layers);
  const setLayers = useLayerStore((state) => state.setLayers);
  const addLayer = useLayerStore((state) => state.addLayer);
  const bringLayerToTop = useLayerStore((state) => state.bringLayerToTop);
  return {
    layers,
    setLayers,
    addLayer,
    bringLayerToTop,
  };
};

export const useIsDrawing = () => {
  const isDrawing = useLayerStore((state) => state.isDrawing);
  const setIsDrawing = useLayerStore((state) => state.setIsDrawing);
  return {
    isDrawing,
    setIsDrawing,
  };
};

export const useCurrentPath = () => {
  const currentPath = useLayerStore((state) => state.currentPath);
  const setCurrentPath = useLayerStore((state) => state.setCurrentPath);
  return {
    currentPath,
    setCurrentPath,
  };
};

export const useDragStart = () => {
  const dragStart = useLayerStore((state) => state.dragStart);
  const setDragStart = useLayerStore((state) => state.setDragStart);
  return {
    dragStart,
    setDragStart,
  };
};

export const useDrawingMode = () => {
  const drawingMode = useLayerStore((state) => state.drawingMode);
  const setDrawingMode = useLayerStore((state) => state.setDrawingMode);
  return { drawingMode, setDrawingMode };
};

export const useSelectedNode = () => {
  const selectedNode = useLayerStore((state) => state.selectedNode);
  const setSelectedNode = useLayerStore((state) => state.setSelectedNode);
  return { selectedNode, setSelectedNode };
};

export const useNodeDialog = () => {
  const isNodeDialogOpen = useLayerStore((state) => state.isNodeDialogOpen);
  const setIsNodeDialogOpen = useLayerStore(
    (state) => state.setIsNodeDialogOpen
  );
  return { isNodeDialogOpen, setIsNodeDialogOpen };
};

export const useHoverInfo = () => {
  const hoverInfo = useLayerStore((state) => state.hoverInfo);
  const setHoverInfo = useLayerStore((state) => state.setHoverInfo);
  return { hoverInfo, setHoverInfo };
};

export const useMousePosition = () => {
  const mousePosition = useLayerStore((state) => state.mousePosition);
  const setMousePosition = useLayerStore((state) => state.setMousePosition);
  return { mousePosition, setMousePosition };
};

export const useNetworkLayersVisible = () => {
  const networkLayersVisible = useLayerStore(
    (state) => state.networkLayersVisible
  );
  const setNetworkLayersVisible = useLayerStore(
    (state) => state.setNetworkLayersVisible
  );
  return { networkLayersVisible, setNetworkLayersVisible };
};

export const useNodeIconMappings = () => {
  const nodeIconMappings = useLayerStore((state) => state.nodeIconMappings);
  const setNodeIconMappings = useLayerStore(
    (state) => state.setNodeIconMappings
  );
  const getNodeIcon = useLayerStore((state) => state.getNodeIcon);
  const setNodeIcon = useLayerStore((state) => state.setNodeIcon);
  return { nodeIconMappings, setNodeIconMappings, getNodeIcon, setNodeIcon };
};

export const useFocusLayerRequest = () => {
  const focusLayerRequest = useLayerStore((state) => state.focusLayerRequest);
  const setFocusLayerRequest = useLayerStore(
    (state) => state.setFocusLayerRequest
  );
  const focusLayer = useLayerStore((state) => state.focusLayer);
  const clearLayerFocusRequest = useLayerStore(
    (state) => state.clearLayerFocusRequest
  );
  const deleteLayer = useLayerStore((state) => state.deleteLayer);
  const updateLayer = useLayerStore((state) => state.updateLayer);
  return {
    focusLayerRequest,
    setFocusLayerRequest,
    focusLayer,
    clearLayerFocusRequest,
    deleteLayer,
    updateLayer,
  };
};

export const useAzimuthalAngle = () => {
  const azimuthalAngle = useLayerStore((state) => state.azimuthalAngle);
  const setAzimuthalAngle = useLayerStore((state) => state.setAzimuthalAngle);
  return { azimuthalAngle, setAzimuthalAngle };
};

export const usePendingPolygon = () => {
  const pendingPolygonPoints = useLayerStore(
    (state) => state.pendingPolygonPoints
  );
  const setPendingPolygonPoints = useLayerStore(
    (state) => state.setPendingPolygonPoints
  );
  return { pendingPolygonPoints, setPendingPolygonPoints };
};
