import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useLayersContext } from "@/layers-provider";
import { Directory } from "@capacitor/filesystem";
import { useState, useEffect } from "react";
import ToolsGroup from "./tools-group";
import NetworkControls from "./network-controls";
import LayersPanel from "./layers-panel";
import StorageLayer from "./storage-layer";
import FileSection from "./file-section";
import ActionDialog from "./action-dialog";

// TODO: Break the sidebar into smaller components that handle maybe a section or a feature of the sidebar, not one large component
// each part of the sidebar should use its own state and actions, not the whole sidebar state and actions
// first pass, each sidebar section should be a separate component
export function AppSidebar() {
  const {
    layers,
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
    createNodeLayer,
    selectedNode,
    isNodeDialogOpen,
    handleVoiceCall,
    handleVideoCall,
    handleSendMessage,
    handleFtp,
    closeNodeDialog,
    networkLayersVisible,
    toggleNetworkLayersVisibility,
    downloadLayersToDevice,
    importLayersFromDevice,
    uploadGeoJsonFile,
    uploadDemFile,
    handleFileImport,
    getStorageDirectory,
    setStorageDirectory,
    getStorageDirectoryName,
    getStorageDirectoryPath,
  } = useLayersContext();
  const [isDrawingToolsOpen, setIsDrawingToolsOpen] = useState(true);
  const [currentStorageDir, setCurrentStorageDir] = useState<Directory>(
    Directory.Documents
  );
  const [isLayersOpen, setIsLayersOpen] = useState(true);
  const [isNetworkControlsOpen, setIsNetworkControlsOpen] = useState(true);

  // Load current storage directory on mount
  useEffect(() => {
    getStorageDirectory().then((dir) => {
      setCurrentStorageDir(dir);
    });
  }, [getStorageDirectory]);

  return (
    <div className="flex">
      <Sidebar variant="floating" collapsible={"offcanvas"} className="w-80">
        <SidebarContent className="px-4 py-3 space-y-4">
          <ToolsGroup
            drawingMode={drawingMode}
            toggleDrawingMode={toggleDrawingMode}
            setIsDrawingToolsOpen={setIsDrawingToolsOpen}
            isDrawingToolsOpen={isDrawingToolsOpen}
          />
          <NetworkControls
            setIsNetworkControlsOpen={setIsNetworkControlsOpen}
            isNetworkControlsOpen={isNetworkControlsOpen}
            networkLayersVisible={networkLayersVisible}
            toggleNetworkLayersVisibility={toggleNetworkLayersVisibility}
          />

          <LayersPanel
            deleteLayer={deleteLayer}
            focusLayer={focusLayer}
            handleLayerVisibility={handleLayerVisibility}
            handleLayerName={handleLayerName}
            handleLayerColor={handleLayerColor}
            handleLayerLineWidth={handleLayerLineWidth}
            handleLayerRadius={handleLayerRadius}
            handleLayerPointRadius={handleLayerPointRadius}
            layers={layers}
            setIsLayersOpen={setIsLayersOpen}
            isLayersOpen={isLayersOpen}
          />
          <StorageLayer
            currentStorageDir={currentStorageDir}
            setCurrentStorageDir={setCurrentStorageDir}
          />
          <FileSection
            handleFileImport={handleFileImport}
            downloadAllLayers={downloadAllLayers}
            layers={layers}
          />
        </SidebarContent>
        <SidebarFooter className="px-4 py-4" />
      </Sidebar>

      {/* Node Action Dialog */}
      <ActionDialog
        isNodeDialogOpen={isNodeDialogOpen}
        closeNodeDialog={closeNodeDialog}
        selectedNode={selectedNode!}
        handleVoiceCall={handleVoiceCall}
        handleVideoCall={handleVideoCall}
        handleSendMessage={handleSendMessage}
        handleFtp={handleFtp}
      />
    </div>
  );
}
