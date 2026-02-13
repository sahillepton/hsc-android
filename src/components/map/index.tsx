import Map, { useControl, NavigationControl } from "react-map-gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { PickingInfo } from "@deck.gl/core";
import {
  BitmapLayer,
  GeoJsonLayer,
  IconLayer,
  LineLayer,
  PathLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer,
} from "@deck.gl/layers";
import unkinkPolygon from "@turf/unkink-polygon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import IconSelection from "./icon-selection";
import MeasurementBox from "./measurement-box";
import NetworkBox from "./network-box";
import ZoomControls from "./zoom-controls";
import Tooltip from "./tooltip";
import { useUdpLayers } from "./udp-layers";
import UdpConfigDialog from "./udp-config-dialog";
import OfflineLocationTracker from "./offline-location-tracker";
import { initializeTileServer } from "./tile-folder-dialog";
import {
  useRubberBandRectangle,
  useRubberBandOverlay,
  calculateRectangleBounds,
} from "./rubber-band-overlay";
import { useUdpConfigStore } from "@/store/udp-config-store";
// import { useDefaultLayers } from "@/hooks/use-default-layers";
import {
  useCurrentPath,
  useDragStart,
  useDrawingMode,
  useFocusLayerRequest,
  useIsDrawing,
  useLayers,
  useMousePosition,
  useNetworkLayersVisible,
  useHoverInfo,
  usePendingPolygon,
  useIgrsPreference,
  useSetIgrsPreference,
  useUserLocation,
} from "@/store/layers-store";
import {
  calculateBearingDegrees,
  calculateDistanceMeters,
  destinationPoint,
  generateLayerId,
  isPointNearFirstPoint,
  getPolygonCloseThreshold,
  normalizeAngleSigned,
  computePolygonAreaMeters,
  computePolygonPerimeterMeters,
  calculateLayerZoomRange,
} from "@/lib/layers";
import {
  formatArea,
  formatDistance,
  shpToGeoJSON,
  // fileToGeoJSON,
  // fileToDEMRaster,
  // generateRandomColor,
} from "@/lib/utils";
import type { LayerProps } from "@/lib/definitions";
import { toast } from "@/lib/toast";
import { NativeUploader } from "@/plugins/native-uploader";
import { Geolocation } from "@capacitor/geolocation";
import { ZipFolder } from "@/plugins/zip-folder";
import { Screenshot } from "@/plugins/screenshot";
import { Capacitor } from "@capacitor/core";
import { stagedPathToFile } from "@/utils/stagedPathToFile";
import { MAX_UPLOAD_FILES, HSC_FILES_DIR } from "@/sessions/constants";
import {
  upsertManifestEntry,
  finalizeSaveManifest,
  type ManifestEntry,
} from "@/sessions/manifestStore";
import {
  parseDemFile,
  createDemLayer,
  parseVectorFile,
  createVectorLayer,
} from "@/utils/parser";
import { generateRandomColor } from "@/lib/utils";

function DeckGLOverlay({ layers }: { layers: any[] }) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({}));
  useEffect(() => {
    overlay.setProps({ layers });
  }, [overlay, layers]);

  return null;
}

