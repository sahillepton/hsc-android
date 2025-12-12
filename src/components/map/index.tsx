import Map, { useControl, NavigationControl } from "react-map-gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { PickingInfo } from "@deck.gl/core";
import {
  BitmapLayer,
  GeoJsonLayer,
  IconLayer,
  LineLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer,
} from "@deck.gl/layers";
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
import { useUdpConfigStore } from "@/store/udp-config-store";
import { useDefaultLayers } from "@/hooks/use-default-layers";
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
  fileToGeoJSON,
  fileToDEMRaster,
  generateRandomColor,
} from "@/lib/utils";
import type { LayerProps, Node } from "@/lib/definitions";
import { Directory } from "@capacitor/filesystem";
import { toast } from "@/lib/toast";

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
  const { layers, addLayer, setLayers } = useLayers();
  const { setNodeIconMappings } = useNodeIconMappings();
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
  const [isUdpConfigDialogOpen, setIsUdpConfigDialogOpen] = useState(false);
  const [configKey, setConfigKey] = useState(0);
  const [showConnectionError, setShowConnectionError] = useState(false);
  const [isCameraPopoverOpen, setIsCameraPopoverOpen] = useState(false);
  const [isMeasurementBoxOpen, setIsMeasurementBoxOpen] = useState(false);
  const [isNetworkBoxOpen, setIsNetworkBoxOpen] = useState(false);
  const lastLayerCreationTimeRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  // Export layers using FileSection's downloadAllLayers with fixed Documents directory
  const handleExportLayers = async () => {
    if (layers.length === 0) {
      toast.error("No layers to export.");
      return;
    }
    const toastId = toast.loading("Exporting layers...");
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const zipFileName = `layers_export_${timestamp}.zip`;
      const { saveLayers } = await import("@/lib/autosave");
      await saveLayers(
        layers,
        `HSC_LAYERS/${zipFileName}`,
        Directory.Documents
      );
      toast.update(
        toastId,
        `Saved to Documents/HSC_LAYERS/${zipFileName}`,
        "success"
      );
    } catch (error) {
      toast.update(
        toastId,
        `Failed to export layers: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        "error"
      );
    }
  };

  // Save session manually
  const handleSaveSession = async () => {
    const toastId = toast.loading("Saving session...");
    try {
      const { saveLayers } = await import("@/lib/autosave");
      await saveLayers(layers);
      toast.update(toastId, "Session saved successfully", "success");
    } catch (error) {
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
  const handleRestoreSession = async () => {
    const toastId = toast.loading("Restoring session...");
    try {
      const { loadLayers } = await import("@/lib/autosave");
      const restoredLayers = await loadLayers();
      if (restoredLayers.length > 0) {
        setLayers(restoredLayers);
        toast.update(
          toastId,
          `Restored ${restoredLayers.length} layer(s) from session`,
          "success"
        );
      } else {
        toast.update(toastId, "No session data found", "error");
      }
    } catch (error) {
      toast.update(
        toastId,
        `Failed to restore session: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        "error"
      );
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

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Process each selected file
    const toastId = toast.loading("Uploading files...");
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await processUploadedFile(file);
      }
      toast.update(
        toastId,
        `Successfully uploaded ${files.length} file${
          files.length > 1 ? "s" : ""
        }`,
        "success"
      );
    } catch (error) {
      toast.update(
        toastId,
        `Error uploading files: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        "error"
      );
    }
    // Reset the input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Helper function to extract size from properties (for CSV)
  const extractSizeFromProperties = (
    properties: any,
    sizeType: "point" | "line"
  ): number | null => {
    if (!properties) return null;
    const key =
      sizeType === "point"
        ? properties.radius || properties.pointRadius || properties.size
        : properties.width || properties.lineWidth || properties.strokeWidth;
    if (typeof key === "number" && key > 0) return key;
    return null;
  };

  // Upload DEM file with error handling for large files
  const uploadDemFile = async (file: File) => {
    try {
      // Check file size and warn for very large files
      const fileSizeMB = file.size / (1024 * 1024);
      if (fileSizeMB > 50) {
      }

      // Add timeout for large file processing (5 minutes max)
      const processingTimeout = setTimeout(() => {}, 60000); // 1 minute warning

      let dem;
      try {
        // Prefer worker: offload DEM parsing; fallback to main thread if worker fails/times out
        const runWorker = async () => {
          const worker = new Worker(
            new URL("../../workers/dem-worker.ts", import.meta.url),
            { type: "module" }
          );
          const ab = await file.arrayBuffer();
          const result = await new Promise<any>((resolve, reject) => {
            const timer = setTimeout(() => {
              worker.terminate();
              reject(new Error("Worker timeout"));
            }, 300000);
            worker.onmessage = (e: MessageEvent<any>) => {
              clearTimeout(timer);
              worker.terminate();
              resolve(e.data);
            };
            worker.onerror = (err) => {
              clearTimeout(timer);
              worker.terminate();
              reject(err);
            };
            worker.postMessage(
              { type: "parse-dem", name: file.name, buffer: ab },
              [ab]
            );
          });
          if (result?.error) throw new Error(result.error);

          // Rebuild canvas from grayscale on main thread
          const elevation = new Float32Array(result.elevationBuffer);
          const grayscale = new Uint8ClampedArray(result.grayscaleBuffer);
          const canvas = document.createElement("canvas");
          canvas.width = result.width;
          canvas.height = result.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            throw new Error("Failed to create canvas for DEM");
          }
          const cloned = new Uint8ClampedArray(grayscale.length);
          cloned.set(grayscale);
          const img = new ImageData(cloned, result.width, result.height);
          ctx.putImageData(img, 0, 0);

          return {
            bounds: result.bounds,
            width: result.width,
            height: result.height,
            data: elevation,
            min: result.min,
            max: result.max,
            canvas,
          };
        };

        dem = await Promise.race([
          runWorker(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("Processing timeout after 5 minutes")),
              300000
            )
          ),
        ]);
        clearTimeout(processingTimeout);
      } catch (workerErr) {
        // Worker failed; fallback to main-thread parsing
        dem = await Promise.race([
          fileToDEMRaster(file),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("Processing timeout after 5 minutes")),
              300000
            )
          ),
        ]);
        clearTimeout(processingTimeout);
      }

      const isDefaultBounds =
        dem.bounds[0] === 68.0 &&
        dem.bounds[1] === 6.0 &&
        dem.bounds[2] === 97.0 &&
        dem.bounds[3] === 37.0;

      const newLayer: LayerProps = {
        type: "dem",
        id: generateLayerId(),
        name: file.name.split(".")[0],
        color: [255, 255, 255],
        visible: true,
        bounds: [
          [dem.bounds[0], dem.bounds[1]],
          [dem.bounds[2], dem.bounds[3]],
        ],
        bitmap: dem.canvas,
        texture: dem.canvas,
        elevationData: {
          data: dem.data,
          width: dem.width,
          height: dem.height,
          min: dem.min,
          max: dem.max,
        },
        uploadedAt: Date.now(),
      } as LayerProps & { uploadedAt: number };
      addLayer(newLayer);

      if (isDefaultBounds) {
        console.warn(
          "DEM uploaded with default bounds (may not be correctly positioned). Use a georeferenced GeoTIFF for accurate positioning."
        );
      } else {
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Provide helpful error messages for common issues
      let userMessage = `Error uploading DEM: ${errorMessage}`;
      if (errorMessage.includes("timeout") || errorMessage.includes("time")) {
        userMessage = `File too large or processing timeout. Try a smaller file or wait longer.`;
      } else if (
        errorMessage.includes("memory") ||
        errorMessage.includes("Memory")
      ) {
        userMessage = `File too large for available memory. Try a smaller file.`;
      }

      console.error(userMessage);
    }
  };

  // Upload GeoJSON/Vector file
  const parseVectorInWorker = async (file: File) => {
    const worker = new Worker(
      new URL("../../workers/vector-worker.ts", import.meta.url),
      { type: "module" }
    );
    const ab = await file.arrayBuffer();
    return await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error("Vector worker timeout"));
      }, 180000); // 3 minutes
      worker.onmessage = (e: MessageEvent<any>) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(e.data);
      };
      worker.onerror = (err) => {
        clearTimeout(timer);
        worker.terminate();
        reject(err);
      };
      worker.postMessage(
        { type: "parse-vector", name: file.name, mime: file.type, buffer: ab },
        [ab]
      );
    });
  };

  const uploadGeoJsonFile = async (
    file: File,
    suppressToast: boolean = false
  ) => {
    try {
      const lowerName = file.name.toLowerCase();
      let ext = "";
      if (lowerName.endsWith(".geojson")) {
        ext = "geojson";
      } else if (lowerName.endsWith(".tiff")) {
        ext = "tiff";
      } else {
        const parts = lowerName.split(".");
        ext = parts.length > 1 ? parts[parts.length - 1] : "";
      }

      const shouldOffloadVector = [
        "csv",
        "gpx",
        "kml",
        "kmz",
        "wkt",
        "prj",
      ].includes(ext);

      let rawGeojson: any = null;

      if (shouldOffloadVector) {
        try {
          const workerResult = await parseVectorInWorker(file);
          if (workerResult?.geojson) {
            rawGeojson = workerResult.geojson;
          } else if (workerResult?.unsupported) {
            // Fall back to main thread below
          } else if (workerResult?.error) {
            // Fall back to main thread parsing
          }
        } catch {
          // Fall back to main thread parsing
        }
      }

      if (!rawGeojson) {
        rawGeojson = await fileToGeoJSON(file);
      }

      // Convert to FeatureCollection format
      let features: GeoJSON.Feature[] = [];

      if (rawGeojson.type === "FeatureCollection") {
        features = (rawGeojson as GeoJSON.FeatureCollection).features || [];
      } else if (rawGeojson.type === "Feature") {
        features = [rawGeojson as GeoJSON.Feature];
      } else if (
        (rawGeojson as any).features &&
        Array.isArray((rawGeojson as any).features)
      ) {
        features = (rawGeojson as any).features;
      } else if ((rawGeojson as any).geometry) {
        features = [
          {
            type: "Feature",
            geometry: (rawGeojson as any).geometry,
            properties: (rawGeojson as any).properties ?? {},
          },
        ];
      }

      // Filter out invalid features
      const validFeatures = features.filter((f) => f && f.geometry);

      // Extract size values from properties if available
      const firstFeature = validFeatures[0];
      const hasPoints = validFeatures.some(
        (f) => f.geometry?.type === "Point" || f.geometry?.type === "MultiPoint"
      );
      const hasLines = validFeatures.some(
        (f) =>
          f.geometry?.type === "LineString" ||
          f.geometry?.type === "MultiLineString"
      );

      const extractedPointRadius = hasPoints
        ? extractSizeFromProperties(firstFeature?.properties, "point")
        : null;
      const extractedLineWidth = hasLines
        ? extractSizeFromProperties(firstFeature?.properties, "line")
        : null;

      const newLayer: LayerProps = {
        type: "geojson",
        id: generateLayerId(),
        name: file.name.split(".")[0],
        geojson: {
          type: "FeatureCollection",
          features: validFeatures,
        },
        color: generateRandomColor(),
        pointRadius: extractedPointRadius ?? 5,
        lineWidth: extractedLineWidth ?? 5,
        visible: true,
        uploadedAt: Date.now(),
      } as LayerProps & { uploadedAt: number };

      addLayer(newLayer);
    } catch (error) {
      console.error(
        `Error uploading file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      throw error;
    }
  };

  // Upload annotation file
  const uploadAnnotationFile = async (file: File) => {
    try {
      const geojson = await fileToGeoJSON(file);

      if (
        !geojson ||
        geojson.type !== "FeatureCollection" ||
        !Array.isArray(geojson.features)
      ) {
        console.error(
          "Invalid annotation file format. Could not convert to GeoJSON."
        );
        return;
      }

      if (geojson.features.length === 0) {
        console.error("Annotation file contains no features.");
        return;
      }

      const annotations: Array<{
        position: [number, number];
        text: string;
        color?: [number, number, number];
        fontSize?: number;
      }> = [];

      geojson.features.forEach((feature: any) => {
        const text =
          feature.properties?.text ||
          feature.properties?.label ||
          feature.properties?.name ||
          feature.properties?.annotation ||
          feature.properties?.title ||
          "";

        if (text && feature.geometry) {
          let position: [number, number] | null = null;

          if (
            feature.geometry.type === "Point" &&
            feature.geometry.coordinates
          ) {
            position = [
              feature.geometry.coordinates[0],
              feature.geometry.coordinates[1],
            ];
          } else if (
            feature.geometry.type === "LineString" &&
            feature.geometry.coordinates.length > 0
          ) {
            position = [
              feature.geometry.coordinates[0][0],
              feature.geometry.coordinates[0][1],
            ];
          } else if (
            feature.geometry.type === "Polygon" &&
            feature.geometry.coordinates.length > 0
          ) {
            position = [
              feature.geometry.coordinates[0][0][0],
              feature.geometry.coordinates[0][0][1],
            ];
          }

          if (position) {
            let color: [number, number, number] | undefined;
            if (feature.properties?.color) {
              if (Array.isArray(feature.properties.color)) {
                color = feature.properties.color.slice(0, 3) as [
                  number,
                  number,
                  number
                ];
              }
            }

            annotations.push({
              position,
              text: String(text),
              color,
              fontSize:
                feature.properties?.fontSize ||
                feature.properties?.font_size ||
                undefined,
            });
          }
        }
      });

      if (annotations.length === 0) {
        console.error(
          "No valid annotations found. Features must have text/label/name/annotation properties."
        );
        return;
      }

      const newLayer: LayerProps = {
        type: "annotation",
        id: generateLayerId(),
        name: file.name.split(".")[0],
        color: [0, 0, 0],
        visible: true,
        annotations: annotations,
        uploadedAt: Date.now(),
      } as LayerProps & { uploadedAt: number };

      addLayer(newLayer);
    } catch (error) {
      console.error(
        `Error uploading annotation file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };

  // Import layers from JSON export
  const importLayersFromJson = async (file: File): Promise<boolean> => {
    const toastId = toast.loading(`Importing ${file.name}...`);
    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      if (importData.version && Array.isArray(importData.layers)) {
        if (!importData.layers || !Array.isArray(importData.layers)) {
          throw new Error("Invalid layers data format");
        }

        if (importData.layers.length > 100) {
          const proceed = window.confirm(
            `This export contains ${importData.layers.length} layers. ` +
              `Importing may take a moment and could affect performance. Continue?`
          );
          if (!proceed) {
            toast.dismiss(toastId);
            return true;
          }
        }

        setTimeout(() => {
          setLayers(importData.layers);

          if (importData.nodeIconMappings) {
            setNodeIconMappings(importData.nodeIconMappings);
          }

          setTimeout(() => {
            toast.update(
              toastId,
              `Successfully imported ${importData.layers.length} layers from ${file.name}`,
              "success"
            );
          }, 500);
        }, 300);

        return true;
      } else {
        toast.dismiss(toastId);
        return false;
      }
    } catch (error) {
      let errorMessage = "Failed to import layers";
      if (error instanceof Error) {
        const errorMsg = error.message.toLowerCase();
        if (
          errorMsg.includes("memory") ||
          errorMsg.includes("heap") ||
          errorMsg.includes("allocation")
        ) {
          errorMessage =
            "File is too large for Android. Please split the export into smaller files.";
        } else if (errorMsg.includes("parse")) {
          errorMessage = "Invalid JSON format. Please check the file.";
        } else {
          errorMessage = error.message;
        }
      }

      toast.update(toastId, errorMessage, "error");
      return false;
    }
  };

  // Find all valid files in ZIP for sequential processing (handles nested ZIPs)
  type ValidFile = {
    file: File;
    type: "tiff" | "vector" | "shapefile";
    name: string;
  };

  const findAllValidFilesInZipWithZip = async (
    zip: any,
    depth: number = 0,
    maxDepth: number = 10
  ): Promise<ValidFile[]> => {
    if (depth > maxDepth) {
      console.warn("Maximum ZIP nesting depth reached, skipping nested ZIP");
      return [];
    }

    try {
      const JSZip = (await import("jszip")).default;
      const validFiles: ValidFile[] = [];

      // Find all nested ZIP files first (to process recursively)
      const nestedZipFiles = Object.keys(zip.files).filter((name) => {
        const lowerName = name.toLowerCase();
        if (zip.files[name].dir) return false;
        return lowerName.endsWith(".zip");
      });

      // Process nested ZIPs recursively
      for (const nestedZipName of nestedZipFiles) {
        try {
          const nestedZipData = await zip.files[nestedZipName].async("blob");
          const nestedZip = await JSZip.loadAsync(nestedZipData);
          const nestedFiles = await findAllValidFilesInZipWithZip(
            nestedZip,
            depth + 1,
            maxDepth
          );
          validFiles.push(...nestedFiles);
        } catch (error) {
          console.error(`Error processing nested ZIP ${nestedZipName}:`, error);
        }
      }

      // Find all TIFF files
      const tiffFiles = Object.keys(zip.files).filter((name) => {
        const lowerName = name.toLowerCase();
        if (zip.files[name].dir) return false;
        return (
          lowerName.endsWith(".tif") ||
          lowerName.endsWith(".tiff") ||
          lowerName.endsWith(".hgt") ||
          lowerName.endsWith(".dett")
        );
      });

      for (const fileName of tiffFiles) {
        try {
          const fileEntry = zip.files[fileName];
          if (fileEntry._data?.uncompressedSize > 50 * 1024 * 1024) {
            continue; // Skip large files
          }
          const fileData = await fileEntry.async("blob");
          const baseFileName = fileName.split("/").pop() || fileName;
          const lowerName = fileName.toLowerCase();
          let mimeType = "image/tiff";
          if (lowerName.endsWith(".hgt")) {
            mimeType = "application/octet-stream";
          }
          const extractedFile = new File([fileData], baseFileName, {
            type: mimeType,
          });
          validFiles.push({
            file: extractedFile,
            type: "tiff",
            name: baseFileName,
          });
        } catch (error) {
          // Skip files that fail to extract
        }
      }

      // Find all vector files
      const vectorFiles = Object.keys(zip.files).filter((name) => {
        const lowerName = name.toLowerCase();
        if (zip.files[name].dir) return false;
        // Skip ZIP files (already processed above)
        if (lowerName.endsWith(".zip")) return false;
        const isOldExportFormat =
          lowerName.includes("layers_export") &&
          lowerName.endsWith(".json") &&
          !lowerName.includes("/");
        return (
          lowerName.endsWith(".geojson") ||
          (lowerName.endsWith(".json") &&
            !lowerName.includes("node_icon_mappings") &&
            !isOldExportFormat) ||
          lowerName.endsWith(".csv") ||
          lowerName.endsWith(".gpx") ||
          lowerName.endsWith(".kml") ||
          lowerName.endsWith(".kmz") ||
          lowerName.endsWith(".wkt") ||
          lowerName.endsWith(".prj")
        );
      });

      for (const fileName of vectorFiles) {
        try {
          const fileEntry = zip.files[fileName];
          const fileData = await fileEntry.async("blob");
          const baseFileName = fileName.split("/").pop() || fileName;
          const lowerName = fileName.toLowerCase();
          let mimeType = "application/octet-stream";
          if (lowerName.endsWith(".geojson") || lowerName.endsWith(".json")) {
            mimeType = "application/json";
          } else if (lowerName.endsWith(".csv")) {
            mimeType = "text/csv";
          } else if (lowerName.endsWith(".gpx")) {
            mimeType = "application/gpx+xml";
          } else if (lowerName.endsWith(".kml")) {
            mimeType = "application/vnd.google-earth.kml+xml";
          } else if (lowerName.endsWith(".kmz")) {
            mimeType = "application/vnd.google-earth.kmz";
          }
          const extractedFile = new File([fileData], baseFileName, {
            type: mimeType,
          });
          validFiles.push({
            file: extractedFile,
            type: "vector",
            name: baseFileName,
          });
        } catch (error) {
          // Skip files that fail to extract
        }
      }

      // Find shapefile components and group them
      const shapefileComponents = Object.keys(zip.files).filter((name) => {
        const lowerName = name.toLowerCase();
        if (zip.files[name].dir) return false;
        return (
          lowerName.endsWith(".shp") ||
          lowerName.endsWith(".shx") ||
          lowerName.endsWith(".dbf") ||
          lowerName.endsWith(".prj")
        );
      });

      if (shapefileComponents.length > 0) {
        const shapefileGroups: Record<string, string[]> = {};
        for (const fileName of shapefileComponents) {
          const baseName = fileName
            .toLowerCase()
            .replace(/\.(shp|shx|dbf|prj)$/, "");
          if (!shapefileGroups[baseName]) {
            shapefileGroups[baseName] = [];
          }
          shapefileGroups[baseName].push(fileName);
        }

        for (const [baseName, files] of Object.entries(shapefileGroups)) {
          const hasShp = files.some((f: string) =>
            f.toLowerCase().endsWith(".shp")
          );
          const hasShx = files.some((f: string) =>
            f.toLowerCase().endsWith(".shx")
          );
          const hasDbf = files.some((f: string) =>
            f.toLowerCase().endsWith(".dbf")
          );

          if (hasShp && hasShx && hasDbf) {
            try {
              const shapefileZip = new JSZip();
              for (const fileName of files) {
                const fileData = await zip.files[fileName].async("blob");
                shapefileZip.file(fileName, fileData);
              }
              const zipBlob = await shapefileZip.generateAsync({
                type: "blob",
                compression: "DEFLATE",
              });
              const extractedFile = new File([zipBlob], `${baseName}.zip`, {
                type: "application/zip",
              });
              validFiles.push({
                file: extractedFile,
                type: "shapefile",
                name: `${baseName}.zip`,
              });
            } catch (error) {
              // Skip shapefiles that fail to create
            }
          }
        }
      }

      return validFiles;
    } catch (error) {
      console.error("Error finding valid files in ZIP:", error);
      return [];
    }
  };

  // Main file import handler (matches FileSection's handleFileImport)
  const processUploadedFile = async (file: File) => {
    try {
      if (!file) {
        return;
      }

      const fileName = file.name?.toLowerCase() || "";
      let ext = "";

      if (fileName.endsWith(".geojson")) {
        ext = "geojson";
      } else if (fileName.endsWith(".tiff")) {
        ext = "tiff";
      } else {
        const parts = fileName.split(".");
        ext = parts.length > 1 ? parts[parts.length - 1] : "";
      }

      // Check for layer export JSON first
      if (ext === "json") {
        const isLayerExport = await importLayersFromJson(file);
        if (isLayerExport) {
          return;
        }
      }

      // Handle ZIP files
      if (ext === "zip") {
        let zip: any = null;
        try {
          const JSZip = (await import("jszip")).default;
          zip = await JSZip.loadAsync(file);
        } catch (zipError) {
          console.error("Error reading ZIP file:", zipError);
          return;
        }

        if (!zip) {
          console.error("Failed to load ZIP file.");
          return;
        }

        try {
          // Find all valid files in ZIP
          const validFiles = await findAllValidFilesInZipWithZip(zip);

          if (validFiles.length === 0) {
            console.error(
              "No supported files found in ZIP. The ZIP should contain GeoJSON, TIFF, CSV, GPX, KML, KMZ, or shapefile files."
            );
            return;
          }

          // Process files sequentially - one at a time
          let successCount = 0;
          let errorCount = 0;
          const typeCounts = { tiff: 0, vector: 0, shapefile: 0 };

          for (let i = 0; i < validFiles.length; i++) {
            const validFile = validFiles[i];
            try {
              if (validFile.type === "tiff") {
                await uploadDemFile(validFile.file);
                typeCounts.tiff++;
                successCount++;
              } else if (
                validFile.type === "vector" ||
                validFile.type === "shapefile"
              ) {
                await uploadGeoJsonFile(validFile.file, true);
                if (validFile.type === "shapefile") {
                  typeCounts.shapefile++;
                } else {
                  typeCounts.vector++;
                }
                successCount++;
              }

              // Wait for the layer to be added before moving to next file
              await new Promise((resolve) => setTimeout(resolve, 100));
            } catch (error) {
              console.error(
                `Error processing ${validFile.name} from ZIP:`,
                error
              );
              errorCount++;
            }
          }

          // Check for node_icon_mappings.json
          try {
            const nodeIconMappingsFile = Object.keys(zip.files).find((name) =>
              name.toLowerCase().includes("node_icon_mappings.json")
            );
            if (nodeIconMappingsFile) {
              const fileData = await zip.files[nodeIconMappingsFile].async(
                "string"
              );
              const mappings = JSON.parse(fileData);
              setNodeIconMappings(mappings);
            }
          } catch {
            // Silently fail for node icon mappings
          }

          // Log final results
          if (successCount > 0) {
            const parts: string[] = [];
            if (typeCounts.tiff > 0)
              parts.push(
                `${typeCounts.tiff} DEM${typeCounts.tiff > 1 ? "s" : ""}`
              );
            if (typeCounts.vector > 0)
              parts.push(`${typeCounts.vector} vector`);
            if (typeCounts.shapefile > 0)
              parts.push(`${typeCounts.shapefile} shapefile`);
          } else {
            console.error(
              "No files could be imported. Check console for errors."
            );
          }
        } catch (zipProcessError) {
          console.error(
            `Error processing ZIP file: ${
              zipProcessError instanceof Error
                ? zipProcessError.message
                : "Unknown error"
            }`
          );
          return;
        }
      }

      const vectorExtensions = [
        "wkt",
        "prj",
        "geojson",
        "json",
        "shp",
        "zip",
        "csv",
        "gpx",
        "kml",
        "kmz",
      ];
      const rasterExtensions = ["tif", "tiff", "hgt"];

      // Check for annotation files
      if (ext === "geojson" || ext === "json") {
        const isAnnotationFile =
          fileName.includes("annotation") ||
          fileName.includes("label") ||
          fileName.includes("text") ||
          fileName.includes("annot");

        try {
          const text = await file.text();
          const parsed = JSON.parse(text);

          if (
            parsed.type === "FeatureCollection" &&
            Array.isArray(parsed.features)
          ) {
            const hasTextProperties = parsed.features.some(
              (f: any) =>
                f.properties &&
                (f.properties.text ||
                  f.properties.label ||
                  f.properties.annotation ||
                  f.properties.title)
            );

            if (hasTextProperties || isAnnotationFile) {
              const fileBlob = new Blob([text], { type: file.type });
              const newFile = new File([fileBlob], file.name, {
                type: file.type,
              });
              await uploadAnnotationFile(newFile);
              return;
            }
          }
        } catch (error) {
          // Continue to normal processing
        }
      }

      // Handle vector files
      if (vectorExtensions.includes(ext)) {
        await uploadGeoJsonFile(file);
      } else if (rasterExtensions.includes(ext)) {
        await uploadDemFile(file);
      } else {
        const mimeType = file.type?.toLowerCase() || "";
        if (mimeType.includes("json") || mimeType.includes("geojson")) {
          await uploadGeoJsonFile(file);
        } else if (mimeType.includes("tiff") || mimeType.includes("tif")) {
          await uploadDemFile(file);
        } else {
          console.error(
            `Unsupported file type: .${ext}. Supported formats: GeoJSON, CSV, TIFF, GPX, KML, KMZ, WKT/PRJ, or shapefile (with .prj).`
          );
        }
      }
    } catch (error) {
      console.error(
        `Error importing file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };

  const measurementPreview = useMemo(() => {
    if (!isDrawing) return null;

    if (drawingMode === "polyline" && currentPath.length >= 1) {
      const path = [...currentPath];
      if (mousePosition) path.push(mousePosition);
      if (path.length < 2) return null;

      const segmentDistances = computeSegmentDistancesKm(path);
      const totalKm = segmentDistances.reduce((sum, dist) => sum + dist, 0);
      const segments = segmentDistances.map((dist, idx) => ({
        label: `Segment ${idx + 1}`,
        lengthKm: dist,
      }));

      return {
        type: "polyline" as const,
        segments,
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

    if (
      previousMode === "polygon" &&
      drawingMode !== "polygon" &&
      pendingPolygonPoints.length === 0 &&
      currentPath.length > 0
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
      if (isSinglePoint) {
        const currentZoom = map.getZoom();
        // Zoom to at least 12 (but not more than map's maxZoom of 12)
        const targetZoom = Math.max(currentZoom, 12);
        map.easeTo({
          center: [clampLng(center[0]), clampLat(center[1])],
          zoom: Math.min(targetZoom, 12), // Respect map's maxZoom
          duration: 800,
        });
      } else {
        // Use map's actual maxZoom instead of 20
        const mapMaxZoom = 12; // Match the map's maxZoom prop
        map.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          {
            padding: { top: 120, bottom: 120, left: 160, right: 160 },
            duration: 800,
            maxZoom: mapMaxZoom, // Use actual map maxZoom
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
      deckLayers.push(
        new PolygonLayer({
          id: "polygon-layer",
          data: polygonLayers,
          getPolygon: (d: LayerProps) => d.polygon?.[0] ?? [],
          getFillColor: (d: LayerProps) =>
            d.color && d.color.length === 4
              ? [...d.color] // Create a copy to avoid reference sharing
              : [...(d.color ?? [32, 32, 32]), 100],
          getLineColor: (d: LayerProps) =>
            d.color
              ? ([...d.color.slice(0, 3)] as [number, number, number])
              : [32, 32, 32], // Create a copy
          getLineWidth: 2,
          pickable: true,
          pickingRadius: 300, // Larger picking radius for touch devices
          onHover: handleLayerHover,
        })
      );

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
        const previewPath = [...currentPath, mousePosition];
        previewLayers.push(
          new PolygonLayer({
            id: "preview-polygon-layer",
            data: [previewPath],
            getPolygon: (d: [number, number][]) => d,
            getFillColor: [32, 32, 32, 100],
            getLineColor: [32, 32, 32],
            getLineWidth: 2,
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
            <span className="text-[10px] font-semibold text-slate-500">
              {useIgrs ? "IGRS" : "LAT / LNG"}
            </span>
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
        renderWorldCopies={false}
        reuseMaps={true}
        attributionControl={false}
        dragRotate={true}
        touchZoomRotate={true}
        pitchWithRotate={true}
        initialViewState={{
          longitude: 81.5, // Center of India (between 63.5°E and 99.5°E)
          latitude: 20.5, // Center of India (between 2.5°N and 38.5°N)
          zoom: 6, // Zoom level to show India's bounding box
          pitch: pitch,
          bearing: 0,
        }}
        minZoom={0}
        maxZoom={15}
        maxPitch={85}
        onLoad={async (map: any) => {
          // Fit map to India's bounding box
          const mapInstance = map.target;
          mapInstance.fitBounds(
            [
              [63.5, 2.5], // Southwest corner (West, South)
              [99.5, 38.5], // Northeast corner (East, North)
            ],
            {
              padding: { top: 50, bottom: 50, left: 50, right: 50 },
              duration: 0, // Instant fit
            }
          );

          if (!mapInstance.getSource("offline-tiles")) {
            mapInstance.addSource("offline-tiles", {
              type: "raster",
              tiles: ["/tiles-map/{z}/{x}/{y}.png"],
              tileSize: 512,
              minzoom: 0,
              maxzoom: 20,
            });
          }

          mapInstance.on("sourcedata", (e: any) => {
            if (e.sourceId === "offline-tiles" && e.isSourceLoaded) {
            }
          });

          mapInstance.on("error", (e: any) => {
            if (e.sourceId === "offline-tiles") {
              console.warn("Failed to load offline tiles:", e.error);
            }
          });

          if (!mapInstance.getLayer("offline-tiles-layer")) {
            mapInstance.addLayer({
              id: "offline-tiles-layer",
              type: "raster",
              source: "offline-tiles",
              paint: {
                "raster-opacity": 0.9,
              },
            });
          }

          mapInstance.setMaxBounds(null);
        }}
        onClick={handleMapClick}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMove={(e: any) => {
          if (e && e.viewState && typeof e.viewState.zoom === "number") {
            // Throttle zoom updates to reduce re-renders during zoom operations
            if (zoomUpdateTimeoutRef.current) {
              clearTimeout(zoomUpdateTimeoutRef.current);
            }
            zoomUpdateTimeoutRef.current = setTimeout(() => {
              setMapZoom(e.viewState.zoom);
            }, 100); // Update zoom at most every 100ms
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
      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        multiple
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
      <ZoomControls
        mapRef={mapRef}
        zoom={mapZoom}
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
    </div>
  );
};

export default MapComponent;
