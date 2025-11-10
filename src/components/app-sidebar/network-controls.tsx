import { ChevronDown, ChevronRight } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "../ui/sidebar";
import { Button } from "../ui/button";
import { useNetworkLayersVisible } from "@/store/layers-store";

const NetworkControls = ({
  setIsNetworkControlsOpen,
  isNetworkControlsOpen,
}: {
  setIsNetworkControlsOpen: (isOpen: boolean) => void;
  isNetworkControlsOpen: boolean;
}) => {
  const { networkLayersVisible, setNetworkLayersVisible } =
    useNetworkLayersVisible();
  return (
    <SidebarGroup className="space-y-3">
      <SidebarGroupLabel
        className="cursor-pointer hover:bg-accent rounded-lg px-3 py-2.5 flex items-center justify-between text-sm font-semibold transition-colors"
        onClick={() => setIsNetworkControlsOpen(!isNetworkControlsOpen)}
      >
        Network Controls
        {isNetworkControlsOpen ? (
          <ChevronDown size={16} />
        ) : (
          <ChevronRight size={16} />
        )}
      </SidebarGroupLabel>

      {isNetworkControlsOpen && (
        <SidebarGroupContent>
          <SidebarMenu className="space-y-2">
            <SidebarMenuItem>
              <div className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-accent">
                <span className="text-sm font-medium">Show Network Layers</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNetworkLayersVisible(!networkLayersVisible)}
                  className={`h-8 w-14 px-1 ${
                    networkLayersVisible
                      ? "bg-blue-500 hover:bg-blue-600 text-white"
                      : "bg-gray-200 hover:bg-gray-300 text-gray-600"
                  }`}
                  style={{
                    borderRadius: "12px",
                    position: "relative",
                    transition: "all 0.2s ease-in-out",
                  }}
                >
                  <div
                    className="w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-200 ease-in-out"
                    style={{
                      transform: networkLayersVisible
                        ? "translateX(24px)"
                        : "translateX(0)",
                      position: "absolute",
                      left: "2px",
                      top: "2px",
                    }}
                  />
                </Button>
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
};

export default NetworkControls;
