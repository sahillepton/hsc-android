import { Map } from "lucide-react";
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";

const SidebarDrawHeader = () => {
  return (
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" asChild>
            <div className="flex items-center gap-2">
              <div className="text-sidebar-primary flex aspect-square size-8 items-center justify-center rounded-lg">
                <Map className="size-5" />
              </div>
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-medium text-base">Layers Panel</span>
              </div>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  );
};

export default SidebarDrawHeader;
