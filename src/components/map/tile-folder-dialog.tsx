import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { OfflineTileServer } from "@/plugins/offline-tile-server";
import { Preferences } from "@capacitor/preferences";
import { toast } from "@/lib/toast";

const TILE_FOLDER_URI_KEY = "tile_folder_uri";
const TILE_SERVER_URL_KEY = "tile_server_url";

export const TileFolderDialog = ({
  isOpen,
  onOpenChange,
  onFolderSelected,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onFolderSelected?: (uri: string, serverUrl: string) => void;
}) => {
  const [currentUri, setCurrentUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadCurrentFolder();
    }
  }, [isOpen]);

  const loadCurrentFolder = async () => {
    try {
      const result = await OfflineTileServer.getSavedFolderUri();
      setCurrentUri(result.uri || null);
    } catch (error) {
      console.error("Error loading folder:", error);
    }
  };

  const handleSelectFolder = async () => {
    setIsLoading(true);
    const toastId = toast.loading("Opening folder picker...");

    try {
      const result = await OfflineTileServer.selectTileFolder();
      const selectedUri = result.uri;

      // Save URI to preferences
      await Preferences.set({
        key: TILE_FOLDER_URI_KEY,
        value: selectedUri,
      });

      // Start tile server (useTms: false for XYZ format, set to true if tiles are in TMS format)
      console.log("[TileServer] Starting server with URI:", selectedUri);
      const serverResult = await OfflineTileServer.startTileServer({
        uri: selectedUri,
        useTms: false, // Change to true if your tiles use TMS format (Y-flipped)
      });
      console.log(
        "[TileServer] Server started, baseUrl:",
        serverResult.baseUrl
      );

      // Save server URL
      await Preferences.set({
        key: TILE_SERVER_URL_KEY,
        value: serverResult.baseUrl,
      });

      setCurrentUri(selectedUri);
      toast.update(toastId, "Folder selected and server started!", "success");

      onFolderSelected?.(selectedUri, serverResult.baseUrl);
      onOpenChange(false);
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "Failed to select folder";
      toast.update(toastId, errorMsg, "error");
      console.error("Error selecting folder:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStopServer = async () => {
    try {
      await OfflineTileServer.stopTileServer();
      await Preferences.remove({ key: TILE_FOLDER_URI_KEY });
      await Preferences.remove({ key: TILE_SERVER_URL_KEY });
      setCurrentUri(null);
      toast.success("Tile server stopped");
    } catch (error) {
      console.error("Error stopping server:", error);
      toast.error("Failed to stop server");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Select Offline Tiles Folder</DialogTitle>
          <DialogDescription>
            Choose the folder containing your map tiles in tiles/z/x/y.pbf
            format
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {currentUri ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Current folder:</p>
              <p className="text-sm font-mono bg-muted p-2 rounded break-all">
                {currentUri}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleStopServer}
                className="w-full"
              >
                Stop Server & Clear
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No folder selected. Please select a folder containing your map
              tiles.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSelectFolder} disabled={isLoading}>
            {isLoading ? "Loading..." : "Select Folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const getTileServerUrl = async (): Promise<string | null> => {
  try {
    const { value } = await Preferences.get({ key: TILE_SERVER_URL_KEY });
    return value || null;
  } catch (error) {
    console.error("Error getting tile server URL:", error);
    return null;
  }
};

export const initializeTileServer = async (): Promise<string | null> => {
  try {
    // Get saved folder URI
    const { uri } = await OfflineTileServer.getSavedFolderUri();
    if (!uri) {
      return null;
    }

    // Get saved server URL
    const serverUrl = await getTileServerUrl();
    if (serverUrl) {
      // Server might already be running, try to verify
      return serverUrl;
    }

    // Start server with saved URI (useTms: false for XYZ format)
    const result = await OfflineTileServer.startTileServer({
      uri,
      useTms: false, // Change to true if your tiles use TMS format
    });
    await Preferences.set({
      key: TILE_SERVER_URL_KEY,
      value: result.baseUrl,
    });
    return result.baseUrl;
  } catch (error) {
    console.error("Error initializing tile server:", error);
    return null;
  }
};
