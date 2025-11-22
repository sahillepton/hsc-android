import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Directory } from "@capacitor/filesystem";
import { useState, useEffect } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import ToolsGroup from "./tools-group";
import NetworkControls from "./network-controls";
import LayersPanel from "./layers-panel";
import StorageLayer from "./storage-layer";
import FileSection from "./file-section";
import ActionDialog from "./action-dialog";
import { getStorageDirectory } from "@/lib/capacitor-utils";
import SidebarDrawHeader from "./sidebar-header";
export function AppSidebar({ onClose }: { onClose?: () => void }) {
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
    <div className="flex relative">
      <style>{`
        div[data-slot='sidebar-container'] {
          top: 1rem !important;
          left: 1rem !important;
        }
      `}</style>
      {onClose && (
        <Button
          onClick={onClose}
          variant="ghost"
          size="icon"
          className="absolute top-7 right-6 z-50 h-8 w-8 bg-transparent hover:bg-transparent"
          title="Close panel"
        >
          <XIcon className="h-4 w-4 text-gray-600" />
        </Button>
      )}
      <Sidebar
        variant="floating"
        collapsible={"offcanvas"}
        className="h-auto max-h-[calc(100vh-2rem)]"
      >
        <SidebarDrawHeader />
        <SidebarContent className="px-2 py-0 space-y-0 gap-0 overflow-y-auto">
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