const MapComponent = ({
  onToggleLayersBox,
  onCloseLayersBox,
  isLayersBoxOpen,
}: {
  onToggleLayersBox?: () => void;
  onCloseLayersBox?: () => void;
  isLayersBoxOpen?: boolean;
}) => {
  const computeSegmentDistancesKm = useCallback((path: [number, number][]) => {
    if (!Array.isArray(path) || path.length < 2) return [] as number[];
    return path.slice(0, -1).map((point, idx) => {
      const next = path[idx + 1];
      return calculateDistanceMeters(point, next) / 1000;
    });
  }, []);

  const arePointsClose = useCallback(
    (a: [number, number], b: [number, number], thresholdMeters = 25) => {
      return calculateDistanceMeters(a, b) <= thresholdMeters;
    },
    []
  );

  const mapRef = useRef<any>(null);
  const zoomUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const zoomDebounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    (window as any).mapRef = mapRef;

    // Cleanup timeouts on unmount
    return () => {
      if (zoomUpdateTimeoutRef.current) {
        clearTimeout(zoomUpdateTimeoutRef.current);
      }
      if (zoomDebounceTimeoutRef.current) {
        clearTimeout(zoomDebounceTimeoutRef.current);
      }
    };
  }, []);

  // Detect Android tablet (or allow on any device with touch support for testing)
  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    const isAndroid = /android/.test(userAgent);
    const isMobile = /mobile/.test(userAgent);
    const screenWidth = window.innerWidth;

    // Consider it a tablet if Android and not mobile, or screen width > 600px
    // For now, allow on any device with touch support for testing
    const isTabletDevice =
      (isAndroid && !isMobile) ||
      (isAndroid && screenWidth > 600) ||
      "ontouchstart" in window;
    setIsAndroidTablet(isTabletDevice);
  }, []);

  // Reset view and restart tile server when app resumes from background
  useEffect(() => {
    let appStateListener: any;
    let visibilityListener: any;

    const setupAppLifecycle = async () => {
      try {
        // Try to use Capacitor App plugin if available
        const { App } = await import("@capacitor/app");

        // Listen for app state changes (foreground/background)
        appStateListener = await App.addListener(
          "appStateChange",
          async ({ isActive }) => {
            if (isActive) {
       
              const { initializeTileServer } = await import(
                "./tile-folder-dialog"
              );
              // Wait for permissions when app comes to foreground (user might have granted them)
              const url = await initializeTileServer(true);

              if (url) {
                // Force retry by clearing and resetting URL to trigger style reload
                setTileServerUrl(null);
                setTimeout(() => {
                  setTileServerUrl(url);
                }, 100);
              }

              // Reset view to India to force re-render
              if (mapRef.current) {
                setTimeout(() => {
                  handleResetHome();
                }, 100);
              }
            }
          }
        );
      } catch (error) {
        // Capacitor App plugin not available, use browser visibility API as fallback
        const handleVisibilityChange = async () => {
          if (!document.hidden) {
            // App came to foreground - restart tile server fresh

            const { initializeTileServer } = await import(
              "./tile-folder-dialog"
            );
            // Wait for permissions when app comes to foreground (user might have granted them)
            const url = await initializeTileServer(true);

            if (url) {
              // Force retry by clearing and resetting URL to trigger style reload
              setTileServerUrl(null);
              setTimeout(() => {
                setTileServerUrl(url);
              }, 100);
            }

            // Reset view to India to force re-render
            if (mapRef.current) {
              setTimeout(() => {
                handleResetHome();
              }, 100);
            }
          }
        };

        visibilityListener = handleVisibilityChange;
        document.addEventListener("visibilitychange", handleVisibilityChange);
      }
    };

    setupAppLifecycle();

    return () => {
      if (appStateListener) {
        appStateListener.remove();
      }
      if (visibilityListener) {
        document.removeEventListener("visibilitychange", visibilityListener);
      }
    };
  }, []);

  // Show UDP config dialog on app start (only once) if no config exists
  useEffect(() => {
    const hasShownConfig = sessionStorage.getItem("udp-config-shown");
    const { host, port } = useUdpConfigStore.getState();
    // Only auto-show if we haven't shown it before AND no config is set
    if (!hasShownConfig && (!host || !host.trim() || !port || port <= 0)) {
      setIsUdpConfigDialogOpen(true);
      sessionStorage.setItem("udp-config-shown", "true");
    }
  }, []);

  const { networkLayersVisible } = useNetworkLayersVisible();
  const { dragStart, setDragStart } = useDragStart();
  const { mousePosition, setMousePosition } = useMousePosition();
  const { layers, addLayer, setLayers } = useLayers();
  // const { setNodeIconMappings } = useNodeIconMappings();
  const { focusLayerRequest, setFocusLayerRequest } = useFocusLayerRequest();
  const { drawingMode } = useDrawingMode();
  const { isDrawing, setIsDrawing } = useIsDrawing();
  const { currentPath, setCurrentPath } = useCurrentPath();
  const { hoverInfo, setHoverInfo } = useHoverInfo();
  const { pendingPolygonPoints, setPendingPolygonPoints } = usePendingPolygon();
  const useIgrs = useIgrsPreference();
  const setUseIgrs = useSetIgrsPreference();
  const {
    userLocation,
    showUserLocation,
    setShowUserLocation,
    setUserLocation,
  } = useUserLocation();
  const previousDrawingModeRef = useRef(drawingMode);

  // const { nodeCoordinatesData, setNodeCoordinatesData } =
  //   useProgressiveNodes(networkLayersVisible);
  const [isMapEnabled] = useState(true);
  const [pitch, setPitch] = useState(0);
  const [rubberBandMode, setRubberBandMode] = useState(false);
  const [isRubberBandDrawing, setIsRubberBandDrawing] = useState(false);
  const [isRubberBandZooming, setIsRubberBandZooming] = useState(false);
  const [rubberBandStart, setRubberBandStart] = useState<
    [number, number] | null
  >(null);
  const [rubberBandEnd, setRubberBandEnd] = useState<[number, number] | null>(
    null
  );
  const [isAndroidTablet, setIsAndroidTablet] = useState(false);
  const [rubberBandToastId, setRubberBandToastId] = useState<string | null>(
    null
  );

  const [selectedNodeForIcon, setSelectedNodeForIcon] = useState<string | null>(
    null
  );
  const [mapZoom, setMapZoom] = useState(4);
  const [mapBearing, setMapBearing] = useState(0);
  const [isUdpConfigDialogOpen, setIsUdpConfigDialogOpen] = useState(false);
  const [configKey, setConfigKey] = useState(0);
  const [showConnectionError, setShowConnectionError] = useState(false);
  const [isCameraPopoverOpen, setIsCameraPopoverOpen] = useState(false);
  const [isMeasurementBoxOpen, setIsMeasurementBoxOpen] = useState(false);
  const [isNetworkBoxOpen, setIsNetworkBoxOpen] = useState(false);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [tileServerUrl, setTileServerUrl] = useState<string | null>(null);
  const lastLayerCreationTimeRef = useRef<number>(0);

  // Initialize tile server on mount and set up fetch interceptor for tile logging
  useEffect(() => {
    const initServer = async () => {
      // Wait for permissions on initial load (user might need to grant them)
      const url = await initializeTileServer(true);
      if (url) {
        setTileServerUrl(url);

        // Intercept fetch requests to log tile requests with x, y, z values
        const originalFetch = window.fetch;
        window.fetch = async function (...args) {
          const url = args[0]?.toString() || "";
          const tileMatch = url.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf/);

          if (tileMatch) {
            const [, z, x, y] = tileMatch;


            try {
              const response = await originalFetch.apply(this, args);
              if (!response.ok) {
                console.error(
                  `CAPACITOR_HAHA [Tile Request] FAILED: z=${z}, x=${x}, y=${y} - Status: ${response.status} ${response.statusText}`
                );
              } else {
                
              }
              return response;
            } catch (error) {
              console.error(
                `CAPACITOR_HAHA [Tile Request] ERROR: z=${z}, x=${x}, y=${y} -`,
                error
              );
              throw error;
            }
          }

          return originalFetch.apply(this, args);
        };
      }
    };

    initServer();

    // Cleanup: restore original fetch on unmount
    return () => {
      // Note: We can't easily restore fetch without storing the original,
      // but this is fine as it only runs once on mount
    };
  }, []);

  // Reload style when tileServerUrl changes (after map is loaded)
  useEffect(() => {
    if (!tileServerUrl || !mapRef.current) return;

    const map = mapRef.current.getMap();
    if (!map || !map.loaded()) return;

    // Load style from URL
    const styleUrl = `${tileServerUrl}/style.json`;

    try {
      // Fetch style.json to modify it
      fetch(styleUrl)
        .then(async (response) => {
          // If 404, check permissions and retry once
          if (response.status === 404) {
            console.warn(
              "[Map] style.json not found (404), checking permissions..."
            );
            const { checkStoragePermission, waitForStoragePermission } =
              await import("./tile-folder-dialog");
            const hasPermission = await checkStoragePermission();
            if (!hasPermission) {
              const granted = await waitForStoragePermission(5000); // Wait 5 seconds
              if (granted) {
                // Retry fetch
                const retryResponse = await fetch(styleUrl);
                if (retryResponse.ok) {
                  return retryResponse.json();
                }
              }
            }
            // If still 404 or no permission, throw error
            throw new Error(
              `style.json not found (404) - Check if file exists in Documents/tiles/ and permissions are granted`
            );
          }
          if (!response.ok) {
            throw new Error(`Failed to fetch style.json: ${response.status}`);
          }
          return response.json();
        })
        .then((styleJson) => {
          // Force ALL tile URLs to point to tile server
          if (styleJson.sources) {
            Object.keys(styleJson.sources).forEach((sourceKey) => {
              const source = styleJson.sources[sourceKey];
              if (source.type === "vector" && source.tiles) {
            
                source.tiles = source.tiles.map((tileUrl: string) => {
                  // Extract the tile path (e.g., /3/5/3.pbf from any URL format)
                  let tilePath = tileUrl;

                  // If it's an absolute URL, extract the path
                  try {
                    const url = new URL(tilePath);
                    tilePath = url.pathname;
                  } catch {
                    // Not a valid URL, might be relative or template
                  }

                  // Handle Mapbox tile URL templates like {z}/{x}/{y}.pbf
                  // If it's a template, keep it but ensure it points to our server
                  if (
                    tilePath.includes("{z}") ||
                    tilePath.includes("{x}") ||
                    tilePath.includes("{y}")
                  ) {
                    // Template format - ensure it starts with / and use our server
                    if (!tilePath.startsWith("/")) {
                      tilePath = "/" + tilePath;
                    }
                    return `${tileServerUrl}${tilePath}`;
                  }

                  // Regular tile path - ensure it starts with /
                  if (!tilePath.startsWith("/")) {
                    tilePath = "/" + tilePath;
                  }

                  // Always use tile server URL
                  const finalUrl = `${tileServerUrl}${tilePath}`;
               
                  return finalUrl;
                });
         
              }
            });
          }

          // Convert relative glyphs URL to absolute URL
          if (styleJson.glyphs && typeof styleJson.glyphs === "string") {
            if (styleJson.glyphs.startsWith("/")) {
              styleJson.glyphs = `${tileServerUrl}${styleJson.glyphs}`;
            }
          } else if (
            styleJson.layers &&
            styleJson.layers.some(
              (layer: any) => layer.layout && layer.layout["text-field"]
            )
          ) {
            // If glyphs is missing but text layers exist, set default glyphs path
            styleJson.glyphs = `${tileServerUrl}/fonts/{fontstack}/{range}.pbf`;
          }

          // Apply the modified style
          map.setStyle(styleJson);
        })
        .catch((error) => {
          console.error("[Map] Failed to fetch and apply style:", error);
        });
    } catch (error) {
      console.error("[Map] Error reloading style:", error);
    }

    map.once("style.load", () => {

      // Force update all tile source URLs to point to tile server
      const currentStyle = map.getStyle();
      if (currentStyle && currentStyle.sources) {
        Object.keys(currentStyle.sources).forEach((sourceKey) => {
          const source = map.getSource(sourceKey);
          if (source) {
            const sourceData = source as any;
            if (sourceData.type === "vector" && sourceData.tiles) {
             

              // Update tiles to point to tile server
              const updatedTiles = sourceData.tiles.map((tileUrl: string) => {
                let tilePath = tileUrl;

                // Extract path from absolute URL
                try {
                  const url = new URL(tilePath);
                  tilePath = url.pathname;
                } catch {
                  // Not a valid URL
                }

                // Handle template format
                if (
                  tilePath.includes("{z}") ||
                  tilePath.includes("{x}") ||
                  tilePath.includes("{y}")
                ) {
                  if (!tilePath.startsWith("/")) {
                    tilePath = "/" + tilePath;
                  }
                  return `${tileServerUrl}${tilePath}`;
                }

                // Regular path
                if (!tilePath.startsWith("/")) {
                  tilePath = "/" + tilePath;
                }

                return `${tileServerUrl}${tilePath}`;
              });

              // Update the source with new tile URLs
              try {
                map.removeSource(sourceKey);
                map.addSource(sourceKey, {
                  type: "vector",
                  tiles: updatedTiles,

                  minzoom: 0,
                  maxzoom: 18, // camera zoom allowed
                  maxNativeZoom: 14, // 🔥 THIS IS THE KEY
                });
               
              } catch (e) {
                console.error(`[Map] Failed to update source ${sourceKey}:`, e);
              }
            } else {
              
            }
          }
        });
      }
    });

    map.once("style.error", (e: any) => {
      console.error("[Map] Failed to reload style:", e);
    });
  }, [tileServerUrl]);

  // COMMENTED OUT: Not using HTML file input anymore - using NativeUploader directly
  // const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (isProcessingFiles) {
      return; // Prevent multiple uploads while processing
    }
    setIsProcessingFiles(true);
    const toastId = toast.loading("Opening file picker...");
    let progressListener: { remove: () => void } | null = null;

    try {
      // Set up progress listener for upload
      let currentUploadProgress = 0;
      try {
        progressListener = await NativeUploader.addListener(
          "uploadProgress",
          (event) => {
            if (event.totalBytes > 0) {
              currentUploadProgress = Math.round(
                (event.bytesWritten / event.totalBytes) * 100
              );
        
              toast.update(
                toastId,
                `Uploading File: ${currentUploadProgress}/100 %`,
                "loading"
              );
            }
          }
        );
      } catch (listenerError) {
        console.warn(
          "[FileUpload] Failed to add progress listener:",
          listenerError
        );
        // Continue without progress listener
      }

;
      const result = await NativeUploader.pickAndStageMany({
        maxFiles: MAX_UPLOAD_FILES,
      });

      if (progressListener) {
        await progressListener.remove();
      }

      if (!result.files || result.files.length === 0) {
        toast.update(toastId, "No files selected", "error");
        return;
      }

      // Track if any files were actually valid
      let hasValidFiles = false;

      // Process files sequentially
      for (let i = 0; i < result.files.length; i++) {
        const stagedFile = result.files[i];
        const fileNum = i + 1;

        try {
          // Step 1: Check if file extension is allowed
          const { isFileExtensionAllowed, getBlockedFileMessage } =
            await import("@/lib/allowed-file-extensions");
          if (!isFileExtensionAllowed(stagedFile.originalName)) {
            toast.update(
              toastId,
              getBlockedFileMessage(stagedFile.originalName),
              "error"
            );
            continue; // Skip this file
          }

          // Don't set hasValidFiles here - only set it after successfully processing a file
          // This prevents empty ZIPs from being counted as valid

          // Step 2: Wait a bit for file to be fully written to disk
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Step 3: Check file size before reading (prevent memory issues)
          const fileSizeMB = stagedFile.size / (1024 * 1024);
          if (fileSizeMB > 500) {
            toast.update(
              toastId,
              `File ${
                stagedFile.originalName
              } is too large (${fileSizeMB.toFixed(
                2
              )} MB). Maximum size is 500 MB.`,
              "error"
            );
            continue; // Skip this file
          }

          // Step 3: Convert staged file to File object (with error handling and timeout)
          let file: File;
          try {
            file = await Promise.race([
              stagedPathToFile({
                absolutePath: stagedFile.absolutePath,
                originalName: stagedFile.originalName,
                mimeType: stagedFile.mimeType,
              }),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error("File read timeout (30 seconds)")),
                  30000
                )
              ),
            ]);
          } catch (fileError) {
            console.error("[FileUpload] Error reading file:", fileError);
            const errorMsg =
              fileError instanceof Error ? fileError.message : "Unknown error";
            toast.update(
              toastId,
              `Error reading file ${stagedFile.originalName}: ${errorMsg}`,
              "error"
            );
            continue; // Skip this file and move to next
          }

          // Step 4: Check if file is ZIP and handle accordingly
          const fileNameLower = stagedFile.originalName.toLowerCase();
          const isZip = fileNameLower.endsWith(".zip");

          if (isZip) {

            const extractToastId = toast.loading(
              `Extracting ZIP: ${stagedFile.originalName}...`
            );

            try {
              // Use native plugin to extract ZIP recursively
              const extractResult = await ZipFolder.extractZipRecursive({
                zipPath: stagedFile.absolutePath,
                outputDir: HSC_FILES_DIR,
              });

            
              if (extractResult.files.length === 0) {
                toast.dismiss(extractToastId);
                toast.update(
                  extractToastId,
                  "ZIP file is empty or contains no valid files. Only GIS-related files are allowed.",
                  "error"
                );
                // Don't mark as valid - continue to next file
                continue; // Skip this ZIP file
              }

              toast.update(
                extractToastId,
                `Found ${extractResult.files.length} file(s), processing...`,
                "loading"
              );

              // Track if any valid files were found in ZIP
              let hasValidFilesInZip = false;

              // Process each extracted file sequentially
              for (
                let zipFileIdx = 0;
                zipFileIdx < extractResult.files.length;
                zipFileIdx++
              ) {
                const extractedFile = extractResult.files[zipFileIdx];
                const zipFileNum = zipFileIdx + 1;

                // Check if extracted file extension is allowed
                const { isFileExtensionAllowed } = await import(
                  "@/lib/allowed-file-extensions"
                );
                if (!isFileExtensionAllowed(extractedFile.name)) {
            
                  // Delete the extracted file since we don't want to store it
                  try {
                    await NativeUploader.deleteFile({
                      absolutePath: extractedFile.absolutePath,
                    });
                  } catch (deleteError) {
                    console.warn(
                      `[FileUpload] Failed to delete blocked file: ${extractedFile.name}`,
                      deleteError
                    );
                  }
                  continue; // Skip this file
                }

                hasValidFilesInZip = true; // Mark that we have at least one valid file in ZIP

                try {
                  // Add to manifest
                  const layerId = generateLayerId();
                  const layerName = extractedFile.name.split(".")[0];
                  await upsertManifestEntry({
                    layerId: layerId,
                    layerName: layerName,
                    path: `DOCUMENTS/${HSC_FILES_DIR}/${extractedFile.name}`,
                    absolutePath: extractedFile.absolutePath,
                    originalName: extractedFile.name,
                    size: extractedFile.size,
                    status: "staged",
                    type: extractedFile.type as "tiff" | "vector" | "shapefile",
                    createdAt: Date.now(),
                  });

                  // Create progress toast for this file
                  const progressToastId = toast.loading(
                    `Processing ${zipFileNum}/${extractResult.files.length}: ${extractedFile.name}...`
                  );

                  // Convert absolute path to File object for parsing
                  const file = await stagedPathToFile({
                    absolutePath: extractedFile.absolutePath,
                    originalName: extractedFile.name,
                    mimeType:
                      extractedFile.type === "tiff"
                        ? "image/tiff"
                        : "application/octet-stream",
                  });

                  if (extractedFile.type === "tiff") {
                    // Process DEM file
                    const demResult = await parseDemFile(file, {
                      layerId: layerId,
                      layerName: layerName,
                      onProgress: (percent) => {
                        toast.update(
                          progressToastId,
                          `Processing ${zipFileNum}/${extractResult.files.length}: ${extractedFile.name} (${percent}%)`,
                          "loading"
                        );
                      },
                    });

                    const newLayer = createDemLayer(demResult, {
                      layerId: layerId,
                      layerName: layerName,
                    });
                    addLayer(newLayer);
                    // Update manifest with layer color
                    const { updateManifestColor } = await import(
                      "@/sessions/manifestStore"
                    );
                    await updateManifestColor(layerId, newLayer.color);

                    toast.update(
                      progressToastId,
                      `DEM: ${extractedFile.name}`,
                      "success"
                    );
                    hasValidFiles = true; // Mark that we have at least one valid file overall
                  } else if (
                    extractedFile.type === "vector" ||
                    extractedFile.type === "shapefile"
                  ) {
                    // Process vector file
                    const vectorResult = await parseVectorFile(file, {
                      layerId: layerId,
                      layerName: layerName,
                      generateRandomColor,
                      onProgress: (percent) => {
                        toast.update(
                          progressToastId,
                          `Processing ${zipFileNum}/${extractResult.files.length}: ${extractedFile.name} (${percent}%)`,
                          "loading"
                        );
                      },
                    });

                    const newLayer = createVectorLayer(vectorResult, {
                      layerId: layerId,
                      layerName: layerName,
                      generateRandomColor,
                    });
                    addLayer(newLayer);
                    // Update manifest with layer color
                    const { updateManifestColor } = await import(
                      "@/sessions/manifestStore"
                    );
                    await updateManifestColor(layerId, newLayer.color);

                    toast.update(
                      progressToastId,
                      `Vector: ${extractedFile.name}`,
                      "success"
                    );
                    hasValidFiles = true; // Mark that we have at least one valid file overall
                  }

                  // Small delay between files
                  await new Promise((resolve) => setTimeout(resolve, 100));
                } catch (fileError) {
                  console.error(
                    `[FileUpload] Error processing extracted file ${extractedFile.name}:`,
                    fileError
                  );
                  toast.error(
                    `Error processing ${extractedFile.name}: ${
                      fileError instanceof Error
                        ? fileError.message
                        : "Unknown error"
                    }`
                  );
                }
              }

              // Check if ZIP contained any valid files
              if (!hasValidFilesInZip) {
                toast.dismiss(extractToastId);
                toast.update(
                  extractToastId,
                  "ZIP file contains no valid files. Only GIS-related files are allowed.",
                  "error"
                );
                continue; // Skip to next file
              }

              // Only show success if we actually processed valid files
              if (hasValidFilesInZip) {
                toast.dismiss(extractToastId);
                toast.success(
                  `Successfully processed files from ZIP: ${stagedFile.originalName}`
                );
              }

              // Delete the original ZIP file after extraction
              try {
                await NativeUploader.deleteFile({
                  absolutePath: stagedFile.absolutePath,
                });
  
              } catch (deleteError) {
                console.warn(
                  `[FileUpload] Failed to delete original ZIP file:`,
                  deleteError
                );
              }
            } catch (zipError) {
              console.error(
                `[FileUpload] Error extracting ZIP file:`,
                zipError
              );
              toast.dismiss(extractToastId);
              toast.update(
                extractToastId,
                `Error extracting ZIP: ${
                  zipError instanceof Error ? zipError.message : "Unknown error"
                }`,
                "error"
              );
              // Don't mark as valid - continue to next file
              continue; // Skip this ZIP file on error
            }
          } else {
            // Handle regular (non-ZIP) file
            // Add to manifest first (before parsing to avoid losing track if parsing fails)
            const layerId = generateLayerId();
            const layerName = stagedFile.originalName.split(".")[0];
            const logicalPath = stagedFile.logicalPath;
            const manifestEntry: ManifestEntry = {
              layerId,
              layerName,
              path: logicalPath,
              absolutePath: stagedFile.absolutePath,
              originalName: stagedFile.originalName,
              mimeType: stagedFile.mimeType,
              size: stagedFile.size,
              status: "staged",
              createdAt: Date.now(),
            };


            try {
              await upsertManifestEntry(manifestEntry);
            } catch (manifestError) {
              console.error(
                `[FileUpload] Error adding to manifest:`,
                manifestError
              );
              toast.update(
                toastId,
                `Error adding file to manifest: ${
                  manifestError instanceof Error
                    ? manifestError.message
                    : "Unknown error"
                }`,
                "error"
              );
              // Continue - still try to render the file even if manifest fails
            }

            const vectorExtensions = [
              "geojson",
              "json",
              "csv",
              "gpx",
              "kml",
              "kmz",
              "wkt",
              "shp",
            ];
            const rasterExtensions = ["tif", "tiff", "hgt", "dett"];

            let ext = "";
            if (fileNameLower.endsWith(".geojson")) {
              ext = "geojson";
            } else if (
              fileNameLower.endsWith(".tiff") ||
              fileNameLower.endsWith(".tif")
            ) {
              ext = fileNameLower.endsWith(".tiff") ? "tiff" : "tif";
            } else {
              const parts = fileNameLower.split(".");
              ext = parts.length > 1 ? parts[parts.length - 1] : "";
            }

            const isRaster = rasterExtensions.includes(ext);
            const isVector = vectorExtensions.includes(ext);

            if (!isRaster && !isVector) {
              console.error(`[FileUpload] Unsupported file type: ${ext}`);
              toast.update(toastId, `Unsupported file type: ${ext}`, "error");
              continue;
            }

            const renderToastId = toast.loading(
              `Rendering File ${fileNum} (${stagedFile.originalName}): 0/100 %`
            );

            try {

              if (isRaster) {
                const demResult = await parseDemFile(file, {
                  layerId,
                  layerName,
                  onProgress: (percent) => {
                    toast.update(
                      renderToastId,
                      `Rendering File ${fileNum} (${stagedFile.originalName}): ${percent}/100 %`,
                      "loading"
                    );
                  },
                });
                const newLayer = createDemLayer(demResult, {
                  layerId,
                  layerName,
                });
                addLayer(newLayer);
                // Update manifest with layer color
                const { updateManifestColor } = await import(
                  "@/sessions/manifestStore"
                );
                await updateManifestColor(layerId, newLayer.color);
              } else {
                const featureCollection = await parseVectorFile(file, {
                  layerId,
                  layerName,
                  generateRandomColor,
                  onProgress: (percent) => {
                    toast.update(
                      renderToastId,
                      `Rendering File ${fileNum} (${stagedFile.originalName}): ${percent}/100 %`,
                      "loading"
                    );
                  },
                });
                const newLayer = createVectorLayer(featureCollection, {
                  layerId,
                  layerName,
                  generateRandomColor,
                });
                addLayer(newLayer);
                // Update manifest with layer color
                const { updateManifestColor } = await import(
                  "@/sessions/manifestStore"
                );
                await updateManifestColor(layerId, newLayer.color);
              }

              toast.update(
                renderToastId,
                "File Rendered Successfully",
                "success"
              );
              hasValidFiles = true; // Mark that we have at least one valid file
              await new Promise((resolve) => setTimeout(resolve, 1000));
              toast.dismiss(renderToastId);
            } catch (renderError) {
              console.error("[FileUpload] Error rendering file:", renderError);
              toast.update(
                renderToastId,
                `Error rendering: ${
                  renderError instanceof Error
                    ? renderError.message
                    : "Unknown error"
                }`,
                "error"
              );
              // Don't throw - continue with next file
            }
          }
        } catch (fileError) {
          console.error(
            `[FileUpload] Error processing file ${fileNum}:`,
            fileError
          );
          toast.update(
            toastId,
            `Error processing file ${fileNum}: ${
              fileError instanceof Error ? fileError.message : "Unknown error"
            }`,
            "error"
          );
          // Continue with next file
        }
      }

      // Check if any files were actually valid
      if (!hasValidFiles) {
        toast.update(
          toastId,
          "No valid files found. Only GIS-related files are allowed.",
          "error"
        );
        return;
      }

      toast.update(
        toastId,
        `Successfully uploaded and rendered file(s)`,
        "success"
      );
    } catch (error) {
      console.error("[FileUpload] Error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      
      // Check if user cancelled - show notification toast instead of error
      if (
        errorMessage.toLowerCase().includes("user cancelled") ||
        errorMessage.toLowerCase().includes("user canceled") ||
        errorMessage.toLowerCase().includes("cancelled") ||
        errorMessage.toLowerCase().includes("canceled")
      ) {
        toast.update(toastId, "File selection cancelled", "notification");
        // Auto-dismiss notification toast after 5 seconds
        setTimeout(() => {
          toast.dismiss(toastId);
        }, 5000);
      } else {
        toast.update(toastId, `Error: ${errorMessage}`, "error");
      }
    } finally {
      // Always try to remove progress listener if it exists
      if (progressListener) {
        try {
          progressListener.remove();

        } catch (removeError) {
          console.warn(
            "[FileUpload] Error removing progress listener in finally:",
            removeError
          );
        }
      }
      // Always reset processing state
      setIsProcessingFiles(false);
    }
  };

  // Export layers based on tempManifest
  const handleExportLayers = async () => {
    setIsExporting(true);
    const toastId = toast.loading("Exporting layers...");
    try {
      // Get tempManifest and filter for staged/saved entries
      const { getTempManifest } = await import("@/sessions/manifestStore");
      const tempManifest = getTempManifest();
      const filesToExport = tempManifest.filter(
        (entry) => entry.status === "staged" || entry.status === "saved"
      );

      // Check if there's anything to export
      if (filesToExport.length === 0) {
        toast.update(toastId, "Nothing to download.", "error");
        return;
      }

      // Prepare manifest file entries for Android
      const manifestFiles = filesToExport.map((entry) => ({
        absolutePath: entry.absolutePath,
        originalName: entry.originalName,
        layerId: entry.layerId,
        layerName: entry.layerName,
        size: entry.size,
      }));



      // Call Android plugin to create ZIP
      const { ZipFolder } = await import("@/plugins/zip-folder");
      const result = await ZipFolder.zipManifestFiles({
        files: manifestFiles,
      });

      toast.update(
        toastId,
        `GIS data exported to Documents: ${result.fileName}`,
        "success"
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      if (errorMessage === "NOTHING_TO_DOWNLOAD") {
        toast.update(toastId, "Nothing to download.", "error");
      } else {
        toast.update(toastId, `Failed to export: ${errorMessage}`, "error");
      }
    } finally {
      setIsExporting(false);
    }
  };

  // Save session manually
  const handleSaveSession = async () => {
    const toastId = toast.loading("Saving session...");
    try {

      // Early validation: Check if there's anything to save
      const { getTempManifest } = await import("@/sessions/manifestStore");
      const { isSketchLayer } = await import("@/lib/sketch-layers");

      const tempManifest = getTempManifest();
      const sketchLayers = layers.filter(isSketchLayer);

      // If both tempManifest and sketch layers are empty, stop everything
      if (tempManifest.length === 0 && sketchLayers.length === 0) {
        toast.update(toastId, "Nothing to save", "error");
        return; // Early return - stops all further flow
      }

      // First, check if manifest exists and what it contains
      // const { loadManifest } = await import("@/sessions/manifestStore");
      // const beforeManifest = await loadManifest();


      // Step 7 & 8: Finalize manifest according to system design:
      // - Sort all layers in manifest by size (increasing order)
      // - Upgrade "staged" files to "saved" status
      // - Delete "staged_delete" files from files folder
      // - Remove "staged_delete" entries from manifest
      const finalizedEntries = await finalizeSaveManifest();
 
      // Save sketch layers as ZIP file in HSC-SESSIONS/FILES folder
      // Note: sketchLayers already filtered above in early validation
      const { HSC_FILES_DIR } = await import("@/sessions/constants");
      const { Filesystem } = await import("@capacitor/filesystem");
      const sketchLayersPath = `${HSC_FILES_DIR}/sketch_layers.zip`;

      if (sketchLayers.length > 0) {

        const { saveLayers } = await import("@/lib/autosave");
        const { Directory } = await import("@capacitor/filesystem");
        await saveLayers(sketchLayers, sketchLayersPath, Directory.Documents);
      } else {
        // Delete sketch_layers.zip if no sketch layers exist (clear old sketch layers)
        try {
          const { Directory } = await import("@capacitor/filesystem");
          await Filesystem.deleteFile({
            path: sketchLayersPath,
            directory: Directory.Documents,
          });
    
        } catch (error) {
          // File might not exist, which is fine
        
        }
      }

      if (finalizedEntries.length === 0 && sketchLayers.length === 0) {
        console.warn("[SessionSave] No files or sketch layers in session!");
      }

      toast.update(toastId, `Session saved successfully.`, "success");
    } catch (error) {
      console.error("[SessionSave] Error:", error);
      toast.update(
        toastId,
        `Failed to save session: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        "error"
      );
    }
  };

  // Restore session manually (only when button is pressed)
  // Step 9: When user restores the session:
  // - Check manifest file
  // - Merge temp and stored manifest ensuring unique layer_id objects
  // - Restore "saved" files
  // - Restore sketch layers from ZIP
  const handleRestoreSession = async () => {
    if (isProcessingFiles) {
      return; // Prevent restore while processing
    }
    setIsProcessingFiles(true);
    const toastId = toast.loading("Restoring session...");
    try {
      // Restore: Merge temp manifest with stored manifest (ensures unique layer_id)
      const { restoreManifest } = await import("@/sessions/manifestStore");
      const mergedEntries = await restoreManifest();

      // Filter to only "saved" entries for rendering
      const savedEntries = mergedEntries.filter((x) => x.status === "saved");
  

      // Clear ALL current layers from UI - complete reset to saved state
      // Don't call deleteLayer() as it would delete "staged" files immediately
      // Just clear the UI - we'll restore everything from saved manifest
   
      setLayers([]); // Clear everything - complete reset

      // No existing layers after reset - all will be restored fresh
      const existingLayerIds = new Set<string>();

      // Restore layers from saved files (only if layer_id is unique)
      let restoredFileCount = 0;
      let restoredSketchCount = 0;
      for (let i = 0; i < savedEntries.length; i++) {
        const entry = savedEntries[i];

        // Skip if layer_id already exists (prevent duplicates)
        if (existingLayerIds.has(entry.layerId)) {
       
          continue;
        }

        const progressToastId = toast.loading(
          `Restoring File ${i + 1}/${savedEntries.length}: ${
            entry.originalName
          }`
        );

        try {
      

          // Check if this is a shapefile ZIP (stored as ZIP with type="shapefile")
          // Regular ZIP files should have been extracted, but shapefile ZIPs are stored as-is
          const isShapefileZip =
            entry.originalName.toLowerCase().endsWith(".zip") &&
            entry.type === "shapefile";

          // Skip non-shapefile ZIP files (they should have been extracted)
          if (
            entry.originalName.toLowerCase().endsWith(".zip") &&
            !isShapefileZip
          ) {
         
            toast.dismiss(progressToastId);
            continue;
          }

          // Convert absolute path to File object
          let file: File;
          try {
            file = await stagedPathToFile({
              absolutePath: entry.absolutePath,
              originalName: entry.originalName,
              mimeType: entry.mimeType || "application/octet-stream",
            });
          } catch (fileError) {
            // File doesn't exist (404) - skip it
            console.warn(
              `[SessionRestore] File not found (may have been deleted): ${entry.originalName} at ${entry.absolutePath}`
            );
            toast.update(
              progressToastId,
              `Skipping ${entry.originalName} (file not found)`,
              "error"
            );
            await new Promise((resolve) => setTimeout(resolve, 1000));
            toast.dismiss(progressToastId);
            continue;
          }

          // Determine file type
          const fileNameLower = entry.originalName.toLowerCase();
          const vectorExtensions = [
            "geojson",
            "json",
            "csv",
            "gpx",
            "kml",
            "kmz",
            "wkt",
            "shp",
            "zip",
          ];
          const rasterExtensions = ["tif", "tiff", "hgt", "dett"];

          let ext = "";
          if (fileNameLower.endsWith(".geojson")) {
            ext = "geojson";
          } else if (
            fileNameLower.endsWith(".tiff") ||
            fileNameLower.endsWith(".tif")
          ) {
            ext = fileNameLower.endsWith(".tiff") ? "tiff" : "tif";
          } else {
            const parts = fileNameLower.split(".");
            ext = parts.length > 1 ? parts[parts.length - 1] : "";
          }

          // Use type from manifest if available, otherwise determine from extension
          const isRaster =
            entry.type === "tiff" || rasterExtensions.includes(ext);
          const isVector =
            entry.type === "vector" || vectorExtensions.includes(ext);

          if (isRaster) {
            const demResult = await parseDemFile(file, {
              layerId: entry.layerId,
              layerName: entry.layerName,
              onProgress: (percent) => {
                toast.update(
                  progressToastId,
                  `Restoring File ${i + 1}/${
                    savedEntries.length
                  }: ${percent}/100 %`,
                  "loading"
                );
              },
            });
            const newLayer = createDemLayer(demResult, {
              layerId: entry.layerId,
              layerName: entry.layerName,
            });
            // Use createdAt from manifest instead of current time
            if (entry.createdAt) {
              (newLayer as any).uploadedAt = entry.createdAt;
            }
            // Use color from manifest if available
            if (entry.color) {
              newLayer.color = entry.color;
            }
            addLayer(newLayer);
            existingLayerIds.add(entry.layerId);
            restoredFileCount++;
          } else if (isShapefileZip) {
            // Explicitly handle shapefile ZIPs using shpToGeoJSON
    
            toast.update(
              progressToastId,
              `Restoring Shapefile ${i + 1}/${savedEntries.length}: ${
                entry.originalName
              }...`,
              "loading"
            );
            const featureCollection = await shpToGeoJSON(file);
            const newLayer = createVectorLayer(featureCollection, {
              layerId: entry.layerId,
              layerName: entry.layerName,
              generateRandomColor,
            });
            // Use createdAt from manifest instead of current time
            if (entry.createdAt) {
              (newLayer as any).uploadedAt = entry.createdAt;
            }
            // Use color from manifest if available
            if (entry.color) {
              newLayer.color = entry.color;
            }
            addLayer(newLayer);
            existingLayerIds.add(entry.layerId);
            restoredFileCount++;
          } else if (isVector) {
            // Process regular vector files
            const featureCollection = await parseVectorFile(file, {
              layerId: entry.layerId,
              layerName: entry.layerName,
              generateRandomColor,
              onProgress: (percent) => {
                toast.update(
                  progressToastId,
                  `Restoring File ${i + 1}/${
                    savedEntries.length
                  }: ${percent}/100 %`,
                  "loading"
                );
              },
            });
            const newLayer = createVectorLayer(featureCollection, {
              layerId: entry.layerId,
              layerName: entry.layerName,
              generateRandomColor,
            });
            // Use createdAt from manifest instead of current time
            if (entry.createdAt) {
              (newLayer as any).uploadedAt = entry.createdAt;
            }
            // Use color from manifest if available
            if (entry.color) {
              newLayer.color = entry.color;
            }
            addLayer(newLayer);
            existingLayerIds.add(entry.layerId);
            restoredFileCount++;
          }
          toast.dismiss(progressToastId);
        } catch (error) {
          console.error(
            `[SessionRestore] Error restoring file ${entry.originalName}:`,
            error
          );
          toast.update(
            progressToastId,
            `Error restoring ${entry.originalName}`,
            "error"
          );
        }
      }

      // Restore sketch layers from ZIP file
      // Note: All layers have already been cleared above, so no need to remove existing sketch layers

      try {
        const { HSC_FILES_DIR } = await import("@/sessions/constants");
        const { Filesystem, Directory, Encoding } = await import(
          "@capacitor/filesystem"
        );
        const sketchLayersPath = `${HSC_FILES_DIR}/sketch_layers.zip`;

        try {
          const result = await Filesystem.readFile({
            path: sketchLayersPath,
            directory: Directory.Documents,
            encoding: Encoding.UTF8,
          });

          const content = result.data;
          if (content && typeof content === "string" && content.trim() !== "") {
            // Convert base64 to blob
            const binaryString = atob(content);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: "application/zip" });

            // Load ZIP using JSZip
            const JSZip = (await import("jszip")).default;
            const zip = await JSZip.loadAsync(blob);

            // Read layers.json from ZIP
            const layersFile = zip.file("layers.json");
            if (layersFile) {
              const layersJson = await layersFile.async("string");
              const importData = JSON.parse(layersJson);

              if (importData.version && Array.isArray(importData.layers)) {
                // Deserialize sketch layers
                const { deserializeLayers } = await import("@/lib/autosave");
                const sketchLayers = await deserializeLayers(
                  importData.layers,
                  zip
                );

                // Use existingLayerIds that was tracking restored file layers
                // This ensures we don't duplicate layers that were already restored
                // existingLayerIds was populated when restoring file layers above

                // Add sketch layers ensuring unique layer_id
                for (const sketchLayer of sketchLayers) {
                  if (!existingLayerIds.has(sketchLayer.id)) {
                    addLayer(sketchLayer);
                    existingLayerIds.add(sketchLayer.id);
                    restoredSketchCount++;
                  }
                }
               
              }
            }
          }
        } catch (error) {
          // Sketch layers file doesn't exist, which is fine
          console.log(
            `[SessionRestore] No sketch layers file found (this is OK)`
          );
        }
      } catch (error) {
        console.warn(`[SessionRestore] Error restoring sketch layers:`, error);
      }

      const totalRestored = restoredFileCount + restoredSketchCount;
      if (totalRestored === 0 && savedEntries.length === 0) {
        toast.update(toastId, "No saved session data found", "error");
      } else {
        const parts: string[] = [];
        if (restoredFileCount > 0) {
          parts.push(`${restoredFileCount} file(s)`);
        }
        if (restoredSketchCount > 0) {
          parts.push(`${restoredSketchCount} sketch layer(s)`);
        }
        toast.update(
          toastId,
          `Restored ${parts.join(", ")} from session`,
          "success"
        );
      }
    } catch (error) {
      console.error("[SessionRestore] Error:", error);
      toast.update(
        toastId,
        `Failed to restore session: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        "error"
      );
    } finally {
      setIsProcessingFiles(false);
    }
  };

  // Reset to home view (India bounds with fixed zoom)
  const handleResetHome = () => {
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      // Reset to initial view state with fixed zoom level
      map.easeTo({
        center: [81.5, 20.5], // Center of India
        zoom: 3, // Fixed zoom level (same as initialViewState)
        pitch: 0,
        bearing: 0,
        duration: 1000,
      });
    }
  };

  // Capture screenshot and save to gallery
  const handleCaptureScreenshot = async () => {
    // Only work on native platform
    if (!Capacitor.isNativePlatform()) {
      toast.error("Screenshot is only available on native platforms");
      return;
    }

    try {
      const toastId = toast.loading("Capturing screenshot...");
      const result = await Screenshot.captureAndSave();
      toast.dismiss(toastId);

      if (result.success) {
        toast.success("Screenshot saved to gallery!");
      } else {
        toast.error(result.error || "Failed to save screenshot");
      }
    } catch (error) {
      console.error("Screenshot error:", error);
      toast.error("Failed to capture screenshot");
    }
  };

  // Toggle user location visibility and focus to location when enabling
  const handleToggleUserLocation = async () => {
    const willShow = !showUserLocation;
    setShowUserLocation(willShow);

    // If disabling location, just return
    if (!willShow) {
      return;
    }

    let toastId: string | null = null;

    try {
      // If we don't have location yet, fetch it and show loading toast
      if (!userLocation) {
        toastId = toast.loading("Fetching your location");

        // Request permissions first
        const permission = await Geolocation.requestPermissions();
        if (permission.location !== "granted") {
          if (toastId) toast.dismiss(toastId);
          toast.error("Location permission denied");
          setShowUserLocation(false);
          return;
        }

        // Get current position
        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
        });

        if (position?.coords) {
          const location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy || 0,
          };
          // Update location in store (this will trigger OfflineLocationTracker to start watching)
          setUserLocation(location);

          // Wait a bit for the location to be set in the store
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Zoom to location with smooth animation
          if (mapRef.current) {
            const map = mapRef.current.getMap();
            map.easeTo({
              center: [location.lng, location.lat],
              zoom: 14, // Fixed zoom level for better view
              duration: 1500, // Smooth animation over 1.5 seconds
            });
          }

          // Dismiss loading toast and show success
          if (toastId) {
            toast.update(toastId, "Location found", "success");
          }
        }
      } else {
        // We already have location, just zoom to it smoothly
        if (mapRef.current) {
          const map = mapRef.current.getMap();
          map.easeTo({
            center: [userLocation.lng, userLocation.lat],
            zoom: 14, // Fixed zoom level for better view
            duration: 1500, // Smooth animation over 1.5 seconds
          });
        }
      }
    } catch (error: any) {
      console.error("Location error:", error);
      if (toastId) toast.dismiss(toastId);
      toast.error(error.message || "Failed to get location");
      setShowUserLocation(false);
    }
  };

  const measurementPreview = useMemo(() => {
    if (!isDrawing) return null;

    if (drawingMode === "polyline" && currentPath.length >= 1) {
      // Only use committed points (currentPath), not the preview mouse position
      // This ensures we only show segments that are actually drawn
      const path = [...currentPath];
      if (path.length < 2) return null;

      const segmentDistances = computeSegmentDistancesKm(path);
      // Filter out segments with zero or invalid distance
      const validSegments = segmentDistances
        .map((dist, idx) => ({
          label: `Segment ${idx + 1}`,
          lengthKm: dist,
        }))
        .filter(
          (segment) => segment.lengthKm > 0 && Number.isFinite(segment.lengthKm)
        );

      const totalKm = validSegments.reduce(
        (sum, segment) => sum + segment.lengthKm,
        0
      );

      return {
        type: "polyline" as const,
        segments: validSegments,
        totalKm,
      };
    }

    if (drawingMode === "polygon") {
      const path = [...pendingPolygonPoints];
      if (mousePosition) path.push(mousePosition);
      if (path.length < 3) return null;
      const closedPath = [...path, path[0]];
      const areaMeters = computePolygonAreaMeters([closedPath]);
      const perimeterMeters = computePolygonPerimeterMeters([closedPath]);
      return {
        type: "polygon" as const,
        areaMeters,
        perimeterMeters,
      };
    }

    return null;
  }, [
    isDrawing,
    drawingMode,
    currentPath,
    mousePosition,
    pendingPolygonPoints,
    computeSegmentDistancesKm,
  ]);

  const polylinePreviewStats = useMemo(() => {
    if (!measurementPreview || measurementPreview.type !== "polyline") {
      return null;
    }
    const segments = measurementPreview.segments ?? [];
    if (!segments.length) return null;
    const max = Math.max(...segments.map((segment) => segment.lengthKm));
    const min = Math.min(...segments.map((segment) => segment.lengthKm));
    const avg =
      segments.reduce((sum, segment) => sum + segment.lengthKm, 0) /
      segments.length;
    return {
      count: segments.length,
      max,
      min,
      avg,
    };
  }, [measurementPreview]);

  // useEffect(() => {
  //   const loadNodeData = async () => {
  //     try {
  //       const coordinates: Array<{ lat: number; lng: number }[]> = [];

  //       // Load JSON files for each of the 8 nodes
  //       for (let i = 1; i <= 8; i++) {
  //         try {
  //           const response = await fetch(`/node-data/node-${i}.json`);
  //           if (!response.ok) {
  //             console.warn(
  //               `Failed to load node-${i}.json:`,
  //               response.statusText
  //             );
  //             continue;
  //           }
  //           const data = await response.json();
  //           if (Array.isArray(data) && data.length > 0) {
  //             coordinates.push(data);
  //
  //           }
  //         } catch (error) {
  //           console.error(`Error loading node-${i}.json:`, error);
  //         }
  //       }

  //       // Store all coordinates for each node
  //       if (coordinates.length === 8) {
  //         setNodeCoordinatesData(coordinates);
  //         console.log(
  //           "Loaded coordinates from JSON files:",
  //           coordinates.map((tab, idx) => `Node ${idx + 1}: ${tab.length} rows`)
  //         );
  //       } else {
  //         console.warn("Expected 8 node files, found:", coordinates.length);
  //         if (coordinates.length > 0) {
  //           // Use what we have
  //           setNodeCoordinatesData(coordinates);
  //         }
  //       }
  //     } catch (error) {
  //       console.error("Error loading node data files:", error);
  //     }
  //   };

  //   loadNodeData();
  // }, []);

  const createPointLayer = (position: [number, number]) => {
    const newLayer: LayerProps = {
      type: "point",
      id: generateLayerId(),
      name: `Point ${layers.filter((l) => l.type === "point").length + 1}`,
      position,
      color: [59, 130, 246], // Beautiful blue color
      radius: 5,
      visible: true,
    };
    addLayer(newLayer);
    lastLayerCreationTimeRef.current = Date.now();
    setHoverInfo(undefined); // Clear tooltip when creating a layer
  };

  const closeRing = (path: [number, number][]) => {
    if (!path.length) return path;
    const first = path[0];
    const last = path[path.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return path;
    return [...path, first];
  };

  const getUnkinkedRings = (polygon?: [number, number][][]) => {
    const ring = closeRing(polygon?.[0] ?? []);
    if (!ring.length) return [];
    try {
      const feature = unkinkPolygon({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [ring] },
      });
      return feature.features
        .filter((f) => f.geometry && f.geometry.type === "Polygon")
        .flatMap((f) =>
          (f.geometry as any).coordinates.map((coords: [number, number][]) =>
            closeRing(coords)
          )
        );
    } catch {
      return [ring];
    }
  };

  const handlePolygonDrawing = (point: [number, number]) => {
    //

    if (!isDrawing) {
      setCurrentPath([point]);
      setPendingPolygonPoints([point]);
      setIsDrawing(true);
      return;
    }

    const updatedPath = [...pendingPolygonPoints, point];
    setPendingPolygonPoints(updatedPath);
    setCurrentPath(updatedPath);

    // Get zoom-based threshold for closing polygon (optimized for zoom 18)
    const closeThreshold = getPolygonCloseThreshold(mapZoom);

    if (
      updatedPath.length >= 3 &&
      isPointNearFirstPoint(point, updatedPath[0], closeThreshold)
    ) {
      const closedPath = [...updatedPath.slice(0, -1), updatedPath[0]];
      const newLayer: LayerProps = {
        type: "polygon",
        id: generateLayerId(),
        name: `Polygon ${
          layers.filter((l) => l.type === "polygon").length + 1
        }`,
        polygon: [closedPath],
        color: [32, 32, 32, 180],
        visible: true,
      };
      addLayer(newLayer);
      lastLayerCreationTimeRef.current = Date.now();
      setHoverInfo(undefined); // Clear tooltip when creating a layer
      setCurrentPath([]);
      setPendingPolygonPoints([]);
      setIsDrawing(false);
    }
  };

  const finalizePolyline = useCallback(() => {
    if (!currentPath || currentPath.length < 2) {
      setCurrentPath([]);
      setIsDrawing(false);
      return;
    }

    const path = [...currentPath];
    const segmentDistancesKm = computeSegmentDistancesKm(path);
    const totalDistanceKm = segmentDistancesKm.reduce(
      (sum, dist) => sum + dist,
      0
    );

    const newLayer: LayerProps = {
      type: "line",
      id: generateLayerId(),
      name: `Path ${
        layers.filter(
          (l) => l.type === "line" && !(l.name || "").includes("Connection")
        ).length + 1
      }`,
      path,
      color: [68, 68, 68],
      lineWidth: 6,
      visible: false, // Hidden by default - user can toggle visibility in layers panel
      segmentDistancesKm,
      totalDistanceKm,
    };

    addLayer(newLayer);
    lastLayerCreationTimeRef.current = Date.now();
    setHoverInfo(undefined);
    setCurrentPath([]);
    setIsDrawing(false);
  }, [
    currentPath,
    computeSegmentDistancesKm,
    addLayer,
    layers,
    setCurrentPath,
    setIsDrawing,
    setHoverInfo,
  ]);

  const handlePolylineDrawing = useCallback(
    (point: [number, number]) => {
      if (!isDrawing) {
        setCurrentPath([point]);
        setIsDrawing(true);
        return;
      }

      const lastPoint = currentPath[currentPath.length - 1];
      if (
        lastPoint &&
        arePointsClose(lastPoint, point) &&
        currentPath.length >= 2
      ) {
        finalizePolyline();
        return;
      }

      setCurrentPath([...currentPath, point]);
    },
    [
      isDrawing,
      currentPath,
      setCurrentPath,
      setIsDrawing,
      arePointsClose,
      finalizePolyline,
    ]
  );

  const handleAzimuthalDrawing = (point: [number, number]) => {
    if (!isDrawing) {
      setCurrentPath([point]);
      setIsDrawing(true);
      return;
    }

    const center = currentPath[0];
    if (!center) {
      setIsDrawing(false);
      setCurrentPath([]);
      return;
    }

    const target = point;
    const distanceMeters = calculateDistanceMeters(center, target);
    const azimuthAngle = calculateBearingDegrees(center, target);
    const referenceDistance = Math.max(distanceMeters, 1000);
    const northPoint = destinationPoint(center, referenceDistance, 0);

    const azimuthCount = layers.filter((l) => l.type === "azimuth").length;
    const newLayer: LayerProps = {
      type: "azimuth",
      id: generateLayerId(),
      name: `Azimuth ${azimuthCount + 1}`,
      color: [59, 130, 246],
      visible: true,
      azimuthCenter: center,
      azimuthTarget: target,
      azimuthNorth: northPoint,
      azimuthAngleDeg: azimuthAngle,
      distanceMeters,
      lineWidth: 6,
    };

    addLayer(newLayer);
    lastLayerCreationTimeRef.current = Date.now();
    setHoverInfo(undefined);
    setCurrentPath([]);
    setIsDrawing(false);
  };

  useEffect(() => {
    const previousMode = previousDrawingModeRef.current;
    if (
      previousMode === "polygon" &&
      drawingMode !== "polygon" &&
      pendingPolygonPoints.length >= 3
    ) {
      const closedPath = [...pendingPolygonPoints, pendingPolygonPoints[0]];
      const newLayer: LayerProps = {
        type: "polygon",
        id: generateLayerId(),
        name: `Polygon ${
          layers.filter((l) => l.type === "polygon").length + 1
        }`,
        polygon: [closedPath],
        color: [32, 32, 32, 180],
        visible: false, // Hidden by default - user can toggle visibility in layers panel
      };
      addLayer(newLayer);
      lastLayerCreationTimeRef.current = Date.now();
      setHoverInfo(undefined); // Clear tooltip when creating a layer
      setPendingPolygonPoints([]);
      setCurrentPath([]);
      setIsDrawing(false);
    }

    // Clear polygon points if exiting with less than 3 points
    if (
      previousMode === "polygon" &&
      drawingMode !== "polygon" &&
      pendingPolygonPoints.length > 0 &&
      pendingPolygonPoints.length < 3
    ) {
      setPendingPolygonPoints([]);
      setCurrentPath([]);
    }

    if (
      previousMode === "polygon" &&
      drawingMode !== "polygon" &&
      pendingPolygonPoints.length === 0 &&
      currentPath.length > 0
    ) {
      setCurrentPath([]);
    }

    // Clear polyline path if exiting with less than 2 points
    if (
      previousMode === "polyline" &&
      drawingMode !== "polyline" &&
      currentPath.length > 0 &&
      currentPath.length < 2
    ) {
      setCurrentPath([]);
    }

    if (
      previousMode === "polyline" &&
      drawingMode !== "polyline" &&
      currentPath.length >= 2
    ) {
      finalizePolyline();
    }

    // Clear azimuth path if exiting with any points
    if (
      previousMode === "azimuthal" &&
      drawingMode !== "azimuthal" &&
      currentPath.length > 0
    ) {
      setCurrentPath([]);
      setIsDrawing(false);
    }

    // Initialize state when entering azimuth mode (clear any leftover state)
    if (
      previousMode !== "azimuthal" &&
      drawingMode === "azimuthal" &&
      (currentPath.length > 0 || isDrawing)
    ) {
      setCurrentPath([]);
      setIsDrawing(false);
    }

    previousDrawingModeRef.current = drawingMode;
  }, [
    drawingMode,
    pendingPolygonPoints,
    addLayer,
    layers,
    setPendingPolygonPoints,
    setCurrentPath,
    setIsDrawing,
    currentPath,
    finalizePolyline,
    isDrawing,
  ]);

  const handleClick = (event: any) => {
    if (!drawingMode) {
      return;
    }

    // Try to get coordinates from event.lngLat first
    let longitude: number | undefined;
    let latitude: number | undefined;

    if (event.lngLat) {
      longitude = event.lngLat.lng;
      latitude = event.lngLat.lat;
    } else if (event.point && mapRef.current) {
      // Fallback: unproject screen coordinates to geographic coordinates
      // This is needed when the map is tilted and lngLat might be undefined
      try {
        const map = mapRef.current.getMap();
        const coords = map.unproject(event.point);
        longitude = coords.lng;
        latitude = coords.lat;
      } catch (error) {
        console.error("Error unprojecting coordinates:", error);
        return;
      }
    } else {
      // If neither method works, return early
      console.warn("Could not determine click coordinates");
      return;
    }

    // Validate coordinates before proceeding
    if (
      typeof longitude !== "number" ||
      typeof latitude !== "number" ||
      isNaN(longitude) ||
      isNaN(latitude)
    ) {
      console.warn("Invalid coordinates:", { longitude, latitude });
      return;
    }

    const clickPoint: [number, number] = [longitude, latitude];

    switch (drawingMode) {
      case "point":
        createPointLayer(clickPoint);
        break;
      case "polyline":
        handlePolylineDrawing(clickPoint);
        break;
      case "polygon":
        handlePolygonDrawing(clickPoint);
        break;
      case "azimuthal":
        handleAzimuthalDrawing(clickPoint);
        break;
    }
  };

  const handleMapClick = (event: any) => {
    const { object } = event;

    // If clicking on empty space, close any open dialogs
    if (selectedNodeForIcon && !object) {
      setSelectedNodeForIcon(null);
    }

    // Close tooltip when clicking anywhere on the map
    setHoverInfo(undefined);

    // For other clicks, use the default handler
    handleClick(event);
  };
  useEffect(() => {
    if (!focusLayerRequest || !mapRef.current) {
      return;
    }

    const map = mapRef.current.getMap();
    let [minLng, minLat, maxLng, maxLat] = focusLayerRequest.bounds;
    const { center, isSinglePoint } = focusLayerRequest;

    // Validate and clamp bounds to valid ranges
    const clampLng = (lng: number) => {
      if (!Number.isFinite(lng)) return 0;
      // Normalize longitude to [-180, 180]
      while (lng > 180) lng -= 360;
      while (lng < -180) lng += 360;
      return lng;
    };

    const clampLat = (lat: number) => {
      if (!Number.isFinite(lat)) return 0;
      // Clamp latitude to [-90, 90]
      return Math.max(-90, Math.min(90, lat));
    };

    minLng = clampLng(minLng);
    maxLng = clampLng(maxLng);
    minLat = clampLat(minLat);
    maxLat = clampLat(maxLat);

    // Ensure bounds are valid (min < max)
    if (minLng > maxLng) {
      // Handle case where bounds cross the antimeridian
      // For large areas, we'll use a safe fallback
      const lngSpan = maxLng + 360 - minLng;
      if (lngSpan > 180) {
        // Bounds are too large, use center with appropriate zoom
        const centerLng = clampLng((minLng + maxLng) / 2);
        const centerLat = (minLat + maxLat) / 2;
        const currentZoom = map.getZoom();
        map.easeTo({
          center: [centerLng, centerLat],
          zoom: Math.min(currentZoom, 3), // Zoom out for very large areas
          duration: 800,
        });
        setFocusLayerRequest(null);
        return;
      }
    }

    // Ensure minimum span to avoid division by zero in fitBounds
    const lngSpan = maxLng - minLng;
    const latSpan = maxLat - minLat;
    if (lngSpan < 0.0001) maxLng = minLng + 0.0001;
    if (latSpan < 0.0001) maxLat = minLat + 0.0001;

    try {
      const currentZoom = map.getZoom();
      const currentCenter = map.getCenter();
      const centerLng = clampLng(center[0]);
      const centerLat = clampLat(center[1]);

      // Check if we're already focused on this location (within small threshold)
      const centerDistance = Math.sqrt(
        Math.pow(currentCenter.lng - centerLng, 2) +
          Math.pow(currentCenter.lat - centerLat, 2)
      );

      if (isSinglePoint) {
        // For single point, check if already focused
        const targetZoom = Math.min(Math.max(currentZoom, 12), 12);
        const zoomDiff = Math.abs(currentZoom - targetZoom);
        const isAlreadyFocused = centerDistance < 0.001 && zoomDiff < 0.5;

        if (isAlreadyFocused) {
          setFocusLayerRequest(null);
          return;
        }

        // Use flyTo for single point
        map.flyTo({
          center: [centerLng, centerLat],
          zoom: targetZoom,
          duration: 2000,
          curve: 1.2,
          speed: 1.2,
          essential: true,
        });
      } else {
        // For bounds, check if current view already contains the bounds
        const currentBounds = map.getBounds();
        const boundsContained =
          currentBounds.getWest() <= minLng &&
          currentBounds.getEast() >= maxLng &&
          currentBounds.getSouth() <= minLat &&
          currentBounds.getNorth() >= maxLat;
        
        // Calculate zoom based on bounding box size
        // Smaller bounding box = higher zoom, larger bounding box = lower zoom
        const lngSpan = maxLng - minLng;
        const latSpan = maxLat - minLat;
        const maxSpan = Math.max(lngSpan, latSpan);
        
        // Calculate appropriate maxZoom based on bounding box size
        // Formula: smaller span = higher zoom (up to 20), larger span = lower zoom (down to 3)
        let calculatedMaxZoom: number;
        if (maxSpan < 0.001) {
          // Very small area - zoom in very high
          calculatedMaxZoom = 20;
        } else if (maxSpan < 0.01) {
          // Small area - zoom in high
          calculatedMaxZoom = 18;
        } else if (maxSpan < 0.1) {
          // Medium area - moderate zoom
          calculatedMaxZoom = 15;
        } else if (maxSpan < 1) {
          // Large area - lower zoom
          calculatedMaxZoom = 12;
        } else if (maxSpan < 10) {
          // Very large area - even lower zoom
          calculatedMaxZoom = 8;
        } else {
          // Extremely large area - very low zoom
          calculatedMaxZoom = 5;
        }
        
        const zoomDiff = Math.abs(currentZoom - calculatedMaxZoom);
        const isAlreadyFocused = boundsContained && zoomDiff < 1;

        if (isAlreadyFocused) {
          setFocusLayerRequest(null);
          return;
        }

        // Use fitBounds with smooth animation to show the entire bounding box
        // Stop any ongoing animations first to prevent jitter
        map.stop();
        map.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          {
            padding: { top: 120, bottom: 120, left: 160, right: 160 },
            duration: 2000, // Smooth, slower duration
            maxZoom: calculatedMaxZoom, // Zoom based on bounding box size
            linear: false, // Use default easing (smooth)
          }
        );
      }
    } catch (error) {
      console.error("Failed to focus layer:", error);
      // Fallback: just center on the layer without zooming
      try {
        const centerLng = clampLng(center[0]);
        const centerLat = clampLat(center[1]);
        map.easeTo({
          center: [centerLng, centerLat],
          duration: 800,
        });
      } catch (fallbackError) {
        console.error("Fallback focus also failed:", fallbackError);
      }
    } finally {
      setFocusLayerRequest(null);
    }
  }, [focusLayerRequest]);

  // Close tooltip when the hovered layer becomes hidden
  useEffect(() => {
    if (!hoverInfo || !hoverInfo.object) {
      return;
    }

    // Check if hovered layer is a UDP layer (by checking layer ID)
    const hoveredLayerId = hoverInfo.layer?.id;
    if (
      hoveredLayerId &&
      (hoveredLayerId.includes("udp-") ||
        hoveredLayerId.includes("network-members") ||
        hoveredLayerId.includes("targets"))
    ) {
      // If UDP layers are hidden, clear the tooltip
      if (!networkLayersVisible) {
        setHoverInfo(undefined);
        return;
      }
    }

    // Find the layer ID from the hover info
    const hoveredObject = hoverInfo.object;
    let layerId: string | undefined;

    if ((hoveredObject as any)?.layerId) {
      layerId = (hoveredObject as any).layerId;
    } else if ((hoveredObject as any)?.id && (hoveredObject as any)?.type) {
      layerId = (hoveredObject as any).id;
    } else if (hoverInfo.layer?.id) {
      const deckLayerId = hoverInfo.layer.id;
      const matchingLayer = layers.find((l) => l.id === deckLayerId);
      layerId = matchingLayer?.id;
      if (!layerId) {
        const baseId = deckLayerId
          .replace(/-icon-layer$/, "")
          .replace(/-signal-overlay$/, "")
          .replace(/-bitmap$/, "");
        layerId = layers.find((l) => l.id === baseId)?.id;
      }
    }

    // Check if the hovered layer is now hidden or deleted
    if (layerId) {
      const hoveredLayer = layers.find((l) => l.id === layerId);
      if (!hoveredLayer || hoveredLayer.visible === false) {
        setHoverInfo(undefined);
      }
    }
  }, [layers, hoverInfo, setHoverInfo, networkLayersVisible]);

  const handleMouseMove = (event: any) => {
    if (!event.lngLat) return;

    const { lng: longitude, lat: latitude } = event.lngLat;
    const currentPoint: [number, number] = [longitude, latitude];
    setMousePosition(currentPoint);

    // Update rubber band end point if drawing (for mouse/touch support)
    if (isRubberBandDrawing && rubberBandStart) {
      setRubberBandEnd([longitude, latitude]);
      // Force re-render by updating state
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing || !dragStart) return;

    setIsDrawing(false);
    setDragStart(null);
  };

  // Handle mouse down for rubber band (for desktop testing and mouse support)
  const handleMouseDown = useCallback(
    (event: any) => {
      // Only activate when rubber band mode is on and no drawing mode is active
      if (!rubberBandMode || drawingMode || isDrawing) {
        return;
      }

      // Check if it's a left mouse button (not right click)
      if (
        event.originalEvent?.button !== 0 &&
        event.originalEvent?.button !== undefined
      ) {
        return;
      }

      const point = event.lngLat;
      if (!point) return;

      // Start rubber band selection
      setIsRubberBandDrawing(true);
      setRubberBandStart([point.lng, point.lat]);
      setRubberBandEnd([point.lng, point.lat]);
      setIsRubberBandZooming(false);

      // Prevent default map panning
      if (event.originalEvent) {
        event.originalEvent.preventDefault();
      }
    },
    [rubberBandMode, drawingMode, isDrawing]
  );

  // Handle mouse up for rubber band (for desktop testing)
  const handleMouseUpForRubberBand = useCallback(() => {
    if (!isRubberBandDrawing || !rubberBandStart || !rubberBandEnd) {
      return;
    }

    // Calculate minimum distance threshold (e.g., 0.001 degrees)
    const lngDiff = Math.abs(rubberBandEnd[0] - rubberBandStart[0]);
    const latDiff = Math.abs(rubberBandEnd[1] - rubberBandStart[1]);

    // Only zoom if selection is large enough (not just a click)
    if (lngDiff < 0.001 && latDiff < 0.001) {
      // Too small, cleanup
      setIsRubberBandDrawing(false);
      setRubberBandStart(null);
      setRubberBandEnd(null);
      return;
    }

    // Calculate bounding box
    const bounds = calculateRectangleBounds(rubberBandStart, rubberBandEnd);
    if (!bounds) {
      setIsRubberBandDrawing(false);
      setRubberBandStart(null);
      setRubberBandEnd(null);
      return;
    }

    // Start zoom phase
    setIsRubberBandDrawing(false);
    setIsRubberBandZooming(true);

    // Dismiss notification toast when rectangle is drawn
    if (rubberBandToastId) {
      toast.dismiss(rubberBandToastId);
      setRubberBandToastId(null);
    }

    // Zoom to selected area
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      map.fitBounds(
        [
          [bounds.minLng, bounds.minLat],
          [bounds.maxLng, bounds.maxLat],
        ],
        {
          padding: { top: 50, bottom: 50, left: 50, right: 50 },
          duration: 500,
          maxZoom: 18,
        }
      );
    }
  }, [isRubberBandDrawing, rubberBandStart, rubberBandEnd, rubberBandToastId]);

  // Rubber band zoom handlers (rectangle-based)
  const handleTouchStart = useCallback(
    (event: any) => {
      // Only activate on Android tablets when rubber band mode is on and no drawing mode is active
      if (!isAndroidTablet || !rubberBandMode || drawingMode || isDrawing) {
        return;
      }

      // Check if it's a single touch (not multi-touch)
      const touches =
        event.originalEvent?.touches || event.nativeEvent?.touches;
      if (touches && touches.length !== 1) return;

      const point = event.lngLat;
      if (!point) return;

      // Start rubber band selection
      setIsRubberBandDrawing(true);
      setRubberBandStart([point.lng, point.lat]);
      setRubberBandEnd([point.lng, point.lat]);
      setIsRubberBandZooming(false);

      // Prevent default map panning
      if (event.originalEvent) {
        event.originalEvent.preventDefault();
      } else if (event.nativeEvent) {
        event.nativeEvent.preventDefault();
      }
    },
    [isAndroidTablet, rubberBandMode, drawingMode, isDrawing]
  );

  const handleTouchMove = useCallback(
    (event: any) => {
      if (!isRubberBandDrawing || !rubberBandStart) return;

      const point = event.lngLat;
      if (!point) return;

      // Update end point for rectangle
      setRubberBandEnd([point.lng, point.lat]);

      // Prevent default map panning
      if (event.originalEvent) {
        event.originalEvent.preventDefault();
      } else if (event.nativeEvent) {
        event.nativeEvent.preventDefault();
      }
    },
    [isRubberBandDrawing, rubberBandStart]
  );

  const handleTouchEnd = useCallback(
    (event: any) => {
      if (!isRubberBandDrawing || !rubberBandStart || !rubberBandEnd) {
        return;
      }

      // Calculate minimum distance threshold (e.g., 0.001 degrees)
      const lngDiff = Math.abs(rubberBandEnd[0] - rubberBandStart[0]);
      const latDiff = Math.abs(rubberBandEnd[1] - rubberBandStart[1]);

      // Only zoom if selection is large enough (not just a tap)
      if (lngDiff < 0.001 && latDiff < 0.001) {
        // Too small, cleanup
        setIsRubberBandDrawing(false);
        setRubberBandStart(null);
        setRubberBandEnd(null);
        return;
      }

      // Calculate bounding box
      const bounds = calculateRectangleBounds(rubberBandStart, rubberBandEnd);
      if (!bounds) {
        setIsRubberBandDrawing(false);
        setRubberBandStart(null);
        setRubberBandEnd(null);
        return;
      }

      // Start zoom phase
      setIsRubberBandDrawing(false);
      setIsRubberBandZooming(true);

      // Dismiss notification toast when rectangle is drawn
      if (rubberBandToastId) {
        toast.dismiss(rubberBandToastId);
        setRubberBandToastId(null);
      }

      // Zoom to selected area
      if (mapRef.current) {
        const map = mapRef.current.getMap();
        map.fitBounds(
          [
            [bounds.minLng, bounds.minLat],
            [bounds.maxLng, bounds.maxLat],
          ],
          {
            padding: { top: 50, bottom: 50, left: 50, right: 50 },
            duration: 500,
            maxZoom: 18,
          }
        );
      }

      // Prevent default
      if (event.originalEvent) {
        event.originalEvent.preventDefault();
      } else if (event.nativeEvent) {
        event.nativeEvent.preventDefault();
      }
    },
    [isRubberBandDrawing, rubberBandStart, rubberBandEnd, rubberBandToastId]
  );

  // Show notification toast when rubber band mode is enabled
  useEffect(() => {
    if (rubberBandMode) {
      const toastId = toast.notification("Drag to draw a rectangle");
      setRubberBandToastId(toastId);
    } else {
      // Dismiss toast when mode is disabled
      if (rubberBandToastId) {
        toast.dismiss(rubberBandToastId);
        setRubberBandToastId(null);
      }
    }
  }, [rubberBandMode]);

  // Cleanup rubber band when mode is disabled
  useEffect(() => {
    if (!rubberBandMode) {
      setIsRubberBandDrawing(false);
      setIsRubberBandZooming(false);
      setRubberBandStart(null);
      setRubberBandEnd(null);
    }
  }, [rubberBandMode]);

  // Cleanup rubber band when drawing mode is activated (disable rubber band mode)
  useEffect(() => {
    if (drawingMode) {
      setIsRubberBandDrawing(false);
      setIsRubberBandZooming(false);
      setRubberBandStart(null);
      setRubberBandEnd(null);
      // Disable rubber band mode when any drawing tool is activated
      setRubberBandMode(false);
    }
  }, [drawingMode]);

  // Listen for zoom completion to cleanup and exit mode
  useEffect(() => {
    if (!mapRef.current || !isRubberBandZooming) return;

    const map = mapRef.current.getMap();
    const handleMoveEnd = () => {
      // Small delay to ensure zoom animation is complete
      setTimeout(() => {
        // Cleanup all state and exit rubber band mode after zoom completes
        setIsRubberBandZooming(false);
        setRubberBandStart(null);
        setRubberBandEnd(null);
        setRubberBandMode(false); // Exit mode after one zoom
      }, 100);
    };

    map.on("moveend", handleMoveEnd);

    return () => {
      map.off("moveend", handleMoveEnd);
    };
  }, [isRubberBandZooming]);

  // Ensure we always hand BitmapLayer a canvas (avoid createImageBitmap on blob)
  const ensureCanvasImage = (img: any): HTMLCanvasElement | null => {
    if (img instanceof HTMLCanvasElement) return img;
    if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        return canvas;
      }
    }
    return null;
  };

  const handleLayerHover = useCallback(
    (info: PickingInfo<unknown>) => {
      // Prevent tooltip from showing immediately after layer creation (especially on tablets)
      const timeSinceLastCreation =
        Date.now() - lastLayerCreationTimeRef.current;
      if (timeSinceLastCreation < 500) {
        // Don't show tooltip if layer was created less than 500ms ago
        setHoverInfo(undefined);
        return;
      }

      if (!info) {
        setHoverInfo(undefined);
        return;
      }

      const deckLayerId = (info.layer as any)?.id as string | undefined;

      // Special handling for DEM BitmapLayers (.tif, .tiff, .dett, .hgt)
      // BitmapLayer hover info often has no `object`, but we still want a tooltip
      let isDemHover = false;
      if (deckLayerId) {
        const baseId = deckLayerId
          .replace(/-icon-layer$/, "")
          .replace(/-signal-overlay$/, "")
          .replace(/-bitmap$/, "")
          .replace(/-mesh$/, "");

        const matchingLayer = layers.find((l) => l.id === baseId);
        if (matchingLayer?.type === "dem") {
          isDemHover = true;
        }
      }

      if (info.object || (isDemHover && info.coordinate)) {
        setHoverInfo(info);
      } else {
        setHoverInfo(undefined);
      }
    },
    [setHoverInfo, layers]
  );

  // UDP layers from separate component
  const { udpLayers, connectionError, noDataWarning, isConnected } =
    useUdpLayers(handleLayerHover);

  // Rubber band overlay layers
  const rubberBandRectangle = useRubberBandRectangle({
    isDrawing: isRubberBandDrawing,
    isZooming: isRubberBandZooming,
    start: rubberBandStart,
    end: rubberBandEnd,
  });



  const rubberBandOverlay = useRubberBandOverlay({
    isZooming: isRubberBandZooming,
    start: rubberBandStart,
    end: rubberBandEnd,
  });

  const notificationsActive =
    networkLayersVisible && (connectionError || noDataWarning);
  const { host, port } = useUdpConfigStore();

  // Debounced zoom: only updates 1 second after user stops zooming
  // This prevents visibility updates during active zooming
  const [debouncedZoom, setDebouncedZoom] = useState(mapZoom);
  
  useEffect(() => {
    // Clear any existing debounce timeout
    if (zoomDebounceTimeoutRef.current) {
      clearTimeout(zoomDebounceTimeoutRef.current);
    }
    
    // Set new timeout to update debouncedZoom after 1 second of no zoom changes
    zoomDebounceTimeoutRef.current = setTimeout(() => {
      setDebouncedZoom(mapZoom);
    }, 1000); // 1 second debounce
    
    // Cleanup on unmount or when mapZoom changes
    return () => {
      if (zoomDebounceTimeoutRef.current) {
        clearTimeout(zoomDebounceTimeoutRef.current);
      }
    };
  }, [mapZoom]);

  // Round debounced zoom to nearest 0.5 to reduce visibility update frequency
  // Only update visibility when crossing 0.5, 1.0, 1.5, 2.0, etc. thresholds
  const roundedZoom = useMemo(() => {
    return Math.round(debouncedZoom * 2) / 2; // Round to nearest 0.5
  }, [debouncedZoom]);

  // Helper to compute zoom-based visibility (cheap check, no side effects)
  // Uses roundedZoom (from debouncedZoom) to only update after user stops zooming
  const getZoomVisibility = useCallback((layer: LayerProps): boolean => {
    let minZoom: number | undefined = layer.minzoom;
    let maxZoom = layer.maxzoom ?? 20;
    
    if (minZoom === undefined) {
      const zoomRange = calculateLayerZoomRange(layer);
      if (zoomRange) {
        minZoom = zoomRange.minZoom;
        maxZoom = zoomRange.maxZoom;
      } else {
        return true; // Show if can't calculate
      }
    }
    
    // minZoom is guaranteed to be defined here
    // Use roundedZoom (from debouncedZoom) to reduce update frequency
    return roundedZoom >= minZoom && roundedZoom <= maxZoom;
  }, [roundedZoom]);



  const deckGlLayers = useMemo(() => {
    const isLayerVisible = (layer: LayerProps) => {
      if (layer.visible === false) return false;
      const name = layer.name || "";
      const isNetworkLayer =
        name.includes("Network") ||
        name.includes("Connection") ||
        layer.type === "nodes";
      if (isNetworkLayer && !networkLayersVisible) {
        return false;
      }
      return true;
    };

    const guardColor = (color: number[] = [0, 0, 0]) =>
      color.length === 4 ? color : [...color, 255];


    // Don't filter by zoom here - we'll use Deck.gl's visible prop instead
    // This prevents layer recreation on zoom changes
    const visibleLayers = layers
      .filter(isLayerVisible)
      .filter(
        (layer) =>
          !(layer.type === "point" && layer.name?.startsWith("Polygon Point"))
      );
    const pointLayers = visibleLayers.filter((l) => l.type === "point");
    const lineLayers = visibleLayers.filter(
      (l) => l.type === "line" && !(l.name || "").includes("Connection")
    );
    const connectionLayers = visibleLayers.filter(
      (l) => l.type === "line" && (l.name || "").includes("Connection")
    );
    const polygonLayers = visibleLayers.filter((l) => l.type === "polygon");
    const azimuthLayers = visibleLayers.filter((l) => l.type === "azimuth");
    const geoJsonLayers = visibleLayers.filter((l) => l.type === "geojson");
    const demLayers = visibleLayers.filter((l) => l.type === "dem");
    const annotationLayers = visibleLayers.filter(
      (l) => l.type === "annotation"
    );

    const deckLayers: any[] = [];
    const measurementCharacterSet = [
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      ".",
      "-",
      "°",
      "k",
      "m",
      "A",
      "P",
      ":",
      "•",
      "²",
      "h",
      "a",
      " ",
    ];

    // Add raster layers FIRST so they render at the bottom (behind other layers)
    demLayers.forEach((layer) => {
      if (!layer.bounds) return;
      const [minLng, minLat] = layer.bounds[0];
      const [maxLng, maxLat] = layer.bounds[1];

      // Ensure we hand BitmapLayer a canvas (avoid createImageBitmap on blobs)
      const image =
        ensureCanvasImage(layer.bitmap) ||
        ensureCanvasImage(layer.texture) ||
        null;

      if (!image) {

        return;
      }

      const isVisible = layer.visible !== false && getZoomVisibility(layer);
      
      deckLayers.push(
        new BitmapLayer({
          id: `${layer.id}-bitmap`,
          image,
          bounds: [minLng, minLat, maxLng, maxLat],
          pickable: true,
          visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
          onHover: handleLayerHover,
          updateTriggers: {
            visible: [roundedZoom, layer.visible], // Update visibility on zoom (at 0.5 intervals)
          },
        })
      );
    });

    if (pointLayers.length) {
      // Create a unique key based on all radius values to force update
      const radiusKey = pointLayers
        .map((l) => `${l.id}:${l.radius ?? 5}`)
        .join("|");

      // Compute visibility: layer must be visible AND pass zoom check
      const isVisible = pointLayers.some(l => 
        l.visible !== false && getZoomVisibility(l)
      );
      
      deckLayers.push(
        new ScatterplotLayer({
          id: "point-layer",
          data: pointLayers,
          visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
          getPosition: (d: LayerProps) => d.position!,
          getRadius: (d: LayerProps) => d.radius ?? 5, // Use radius for point layers
          radiusUnits: "pixels", // Use pixels instead of meters
          getFillColor: (d: LayerProps) => {
            const color = d.color ? [...d.color] : [59, 130, 246];
            return (color.length === 3 ? [...color, 255] : color) as [
              number,
              number,
              number,
              number
            ];
          },
          getLineColor: (d: LayerProps) => {
            const color = d.color ? d.color.slice(0, 3) : [59, 130, 246];
            return color.map((c) => Math.max(0, c - 40)) as [
              number,
              number,
              number
            ];
          },
          getLineWidth: 1,
          stroked: true,
          pickable: true,
          pickingRadius: 20, // Larger picking radius for touch devices
          radiusMinPixels: 1,
          radiusMaxPixels: 50,
          onHover: handleLayerHover,
          updateTriggers: {
            getRadius: [radiusKey], // Update when any radius changes
            getFillColor: [
              pointLayers.map((l) => l.color?.join(",")).join("|"),
            ],
            visible: [roundedZoom, pointLayers.map(l => `${l.id}:${l.visible}`).join("|")], // Update visibility on zoom (at 0.5 intervals)
          },
        })
      );
    }

    // User location layers will be added at the end to render on top

    if (lineLayers.length) {
      const pathData = lineLayers
        .map((layer) => {
          const path = layer.path ?? [];
          if (path.length < 2) return null; // Need at least 2 points for a line

          // Validate coordinates and filter out invalid points
          const validPath = path.filter((point) => {
            return (
              Array.isArray(point) &&
              point.length >= 2 &&
              typeof point[0] === "number" &&
              typeof point[1] === "number" &&
              !isNaN(point[0]) &&
              !isNaN(point[1])
            );
          }) as [number, number][];

          if (validPath.length < 2) return null;

          return {
            path: validPath,
            color: layer.color ? [...layer.color] : [0, 0, 0], // Black default
            width: layer.lineWidth ?? 5,
            layerId: layer.id,
            layer,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      if (pathData.length > 0) {
        // Compute visibility: at least one layer must be visible AND pass zoom check
        const isVisible = lineLayers.some(
          (l) => l.visible !== false && getZoomVisibility(l)
        );

        deckLayers.push(
          new PathLayer({
            id: "line-layer",
            data: pathData,
            visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
            getPath: (d: any) => d.path,
            getColor: (d: any) => {
              const color = d.color || [0, 0, 0]; // Black default
              return color.length === 3 ? [...color, 255] : color;
            },
            getWidth: (d: any) => Math.max(1, d.width), // Minimum width of 1
            widthUnits: "pixels", // Use pixels instead of meters
            widthMinPixels: 1, // Minimum width of 1 pixel
            widthMaxPixels: 50, // Maximum width of 50 pixels
            pickable: true,
            pickingRadius: 20, // Larger picking radius for touch devices
            onHover: handleLayerHover,
            updateTriggers: {
              visible: [
                roundedZoom,
                lineLayers.map((l) => `${l.id}:${l.visible}`).join("|"),
              ], // Update visibility on zoom
            },
          })
        );
      }
    }

    if (connectionLayers.length) {
      const connectionPathData = connectionLayers.flatMap((layer) => {
        const path = layer.path ?? [];
        if (path.length < 2) return [];

        return path
          .slice(0, -1)
          .map((point, index) => {
            const nextPoint = path[index + 1];
            // Validate coordinates are valid numbers
            if (
              !Array.isArray(point) ||
              point.length < 2 ||
              !Array.isArray(nextPoint) ||
              nextPoint.length < 2 ||
              typeof point[0] !== "number" ||
              typeof point[1] !== "number" ||
              typeof nextPoint[0] !== "number" ||
              typeof nextPoint[1] !== "number" ||
              isNaN(point[0]) ||
              isNaN(point[1]) ||
              isNaN(nextPoint[0]) ||
              isNaN(nextPoint[1])
            ) {
              return null;
            }
            return {
              sourcePosition: point,
              targetPosition: nextPoint,
              color: layer.color ? [...layer.color] : [128, 128, 128], // Create a copy of the color array
              width: layer.lineWidth ?? 5,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);
      });

      if (connectionPathData.length > 0) {
        // Compute visibility: at least one layer must be visible AND pass zoom check
        const isVisible = connectionLayers.some(l => 
          l.visible !== false && getZoomVisibility(l)
        );
        
        deckLayers.push(
          new LineLayer({
            id: "connection-line-layer",
            data: connectionPathData,
            visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => Math.max(1, d.width), // Minimum width of 1
            widthUnits: "pixels", // Use pixels instead of meters
            widthMinPixels: 1, // Minimum width of 1 pixel
            widthMaxPixels: 50, // Maximum width of 50 pixels
            pickable: true,
            pickingRadius: 20, // Larger picking radius for touch devices
            onHover: handleLayerHover,
            updateTriggers: {
              visible: [roundedZoom, connectionLayers.map(l => `${l.id}:${l.visible}`).join("|")], // Update visibility on zoom (at 0.5 intervals)
            },
          })
        );
      }
    }

    if (polygonLayers.length) {
      const polygonData = polygonLayers.flatMap((layer) => {
        const rings = getUnkinkedRings(layer.polygon);
        const areaMeters = computePolygonAreaMeters(layer.polygon);
        const perimeterMeters = computePolygonPerimeterMeters(layer.polygon);
        const vertexCount = (() => {
          const outer = layer.polygon?.[0] ?? [];
          const closed =
            outer.length > 1 &&
            outer[0] &&
            outer[outer.length - 1] &&
            Math.abs(outer[0][0] - outer[outer.length - 1][0]) < 1e-10 &&
            Math.abs(outer[0][1] - outer[outer.length - 1][1]) < 1e-10;
          return Math.max(0, outer.length - (closed ? 1 : 0));
        })();
        return rings.map((ring) => ({
          layer,
          ring,
          areaMeters,
          perimeterMeters,
          vertexCount,
        }));
      });

      // Compute visibility: at least one layer must be visible AND pass zoom check
      const isVisible = polygonLayers.some(l => 
        l.visible !== false && getZoomVisibility(l)
      );
      
      deckLayers.push(
        new PolygonLayer({
          id: "polygon-layer",
          data: polygonData,
          visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
          fp64: true, // Use 64-bit precision for Samsung devices
          parameters: { depthTest: false },
          getPolygon: (d: any) => d.ring,
          getFillColor: (d: any) => {
            const color = d.layer.color ?? [32, 32, 32, 120];
            const rgba =
              color.length === 4 ? [...color] : [...color.slice(0, 3), 120];
            return rgba as [number, number, number, number];
          },
          getLineColor: (d: any) =>
            d.layer.color
              ? ([...d.layer.color.slice(0, 3)] as [number, number, number])
              : [32, 32, 32],
          getLineWidth: 1,
          stroked: false,
          pickable: true,
          pickingRadius: 20, // Larger picking radius for touch devices
          onHover: handleLayerHover,
          updateTriggers: {
            visible: [roundedZoom, polygonLayers.map(l => `${l.id}:${l.visible}`).join("|")], // Update visibility on zoom (at 0.5 intervals)
          },
        })
      );

      const polygonOutlines = polygonData.map((item) => ({
        path: item.ring,
        color: item.layer.color
          ? ([...item.layer.color.slice(0, 3)] as [number, number, number])
          : [32, 32, 32],
        width: item.layer.lineWidth ?? 2,
      }));

      if (polygonOutlines.length) {
        // Use same visibility as polygon layer
        const isVisible = polygonLayers.some(l => 
          l.visible !== false && getZoomVisibility(l)
        );
        
        deckLayers.push(
          new PathLayer({
            id: "polygon-outline-layer",
            data: polygonOutlines,
            visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
            getPath: (d: any) => d.path,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => d.width,
            widthUnits: "pixels",
            widthMinPixels: 1,
            widthMaxPixels: 50,
            parameters: { depthTest: false, depthMask: false },
            pickable: true,
            pickingRadius: 20,
            onHover: handleLayerHover,
            updateTriggers: {
              visible: [roundedZoom, polygonLayers.map(l => `${l.id}:${l.visible}`).join("|")], // Update visibility on zoom (at 0.5 intervals)
            },
          })
        );
      }

      // Polygon labels now shown only in side panel while drawing.
      // No on-map labels for finalized polygons per latest request.
    }

    // Line layer with vertex rendering (duplicate id but different purpose - needs to be merged or renamed)
    if (lineLayers.length) {
      const pathData = lineLayers.flatMap((layer) => {
        const path = layer.path ?? [];
        if (path.length < 2) return [];

        return path
          .slice(0, -1)
          .map((point, index) => {
            const nextPoint = path[index + 1];
            // Validate coordinates are valid numbers
            if (
              !Array.isArray(point) ||
              point.length < 2 ||
              !Array.isArray(nextPoint) ||
              nextPoint.length < 2 ||
              typeof point[0] !== "number" ||
              typeof point[1] !== "number" ||
              typeof nextPoint[0] !== "number" ||
              typeof nextPoint[1] !== "number" ||
              isNaN(point[0]) ||
              isNaN(point[1]) ||
              isNaN(nextPoint[0]) ||
              isNaN(nextPoint[1])
            ) {
              return null;
            }
            return {
              sourcePosition: point,
              targetPosition: nextPoint,
              color: layer.color ? [...layer.color] : [0, 0, 0],
              width: layer.lineWidth ?? 5,
              layerId: layer.id,
              layerName: layer.name,
              segmentIndex: index,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);
      });

      if (pathData.length > 0) {
        // Compute visibility: at least one layer must be visible AND pass zoom check
        const isVisible = lineLayers.some(l => 
          l.visible !== false && getZoomVisibility(l)
        );
        
        deckLayers.push(
          new LineLayer({
            id: "line-layer-vertices",
            data: pathData,
            visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => {
              const color = d.color || [0, 0, 0];
              return color.length === 3 ? [...color, 255] : color;
            },
            getWidth: (d: any) => Math.max(1, d.width),
            widthUnits: "pixels",
            widthMinPixels: 1,
            widthMaxPixels: 50,
            pickable: true,
            pickingRadius: 20,
            onHover: handleLayerHover,
            capRounded: true,
            jointRounded: true,
            parameters: { depthTest: false },
            updateTriggers: {
              visible: [roundedZoom, lineLayers.map(l => `${l.id}:${l.visible}`).join("|")], // Update visibility on zoom (at 0.5 intervals)
            },
          })
        );

        const vertexData = lineLayers.flatMap((layer) => {
          const path = layer.path ?? [];
          if (!path.length) return [];
          return path
            .map((point, index) => {
              // Validate coordinates
              if (
                !Array.isArray(point) ||
                point.length < 2 ||
                typeof point[0] !== "number" ||
                typeof point[1] !== "number" ||
                isNaN(point[0]) ||
                isNaN(point[1])
              ) {
                return null;
              }
              return {
                position: point,
                color: index === 0 ? [255, 213, 79, 255] : [236, 72, 153, 255],
                radius: index === 0 ? 8 : 6, // Smaller radius in meters that scales with zoom
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);
        });

        if (vertexData.length > 0) {
          // Use same visibility as line layer
          const isVisible = lineLayers.some(l => 
            l.visible !== false && getZoomVisibility(l)
          );
          
          deckLayers.push(
            new ScatterplotLayer({
              id: "line-vertex-layer",
              data: vertexData,
              visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
              getPosition: (d: any) => d.position,
              getRadius: (d: any) => d.radius,
              radiusUnits: "meters",
              getFillColor: (d: any) => d.color,
              getLineColor: [255, 255, 255, 200],
              getLineWidth: 2,
              stroked: true,
              pickable: false,
              radiusMinPixels: 4,
              radiusMaxPixels: 10,
              parameters: { depthTest: false },
              updateTriggers: {
                visible: [roundedZoom, lineLayers.map(l => `${l.id}:${l.visible}`).join("|")], // Update visibility on zoom (at 0.5 intervals)
              },
            })
          );
        }
      }
    }

    if (azimuthLayers.length) {
      const azimuthLineData = azimuthLayers.flatMap((layer) => {
        const segments: any[] = [];
        const center = layer.azimuthCenter;
        if (center && layer.azimuthNorth) {
          segments.push({
            sourcePosition: center,
            targetPosition: layer.azimuthNorth,
            color: [148, 163, 184, 220],
            width: 2,
            dashArray: [6, 4],
            layerId: layer.id,
            segmentType: "north",
          });
        }
        if (center && layer.azimuthTarget) {
          const baseColor = layer.color
            ? layer.color.length === 4
              ? [...layer.color]
              : [...layer.color, 255]
            : [59, 130, 246, 255];
          segments.push({
            sourcePosition: center,
            targetPosition: layer.azimuthTarget,
            color: baseColor,
            width: layer.lineWidth ?? 6,
            layerId: layer.id,
            segmentType: "target",
          });
        }
        return segments;
      });

      const azimuthLabelData = azimuthLayers
        .map((layer) => {
          if (
            !layer.azimuthCenter ||
            !layer.azimuthTarget ||
            typeof layer.azimuthAngleDeg !== "number"
          ) {
            return null;
          }
          const [cLng, cLat] = layer.azimuthCenter;
          const [tLng, tLat] = layer.azimuthTarget;
          const labelLng = cLng + (tLng - cLng) * 0.4;
          const labelLat = cLat + (tLat - cLat) * 0.4;
          let signedAngle = normalizeAngleSigned(layer.azimuthAngleDeg);
          if (signedAngle === -180) signedAngle = 180;
          return {
            position: [labelLng, labelLat] as [number, number],
            text: `${signedAngle.toFixed(1)}°`,
          };
        })
        .filter(Boolean);

      // Compute visibility: at least one layer must be visible AND pass zoom check
      const isAzimuthVisible = azimuthLayers.some(l => 
        l.visible !== false && getZoomVisibility(l)
      );
      
      if (azimuthLineData.length) {
        deckLayers.push(
          new LineLayer({
            id: "azimuth-lines-layer",
            data: azimuthLineData,
            visible: isAzimuthVisible, // Use Deck.gl's visible prop - handled on GPU
            pickable: true,
            pickingRadius: 20,
            onHover: handleLayerHover,
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => d.width,
            getDashArray: (d: any) => d.dashArray ?? [0, 0],
            dashJustified: true,
            updateTriggers: {
              visible: [roundedZoom, azimuthLayers.map(l => `${l.id}:${l.visible}`).join("|")], // Update visibility on zoom (at 0.5 intervals)
            },
          })
        );
      }

      if (azimuthLabelData.length) {
        deckLayers.push(
          new TextLayer({
            id: "azimuth-angle-labels",
            data: azimuthLabelData as Array<{
              position: [number, number];
              text: string;
            }>,
            visible: isAzimuthVisible, // Use Deck.gl's visible prop - handled on GPU
            pickable: false,
            getPosition: (d) => d.position,
            getText: (d) => d.text,
            getSize: 14,
            getColor: [59, 130, 246, 255],
            getTextAnchor: "middle",
            getAlignmentBaseline: "center",
            fontWeight: 600,
            background: true,
            getBackgroundColor: [255, 255, 255, 200],
            padding: [2, 4],
            characterSet: measurementCharacterSet,
            updateTriggers: {
              visible: [roundedZoom, azimuthLayers.map(l => `${l.id}:${l.visible}`).join("|")], // Update visibility on zoom (at 0.5 intervals)
            },
          })
        );
      }
    }

    geoJsonLayers.forEach((layer) => {
      if (!layer.geojson) return;
      const lineWidth = layer.lineWidth ?? 5;
      const isVisible = layer.visible !== false && getZoomVisibility(layer);
      
      deckLayers.push(
        new GeoJsonLayer({
          id: layer.id,
          data: layer.geojson,
          visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
          fp64: true, // Use 64-bit precision for Samsung devices
          parameters: { depthTest: false },
          pickable: true,
          pickingRadius: 20, // Larger picking radius for touch devices
          stroked: true,
          filled: true,
          pointRadiusUnits: "pixels", // Use pixels for point radius
          lineWidthUnits: "pixels", // Use pixels for line width
          getFillColor: (f: any) =>
            f.properties?.color ?? [...(layer.color ?? [0, 150, 255]), 120],
          getLineColor: (f: any) =>
            f.properties?.lineColor ?? guardColor(layer.color ?? [0, 150, 255]),
          getPointRadius: (f: any) =>
            f.geometry?.type === "Point" ? layer.pointRadius ?? 5 : 0,
          getLineWidth: (f: any) => {
            const type = f.geometry?.type;
            if (type === "LineString" || type === "MultiLineString") {
              return lineWidth;
            }
            return 2;
          },
          updateTriggers: {
            getFillColor: [layer.color],
            getLineColor: [layer.color],
            getPointRadius: [layer.pointRadius],
            getLineWidth: [layer.lineWidth],
            visible: [roundedZoom, layer.visible], // Update visibility on zoom (at 0.5 intervals)
          },
          onHover: handleLayerHover,
        })
      );
    });

    annotationLayers.forEach((layer) => {
      if (!layer.annotations?.length) return;
      const isVisible = layer.visible !== false && getZoomVisibility(layer);
      
      deckLayers.push(
        new TextLayer({
          id: layer.id,
          data: layer.annotations,
          visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
          getPosition: (d: any) => d.position,
          getText: (d: any) => d.text,
          getColor: (d: any) => d.color ?? layer.color ?? [0, 0, 0],
          getSize: (d: any) => d.fontSize ?? 14,
          getAngle: 0,
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          pickable: true,
          pickingRadius: 20, // Larger picking radius for touch devices
          sizeScale: 1,
          fontFamily: "Arial, sans-serif",
          fontWeight: "normal",
          onHover: handleLayerHover,
          updateTriggers: {
            visible: [roundedZoom, layer.visible], // Update visibility on zoom (at 0.5 intervals)
          },
        })
      );
    });


    // --- Preview layers ---
    const previewLayers: any[] = [];

    // Add UDP layers to the deck layers only when networkLayersVisible is true
    if (networkLayersVisible && udpLayers && udpLayers.length > 0) {
      deckLayers.push(...udpLayers);
    }
    if (
      isDrawing &&
      drawingMode === "polygon" &&
      currentPath.length >= 1 &&
      mousePosition
    ) {
      if (currentPath.length === 1) {
        const previewLineData = [
          {
            sourcePosition: currentPath[0],
            targetPosition: mousePosition,
            color: [160, 160, 160],
            width: 2,
          },
        ];
        previewLayers.push(
          new LineLayer({
            id: "preview-polygon-edge",
            data: previewLineData,
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => d.width,
            pickable: false,
          })
        );
      } else {
        const previewPath = closeRing([...currentPath, mousePosition]);
        previewLayers.push(
          new PolygonLayer({
            id: "preview-polygon-layer",
            fp64: true, // Use 64-bit precision for Samsung devices
            data: [previewPath],
            parameters: { depthTest: false },
            getPolygon: (d: [number, number][]) => d,
            getFillColor: [32, 32, 32, 60],
            getLineColor: [32, 32, 32],
            getLineWidth: 1,
            stroked: false,
            pickable: false,
          })
        );
        previewLayers.push(
          new PathLayer({
            id: "preview-polygon-outline-layer",
            data: [previewPath],
            getPath: (d: [number, number][]) => d,
            getColor: [32, 32, 32],
            getWidth: 2,
            widthUnits: "pixels",
            widthMinPixels: 1,
            parameters: { depthTest: false, depthMask: false },
            pickable: false,
          })
        );

        if (
          isPointNearFirstPoint(mousePosition, currentPath[0]) &&
          previewPath.length >= 3
        ) {
          const closingLineData = [
            {
              sourcePosition: mousePosition,
              targetPosition: currentPath[0],
              color: [255, 255, 0],
              width: 3,
            },
          ];
          previewLayers.push(
            new LineLayer({
              id: "preview-polygon-closing",
              data: closingLineData,
              getSourcePosition: (d: any) => d.sourcePosition,
              getTargetPosition: (d: any) => d.targetPosition,
              getColor: (d: any) => d.color,
              getWidth: (d: any) => d.width,
              pickable: false,
            })
          );
        }
      }
    }

    if (isDrawing && drawingMode === "polyline" && currentPath.length >= 1) {
      const segments =
        currentPath.length > 1
          ? currentPath.slice(0, -1).map((point, index) => ({
              sourcePosition: point,
              targetPosition: currentPath[index + 1],
              color: [96, 96, 96],
              width: 3,
            }))
          : [];

      if (segments.length) {
        previewLayers.push(
          new LineLayer({
            id: "preview-polyline-existing",
            data: segments,
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => d.width,
            pickable: false,
          })
        );
      }

      if (mousePosition) {
        const lastPoint = currentPath[currentPath.length - 1];
        previewLayers.push(
          new LineLayer({
            id: "preview-polyline-next",
            data: [
              {
                sourcePosition: lastPoint,
                targetPosition: mousePosition,
                color: [96, 96, 96],
                width: 3,
              },
            ],
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => d.width,
            pickable: false,
          })
        );
      }
    }

    if (
      isDrawing &&
      drawingMode === "azimuthal" &&
      currentPath.length === 1 &&
      mousePosition
    ) {
      const center = currentPath[0];
      const distanceMeters = calculateDistanceMeters(center, mousePosition);
      const referenceDistance = Math.max(distanceMeters, 1000);
      const northPoint = destinationPoint(center, referenceDistance, 0);
      const angleDeg = calculateBearingDegrees(center, mousePosition);
      const labelLng = center[0] + (mousePosition[0] - center[0]) * 0.4;
      const labelLat = center[1] + (mousePosition[1] - center[1]) * 0.4;
      const previewAzimuthData = [
        {
          sourcePosition: center,
          targetPosition: northPoint,
          color: [148, 163, 184],
          width: 2,
          dashArray: [6, 4],
        },
        {
          sourcePosition: center,
          targetPosition: mousePosition,
          color: [59, 130, 246],
          width: 6,
        },
      ];
      previewLayers.push(
        new LineLayer({
          id: "preview-azimuth-lines",
          data: previewAzimuthData,
          getSourcePosition: (d: any) => d.sourcePosition,
          getTargetPosition: (d: any) => d.targetPosition,
          getColor: (d: any) => d.color,
          getWidth: (d: any) => d.width,
          getDashArray: (d: any) => d.dashArray ?? [0, 0],
          dashJustified: true,
          pickable: false,
        })
      );
      if (distanceMeters > 5) {
        let signedPreviewAngle = normalizeAngleSigned(angleDeg);
        if (signedPreviewAngle === -180) signedPreviewAngle = 180;
        previewLayers.push(
          new TextLayer({
            id: "preview-azimuth-angle-label",
            data: [
              {
                position: [labelLng, labelLat] as [number, number],
                text: `${signedPreviewAngle.toFixed(1)}°`,
              },
            ],
            pickable: false,
            getPosition: (d: any) => d.position,
            getText: (d: any) => d.text,
            getSize: 14,
            getColor: [59, 130, 246, 255],
            getTextAnchor: "middle",
            getAlignmentBaseline: "center",
            fontWeight: 600,
            background: true,
            getBackgroundColor: [255, 255, 255, 220],
            padding: [2, 4],
            characterSet: measurementCharacterSet,
          })
        );
      }
    }

    if (isDrawing && currentPath.length > 0) {
      const previewPointData = currentPath.map((point, index) => ({
        position: point,
        radius: index === 0 ? 8 : 6, // Smaller radius in meters that scales with zoom
        color: index === 0 ? [255, 255, 0] : [255, 0, 255],
      }));
      previewLayers.push(
        new ScatterplotLayer({
          id: "preview-point-layer",
          data: previewPointData,
          getPosition: (d: any) => d.position,
          getRadius: (d: any) => d.radius,
          radiusUnits: "meters",
          getFillColor: (d: any) => d.color,
          pickable: false,
          radiusMinPixels: 4,
          radiusMaxPixels: 10,
        })
      );
    }

    // Return layers (user location will be added separately after default layers)
    return [...deckLayers, ...previewLayers];
  }, [
    layers,
    networkLayersVisible,
    isDrawing,
    drawingMode,
    currentPath,
    mousePosition,
    handleLayerHover,
    udpLayers,
    getUnkinkedRings,
    closeRing,
    roundedZoom, // Use roundedZoom (0.5 intervals) to reduce update frequency
    getZoomVisibility, // Include zoom visibility helper
  ]);

  return (
    <div
      className={`relative h-screen w-screen overflow-hidden ${
        isMapEnabled ? "bg-transparent" : "bg-black"
      }`}
    >
      <OfflineLocationTracker />
      {selectedNodeForIcon && (
        <IconSelection
          selectedNodeForIcon={selectedNodeForIcon}
          setSelectedNodeForIcon={setSelectedNodeForIcon}
        />
      )}

      {measurementPreview && (
        <div
          className="absolute right-4 z-40 w-64 rounded-lg border border-black/10 bg-white shadow-xl p-3 space-y-2"
          style={{ top: notificationsActive ? 40 : 16 }}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <span>Drawing Measurements</span>
          </div>
          {measurementPreview.type === "polygon" ? (
            <div className="space-y-1 text-sm text-gray-700">
              <div className="flex justify-between">
                <span>Area</span>
                <span className="font-mono">
                  {formatArea(measurementPreview.areaMeters)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Perimeter</span>
                <span className="font-mono">
                  {formatDistance(measurementPreview.perimeterMeters / 1000)}
                </span>
              </div>
            </div>
          ) : (
            <>
              {measurementPreview.segments.length > 0 && (
                <>
                  <div className="text-xs text-gray-500">Segments</div>
                  <div className="space-y-1 max-h-64 overflow-y-auto text-sm text-gray-700">
                    {measurementPreview.segments.map((segment, idx) => (
                      <div
                        key={`${segment.label}-${idx}`}
                        className="flex justify-between"
                      >
                        <span>{segment.label}</span>
                        <span className="font-mono">
                          {segment.lengthKm.toFixed(2)} km
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {polylinePreviewStats && (
                <div className="mt-2 space-y-1 border-t border-dashed border-slate-200 pt-2 text-xs text-gray-700">
                  <div className="flex justify-between">
                    <span>Count</span>
                    <span className="font-mono">
                      {polylinePreviewStats.count}
                    </span>
                  </div>
                  {polylinePreviewStats.count > 1 && (
                    <>
                      <div className="flex justify-between">
                        <span>Max segment</span>
                        <span className="font-mono">
                          {polylinePreviewStats.max.toFixed(2)} km
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Min segment</span>
                        <span className="font-mono">
                          {polylinePreviewStats.min.toFixed(2)} km
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Avg segment</span>
                        <span className="font-mono">
                          {polylinePreviewStats.avg.toFixed(2)} km
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )}
              <div className="text-xs font-semibold text-gray-800">
                Total: {measurementPreview.totalKm.toFixed(2)} km
              </div>
            </>
          )}
        </div>
      )}

      {/* UDP Connection Error Banner */}
      {networkLayersVisible && connectionError && showConnectionError && (
        <div className="absolute bottom-14 right-78 z-50 bg-white rounded-lg shadow-lg p-3 max-w-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="font-semibold mb-1.5 text-sm text-red-600">
                Connection Error
              </div>
              <div className="text-xs space-y-1 text-gray-700">
                <div>Failed to connect to UDP server</div>
                <div className="text-gray-600">
                  Host: {host}:{port}
                </div>
                <div className="text-gray-500 text-[10px] mt-1">
                  {connectionError.includes("Error:")
                    ? connectionError.split("Error:")[1]?.trim()
                    : "Please check your configuration"}
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowConnectionError(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
              title="Close"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* UDP No Data Warning Banner */}
      {networkLayersVisible && noDataWarning && showConnectionError && (
        <div className="absolute bottom-32 right-4 z-50 bg-white rounded-lg shadow-lg p-3 max-w-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="font-semibold mb-1.5 text-sm text-orange-600">
                No Data Warning
              </div>
              <div className="text-xs space-y-1 text-gray-700">
                <div>{noDataWarning}</div>
                <div className="text-gray-600">
                  Host: {host}:{port}
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowConnectionError(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
              title="Close"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* UDP Connection Status Indicator */}
      {networkLayersVisible && isConnected && !connectionError && (
        <div
          className="absolute bottom-4 left-4 z-50 rounded-sm shadow-lg px-2 py-1 flex items-center gap-2"
          style={{
            background: "rgba(0, 0, 0, 0.4)",
            pointerEvents: "none",
          }}
        >
          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
          <span
            className="text-[10px] md:text-xs font-mono text-gray-700 font-bold capitalize "
            style={{ color: "rgb(255, 255, 255)", letterSpacing: "0.08em" }}
          >
            {host}:{port}
          </span>
        </div>
      )}

      {isMeasurementBoxOpen && (
        <MeasurementBox onClose={() => setIsMeasurementBoxOpen(false)} />
      )}

      {isNetworkBoxOpen && (
        <NetworkBox onClose={() => setIsNetworkBoxOpen(false)} />
      )}

      <Map
        ref={mapRef}
        style={{ width: "100%", height: "100%" }}
        mapboxAccessToken="pk.eyJ1IjoibmlraGlsc2FyYWYiLCJhIjoiY2xlc296YjRjMDA5dDNzcXphZjlzamFmeSJ9.7ZDaMZKecY3-70p9pX9-GQ"
        mapStyle={undefined}
        // Don't use mapStyle prop - we load style manually after modifying tile URLs
        renderWorldCopies={false}
        reuseMaps={true}
        attributionControl={false}
        dragRotate={true}
        pitchWithRotate={true}
        initialViewState={{
          longitude: tileServerUrl ? 81.5 : 81.5, // World center (0) when using tile server, India center (home view) otherwise
          latitude: tileServerUrl ? 81.5 : 20.5, // Equator (0) when using tile server, India center (home view) otherwise
          zoom: tileServerUrl ? 3 : 3, // World view (zoom 2) when using tile server, India view (zoom 3 - home view) otherwise
          pitch: pitch,
          bearing: 0,
        }}
        minZoom={0}
        maxZoom={18}
        maxPitch={85}
        onLoad={async (map: any) => {
          const mapInstance = map.target;

          // Remove any old raster tile sources/layers if they exist (we only use tile server)
          try {
            if (mapInstance.getLayer("offline-tiles-layer")) {
              mapInstance.removeLayer("offline-tiles-layer");
            }
            if (mapInstance.getSource("offline-tiles")) {
              mapInstance.removeSource("offline-tiles");
            }
          } catch (e) {
            // Ignore errors if source/layer doesn't exist
          }

          // Get tile server URL directly (don't rely on state which might not be set yet)
          const { initializeTileServer } = await import("./tile-folder-dialog");
          let serverUrl = tileServerUrl || (await initializeTileServer());

          // Ensure serverUrl doesn't have trailing slash
          if (serverUrl && serverUrl.endsWith("/")) {
            serverUrl = serverUrl.slice(0, -1);
          }

          // Always load style manually (never use mapStyle prop to ensure we can modify URLs)
          if (serverUrl) {
            // Update state if needed
            if (serverUrl !== tileServerUrl) {
              setTileServerUrl(serverUrl);
            }

            // Load style from tile server
            const styleUrl = `${serverUrl}/style.json`;

            try {
              // Fetch style.json to modify it
              const response = await fetch(styleUrl);

              if (!response.ok) {
                throw new Error(
                  `Failed to fetch style.json: ${response.status}`
                );
              }

              let styleJson = await response.json();

              // Force ALL tile URLs to point to tile server
              if (styleJson.sources) {
                Object.keys(styleJson.sources).forEach((sourceKey) => {
                  const source = styleJson.sources[sourceKey];
                  if (source.type === "vector" && source.tiles) {
                   
                    source.tiles = source.tiles.map((tileUrl: string) => {
                      // Extract the tile path (e.g., /3/5/3.pbf from any URL format)
                      let tilePath = tileUrl;

                      // If it's an absolute URL, extract the path
                      try {
                        const url = new URL(tilePath);
                        tilePath = url.pathname;
                      } catch {
                        // Not a valid URL, might be relative or template
                      }

                      // Handle Mapbox tile URL templates like {z}/{x}/{y}.pbf
                      // If it's a template, keep it but ensure it points to our server
                      if (
                        tilePath.includes("{z}") ||
                        tilePath.includes("{x}") ||
                        tilePath.includes("{y}")
                      ) {
                        // Template format - ensure it starts with / and use our server
                        if (!tilePath.startsWith("/")) {
                          tilePath = "/" + tilePath;
                        }
                        return `${serverUrl}${tilePath}`;
                      }

                      // Regular tile path - ensure it starts with /
                      if (!tilePath.startsWith("/")) {
                        tilePath = "/" + tilePath;
                      }

                      // Always use tile server URL
                      const finalUrl = `${serverUrl}${tilePath}`;
                    
                      return finalUrl;
                    });
                   
                  }
                });
              }

              // Convert relative glyphs URL to absolute URL
              if (styleJson.glyphs && typeof styleJson.glyphs === "string") {
                if (styleJson.glyphs.startsWith("/")) {
                  styleJson.glyphs = `${serverUrl}${styleJson.glyphs}`;
                }
              } else if (
                styleJson.layers &&
                styleJson.layers.some(
                  (layer: any) => layer.layout && layer.layout["text-field"]
                )
              ) {
                // If glyphs is missing but text layers exist, set default glyphs path
                styleJson.glyphs = `${serverUrl}/fonts/{fontstack}/{range}.pbf`;
               
              }

              // Set up style.load handler BEFORE applying style
              mapInstance.once("style.load", () => {

                // Double-check and force update tile URLs after style loads
                const currentStyle = mapInstance.getStyle();
                if (currentStyle && currentStyle.sources) {
                  Object.keys(currentStyle.sources).forEach((sourceKey) => {
                    const source = mapInstance.getSource(sourceKey);
                    if (source) {
                      const sourceData = source as any;
                      if (sourceData.type === "vector" && sourceData.tiles) {
                        
                        // Check if any tile URL doesn't start with serverUrl
                        const needsUpdate = sourceData.tiles.some(
                          (url: string) => !url.startsWith(serverUrl)
                        );
                        if (needsUpdate) {
                          console.warn(
                            `[Map] Source ${sourceKey} has incorrect tile URLs, updating...`
                          );
                          const updatedTiles = sourceData.tiles.map(
                            (tileUrl: string) => {
                              let tilePath = tileUrl;
                              try {
                                const url = new URL(tilePath);
                                tilePath = url.pathname;
                              } catch {}
                              if (
                                tilePath.includes("{z}") ||
                                tilePath.includes("{x}") ||
                                tilePath.includes("{y}")
                              ) {
                                if (!tilePath.startsWith("/"))
                                  tilePath = "/" + tilePath;
                                return `${serverUrl}${tilePath}`;
                              }
                              if (!tilePath.startsWith("/"))
                                tilePath = "/" + tilePath;
                              return `${serverUrl}${tilePath}`;
                            }
                          );
                          try {
                            mapInstance.removeSource(sourceKey);
                            mapInstance.addSource(sourceKey, {
                              type: "vector",
                              tiles: updatedTiles,
                              minzoom: 0,
                              maxzoom: 18,
                              maxNativeZoom: 14,
                            });
                           
                          } catch (e) {
                            console.error(
                              `[Map] Failed to correct source ${sourceKey}:`,
                              e
                            );
                          }
                        }
                      }
                    }
                  });
                }
              });

              // Apply the modified style
             
             
              mapInstance.setStyle(styleJson);
            } catch (error) {
              console.error("[Map] Failed to fetch and apply style:", error);
              // Fallback: use a minimal style if tile server fails
              mapInstance.setStyle({
                version: 8,
                sources: {},
                layers: [],
              });
            }
          } else {
            // No tile server - use default Mapbox style
            mapInstance.setStyle("mapbox://styles/mapbox/streets-v12");
          }

          mapInstance.once("style.error", (e: any) => {
            console.error("[Map] Style loading error:", e);
          });

          mapInstance.setMaxBounds(null);
        }}
        onClick={handleMapClick}
        onMouseMove={handleMouseMove}
        onMouseUp={() => {
          handleMouseUp();
          handleMouseUpForRubberBand();
        }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        dragPan={!isRubberBandDrawing}
        touchZoomRotate={!isRubberBandDrawing}
        onMoveEnd={(e: any) => {
          if (e && e.viewState) {
            // Throttle updates to reduce re-renders during map operations
            if (zoomUpdateTimeoutRef.current) {
              clearTimeout(zoomUpdateTimeoutRef.current);
            }
            zoomUpdateTimeoutRef.current = setTimeout(() => {
              if (typeof e.viewState.zoom === "number") {
                setMapZoom(e.viewState.zoom);
              }
              if (typeof e.viewState.bearing === "number") {
                setMapBearing(e.viewState.bearing);
              }
            }, 100); // Update at most every 100ms
          }
        }}
      >
        <DeckGLOverlay
          layers={[
            ...deckGlLayers,
            // Rubber band overlay layers (render on top)
            ...(rubberBandRectangle
              ? Array.isArray(rubberBandRectangle)
                ? rubberBandRectangle
                : [rubberBandRectangle]
              : []),
            ...(rubberBandOverlay ? [rubberBandOverlay] : []),

            // Add user location layers LAST so they render on top of everything
            ...(userLocation && showUserLocation
              ? [
                  // Add accuracy circle (in meters)
                  ...(userLocation.accuracy > 0
                    ? [
                        new ScatterplotLayer({
                          id: "user-location-accuracy",
                          data: [
                            { position: [userLocation.lng, userLocation.lat] },
                          ],
                          getPosition: (d: any) => d.position,
                          getRadius: userLocation.accuracy,
                          radiusUnits: "meters",
                          getFillColor: [59, 130, 246, 20], // Light blue with transparency
                          getLineColor: [59, 130, 246, 100], // Blue border
                          getLineWidth: 1,
                          stroked: true,
                          filled: true,
                          pickable: false,
                          radiusMinPixels: 0,
                          radiusMaxPixels: 1000,
                        }),
                      ]
                    : []),
                  // Add user location marker using IconLayer with proper location icon
                  new IconLayer({
                    id: "user-location-layer",
                    data: [{ position: [userLocation.lng, userLocation.lat] }],
                    getIcon: () => ({
                      url: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJDNy41ODIgMiA0IDUuNTgyIDQgMTBDNCAxNi4wODggMTIgMjIgMTIgMjJDMTIgMjIgMjAgMTYuMDg4IDIwIDEwQzIwIDUuNTgyIDE2LjQxOCAyIDEyIDJaIiBmaWxsPSIjM0I4MkY2IiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiLz4KPGNpcmNsZSBjeD0iMTIiIGN5PSIxMCIgcj0iMyIgZmlsbD0id2hpdGUiLz4KPC9zdmc+",
                      width: 24,
                      height: 24,
                      anchorY: 24,
                    }),
                    getPosition: (d: any) => d.position,
                    sizeScale: 1,
                    sizeMinPixels: 24,
                    sizeMaxPixels: 48,
                    pickable: true,
                    pickingRadius: 20,
                    onHover: handleLayerHover,
                  }),
                ]
              : []),
          ]}
        />
        <NavigationControl
          position="bottom-right"
          showCompass={true}
          showZoom={true}
        />
      </Map>

      <Tooltip />
      {/* COMMENTED OUT: HTML file input - using NativeUploader directly to avoid double picker */}
      <ZoomControls
        mapRef={mapRef}
        zoom={mapZoom}
        bearing={mapBearing}
        onToggleLayersBox={() => {
          const willBeOpen = !(isLayersBoxOpen ?? false);
          // If opening layers box, close other panels
          if (willBeOpen) {
            setIsMeasurementBoxOpen(false);
            setIsNetworkBoxOpen(false);
          }
          onToggleLayersBox?.();
        }}
        isLayersBoxOpen={isLayersBoxOpen}
        isMeasurementBoxOpen={isMeasurementBoxOpen}
        isNetworkBoxOpen={isNetworkBoxOpen}
        onToggleMeasurementBox={() => {
          const willBeOpen = !isMeasurementBoxOpen;
          // If opening measurement box, close other panels
          if (willBeOpen) {
            onCloseLayersBox?.();
            setIsNetworkBoxOpen(false);
          }
          setIsMeasurementBoxOpen((prev) => !prev);
        }}
        onToggleNetworkBox={() => {
          const willBeOpen = !isNetworkBoxOpen;
          // If opening network box, close other panels
          if (willBeOpen) {
            onCloseLayersBox?.();
            setIsMeasurementBoxOpen(false);
          }
          setIsNetworkBoxOpen((prev) => !prev);
        }}
        onUpload={handleUpload}
        onExportLayers={handleExportLayers}
        onSaveSession={handleSaveSession}
        onRestoreSession={handleRestoreSession}
        onToggleUserLocation={handleToggleUserLocation}
        onResetHome={handleResetHome}
        onCaptureScreenshot={handleCaptureScreenshot}
        showUserLocation={showUserLocation}
        onOpenConnectionConfig={() => setIsUdpConfigDialogOpen(true)}
        isProcessingFiles={isProcessingFiles}
        isExporting={isExporting}
        cameraPopoverProps={{
          isOpen: isCameraPopoverOpen,
          onOpenChange: setIsCameraPopoverOpen,
          pitch,
          setPitch,
          onCreatePoint: createPointLayer,
        }}
        alertButtonProps={{
          visible: Boolean(
            networkLayersVisible && (connectionError || noDataWarning)
          ),
          severity: connectionError ? "error" : "warning",
          title: connectionError
            ? "Connection Error - Click to view details"
            : "No Data Warning - Click to view details",
          onClick: () => setShowConnectionError((prev) => !prev),
        }}
        igrsToggleProps={{
          value: useIgrs,
          onToggle: (checked) => setUseIgrs(checked),
        }}
        rubberBandMode={rubberBandMode}
        onToggleRubberBand={() => setRubberBandMode((prev) => !prev)}
      />

      {/* UDP Config Dialog */}
      <UdpConfigDialog
        key={configKey}
        isOpen={isUdpConfigDialogOpen}
        onClose={() => setIsUdpConfigDialogOpen(false)}
        onConfigSet={() => {
          // Trigger reconnection by updating key
          setConfigKey((prev) => prev + 1);
        }}
      />
    </div>
  );
};

export default MapComponent;
