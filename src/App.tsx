// @ts-nocheck
import { useState, useEffect } from "react";
import MapComponent from "./components/map";
import { SidebarProvider, SidebarTrigger } from "./components/ui/sidebar";
import { AppSidebar } from "./components/app-sidebar";
import { loadAutosavedLayers } from "./store/layers-store";
import LayersBox from "./components/map/layers-box";

const App = () => {
  const [isLayersPanelVisible, setIsLayersPanelVisible] = useState(false);
  const [isLayersBoxOpen, setIsLayersBoxOpen] = useState(false);

  // Load autosaved layers on app initialization
  useEffect(() => {
    loadAutosavedLayers().catch((error) => {
      console.error("Failed to load autosaved layers:", error);
    });
  }, []);

  return (
    <SidebarProvider>
      {isLayersPanelVisible && (
        <div className="fixed top-4 left-4 z-50" style={{ zoom: 0.85 }}>
          <AppSidebar onClose={() => setIsLayersPanelVisible(false)} />
        </div>
      )}
      {isLayersBoxOpen && (
        <LayersBox onClose={() => setIsLayersBoxOpen(false)} />
      )}
      <MapComponent
        onToggleLayersBox={() => {
          setIsLayersBoxOpen((prev) => {
            // If opening layers box, we'll close others via callback
            return !prev;
          });
        }}
        onCloseLayersBox={() => setIsLayersBoxOpen(false)}
        isLayersBoxOpen={isLayersBoxOpen}
      />
    </SidebarProvider>
  );
};

export default App;
