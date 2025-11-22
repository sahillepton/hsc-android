// @ts-nocheck
import { useState } from "react";
import MapComponent from "./components/map";
import { SidebarProvider, SidebarTrigger } from "./components/ui/sidebar";
import { AppSidebar } from "./components/app-sidebar";

const App = () => {
  const [isLayersPanelVisible, setIsLayersPanelVisible] = useState(false);

  return (
    <SidebarProvider>
      {isLayersPanelVisible && (
        <div className="fixed top-4 left-4 z-50" style={{ zoom: 0.85 }}>
          <AppSidebar onClose={() => setIsLayersPanelVisible(false)} />
        </div>
      )}
      <MapComponent
        onToggleLayersPanel={() =>
          setIsLayersPanelVisible(!isLayersPanelVisible)
        }
      />
    </SidebarProvider>
  );
};

export default App;
