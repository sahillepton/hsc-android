// @ts-nocheck
import { useLayers } from "@/hooks/use-layers";
import type { LayerProps, Node } from "@/lib/definitions";
import type { PickingInfo } from "@deck.gl/core";
import { createContext, useContext } from "react";

interface LayersContextType {
  allLayers: any[];
  layers: LayerProps[];
  handleClick: (event: any) => void;
  handleMouseMove: (event: any) => void;
  handleMouseUp: () => void;
  handleLayerVisibility: (layerId: string, visible: boolean) => void;
  toggleDrawingMode: (mode: "point" | "polygon" | "line" | null) => void;
  drawingMode: "point" | "polygon" | "line" | null;
  handleLayerName: (layerId: string, name: string) => void;
  handleLayerColor: (layerId: string, color: [number, number, number]) => void;
  handleLayerRadius: (layerId: string, radius: number) => void;
  handleLayerPointRadius: (layerId: string, pointRadius: number) => void;
  clearAllLayers: () => void;
  downloadAllLayers: () => Promise<string>;
  deleteLayer: (layerId: string) => void;
  hoverInfo: PickingInfo<LayerProps> | undefined;
  createNodeLayer: (nodes: Node[], layerName?: string) => void;
  networkLayersVisible: boolean;
  toggleNetworkLayersVisibility: () => void;
  // Icon selection functionality
  nodeIconMappings: Record<string, string>;
  setNodeIcon: (nodeId: string, iconName: string) => void;
  getAvailableIcons: () => string[];
  // New Capacitor Preferences functions
  getStoredUploadData: (fileName: string) => Promise<any>;
  getStoredDownloadData: (fileName: string) => Promise<any>;
  clearStoredUploadData: (fileName: string) => Promise<void>;
  clearStoredDownloadData: (fileName: string) => Promise<void>;
  loadStoredUploadData: (fileName: string) => Promise<boolean>;
  loadStoredDownloadData: (fileName: string) => Promise<boolean>;
  // New Filesystem functions
  listStoredFiles: () => Promise<any[]>;
  loadFileFromFilesystem: (fileName: string) => Promise<boolean>;
  deleteStoredFile: (fileName: string) => Promise<void>;
  getFileInfoFromFilesystem: (fileName: string) => Promise<any>;
}

const LayersContext = createContext<LayersContextType | null>(null);

export const LayersProvider = ({ children }: { children: React.ReactNode }) => {
  const {
    allLayers,
    layers,
    handleClick,
    handleMouseMove,
    handleMouseUp,
    handleLayerVisibility,
    toggleDrawingMode,
    drawingMode,
    handleLayerName,
    handleLayerColor,
    handleLayerRadius,
    handleLayerPointRadius,
    clearAllLayers,
    downloadAllLayers,
    deleteLayer,
    hoverInfo,
    createNodeLayer,
    networkLayersVisible,
    toggleNetworkLayersVisibility,
    nodeIconMappings,
    setNodeIcon,
    getAvailableIcons,
    getStoredUploadData,
    getStoredDownloadData,
    clearStoredUploadData,
    clearStoredDownloadData,
    loadStoredUploadData,
    loadStoredDownloadData,
    listStoredFiles,
    loadFileFromFilesystem,
    deleteStoredFile,
    getFileInfoFromFilesystem,
  } = useLayers();
  return (
    <LayersContext.Provider
      value={{
        allLayers,
        layers,
        handleClick,
        handleMouseMove,
        handleMouseUp,
        handleLayerVisibility,
        toggleDrawingMode,
        drawingMode,
        handleLayerName,
        handleLayerColor,
        handleLayerRadius,
        handleLayerPointRadius,
        clearAllLayers,
        downloadAllLayers,
        deleteLayer,
        hoverInfo,
        createNodeLayer,
        networkLayersVisible,
        toggleNetworkLayersVisibility,
        nodeIconMappings,
        setNodeIcon,
        getAvailableIcons,
        getStoredUploadData,
        getStoredDownloadData,
        clearStoredUploadData,
        clearStoredDownloadData,
        loadStoredUploadData,
        loadStoredDownloadData,
        listStoredFiles,
        loadFileFromFilesystem,
        deleteStoredFile,
        getFileInfoFromFilesystem,
      }}
    >
      {children}
    </LayersContext.Provider>
  );
};

export const useLayersContext = () => {
  const context = useContext(LayersContext);
  if (!context) {
    throw new Error("useLayersContext must be used within a LayersProvider");
  }
  return context;
};
