import { useState } from "react";
import MapComponent from "./components/map";
import { SidebarProvider } from "./components/ui/sidebar";
import { AppSidebar } from "./components/app-sidebar";

const App = () => {
  const [layers, setLayers] = useState<any[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<[number, number][]>([]);
  const [dragStart, setDragStart] = useState<[number, number] | null>(null);
  const [drawingMode, setDrawingMode] = useState<"point" | "polygon" | "line">(
    "point"
  );

  return (
    <SidebarProvider>
      <div className="absolute z-50">
        <AppSidebar
          layers={layers}
          setLayers={setLayers}
          drawingMode={drawingMode}
          setDrawingMode={setDrawingMode}
        />
      </div>
      <MapComponent
        layers={layers}
        setLayers={setLayers}
        isDrawing={isDrawing}
        setIsDrawing={setIsDrawing}
        currentPath={currentPath}
        setCurrentPath={setCurrentPath}
        dragStart={dragStart}
        setDragStart={setDragStart}
        drawingMode={drawingMode}
      />
    </SidebarProvider>
  );
};

export default App;
