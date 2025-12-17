// @ts-nocheck
import { useState, useEffect } from "react";
import MapComponent from "./components/map";
import { SidebarProvider, SidebarTrigger } from "./components/ui/sidebar";
import { AppSidebar } from "./components/app-sidebar";
import LayersBox from "./components/map/layers-box";
import { toast } from "./lib/toast";
import { NativeUploader } from "./plugins/native-uploader";

const App = () => {
  const [isLayersPanelVisible, setIsLayersPanelVisible] = useState(false);
  const [isLayersBoxOpen, setIsLayersBoxOpen] = useState(false);

  // Cleanup untracked files on app startup
  useEffect(() => {
    const cleanupUntrackedFiles = async () => {
      const toastId = toast.loading("Setting Up App.");
      try {
        const { loadUntrackedFiles, clearUntracked } = await import(
          "./sessions/manifestStore"
        );
        const untrackedFiles = await loadUntrackedFiles();

        if (untrackedFiles.length > 0) {
          console.log(
            `[AppStartup] Found ${untrackedFiles.length} untracked file(s) to cleanup`
          );
          // Delete each file using plugin
          for (const file of untrackedFiles) {
            try {
              await NativeUploader.deleteFile({
                absolutePath: file.absolutePath,
              });
              console.log(
                `[AppStartup] Deleted untracked file: ${file.absolutePath}`
              );
            } catch (error) {
              console.warn(
                `[AppStartup] Failed to delete untracked file: ${file.absolutePath}`,
                error
              );
              // Continue with other files even if one fails
            }
          }

          // Clear untracked.json after cleanup
          await clearUntracked();
          console.log(`[AppStartup] Cleanup complete, cleared untracked.json`);
        }

        toast.dismiss(toastId);
      } catch (error) {
        console.error("[AppStartup] Error cleaning up untracked files:", error);
        toast.dismiss(toastId);
      }
    };

    cleanupUntrackedFiles();
  }, []);

  // Don't auto-load session on app start - user must press restore button
  // Session will only be restored when user explicitly clicks the restore button

  return (
    <SidebarProvider>
      {isLayersPanelVisible && (
        <div className="fixed top-4 left-4 z-50" style={{ zoom: 0.85 }}>
          <AppSidebar onClose={() => setIsLayersPanelVisible(false)} />
        </div>
      )}
      {isLayersBoxOpen && (
        <LayersBox onClose={() => setIsLayersBoxOpen(false)} />
      )}
      <MapComponent
        onToggleLayersBox={() => {
          setIsLayersBoxOpen((prev) => {
            // If opening layers box, we'll close others via callback
            return !prev;
          });
        }}
        onCloseLayersBox={() => setIsLayersBoxOpen(false)}
        isLayersBoxOpen={isLayersBoxOpen}
      />
    </SidebarProvider>
  );
};

export default App;
