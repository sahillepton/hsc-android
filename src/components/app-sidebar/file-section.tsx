import type { LayerProps } from "@/lib/definitions";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "../ui/sidebar";

const FileSection = ({
  handleFileImport,
  downloadAllLayers,
  layers,
}: {
  handleFileImport: (file: File) => Promise<void>;
  downloadAllLayers: () => Promise<string>;
  layers: LayerProps[];
}) => {
  return (
    <SidebarGroup className="space-y-3">
      <SidebarGroupLabel className="px-3 py-2 text-sm font-semibold">
        Import / Export Layers
      </SidebarGroupLabel>
      <SidebarGroupContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground block px-3">
            Import Files
          </label>
          <Input
            type="file"
            accept="*/*"
            className="w-full mx-3"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                try {
                  await handleFileImport(file);
                  // Reset input so same file can be selected again
                  e.target.value = "";
                } catch (error) {
                  console.error("Failed to import file:", error);
                  e.target.value = "";
                }
              }
            }}
          />
          <p className="text-xs text-muted-foreground px-3">
            Import vector files, raster/DEM, or layer exports (JSON)
          </p>
        </div>

        <Button
          onClick={async () => {
            try {
              await downloadAllLayers();
            } catch (error) {
              console.error("Failed to download layers:", error);
            }
          }}
          disabled={layers.length === 0}
          className="w-full h-10 font-medium mx-3"
          variant="outline"
        >
          📥 Export All Layers
        </Button>
        <p className="text-xs text-muted-foreground px-3">
          Export all layers as JSON with complete layer information
        </p>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default FileSection;
