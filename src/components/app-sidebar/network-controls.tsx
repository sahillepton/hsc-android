import { ChevronDown, ChevronRight } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "../ui/sidebar";
import { useNetworkLayersVisible } from "@/store/layers-store";
import { Button } from "../ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "../ui/label";

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
    <SidebarGroup>
      {/* Group Label */}
      <SidebarGroupLabel
        className="flex items-center justify-between cursor-pointer select-none font-semibold px-3 py-2.5 rounded-lg hover:bg-accent transition-colors"
        onClick={() => setIsNetworkControlsOpen(!isNetworkControlsOpen)}
      >
        <span>Network Controls</span>
        {isNetworkControlsOpen ? (
          <ChevronDown size={16} className="text-muted-foreground" />
        ) : (
          <ChevronRight size={16} className="text-muted-foreground" />
        )}
      </SidebarGroupLabel>

      {/* Collapsible Content */}
      <SidebarGroupContent
        className={`${
          isNetworkControlsOpen ? "block" : "hidden"
        } transition-all`}
      >
        <SidebarMenu className="space-y-2 mt-2">
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <div className="flex items-center space-x-2">
                <Switch
                  id="show-network-layers"
                  checked={networkLayersVisible}
                  onCheckedChange={setNetworkLayersVisible}
                />
                <Label htmlFor="show-network-layers">Show Network Layers</Label>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default NetworkControls;
