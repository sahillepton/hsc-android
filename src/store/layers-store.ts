import type { LayerProps, Node, DrawingMode } from "@/lib/definitions";
import { create } from "zustand";
import type { PickingInfo } from "@deck.gl/core";
import { computeLayerBounds, calculateLayerZoomRange } from "@/lib/layers";
import {
  markLayerStagedDelete,
  updateManifestColor,
} from "@/sessions/manifestStore";

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
  drawingMode: DrawingMode;
  setDrawingMode: (drawingMode: DrawingMode) => void;
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
  useIgrs: boolean;
  setUseIgrs: (value: boolean) => void;
  userLocation: {
    lat: number;
    lng: number;
    accuracy: number;
  } | null;
  setUserLocation: (
    location: {
      lat: number;
      lng: number;
      accuracy: number;
    } | null
  ) => void;
  userLocationError: string | null;
  setUserLocationError: (error: string | null) => void;
  showUserLocation: boolean;
  setShowUserLocation: (show: boolean) => void;
}

const useLayerStore = create<LayerState>()((set, get) => ({
  layers: [],
  setLayers: (layers) => {
    set({ layers });
  },
  addLayer: (layer) => {
    set((state) => {
      // Calculate zoom range before saving if not already set (skip point layers)
      let layerWithZoomRange = { ...layer };
      if (layer.type !== "point") {
        // If minzoom is not set, calculate both minzoom and maxzoom
        if (layer.minzoom === undefined) {
          const zoomRange = calculateLayerZoomRange(layer);
          if (zoomRange !== undefined) {
            layerWithZoomRange.minzoom = zoomRange.minZoom;
            layerWithZoomRange.maxzoom = zoomRange.maxZoom;
          }
        }
        // If minzoom is set but maxzoom is not, calculate maxzoom
        else if (layer.maxzoom === undefined) {
          const zoomRange = calculateLayerZoomRange(layer);
          if (zoomRange !== undefined) {
            layerWithZoomRange.maxzoom = zoomRange.maxZoom;
          }
        }
      }
      const newLayers = [...state.layers, layerWithZoomRange];
      return { layers: newLayers };
    });
  },
  deleteLayer: (layerId: string) => {
    // Mark layer as staged_delete in manifest before filtering
    console.log(
      `[LayerDelete] Marking layer ${layerId} as staged_delete in manifest`
    );
    markLayerStagedDelete(layerId).catch((error) => {
      console.error(
        `[LayerDelete] Error marking layer as staged_delete:`,
        error
      );
      // Continue with deletion even if manifest update fails
    });

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

      const newLayers = state.layers.filter((layer) => layer.id !== layerId);
      return {
        layers: newLayers,
        hoverInfo: shouldClearHoverInfo ? undefined : state.hoverInfo,
      };
    });
  },
  updateLayer: (layerId: string, updatedLayer: LayerProps) =>
    set((state) => {
      const oldLayer = state.layers.find((l) => l.id === layerId);
      const colorChanged =
        oldLayer &&
        updatedLayer.color &&
        JSON.stringify(oldLayer.color) !== JSON.stringify(updatedLayer.color);

      const newLayers = state.layers.map((layer) => {
        if (layer.id === layerId) {
          // Ensure color array is a new reference to avoid sharing
          const newColor = updatedLayer.color
            ? ([...updatedLayer.color] as typeof updatedLayer.color)
            : updatedLayer.color;

          // Calculate zoom range if needed (skip point layers)
          let finalLayer = { ...updatedLayer };
          if (updatedLayer.type !== "point") {
            // If minzoom is not set, calculate both minzoom and maxzoom
            if (updatedLayer.minzoom === undefined) {
              const zoomRange = calculateLayerZoomRange(updatedLayer);
              if (zoomRange !== undefined) {
                finalLayer.minzoom = zoomRange.minZoom;
                finalLayer.maxzoom = zoomRange.maxZoom;
              }
            }
            // If minzoom is set but maxzoom is not, calculate maxzoom
            else if (updatedLayer.maxzoom === undefined) {
              const zoomRange = calculateLayerZoomRange(updatedLayer);
              if (zoomRange !== undefined) {
                finalLayer.maxzoom = zoomRange.maxZoom;
              }
            }
          }

          // Create a completely new layer object to ensure React/deck.gl detects the change
          return {
            ...finalLayer,
            color: newColor,
            // Explicitly include geometry properties to ensure they're updated
            radius: finalLayer.radius,
            pointRadius: finalLayer.pointRadius,
            lineWidth: finalLayer.lineWidth,
            // Explicitly include zoom properties
            minzoom: finalLayer.minzoom,
            maxzoom: finalLayer.maxzoom,
          };
        }
        return layer;
      });

      // Update manifest color if it changed
      if (colorChanged && updatedLayer.color) {
        updateManifestColor(layerId, updatedLayer.color).catch((error) => {
          console.error(
            `[LayerUpdate] Error updating manifest color for layer ${layerId}:`,
            error
          );
        });
      }

      return { layers: newLayers };
    }),
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
  setNodeIconMappings: (nodeIconMappings) => {
    set({ nodeIconMappings });
  },
  getNodeIcon: (nodeId: string) => get().nodeIconMappings[nodeId],
  setNodeIcon: (nodeId: string, iconName: string) =>
    set((state) => {
      const newMappings = { ...state.nodeIconMappings, [nodeId]: iconName };
      return { nodeIconMappings: newMappings };
    }),
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
  userLocation: null,
  setUserLocation: (location) => set({ userLocation: location }),
  userLocationError: null,
  setUserLocationError: (error) => set({ userLocationError: error }),
  showUserLocation: false,
  setShowUserLocation: (show) => set({ showUserLocation: show }),
  useIgrs: false,
  setUseIgrs: (value) => set({ useIgrs: value }),
}));

