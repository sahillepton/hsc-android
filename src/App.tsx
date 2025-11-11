// @ts-nocheck
import MapComponent from "./components/map";
import { SidebarProvider, SidebarTrigger } from "./components/ui/sidebar";
import { AppSidebar } from "./components/app-sidebar";

const App = () => {
  return (
    <SidebarProvider>
      <SidebarTrigger className="absolute top-4 left-4 z-99 h-8 w-8 p-0" />
      <div className="absolute z-50">
        <AppSidebar />
      </div>
      <MapComponent />
    </SidebarProvider>
  );
};

export default App;
