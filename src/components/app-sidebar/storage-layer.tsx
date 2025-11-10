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

const StorageLayer = ({
  currentStorageDir,
  setCurrentStorageDir,
}: {
  currentStorageDir: Directory;
  setCurrentStorageDir: (dir: Directory) => void;
}) => {
  return (
    <SidebarGroup className="space-y-3">
      <SidebarGroupLabel className="px-3 py-2 text-sm font-semibold">
        Storage Location
      </SidebarGroupLabel>
      <SidebarGroupContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground block">
            Current Storage Location (Android Device)
          </label>
          <div className="px-3 py-2 bg-muted rounded-md text-xs text-foreground break-all">
            {getStorageDirectoryPath(currentStorageDir)}
          </div>
          <p className="text-xs text-muted-foreground">
            Files will be saved to:{" "}
            <strong>{getStorageDirectoryName(currentStorageDir)}</strong>
          </p>
          <p className="text-xs text-blue-600 dark:text-blue-400">
            📱 On Android, files are saved to your device's internal storage.
            Use a file manager app to access them.
          </p>
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground block">
            Change Storage Location
          </label>
          <select
            value={currentStorageDir}
            onChange={async (e) => {
              try {
                const value = e.target.value as Directory;
                await setStorageDirectory(value);
                setCurrentStorageDir(value);
              } catch (error) {
                console.error("Failed to change storage location:", error);
              }
            }}
            className="w-full px-3 py-2 text-sm border border-input bg-background rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value={Directory.Documents}>
              Documents (Recommended for Android)
            </option>
            <option value={Directory.Data}>Data (App Internal)</option>
            <option value={Directory.Cache}>Cache (Temporary)</option>
            <option value={Directory.External}>
              External Storage (Public)
            </option>
            <option value={Directory.ExternalStorage}>
              External Storage (Public - Alt)
            </option>
          </select>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            ⚠️ Note: On Android, "Documents" is the recommended location for
            user-accessible files. Files saved here can be accessed via file
            manager apps.
          </p>
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default StorageLayer;
