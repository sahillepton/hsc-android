import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Directory } from "@capacitor/filesystem";
import { useState, useEffect } from "react";
import ToolsGroup from "./tools-group";
import NetworkControls from "./network-controls";
import LayersPanel from "./layers-panel";
import StorageLayer from "./storage-layer";
import FileSection from "./file-section";
import ActionDialog from "./action-dialog";
import { getStorageDirectory } from "@/lib/capacitor-utils";
export function AppSidebar() {
  // const {
  //   layers,
  //   handleLayerVisibility,
  //   toggleDrawingMode,
  //   drawingMode,
  //   handleLayerName,
  //   handleLayerColor,
  //   focusLayer,
  //   handleLayerLineWidth,
  //   handleLayerRadius,
  //   handleLayerPointRadius,
  //   clearAllLayers,
  //   downloadAllLayers,
  //   deleteLayer,
  //   createNodeLayer,
  //   selectedNode,
  //   isNodeDialogOpen,
  //   handleVoiceCall,
  //   handleVideoCall,
  //   handleSendMessage,
  //   handleFtp,
  //   closeNodeDialog,
  //   networkLayersVisible,
  //   toggleNetworkLayersVisibility,
  //   downloadLayersToDevice,
  //   importLayersFromDevice,
  //   uploadGeoJsonFile,
  //   uploadDemFile,
  //   handleFileImport,
  //   getStorageDirectory,
  //   setStorageDirectory,
  //   getStorageDirectoryName,
  //   getStorageDirectoryPath,
  // } = useLayersContext();
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
  }, []);

  return (
    <div className="flex">
      <Sidebar variant="floating" collapsible={"offcanvas"} className="w-80">
        <SidebarContent className="px-4 py-3 space-y-4">
          <ToolsGroup
            setIsDrawingToolsOpen={setIsDrawingToolsOpen}
            isDrawingToolsOpen={isDrawingToolsOpen}
          />
          <NetworkControls
            setIsNetworkControlsOpen={setIsNetworkControlsOpen}
            isNetworkControlsOpen={isNetworkControlsOpen}
          />

          <LayersPanel
            isLayersOpen={isLayersOpen}
            setIsLayersOpen={setIsLayersOpen}
          />
          <StorageLayer
            currentStorageDir={currentStorageDir}
            setCurrentStorageDir={setCurrentStorageDir}
          />
          <FileSection />
        </SidebarContent>
        <SidebarFooter className="px-4 py-4" />
      </Sidebar>

      {/* Node Action Dialog */}
      <ActionDialog />
    </div>
  );
}
