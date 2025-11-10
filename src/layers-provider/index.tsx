// @ts-nocheck
import { useLayers } from "@/hooks/use-layers";
import type { DrawingMode, LayerProps, Node } from "@/lib/definitions";
import type { PickingInfo } from "@deck.gl/core";
import { createContext, useContext } from "react";

// TODO: This is very inefficient. The whole application is rendering from the top everytime any change is made.
// Literally worst case scenario

// Step 1: Separate state and setters/actions
// step 2: Use an external store like zustand to manage the state and actions
// Step 3: The context provider should only be used to provide the store to the components
// Step 4: The components should use the store to get the state and actions, only the ones they use, not all the state

interface LayersContextType {
  allLayers: any[];
  layers: LayerProps[];
  handleClick: (event: any) => void;
  handleMouseMove: (event: any) => void;
  handleMouseUp: () => void;
  handleLayerVisibility: (layerId: string, visible: boolean) => void;
  toggleDrawingMode: (mode: DrawingMode) => void;
  drawingMode: DrawingMode;
  handleLayerName: (layerId: string, name: string) => void;
  handleLayerColor: (layerId: string, color: [number, number, number]) => void;
  focusLayer: (layerId: string) => void;
  handleLayerLineWidth: (layerId: string, lineWidth: number) => void;
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
  focusLayerRequest: {
    layerId: string;
    bounds: [number, number, number, number];
    center: [number, number];
    isSinglePoint: boolean;
    timestamp: number;
  } | null;
  clearLayerFocusRequest: () => void;
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
  // New device storage functions
  downloadLayersToDevice: () => Promise<string>;
  importLayersFromDevice: () => Promise<boolean>;
  // File upload function
  uploadGeoJsonFile: (file: File) => Promise<void>;
  uploadDemFile: (file: File) => Promise<void>;
  uploadGeoJsonFromFilesystem: (
    path: string,
    fileName?: string
  ) => Promise<void>;
  uploadDemFromFilesystem: (path: string, fileName?: string) => Promise<void>;
  handleFileImport: (file: File) => Promise<void>;
  // Storage directory functions
  getStorageDirectory: () => Promise<import("@capacitor/filesystem").Directory>;
  setStorageDirectory: (
    directory: import("@capacitor/filesystem").Directory
  ) => Promise<void>;
  getStorageDirectoryName: (
    directory: import("@capacitor/filesystem").Directory
  ) => string;
  getStorageDirectoryPath: (
    directory: import("@capacitor/filesystem").Directory
  ) => string;
  // Node dialog functions
  selectedNode: Node | null;
  isNodeDialogOpen: boolean;
  handleVoiceCall: (node: Node) => void;
  handleVideoCall: (node: Node) => void;
  handleSendMessage: (node: Node) => void;
  handleFtp: (node: Node) => void;
  closeNodeDialog: () => void;
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
    focusLayer,
    handleLayerLineWidth,
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
    focusLayerRequest,
    clearLayerFocusRequest,
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
    downloadLayersToDevice,
    importLayersFromDevice,
    uploadGeoJsonFile,
    uploadDemFile,
    uploadGeoJsonFromFilesystem,
    uploadDemFromFilesystem,
    handleFileImport,
    getStorageDirectory,
    setStorageDirectory,
    getStorageDirectoryName,
    getStorageDirectoryPath,
    selectedNode,
    isNodeDialogOpen,
    handleVoiceCall,
    handleVideoCall,
    handleSendMessage,
    handleFtp,
    closeNodeDialog,
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
        focusLayer,
        handleLayerLineWidth,
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
        focusLayerRequest,
        clearLayerFocusRequest,
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
        downloadLayersToDevice,
        importLayersFromDevice,
        uploadGeoJsonFile,
        uploadDemFile,
        uploadGeoJsonFromFilesystem,
        uploadDemFromFilesystem,
        handleFileImport,
        getStorageDirectory,
        setStorageDirectory,
        getStorageDirectoryName,
        getStorageDirectoryPath,
        selectedNode,
        isNodeDialogOpen,
        handleVoiceCall,
        handleVideoCall,
        handleSendMessage,
        handleFtp,
        closeNodeDialog,
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
