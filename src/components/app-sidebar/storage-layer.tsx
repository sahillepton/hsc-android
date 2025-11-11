import {
  getStorageDirectoryName,
  getStorageDirectoryPath,
  setStorageDirectory,
} from "@/lib/capacitor-utils";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "../ui/sidebar";
import { Directory } from "@capacitor/filesystem";
import { Label } from "../ui/label";
import { Card, CardContent } from "../ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

const StorageLayer = ({
  currentStorageDir,
  setCurrentStorageDir,
}: {
  currentStorageDir: Directory;
  setCurrentStorageDir: (dir: Directory) => void;
}) => {
  const handleChange = async (value: Directory) => {
    try {
      await setStorageDirectory(value);
      setCurrentStorageDir(value);
    } catch (error) {
      console.error("Failed to change storage location:", error);
    }
  };

  return (
    <SidebarGroup className="space-y-3">
      <SidebarGroupLabel className="px-3 py-2 text-sm font-semibold">
        Storage Location
      </SidebarGroupLabel>

      <SidebarGroupContent className="space-y-4">
        {/* <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            Current Storage Location (Android Device)
          </Label>

          <Card className="bg-muted/50 border-border/50">
            <CardContent className="p-3 text-xs break-all text-foreground">
              {getStorageDirectoryPath(currentStorageDir)}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Files will be saved to:{" "}
            <strong>{getStorageDirectoryName(currentStorageDir)}</strong>
          </p>
        </div> */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            Change Storage Location
          </Label>
          <Select
            value={currentStorageDir}
            onValueChange={(value) => handleChange(value as Directory)}
          >
            <SelectTrigger className="w-full text-sm">
              <SelectValue placeholder="Select storage location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={Directory.Documents}>
                Documents (Recommended for Android)
              </SelectItem>
              <SelectItem value={Directory.Data}>
                Data (App Internal)
              </SelectItem>
              <SelectItem value={Directory.Cache}>Cache (Temporary)</SelectItem>
              <SelectItem value={Directory.External}>
                External Storage (Public)
              </SelectItem>
              <SelectItem value={Directory.ExternalStorage}>
                External Storage (Public - Alt)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default StorageLayer;
