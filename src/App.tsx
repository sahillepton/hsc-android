// @ts-nocheck
import MapComponent from "./components/map";
import { SidebarProvider, SidebarTrigger } from "./components/ui/sidebar";
import { AppSidebar } from "./components/app-sidebar";

const App = () => {
  return (
    <SidebarProvider>
      <div className="absolute z-50">
        <AppSidebar />
      </div>
      <MapComponent />
    </SidebarProvider>
  );
};

export default App;