export const useLayers = () => {
  const layers = useLayerStore((state) => state.layers);
  const setLayers = useLayerStore((state) => state.setLayers);
  const addLayer = useLayerStore((state) => state.addLayer);
  const deleteLayer = useLayerStore((state) => state.deleteLayer);
  const bringLayerToTop = useLayerStore((state) => state.bringLayerToTop);
  return {
    layers,
    setLayers,
    addLayer,
    deleteLayer,
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

export const useUserLocation = () => {
  const userLocation = useLayerStore((state) => state.userLocation);
  const setUserLocation = useLayerStore((state) => state.setUserLocation);
  const userLocationError = useLayerStore((state) => state.userLocationError);
  const setUserLocationError = useLayerStore(
    (state) => state.setUserLocationError
  );
  const showUserLocation = useLayerStore((state) => state.showUserLocation);
  const setShowUserLocation = useLayerStore(
    (state) => state.setShowUserLocation
  );
  return {
    userLocation,
    setUserLocation,
    userLocationError,
    setUserLocationError,
    showUserLocation,
    setShowUserLocation,
  };
};

// Load layers from autosave on app initialization
export const loadAutosavedLayers = async () => {
  const {
    loadLayers,
    loadNodeIconMappings,
    loadLayersFromFile,
    loadNodeIconMappingsFromFile,
  } = await import("@/lib/autosave");

  // First try to load from file (if available)
  let layers = await loadLayersFromFile();
  let nodeIconMappings = await loadNodeIconMappingsFromFile();

  // If no file found, fall back to autosave
  if (layers.length === 0) {
    layers = await loadLayers();
  }
  if (Object.keys(nodeIconMappings).length === 0) {
    nodeIconMappings = await loadNodeIconMappings();
  }

  // Load the data into the store
  if (layers.length > 0) {
    useLayerStore.getState().setLayers(layers);
  }
  if (Object.keys(nodeIconMappings).length > 0) {
    useLayerStore.getState().setNodeIconMappings(nodeIconMappings);
  }

  return { layers, nodeIconMappings };
};

export const useIgrsPreference = () => useLayerStore((state) => state.useIgrs);
export const useSetIgrsPreference = () =>
  useLayerStore((state) => state.setUseIgrs);
