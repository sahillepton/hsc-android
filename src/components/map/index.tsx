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
import { MVTLayer } from "@deck.gl/geo-layers";
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
import { TileFolderDialog, initializeTileServer } from "./tile-folder-dialog";
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
  useNodeIconMappings,
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
  normalizeAngleSigned,
  computePolygonAreaMeters,
  computePolygonPerimeterMeters,
} from "@/lib/layers";
import {
  formatArea,
  formatDistance,
  shpToGeoJSON,
  // fileToGeoJSON,
  // fileToDEMRaster,
  // generateRandomColor,
} from "@/lib/utils";
import type { LayerProps, Node } from "@/lib/definitions";
import { toast } from "@/lib/toast";
import { NativeUploader } from "@/plugins/native-uploader";
import { ZipFolder } from "@/plugins/zip-folder";
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

  useEffect(() => {
    (window as any).mapRef = mapRef;

    // Cleanup timeout on unmount
    return () => {
      if (zoomUpdateTimeoutRef.current) {
        clearTimeout(zoomUpdateTimeoutRef.current);
      }
    };
  }, []);

  // Reset view to India when app resumes from background (fixes layer rendering issue)
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
          ({ isActive }) => {
            if (isActive && mapRef.current) {
              // App came to foreground - reset view to India to force re-render
              setTimeout(() => {
                handleResetHome();
              }, 100);
            }
          }
        );
      } catch (error) {
        // Capacitor App plugin not available, use browser visibility API as fallback
        const handleVisibilityChange = () => {
          if (!document.hidden && mapRef.current) {
            // App came to foreground - reset view to India to force re-render
            setTimeout(() => {
              handleResetHome();
            }, 100);
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
  const { layers, addLayer, deleteLayer } = useLayers();
  // const { setNodeIconMappings } = useNodeIconMappings();
  const { focusLayerRequest, setFocusLayerRequest } = useFocusLayerRequest();
  const { drawingMode } = useDrawingMode();
  const { isDrawing, setIsDrawing } = useIsDrawing();
  const { currentPath, setCurrentPath } = useCurrentPath();
  const { nodeIconMappings } = useNodeIconMappings();
  const { hoverInfo, setHoverInfo } = useHoverInfo();
  const { pendingPolygonPoints, setPendingPolygonPoints } = usePendingPolygon();
  const useIgrs = useIgrsPreference();
  const setUseIgrs = useSetIgrsPreference();
  const { userLocation, showUserLocation, setShowUserLocation } =
    useUserLocation();
  const previousDrawingModeRef = useRef(drawingMode);

  // const { nodeCoordinatesData, setNodeCoordinatesData } =
  //   useProgressiveNodes(networkLayersVisible);
  const [isMapEnabled] = useState(true);
  const [pitch, setPitch] = useState(0);

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
  const [isTileFolderDialogOpen, setIsTileFolderDialogOpen] = useState(false);
  const [tileServerUrl, setTileServerUrl] = useState<string | null>(null);
  const lastLayerCreationTimeRef = useRef<number>(0);

  // Initialize tile server on mount and set up fetch interceptor for tile logging
  useEffect(() => {
    initializeTileServer().then((url) => {
      if (url) {
        setTileServerUrl(url);

        // Intercept fetch requests to log tile requests with x, y, z values
        const originalFetch = window.fetch;
        window.fetch = async function (...args) {
          const url = args[0]?.toString() || "";
          const tileMatch = url.match(/\/tiles\/(\d+)\/(\d+)\/(\d+)\.pbf/);

          if (tileMatch) {
            const [, z, x, y] = tileMatch;
            console.log(
              `CAPACITOR_HAHA [Tile Request] Fetching tile: z=${z}, x=${x}, y=${y}`
            );

            try {
              const response = await originalFetch.apply(this, args);
              if (!response.ok) {
                console.error(
                  `CAPACITOR_HAHA [Tile Request] FAILED: z=${z}, x=${x}, y=${y} - Status: ${response.status} ${response.statusText}`
                );
              } else {
                console.log(
                  `CAPACITOR_HAHA [Tile Request] SUCCESS: z=${z}, x=${x}, y=${y}`
                );
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
    });

    // Cleanup: restore original fetch on unmount
    return () => {
      // Note: We can't easily restore fetch without storing the original,
      // but this is fine as it only runs once on mount
    };
  }, []);
  // COMMENTED OUT: Not using HTML file input anymore - using NativeUploader directly
  // const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (isProcessingFiles) {
      return; // Prevent multiple uploads while processing
    }
    setIsProcessingFiles(true);
    console.log("[FileUpload] Upload button clicked");
    const toastId = toast.loading("Opening file picker...");
    let progressListener: { remove: () => void } | null = null;

    try {
      // Set up progress listener for upload
      let currentUploadProgress = 0;
      console.log("[FileUpload] Setting up progress listener...");
      try {
        progressListener = await NativeUploader.addListener(
          "uploadProgress",
          (event) => {
            if (event.totalBytes > 0) {
              currentUploadProgress = Math.round(
                (event.bytesWritten / event.totalBytes) * 100
              );
              console.log(
                `[FileUpload] Upload progress: ${currentUploadProgress}% (${event.bytesWritten}/${event.totalBytes} bytes)`
              );
              toast.update(
                toastId,
                `Uploading File: ${currentUploadProgress}/100 %`,
                "loading"
              );
            }
          }
        );
        console.log("[FileUpload] Progress listener added successfully");
      } catch (listenerError) {
        console.warn(
          "[FileUpload] Failed to add progress listener:",
          listenerError
        );
        // Continue without progress listener
      }

      // Pick and stage files (max 2) - plugin saves them
      console.log(
        `[FileUpload] Calling pickAndStageMany with maxFiles: ${MAX_UPLOAD_FILES}`
      );
      const result = await NativeUploader.pickAndStageMany({
        maxFiles: MAX_UPLOAD_FILES,
      });
      console.log(
        `[FileUpload] pickAndStageMany result: ${result.files.length} file(s)`
      );

      if (progressListener) {
        await progressListener.remove();
        console.log("[FileUpload] Progress listener removed");
      }

      if (!result.files || result.files.length === 0) {
        toast.update(toastId, "No files selected", "error");
        return;
      }

      // Process files sequentially
      for (let i = 0; i < result.files.length; i++) {
        const stagedFile = result.files[i];
        const fileNum = i + 1;
        console.log(
          `[FileUpload] Processing file ${fileNum}/${result.files.length}: ${stagedFile.originalName}`
        );

        try {
          // Step 1: Wait a bit for file to be fully written to disk
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Step 2: Check file size before reading (prevent memory issues)
          const fileSizeMB = stagedFile.size / (1024 * 1024);
          console.log(`[FileUpload] File size: ${fileSizeMB.toFixed(2)} MB`);
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
          console.log(`[FileUpload] Converting staged path to File object...`);
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
            console.log(`[FileUpload] File object created successfully`);
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
            // Handle ZIP file using native extraction
            console.log(
              `[FileUpload] ZIP file detected, using native extraction...`
            );
            const extractToastId = toast.loading(
              `Extracting ZIP: ${stagedFile.originalName}...`
            );

            try {
              // Use native plugin to extract ZIP recursively
              const extractResult = await ZipFolder.extractZipRecursive({
                zipPath: stagedFile.absolutePath,
                outputDir: HSC_FILES_DIR,
              });

              console.log(
                `[FileUpload] Native extraction found ${extractResult.files.length} file(s)`
              );

              if (extractResult.files.length === 0) {
                toast.update(
                  extractToastId,
                  "No supported files found in ZIP",
                  "error"
                );
                continue;
              }

              toast.update(
                extractToastId,
                `Found ${extractResult.files.length} file(s), processing...`,
                "loading"
              );

              // Process each extracted file sequentially
              for (
                let zipFileIdx = 0;
                zipFileIdx < extractResult.files.length;
                zipFileIdx++
              ) {
                const extractedFile = extractResult.files[zipFileIdx];
                const zipFileNum = zipFileIdx + 1;
                console.log(
                  `[FileUpload] Processing extracted file ${zipFileNum}/${extractResult.files.length}: ${extractedFile.name} (${extractedFile.type})`
                );

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

              toast.dismiss(extractToastId);
              toast.success(
                `Successfully processed ${extractResult.files.length} file(s) from ZIP`
              );

              // Delete the original ZIP file after extraction
              try {
                await NativeUploader.deleteFile({
                  absolutePath: stagedFile.absolutePath,
                });
                console.log(
                  `[FileUpload] Deleted original ZIP file: ${stagedFile.originalName}`
                );
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
              toast.update(
                extractToastId,
                `Error extracting ZIP: ${
                  zipError instanceof Error ? zipError.message : "Unknown error"
                }`,
                "error"
              );
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

            console.log(`[FileUpload] Adding to manifest: ${layerId}`);
            console.log(
              `[FileUpload] Manifest entry:`,
              JSON.stringify(manifestEntry, null, 2)
            );
            try {
              await upsertManifestEntry(manifestEntry);
              console.log(`[FileUpload] Successfully added to manifest`);
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

            console.log(
              `[FileUpload] Detected file extension: ${ext} for ${stagedFile.originalName}`
            );
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
              console.log(
                `[FileUpload] Starting ${
                  isRaster ? "DEM" : "Vector"
                } parsing...`
              );
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
                console.log(`[FileUpload] DEM layer created: ${layerId}`);
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
                console.log(`[FileUpload] Vector layer created: ${layerId}`);
              }

              toast.update(
                renderToastId,
                "File Rendered Successfully",
                "success"
              );
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

      toast.update(
        toastId,
        `Successfully uploaded and rendered ${result.files.length} file(s)`,
        "success"
      );
    } catch (error) {
      console.error("[FileUpload] Error:", error);
      toast.update(
        toastId,
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        "error"
      );
    } finally {
      // Always try to remove progress listener if it exists
      if (progressListener) {
        try {
          progressListener.remove();
          console.log(
            "[FileUpload] Progress listener removed in finally block"
          );
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

      console.log(
        `[Export] Preparing to export ${manifestFiles.length} file(s)`
      );
      console.log(`[Export] Files to export:`, manifestFiles);

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
    }
  };

  // Save session manually
  const handleSaveSession = async () => {
    const toastId = toast.loading("Saving session...");
    try {
      console.log("[SessionSave] Starting session save...");

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
      const { loadManifest } = await import("@/sessions/manifestStore");
      const beforeManifest = await loadManifest();
      console.log(
        `[SessionSave] Manifest before save: ${beforeManifest.length} entries`
      );
      if (beforeManifest.length > 0) {
        console.log(
          `[SessionSave] Manifest entries:`,
          JSON.stringify(beforeManifest, null, 2)
        );
      }

      // Step 7 & 8: Finalize manifest according to system design:
      // - Sort all layers in manifest by size (increasing order)
      // - Upgrade "staged" files to "saved" status
      // - Delete "staged_delete" files from files folder
      // - Remove "staged_delete" entries from manifest
      const finalizedEntries = await finalizeSaveManifest();
      console.log(
        `[SessionSave] Manifest finalized: ${finalizedEntries.length} file(s) saved`
      );
      console.log(
        `[SessionSave] Files sorted by size and staged files upgraded to saved`
      );

      // Save sketch layers as ZIP file in HSC-SESSIONS/FILES folder
      // Note: sketchLayers already filtered above in early validation
      const { HSC_FILES_DIR } = await import("@/sessions/constants");
      const { Filesystem } = await import("@capacitor/filesystem");
      const sketchLayersPath = `${HSC_FILES_DIR}/sketch_layers.zip`;

      if (sketchLayers.length > 0) {
        console.log(
          `[SessionSave] Saving ${sketchLayers.length} sketch layer(s)...`
        );
        const { saveLayers } = await import("@/lib/autosave");
        const { Directory } = await import("@capacitor/filesystem");
        await saveLayers(sketchLayers, sketchLayersPath, Directory.Documents);
        console.log(`[SessionSave] Sketch layers saved successfully`);
      } else {
        // Delete sketch_layers.zip if no sketch layers exist (clear old sketch layers)
        try {
          const { Directory } = await import("@capacitor/filesystem");
          await Filesystem.deleteFile({
            path: sketchLayersPath,
            directory: Directory.Documents,
          });
          console.log(
            `[SessionSave] Deleted sketch_layers.zip (no sketch layers in session)`
          );
        } catch (error) {
          // File might not exist, which is fine
          console.log(
            `[SessionSave] sketch_layers.zip doesn't exist (this is OK)`
          );
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
      console.log("[SessionRestore] Starting session restore...");
      // Restore: Merge temp manifest with stored manifest (ensures unique layer_id)
      const { restoreManifest } = await import("@/sessions/manifestStore");
      const mergedEntries = await restoreManifest();

      // Filter to only "saved" entries for rendering
      const savedEntries = mergedEntries.filter((x) => x.status === "saved");
      console.log(
        `[SessionRestore] Found ${savedEntries.length} saved entries to restore`
      );

      // Create set of saved layer IDs
      const savedLayerIds = new Set(savedEntries.map((e) => e.layerId));

      // Clear all current layers that are NOT in the saved manifest
      // This ensures we only show layers from the saved session
      const currentLayers = layers;
      const layersToKeep: LayerProps[] = [];
      const layersToRemove: string[] = [];

      for (const layer of currentLayers) {
        // Keep sketch layers (point, line, polygon, azimuth) as they're restored separately
        const isSketchLayer =
          layer.type === "point" ||
          layer.type === "line" ||
          layer.type === "polygon" ||
          layer.type === "azimuth";

        if (isSketchLayer) {
          // Sketch layers will be restored from ZIP, so we'll keep them for now
          // They'll be replaced when sketch layers are restored
          layersToKeep.push(layer);
        } else if (savedLayerIds.has(layer.id)) {
          // Keep layers that are in saved manifest
          layersToKeep.push(layer);
        } else {
          // Mark for removal - these are staged layers not in saved manifest
          layersToRemove.push(layer.id);
        }
      }

      // Remove layers that are not in saved manifest
      if (layersToRemove.length > 0) {
        console.log(
          `[SessionRestore] Removing ${layersToRemove.length} layer(s) not in saved session`
        );
        for (const layerId of layersToRemove) {
          deleteLayer(layerId);
        }
      }

      // Get existing layer IDs after cleanup to ensure uniqueness
      const existingLayerIds = new Set(layersToKeep.map((l) => l.id));

      // Restore layers from saved files (only if layer_id is unique)
      let restoredFileCount = 0;
      let restoredSketchCount = 0;
      for (let i = 0; i < savedEntries.length; i++) {
        const entry = savedEntries[i];

        // Skip if layer_id already exists (prevent duplicates)
        if (existingLayerIds.has(entry.layerId)) {
          console.log(
            `[SessionRestore] Skipping duplicate layer_id: ${entry.layerId}`
          );
          continue;
        }

        const progressToastId = toast.loading(
          `Restoring File ${i + 1}/${savedEntries.length}: ${
            entry.originalName
          }`
        );

        try {
          console.log(
            `[SessionRestore] Restoring file ${i + 1}/${savedEntries.length}: ${
              entry.originalName
            }`
          );

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
            console.log(
              `[SessionRestore] Skipping ZIP file (should have been extracted): ${entry.originalName}`
            );
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
            console.log(
              `[SessionRestore] Processing shapefile ZIP: ${entry.originalName}`
            );
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
      // First, remove existing sketch layers to avoid duplicates
      const currentSketchLayerIds = layersToKeep
        .filter(
          (l) =>
            l.type === "point" ||
            l.type === "line" ||
            l.type === "polygon" ||
            l.type === "azimuth"
        )
        .map((l) => l.id);

      if (currentSketchLayerIds.length > 0) {
        console.log(
          `[SessionRestore] Removing ${currentSketchLayerIds.length} existing sketch layer(s) before restore`
        );
        for (const layerId of currentSketchLayerIds) {
          deleteLayer(layerId);
        }
      }

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

                // Get updated existing layer IDs after cleanup
                const updatedExistingLayerIds = new Set(
                  layers.map((l) => l.id)
                );

                // Add sketch layers ensuring unique layer_id
                for (const sketchLayer of sketchLayers) {
                  if (!updatedExistingLayerIds.has(sketchLayer.id)) {
                    addLayer(sketchLayer);
                    updatedExistingLayerIds.add(sketchLayer.id);
                    restoredSketchCount++;
                  } else {
                    console.log(
                      `[SessionRestore] Skipping duplicate sketch layer_id: ${sketchLayer.id}`
                    );
                  }
                }
                console.log(
                  `[SessionRestore] Restored ${restoredSketchCount} sketch layer(s)`
                );
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

  // Toggle user location visibility and focus to location when enabling
  const handleToggleUserLocation = () => {
    const willShow = !showUserLocation;
    setShowUserLocation(willShow);

    // If enabling location and we have user location, focus/pan to it
    if (willShow && userLocation && mapRef.current) {
      const map = mapRef.current.getMap();
      map.easeTo({
        center: [userLocation.lng, userLocation.lat],
        zoom: Math.max(map.getZoom(), 14), // Zoom to at least level 14, or keep current if higher
        duration: 1000,
      });
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

    if (
      updatedPath.length >= 3 &&
      isPointNearFirstPoint(point, updatedPath[0])
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
        const zoomDiff = Math.abs(currentZoom - 12); // Rough check
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
            maxZoom: 12,
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
  };

  const handleMouseUp = () => {
    if (!isDrawing || !dragStart) return;

    setIsDrawing(false);
    setDragStart(null);
  };

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

  const notificationsActive =
    networkLayersVisible && (connectionError || noDataWarning);
  const { host, port } = useUdpConfigStore();

  const handleNodeIconClick = useCallback(
    (info: PickingInfo<unknown>) => {
      if (!info || !info.object) {
        return;
      }

      const node = info.object as Node;
      const nodeId = node?.userId?.toString();
      if (nodeId) {
        setSelectedNodeForIcon(nodeId);
      }
      setHoverInfo(undefined);
    },
    [setHoverInfo]
  );

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

    const getSignalColor = (
      snr: number | undefined,
      rssi: number | undefined
    ): [number, number, number] => {
      if (
        typeof snr !== "number" ||
        Number.isNaN(snr) ||
        typeof rssi !== "number" ||
        Number.isNaN(rssi)
      ) {
        return [128, 128, 128];
      }
      const normalizedSNR = Math.max(0, Math.min(1, snr / 30));
      const normalizedRSSI = Math.max(0, Math.min(1, (rssi + 100) / 70));
      const signalStrength = normalizedSNR * 0.7 + normalizedRSSI * 0.3;
      if (signalStrength >= 0.7) return [0, 255, 0];
      if (signalStrength >= 0.4) return [255, 165, 0];
      return [255, 0, 0];
    };

    const getNodeIcon = (node: Node, allNodes: Node[] = []) => {
      const nodeId = node.userId?.toString();
      if (nodeId && nodeIconMappings[nodeId]) {
        const iconName = nodeIconMappings[nodeId];
        const isRectangularIcon = [
          "ground_unit",
          "command_post",
          "naval_unit",
        ].includes(iconName);
        return {
          url: `/icons/${iconName}.svg`,
          width: isRectangularIcon ? 28 : 24,
          height: isRectangularIcon ? 20 : 24,
          anchorY: isRectangularIcon ? 10 : 12,
          anchorX: isRectangularIcon ? 14 : 12,
          mask: false,
        };
      }

      let iconName = "neutral_aircraft";

      const getMotherAircraft = () => {
        if (!allNodes.length) return null;
        const sortedNodes = allNodes
          .filter((n) => typeof n.snr === "number")
          .sort((a, b) => {
            const snrA = a.snr ?? -Infinity;
            const snrB = b.snr ?? -Infinity;
            if (snrB !== snrA) return snrB - snrA;
            return a.userId - b.userId;
          });
        return sortedNodes[0] ?? null;
      };

      const motherAircraft = getMotherAircraft();

      if (motherAircraft && node.userId === motherAircraft.userId) {
        iconName = "mother-aircraft";
      } else if (node.hopCount === 0) {
        iconName = "command_post";
      } else if ((node.snr ?? 0) > 20) {
        iconName = "friendly_aircraft";
      } else if ((node.snr ?? 0) > 10) {
        iconName = "ground_unit";
      } else if ((node.snr ?? 0) > 0) {
        iconName = "neutral_aircraft";
      } else {
        iconName = "unknown_aircraft";
      }

      const isRectangularIcon = [
        "ground_unit",
        "command_post",
        "naval_unit",
      ].includes(iconName);
      return {
        url: `/icons/${iconName}.svg`,
        width: isRectangularIcon ? 28 : 24,
        height: isRectangularIcon ? 20 : 24,
        anchorY: isRectangularIcon ? 10 : 12,
        anchorX: isRectangularIcon ? 14 : 12,
        mask: false,
      };
    };

    const visibleLayers = layers
      .filter(isLayerVisible)
      .filter(
        (layer) =>
          !(layer.type === "point" && layer.name?.startsWith("Polygon Point"))
      )
      .filter((layer) => {
        const minZoomCheck =
          layer.minzoom === undefined || mapZoom >= layer.minzoom;
        const maxZoomCheck = mapZoom <= (layer.maxzoom ?? 20);
        return minZoomCheck && maxZoomCheck;
      });
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
    const nodeLayers = visibleLayers.filter((l) => l.type === "nodes");

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
        console.warn("DEM layer missing usable image source:", {
          id: layer.id,
          name: layer.name,
          hasBitmap: !!layer.bitmap,
          hasTexture: !!layer.texture,
        });
        return;
      }

      deckLayers.push(
        new BitmapLayer({
          id: `${layer.id}-bitmap`,
          image,
          bounds: [minLng, minLat, maxLng, maxLat],
          pickable: true,
          visible: layer.visible !== false,
          minZoom: layer.minzoom,
          onHover: handleLayerHover,
        })
      );
    });

    if (pointLayers.length) {
      // Create a unique key based on all radius values to force update
      const radiusKey = pointLayers
        .map((l) => `${l.id}:${l.radius ?? 5}`)
        .join("|");

      deckLayers.push(
        new ScatterplotLayer({
          id: "point-layer",
          data: pointLayers,
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
          pickingRadius: 300, // Larger picking radius for touch devices
          radiusMinPixels: 1,
          radiusMaxPixels: 50,
          onHover: handleLayerHover,
          updateTriggers: {
            getRadius: [radiusKey], // Update when any radius changes
            getFillColor: [
              pointLayers.map((l) => l.color?.join(",")).join("|"),
            ],
          },
        })
      );
    }

    // User location layers will be added at the end to render on top

    if (lineLayers.length) {
      const pathData = lineLayers.flatMap((layer) => {
        const path = layer.path ?? [];
        if (path.length < 2) return []; // Need at least 2 points for a line

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
              color: layer.color ? [...layer.color] : [0, 0, 0], // Black default
              width: layer.lineWidth ?? 5,
              layerId: layer.id,
              layer: layer,
              bearing: layer.bearing, // Include bearing for azimuthal lines
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);
      });

      if (pathData.length > 0) {
        deckLayers.push(
          new LineLayer({
            id: "line-layer",
            data: pathData,
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => {
              const color = d.color || [0, 0, 0]; // Black default
              return color.length === 3 ? [...color, 255] : color;
            },
            getWidth: (d: any) => Math.max(1, d.width), // Minimum width of 1
            widthUnits: "pixels", // Use pixels instead of meters
            widthMinPixels: 1, // Minimum width of 1 pixel
            widthMaxPixels: 50, // Maximum width of 50 pixels
            pickable: true,
            pickingRadius: 300, // Larger picking radius for touch devices
            onHover: handleLayerHover,
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
        deckLayers.push(
          new LineLayer({
            id: "connection-line-layer",
            data: connectionPathData,
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => Math.max(1, d.width), // Minimum width of 1
            widthUnits: "pixels", // Use pixels instead of meters
            widthMinPixels: 1, // Minimum width of 1 pixel
            widthMaxPixels: 50, // Maximum width of 50 pixels
            pickable: true,
            pickingRadius: 300, // Larger picking radius for touch devices
            onHover: handleLayerHover,
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

      deckLayers.push(
        new PolygonLayer({
          id: "polygon-layer",
          data: polygonData,
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
          pickingRadius: 300, // Larger picking radius for touch devices
          onHover: handleLayerHover,
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
        deckLayers.push(
          new PathLayer({
            id: "polygon-outline-layer",
            data: polygonOutlines,
            getPath: (d: any) => d.path,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => d.width,
            widthUnits: "pixels",
            widthMinPixels: 1,
            widthMaxPixels: 50,
            pickable: true,
            pickingRadius: 300,
            onHover: handleLayerHover,
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
        deckLayers.push(
          new LineLayer({
            id: "line-layer-vertices",
            data: pathData,
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
            pickingRadius: 300,
            onHover: handleLayerHover,
            capRounded: true,
            jointRounded: true,
            parameters: { depthTest: false },
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
                radius: index === 0 ? 200 : 180,
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);
        });

        if (vertexData.length > 0) {
          deckLayers.push(
            new ScatterplotLayer({
              id: "line-vertex-layer",
              data: vertexData,
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

      if (azimuthLineData.length) {
        deckLayers.push(
          new LineLayer({
            id: "azimuth-lines-layer",
            data: azimuthLineData,
            pickable: true,
            pickingRadius: 200,
            onHover: handleLayerHover,
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => d.width,
            getDashArray: (d: any) => d.dashArray ?? [0, 0],
            dashJustified: true,
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
          })
        );
      }
    }

    geoJsonLayers.forEach((layer) => {
      if (!layer.geojson) return;
      const lineWidth = layer.lineWidth ?? 5;
      deckLayers.push(
        new GeoJsonLayer({
          id: layer.id,
          data: layer.geojson,
          pickable: true,
          pickingRadius: 300, // Larger picking radius for touch devices
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
          },
          onHover: handleLayerHover,
        })
      );
    });

    annotationLayers.forEach((layer) => {
      if (!layer.annotations?.length) return;
      deckLayers.push(
        new TextLayer({
          id: layer.id,
          data: layer.annotations,
          getPosition: (d: any) => d.position,
          getText: (d: any) => d.text,
          getColor: (d: any) => d.color ?? layer.color ?? [0, 0, 0],
          getSize: (d: any) => d.fontSize ?? 14,
          getAngle: 0,
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          pickable: true,
          pickingRadius: 300, // Larger picking radius for touch devices
          sizeScale: 1,
          fontFamily: "Arial, sans-serif",
          fontWeight: "normal",
          onHover: handleLayerHover,
        })
      );
    });

    nodeLayers.forEach((layer) => {
      if (!layer.nodes?.length) return;
      const nodes = [...layer.nodes];

      deckLayers.push(
        new IconLayer({
          id: `${layer.id}-icon-layer`,
          data: nodes,
          pickable: true,
          pickingRadius: 300, // Larger picking radius for touch devices
          getIcon: (node: Node) => getNodeIcon(node, nodes),
          getPosition: (node: Node) => [node.longitude, node.latitude],
          getSize: 24,
          sizeScale: 1,
          getPixelOffset: [0, -10],
          alphaCutoff: 0.001,
          billboard: true,
          sizeUnits: "pixels",
          sizeMinPixels: 16,
          sizeMaxPixels: 32,
          updateTriggers: {
            getIcon: [nodes.length, Object.values(nodeIconMappings).join(",")],
          },
          onHover: handleLayerHover,
          onClick: handleNodeIconClick,
        })
      );

      deckLayers.push(
        new ScatterplotLayer({
          id: `${layer.id}-signal-overlay`,
          data: nodes,
          getPosition: (node: Node) => [node.longitude, node.latitude],
          getRadius: 12000,
          getFillColor: (node: Node) => getSignalColor(node.snr, node.rssi),
          getLineColor: [255, 255, 255, 200],
          getLineWidth: 2,
          radiusMinPixels: 8,
          radiusMaxPixels: 32,
          pickable: true,
          pickingRadius: 300, // Larger picking radius for touch devices
          onHover: handleLayerHover,
          onClick: handleNodeIconClick,
        })
      );
    });

    // Add offline vector tiles layer if server is running
    if (tileServerUrl) {
      try {
        const tileUrl = `${tileServerUrl}/{z}/{x}/{y}.pbf`;
        console.log(
          "CAPACITOR_HAHA [MVTLayer] Adding layer with URL template:",
          tileUrl
        );

        deckLayers.push(
          new MVTLayer({
            id: "offline-vector-tiles",
            data: tileUrl,
            minZoom: 0,
            maxZoom: 20,
            getFillColor: [128, 128, 128, 180],
            getLineColor: [0, 0, 0, 255],
            getPointRadius: 3,
            lineWidthMinPixels: 1,
            pickable: true,
            onHover: handleLayerHover,
            onError: (error) => {
              // Extract tile info from error if available
              const errorMsg = error?.message || String(error);
              const tileMatch = errorMsg.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf/);
              if (tileMatch) {
                const [, z, x, y] = tileMatch;
                console.error(
                  `CAPACITOR_HAHA [MVTLayer] Error loading tile: z=${z}, x=${x}, y=${y}`,
                  error
                );
              } else {
                console.error(
                  "CAPACITOR_HAHA [MVTLayer] Error loading tiles:",
                  error
                );
              }
            },
            // Auto-detect layers from tiles
            // layers: ['water', 'landcover', 'boundary'],
          })
        );

        console.log("CAPACITOR_HAHA [MVTLayer] Layer added successfully");
      } catch (error) {
        console.error(
          "CAPACITOR_HAHA [MVTLayer] Error adding MVTLayer:",
          error
        );
      }
    }

    // --- Preview layers ---
    const previewLayers: any[] = [];

    // Add UDP layers to the deck layers
    if (udpLayers && udpLayers.length > 0) {
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
            data: [previewPath],
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
        radius: 150,
        color: index === 0 ? [255, 255, 0] : [255, 0, 255],
      }));
      previewLayers.push(
        new ScatterplotLayer({
          id: "preview-point-layer",
          data: previewPointData,
          getPosition: (d: any) => d.position,
          getRadius: (d: any) => d.radius,
          getFillColor: (d: any) => d.color,
          pickable: false,
          radiusMinPixels: 4,
        })
      );
    }

    // Return layers (user location will be added separately after default layers)
    return [...deckLayers, ...previewLayers];
  }, [
    layers,
    networkLayersVisible,
    nodeIconMappings,
    isDrawing,
    drawingMode,
    currentPath,
    mousePosition,
    handleLayerHover,
    handleNodeIconClick,
    udpLayers,
    userLocation,
    showUserLocation,
    mapZoom,
    tileServerUrl,
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
        mapStyle={`${tileServerUrl}/style.json`}
        renderWorldCopies={false}
        reuseMaps={true}
        attributionControl={false}
        dragRotate={true}
        touchZoomRotate={true}
        pitchWithRotate={true}
        initialViewState={{
          longitude: tileServerUrl ? 0 : 81.5, // World center (0) when using tile server, India center otherwise
          latitude: tileServerUrl ? 0 : 20.5, // Equator (0) when using tile server, India center otherwise
          zoom: tileServerUrl ? 2 : 6, // World view (zoom 2) when using tile server, India view (zoom 6) otherwise
          pitch: pitch,
          bearing: 0,
        }}
        minZoom={0}
        maxZoom={15}
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

          if (tileServerUrl) {
            console.log(
              "[Map] Tile server active, using MVTLayer from:",
              tileServerUrl
            );
          }

          mapInstance.setMaxBounds(null);
        }}
        onClick={handleMapClick}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMove={(e: any) => {
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
                    pickingRadius: 300,
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
        showUserLocation={showUserLocation}
        onOpenConnectionConfig={() => setIsUdpConfigDialogOpen(true)}
        onOpenTileFolder={() => setIsTileFolderDialogOpen(true)}
        isProcessingFiles={isProcessingFiles}
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

      {/* Tile Folder Dialog */}
      <TileFolderDialog
        isOpen={isTileFolderDialogOpen}
        onOpenChange={setIsTileFolderDialogOpen}
        onFolderSelected={async (_uri, serverUrl) => {
          setTileServerUrl(serverUrl);
          toast.success("Offline tiles loaded successfully!");
        }}
      />
    </div>
  );
};

export default MapComponent;
