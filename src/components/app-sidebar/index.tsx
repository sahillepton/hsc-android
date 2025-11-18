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
import SidebarDrawHeader from "./sidebar-header";
export function AppSidebar() {
  const [isDrawingToolsOpen, setIsDrawingToolsOpen] = useState(false);
  const [currentStorageDir, setCurrentStorageDir] = useState<Directory>(
    Directory.Documents
  );
  const [isLayersOpen, setIsLayersOpen] = useState(false);
  const [isNetworkControlsOpen, setIsNetworkControlsOpen] = useState(false);

  // Load current storage directory on mount
  useEffect(() => {
    getStorageDirectory().then((dir) => {
      setCurrentStorageDir(dir);
    });
  }, []);

  return (
    <div className="flex">
      <Sidebar variant="floating" collapsible={"offcanvas"}>
        <SidebarDrawHeader />
        <SidebarContent className="px-2 py-0 space-y-0 gap-0">
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
        <SidebarFooter className="p-2" />
      </Sidebar>

      {/* Node Action Dialog */}
      <ActionDialog />
    </div>
  );
}
