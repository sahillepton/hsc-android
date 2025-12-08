import type { LayerProps } from "@/lib/definitions";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SidebarGroup, SidebarGroupContent } from "../ui/sidebar";
import {
  getStorageDirectory,
  getStorageDirectoryName,
  getStorageDirectoryPath,
  showMessage,
} from "@/lib/capacitor-utils";
import { useLayers, useNodeIconMappings } from "@/store/layers-store";
import { generateLayerId } from "@/lib/layers";
import {
  fileToDEMRaster,
  fileToGeoJSON,
  generateDistinctColor,
} from "@/lib/utils";
import { Encoding, Filesystem } from "@capacitor/filesystem";
import {
  deserializeLayers,
  serializeLayers,
  saveUploadedLayerFile,
} from "@/lib/autosave";
import { FileDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const FileSection = () => {
  const { layers, setLayers, addLayer } = useLayers();
  const { nodeIconMappings, setNodeIconMappings } = useNodeIconMappings();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const uploadDemFile = async (file: File, silent: boolean = false) => {
    try {
      const dem = await fileToDEMRaster(file);

      const isDefaultBounds =
        dem.bounds[0] === 68.0 &&
        dem.bounds[1] === 6.0 &&
        dem.bounds[2] === 97.0 &&
        dem.bounds[3] === 37.0;

      const newLayer: LayerProps = {
        type: "dem",
        id: generateLayerId(),
        name: file.name.split(".")[0],
        color: generateDistinctColor(),
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
      };
      // Use addLayer to ensure proper state updates and prevent overwriting
      addLayer(newLayer);

      // Save the uploaded file for autosave
      saveUploadedLayerFile(newLayer.id, file.name, file).catch(console.error);

      // Save DEM bitmap as PNG
      if (dem.canvas) {
        try {
          const base64Data = dem.canvas.toDataURL("image/png").split(",")[1];
          const storageDir = await getStorageDirectory();
          await Filesystem.writeFile({
            path: `uploaded_layers/${newLayer.id}/bitmap.png`,
            data: base64Data,
            directory: storageDir,
            encoding: Encoding.UTF8,
            recursive: true,
          });
        } catch (error) {
          console.error("Error saving DEM bitmap:", error);
        }
      }

      if (!silent) {
        if (isDefaultBounds) {
          console.log(
            `DEM uploaded with default bounds (may not be correctly positioned). Use a georeferenced GeoTIFF for accurate positioning.`
          );
        } else {
          console.log(`Successfully uploaded DEM: ${file.name}`);
        }
      }
      return { success: true, name: file.name, isDefaultBounds };
    } catch (error) {
      console.error("Error uploading DEM file:", error);
      if (!silent) {
        console.error(
          `Error uploading DEM: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
      return {
        success: false,
        name: file.name,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  };

  const extractTiffFromZip = async (file: File): Promise<File[]> => {
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file);

      // Find all TIFF and HGT files in the ZIP (including in subfolders)
      const tiffFiles = Object.keys(zip.files).filter((name) => {
        const lowerName = name.toLowerCase();
        // Skip directories
        if (zip.files[name].dir) {
          return false;
        }
        return (
          lowerName.endsWith(".tif") ||
          lowerName.endsWith(".tiff") ||
          lowerName.endsWith(".hgt") ||
          lowerName.endsWith(".dett")
        );
      });

      if (tiffFiles.length === 0) {
        return [];
      }

      // Extract all TIFF files
      const extractedFiles: File[] = [];
      for (const fileName of tiffFiles) {
        try {
          const fileData = await zip.files[fileName].async("blob");
          // Extract just the filename without folder path
          const baseFileName = fileName.split("/").pop() || fileName;
          // Determine MIME type based on extension
          const lowerName = fileName.toLowerCase();
          let mimeType = "image/tiff";
          if (lowerName.endsWith(".hgt")) {
            mimeType = "application/octet-stream";
          }
          const extractedFile = new File([fileData], baseFileName, {
            type: mimeType,
          });
          extractedFiles.push(extractedFile);
        } catch (error) {
          console.error(`Error extracting ${fileName} from ZIP:`, error);
        }
      }

      return extractedFiles;
    } catch (error) {
      console.error("Error extracting TIFF from ZIP:", error);
      return [];
    }
  };

  // Extract all vector files (GeoJSON, CSV, GPX, KML, KMZ) from ZIP
  const extractVectorFilesFromZip = async (file: File): Promise<File[]> => {
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file);

      // Find all vector files in the ZIP (including in subfolders)
      const vectorFiles = Object.keys(zip.files).filter((name) => {
        const lowerName = name.toLowerCase();
        // Skip directories
        if (zip.files[name].dir) {
          return false;
        }
        // Check for vector file extensions
        // Note: We allow files in "layers_export" folders (these are our exported ZIPs)
        // but exclude the old JSON export format files
        const isOldExportFormat =
          lowerName.includes("layers_export") &&
          lowerName.endsWith(".json") &&
          !lowerName.includes("/"); // Root level JSON files with "layers_export" in name
        return (
          lowerName.endsWith(".geojson") ||
          (lowerName.endsWith(".json") &&
            !lowerName.includes("node_icon_mappings") &&
            !isOldExportFormat) ||
          lowerName.endsWith(".csv") ||
          lowerName.endsWith(".gpx") ||
          lowerName.endsWith(".kml") ||
          lowerName.endsWith(".kmz")
        );
      });

      if (vectorFiles.length === 0) {
        return [];
      }

      // Extract all vector files
      const extractedFiles: File[] = [];
      for (const fileName of vectorFiles) {
        try {
          const fileData = await zip.files[fileName].async("blob");
          // Extract just the filename without folder path
          const baseFileName = fileName.split("/").pop() || fileName;
          // Determine MIME type based on extension
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
          extractedFiles.push(extractedFile);
        } catch (error) {
          console.error(`Error extracting ${fileName} from ZIP:`, error);
        }
      }

      return extractedFiles;
    } catch (error) {
      console.error("Error extracting vector files from ZIP:", error);
      return [];
    }
  };

  // Extract shapefile components from ZIP
  const extractShapefileFromZip = async (file: File): Promise<File | null> => {
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file);

      // Find all shapefile components (.shp, .shx, .dbf)
      const shapefileComponents = Object.keys(zip.files).filter((name) => {
        const lowerName = name.toLowerCase();
        if (zip.files[name].dir) {
          return false;
        }
        return (
          lowerName.endsWith(".shp") ||
          lowerName.endsWith(".shx") ||
          lowerName.endsWith(".dbf")
        );
      });

      if (shapefileComponents.length === 0) {
        return null;
      }

      // Group shapefile components by base name
      const shapefileGroups = new Map<string, string[]>();
      for (const fileName of shapefileComponents) {
        const baseName = fileName.toLowerCase().replace(/\.(shp|shx|dbf)$/, "");
        if (!shapefileGroups.has(baseName)) {
          shapefileGroups.set(baseName, []);
        }
        shapefileGroups.get(baseName)!.push(fileName);
      }

      // Find a complete shapefile (has .shp, .shx, and .dbf)
      for (const [baseName, files] of shapefileGroups.entries()) {
        const hasShp = files.some((f) => f.toLowerCase().endsWith(".shp"));
        const hasShx = files.some((f) => f.toLowerCase().endsWith(".shx"));
        const hasDbf = files.some((f) => f.toLowerCase().endsWith(".dbf"));

        if (hasShp && hasShx && hasDbf) {
          // Create a new ZIP with just this shapefile's components
          const shapefileZip = new JSZip();
          for (const fileName of files) {
            const fileData = await zip.files[fileName].async("blob");
            shapefileZip.file(fileName, fileData);
          }

          // Generate the shapefile ZIP as a blob
          const zipBlob = await shapefileZip.generateAsync({
            type: "blob",
            compression: "DEFLATE",
          });

          // Return as a File object
          return new File([zipBlob], `${baseName}.zip`, {
            type: "application/zip",
          });
        }
      }

      return null;
    } catch (error) {
      console.error("Error extracting shapefile from ZIP:", error);
      return null;
    }
  };
  const importLayersFromJson = async (file: File) => {
    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      if (importData.version && Array.isArray(importData.layers)) {
        if (!importData.layers || !Array.isArray(importData.layers)) {
          throw new Error("Invalid layers data format");
        }

        // Warn if importing many layers
        if (importData.layers.length > 100) {
          const proceed = window.confirm(
            `This export contains ${importData.layers.length} layers. ` +
              `Importing may take a moment and could affect performance. Continue?`
          );
          if (!proceed) {
            return true; // User cancelled, but file was valid
          }
        }

        // Use deserializeLayers to properly load DEM files from DEM_Layers folder
        setTimeout(async () => {
          try {
            // Deserialize layers (this will load DEM files from DEM_Layers folder)
            const deserializedLayers = await deserializeLayers(
              importData.layers
            );

            // Replace colors that match map background with distinct colors
            const processedLayers = deserializedLayers.map(
              (layer: LayerProps) => {
                if (layer.color) {
                  const color = Array.isArray(layer.color)
                    ? (layer.color.slice(0, 3) as [number, number, number])
                    : [0, 0, 0];

                  // Check if color is similar to map background colors
                  const backgroundColors = [
                    [242, 239, 233], // Light beige
                    [240, 240, 240], // Light gray
                    [255, 255, 255], // White
                    [250, 250, 250], // Off-white
                    [245, 245, 245], // Very light gray
                    [238, 238, 238], // Light gray
                    [248, 248, 248], // Very light gray
                  ];

                  const isSimilarToBackground = backgroundColors.some(
                    (bgColor) => {
                      const diff = Math.sqrt(
                        Math.pow(color[0] - bgColor[0], 2) +
                          Math.pow(color[1] - bgColor[1], 2) +
                          Math.pow(color[2] - bgColor[2], 2)
                      );
                      return diff < 30; // Threshold for similarity
                    }
                  );

                  if (isSimilarToBackground) {
                    return {
                      ...layer,
                      color: generateDistinctColor(),
                    };
                  }
                }
                return layer;
              }
            );

            setLayers(processedLayers);

            if (importData.nodeIconMappings) {
              setNodeIconMappings(importData.nodeIconMappings);
            }

            // Suppress alerts during import - only log to console
            console.log(
              `Successfully imported ${importData.layers.length} layers from ${file.name}`
            );
          } catch (deserializeError) {
            console.error("Error deserializing layers:", deserializeError);
            console.error(
              `Error importing layers: ${
                deserializeError instanceof Error
                  ? deserializeError.message
                  : "Unknown error"
              }`
            );
          }
        }, 300);

        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error("Error importing layers from JSON:", error);

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

      console.error(errorMessage);
      return false;
    }
  };

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
        console.warn("Annotation file contains no features.");
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
        console.warn(
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
      };

      // Use addLayer to ensure proper state updates and prevent overwriting
      addLayer(newLayer);

      // Save the uploaded file for autosave
      saveUploadedLayerFile(newLayer.id, file.name, file).catch(console.error);

      console.log(
        `Successfully uploaded ${annotations.length} annotation(s) from ${file.name}`
      );
    } catch (error) {
      console.error("Error uploading annotation file:", error);
      console.error(
        `Error uploading annotation file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };

  // Helper function to extract size (radius/width) from feature properties
  const extractSizeFromProperties = (
    properties: any,
    sizeType: "point" | "line"
  ): number | null => {
    if (!properties) return null;

    const sizeKeys =
      sizeType === "point"
        ? [
            "size",
            "radius",
            "pointRadius",
            "point-radius",
            "point_radius",
            "marker-size",
            "markerSize",
          ]
        : [
            "size",
            "width",
            "lineWidth",
            "line-width",
            "line_width",
            "stroke-width",
            "strokeWidth",
          ];

    for (const key of sizeKeys) {
      const sizeValue = properties[key];
      if (sizeValue !== undefined && sizeValue !== null) {
        const size = parseFloat(sizeValue);
        if (!isNaN(size)) {
          // Clamp to minimum of 1 and maximum of 50
          return Math.max(1, Math.min(50, Math.round(size)));
        }
      }
    }
    return null;
  };

  const uploadGeoJsonFile = async (file: File, silent: boolean = false) => {
    try {
      const fileName = file.name.toLowerCase();
      let ext = "";
      if (fileName.endsWith(".geojson")) {
        ext = "geojson";
      } else {
        const parts = fileName.split(".");
        ext = parts.length > 1 ? parts[parts.length - 1] : "";
      }

      const supportedFormats = [
        "geojson",
        "json",
        "shp",
        "zip",
        "csv",
        "gpx",
        "kml",
        "kmz",
      ];

      const mimeType = file.type?.toLowerCase() || "";
      const isSupportedByExt = ext && supportedFormats.includes(ext);
      const isSupportedByMime =
        mimeType.includes("json") || mimeType.includes("geojson");

      if (!isSupportedByExt && !isSupportedByMime) {
        console.warn(
          `File extension .${ext} not in supported formats, but attempting to process anyway`
        );
      }

      const rawGeojson = await fileToGeoJSON(file);

      if (!rawGeojson) {
        if (!silent) {
          console.error(
            "Invalid vector file format. Could not convert to GeoJSON."
          );
        }
        return {
          success: false,
          name: file.name,
          error: "Invalid vector file format. Could not convert to GeoJSON.",
        };
      }

      let featureCollection: GeoJSON.FeatureCollection | null = null;

      if (rawGeojson.type === "FeatureCollection") {
        featureCollection = rawGeojson as GeoJSON.FeatureCollection;
      } else if (rawGeojson.type === "Feature") {
        featureCollection = {
          type: "FeatureCollection",
          features: [rawGeojson as GeoJSON.Feature],
        };
      } else if (
        (rawGeojson as any).features &&
        Array.isArray((rawGeojson as any).features)
      ) {
        featureCollection = {
          type: "FeatureCollection",
          features: (rawGeojson as any).features,
        };
      } else if ((rawGeojson as any).geometry) {
        featureCollection = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: (rawGeojson as any).geometry,
              properties: (rawGeojson as any).properties ?? {},
            },
          ],
        };
      }

      if (!featureCollection) {
        if (!silent) {
          console.error(
            `Unsupported GeoJSON structure: ${
              rawGeojson.type ?? "Unknown type"
            }`
          );
        }
        return {
          success: false,
          name: file.name,
          error: `Unsupported GeoJSON structure: ${
            rawGeojson.type ?? "Unknown type"
          }`,
        };
      }

      if (!Array.isArray(featureCollection.features)) {
        if (!silent) {
          console.error("Invalid GeoJSON format: features is not an array.");
        }
        return {
          success: false,
          name: file.name,
          error: "Invalid GeoJSON format: features is not an array.",
        };
      }

      if (featureCollection.features.length === 0) {
        if (!silent) {
          console.warn("Vector file contains no features.");
        }
        return {
          success: false,
          name: file.name,
          error: "Vector file contains no features.",
        };
      }

      const featureCount = featureCollection.features.length;

      // Suppress alerts during import - only log to console
      if (!silent) {
        console.log(`Uploading ${featureCount.toLocaleString()} features...`);
      }

      // Process features in batches to avoid blocking UI thread
      const BATCH_SIZE = 1000;
      const validFeatures: GeoJSON.Feature[] = [];

      // Process features in batches with yield to UI thread
      // Add a small delay between batches to process slowly and avoid blocking
      for (let i = 0; i < featureCollection.features.length; i += BATCH_SIZE) {
        const batch = featureCollection.features.slice(i, i + BATCH_SIZE);
        const batchValid = batch.filter(
          (feature) => feature && feature.geometry
        );
        validFeatures.push(...batchValid);

        // Yield to UI thread and add a small delay to process slowly
        // This prevents blocking and allows the UI to remain responsive
        if (i + BATCH_SIZE < featureCollection.features.length) {
          // Small delay to process slowly (10ms delay between batches)
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      if (validFeatures.length === 0) {
        if (!silent) {
          console.warn("Vector file contains no valid geometries.");
        }
        return {
          success: false,
          name: file.name,
          error: "Vector file contains no valid geometries.",
        };
      }

      // Extract size values from CSV properties if available
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
        color: generateDistinctColor(),
        pointRadius: extractedPointRadius ?? 5,
        lineWidth: extractedLineWidth ?? 5,
        visible: true,
      };
      // Use addLayer to ensure proper state updates and prevent overwriting
      // This prevents overwriting when importing multiple files from ZIP
      addLayer(newLayer);

      // Save the uploaded file for autosave
      saveUploadedLayerFile(newLayer.id, file.name, file).catch(console.error);

      console.log(
        `Successfully uploaded ${validFeatures.length} feature(s) from ${file.name}`
      );
    } catch (error) {
      console.error("Error uploading file:", error);

      let errorMessage = "Unknown error";
      if (error instanceof Error) {
        const errorMsg = error.message.toLowerCase();
        if (
          errorMsg.includes("memory") ||
          errorMsg.includes("heap") ||
          errorMsg.includes("allocation")
        ) {
          errorMessage =
            "File is too large for Android. Please split the file into smaller parts or reduce the number of features.";
        } else if (
          errorMsg.includes("timeout") ||
          errorMsg.includes("exceeded") ||
          errorMsg.includes("too long")
        ) {
          errorMessage =
            "Processing took too long. The file may be too large. Please try a smaller file or split it into parts.";
        } else if (errorMsg.includes("quota") || errorMsg.includes("storage")) {
          errorMessage =
            "Storage quota exceeded. Please free up space or use a smaller file.";
        } else {
          errorMessage = error.message;
        }
      }

      console.error(`Error uploading file: ${errorMessage}`);
    }
  };

  const handleFileImport = async (file: File) => {
    try {
      if (!file) {
        return;
      }

      // Show toast notification that file is being imported
      toast("File is being imported", {
        duration: 2000,
      });

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

      if (ext === "json") {
        const isLayerExport = await importLayersFromJson(file);
        if (isLayerExport) {
          return;
        }
      }

      if (ext === "zip") {
        setIsImporting(true);
        try {
          // First, verify the ZIP can be read
          try {
            const JSZip = (await import("jszip")).default;
            const testZip = await JSZip.loadAsync(file);
            const fileNames = Object.keys(testZip.files);
            console.log(
              `ZIP contains ${fileNames.length} entries:`,
              fileNames.slice(0, 10)
            );
          } catch (zipError) {
            console.error("Error reading ZIP file:", zipError);
            console.error(
              `Error reading ZIP file: ${
                zipError instanceof Error
                  ? zipError.message
                  : "Invalid ZIP format"
              }`
            );
            setIsImporting(false);
            return;
          }

          let tiffCount = 0;
          let vectorCount = 0;
          let shapefileCount = 0;

          // First check for TIFF files (DEM) - process all TIFF files
          const tiffFiles = await extractTiffFromZip(file);
          const tiffErrors: string[] = [];
          if (tiffFiles.length > 0) {
            for (const tiffFile of tiffFiles) {
              const result = await uploadDemFile(tiffFile, true);
              if (result.success) {
                tiffCount++;
              } else {
                tiffErrors.push(`${tiffFile.name}: ${result.error}`);
              }
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }

          // Then check for vector files (GeoJSON, CSV, GPX, KML, KMZ)
          const vectorFiles = await extractVectorFilesFromZip(file);
          const vectorErrors: string[] = [];
          if (vectorFiles.length > 0) {
            // Separate GeoJSON files (for split file handling) from other vector files
            const geojsonFiles = vectorFiles.filter((f) =>
              f.name.toLowerCase().endsWith(".geojson")
            );
            const otherVectorFiles = vectorFiles.filter(
              (f) => !f.name.toLowerCase().endsWith(".geojson")
            );

            // Group split GeoJSON files together (files with _part pattern)
            const fileGroups = new Map<string, File[]>();
            const partFileBaseNames = new Set<string>();

            for (const geojsonFile of geojsonFiles) {
              const fileName = geojsonFile.name.toLowerCase();
              const partMatch = fileName.match(/^(.+?)_part(\d+)\.geojson$/);

              if (partMatch) {
                const baseName = partMatch[1];
                partFileBaseNames.add(baseName);
                if (!fileGroups.has(baseName)) {
                  fileGroups.set(baseName, []);
                }
                fileGroups.get(baseName)!.push(geojsonFile);
              }
            }

            // Identify standalone GeoJSON files and main files of splits
            const standaloneGeoJsonFiles: File[] = [];

            for (const geojsonFile of geojsonFiles) {
              const fileName = geojsonFile.name.toLowerCase();
              const partMatch = fileName.match(/^(.+?)_part(\d+)\.geojson$/);

              if (!partMatch) {
                const baseName = fileName.replace(/\.geojson$/, "");
                if (partFileBaseNames.has(baseName)) {
                  if (fileGroups.has(baseName)) {
                    fileGroups.get(baseName)!.unshift(geojsonFile);
                  }
                } else {
                  standaloneGeoJsonFiles.push(geojsonFile);
                }
              }
            }

            // Sort file groups by part number
            for (const [_, files] of fileGroups.entries()) {
              files.sort((a, b) => {
                const aMatch = a.name.match(/_part(\d+)/);
                const bMatch = b.name.match(/_part(\d+)/);
                if (!aMatch) return -1;
                if (!bMatch) return 1;
                return parseInt(aMatch[1]) - parseInt(bMatch[1]);
              });
            }

            // Process standalone GeoJSON files - each as a separate layer
            for (const geojsonFile of standaloneGeoJsonFiles) {
              const result = await uploadGeoJsonFile(geojsonFile, true);
              if (result && result.success) {
                vectorCount++;
              } else if (result) {
                vectorErrors.push(`${geojsonFile.name}: ${result.error}`);
              }
              await new Promise((resolve) => setTimeout(resolve, 0));
            }

            // Process grouped GeoJSON files (combine split files into one layer)
            for (const [baseName, files] of fileGroups.entries()) {
              try {
                const allFeatures: GeoJSON.Feature[] = [];
                let firstFileData: any = null;

                for (let i = 0; i < files.length; i++) {
                  const file = files[i];
                  const text = await file.text();
                  const geojson = JSON.parse(text) as GeoJSON.FeatureCollection;

                  if (i === 0) {
                    firstFileData = geojson as any;
                  }

                  if (geojson.features) {
                    allFeatures.push(...geojson.features);
                  }
                  await new Promise((resolve) => setTimeout(resolve, 0));
                }

                if (allFeatures.length > 0) {
                  const layerName = firstFileData?.__layerName || baseName;
                  const combinedFeatureCollection: GeoJSON.FeatureCollection = {
                    type: "FeatureCollection",
                    features: allFeatures,
                  };

                  const combinedBlob = new Blob(
                    [JSON.stringify(combinedFeatureCollection)],
                    { type: "application/json" }
                  );
                  const combinedFile = new File(
                    [combinedBlob],
                    `${layerName}.geojson`,
                    { type: "application/json" }
                  );

                  const result = await uploadGeoJsonFile(combinedFile, true);
                  if (result && result.success) {
                    vectorCount++;
                  } else if (result) {
                    vectorErrors.push(`${baseName}: ${result.error}`);
                  }
                }
              } catch (error) {
                console.error(
                  `Error combining split files for ${baseName}:`,
                  error
                );
                vectorErrors.push(
                  `${baseName}: ${
                    error instanceof Error ? error.message : "Unknown error"
                  }`
                );
              }
            }

            // Process other vector files (CSV, GPX, KML, KMZ) - each as a separate layer
            for (const vectorFile of otherVectorFiles) {
              const result = await uploadGeoJsonFile(vectorFile, true);
              if (result && result.success) {
                vectorCount++;
              } else if (result) {
                vectorErrors.push(`${vectorFile.name}: ${result.error}`);
              }
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }

          // Check for shapefiles
          const shapefileZip = await extractShapefileFromZip(file);
          const shapefileErrors: string[] = [];
          if (shapefileZip) {
            const result = await uploadGeoJsonFile(shapefileZip, true);
            if (result && result.success) {
              shapefileCount++;
            } else if (result) {
              shapefileErrors.push(`Shapefile: ${result.error}`);
            }
          }

          // Check for node_icon_mappings.json
          let nodeIconMappingsImported = false;
          try {
            const JSZip = (await import("jszip")).default;
            const zip = await JSZip.loadAsync(file);
            const nodeIconMappingsFile = Object.keys(zip.files).find((name) =>
              name.toLowerCase().includes("node_icon_mappings.json")
            );
            if (nodeIconMappingsFile) {
              const fileData = await zip.files[nodeIconMappingsFile].async(
                "string"
              );
              const mappings = JSON.parse(fileData);
              setNodeIconMappings(mappings);
              nodeIconMappingsImported = true;
            }
          } catch (error) {
            console.error("Error importing node icon mappings:", error);
          }

          // Show ONE final message with all results
          const totalImported = tiffCount + vectorCount + shapefileCount;
          const allErrors = [
            ...tiffErrors,
            ...vectorErrors,
            ...shapefileErrors,
          ];

          if (totalImported > 0) {
            const parts: string[] = [];
            if (tiffCount > 0)
              parts.push(`${tiffCount} DEM${tiffCount > 1 ? "s" : ""}`);
            if (vectorCount > 0) parts.push(`${vectorCount} vector`);
            if (shapefileCount > 0) parts.push(`${shapefileCount} shapefile`);

            let message = `Successfully imported ${totalImported} layer(s) from ZIP (${parts.join(
              ", "
            )}).`;
            if (nodeIconMappingsImported) {
              message += " Node icon mappings imported.";
            }
            if (allErrors.length > 0) {
              message += ` ${allErrors.length} file(s) had errors.`;
            }

            // Suppress alerts during import - only log to console
            console.log(message);
            if (allErrors.length > 0) {
              console.error("Import errors:", allErrors);
            }
            setIsImporting(false);
            return;
          } else if (
            tiffFiles.length > 0 ||
            vectorFiles.length > 0 ||
            shapefileZip
          ) {
            let message = "No files could be imported.";
            if (allErrors.length > 0) {
              message += ` Errors: ${allErrors.slice(0, 3).join("; ")}${
                allErrors.length > 3 ? ` and ${allErrors.length - 3} more` : ""
              }.`;
            }
            console.error(message);
            if (allErrors.length > 0) {
              console.error("Import errors:", allErrors);
            }
            setIsImporting(false);
            return;
          } else {
            // No supported files found in ZIP
            console.warn(
              "No supported files found in ZIP. The ZIP should contain GeoJSON, TIFF, CSV, GPX, KML, KMZ, or shapefile files."
            );
            setIsImporting(false);
            return;
          }
        } finally {
          setIsImporting(false);
        }

        // If no supported files found, try processing as shapefile
        // (This will be handled by the vectorExtensions check below)
      }

      const vectorExtensions = [
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
        } catch (error) {}
      }

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
            `Unsupported file type: .${ext} (${
              file.type || "unknown type"
            }). Supported formats:\n` +
              `Layer Export: JSON (with layers array)\n` +
              `Vector: ${vectorExtensions
                .filter((e) => e !== "json")
                .join(", ")}, JSON\n` +
              `Raster/DEM: ${rasterExtensions.join(", ")}, ZIP (with TIFF)\n` +
              `Note: ZIP files are checked for TIFF files first, then processed as shapefiles if no TIFF found.`
          );
        }
      }
    } catch (error) {
      console.error("Error importing file:", error);
      console.error(
        `Error importing file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };
  const downloadAllLayers = async () => {
    try {
      setIsExporting(true);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const folderName = `layers_export_${timestamp}`;
      const zipFileName = `${folderName}.zip`;

      showMessage(`Exporting ${layers.length} layer(s)...`, false);

      // Import JSZip dynamically
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const folder = zip.folder(folderName);

      if (!folder) {
        throw new Error("Failed to create ZIP folder");
      }

      let exportedCount = 0;
      const errors: string[] = [];

      // Process each layer with progress updates
      for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        const layer = layers[layerIndex];

        // Update progress for large exports
        if (layers.length > 5) {
          showMessage(
            `Exporting layer ${layerIndex + 1} of ${layers.length}: ${
              layer.name
            }...`,
            false
          );
        }
        try {
          const sanitizedName = layer.name
            .replace(/[^a-zA-Z0-9_-]/g, "_")
            .substring(0, 100); // Limit filename length

          if (layer.type === "geojson" && layer.geojson) {
            // Export GeoJSON layer as .geojson file
            // For large feature collections, split into multiple files
            const featureCount = layer.geojson.features?.length || 0;
            const MAX_FEATURES_PER_FILE = 2000; // Smaller chunks to prevent crashes

            if (featureCount > MAX_FEATURES_PER_FILE) {
              // Split into multiple files
              const totalParts = Math.ceil(
                featureCount / MAX_FEATURES_PER_FILE
              );

              for (let partIndex = 0; partIndex < totalParts; partIndex++) {
                const startIdx = partIndex * MAX_FEATURES_PER_FILE;
                const endIdx = Math.min(
                  startIdx + MAX_FEATURES_PER_FILE,
                  featureCount
                );
                const partFeatures = layer.geojson.features.slice(
                  startIdx,
                  endIdx
                );

                const partFeatureCollection: GeoJSON.FeatureCollection = {
                  type: "FeatureCollection",
                  features: partFeatures,
                };

                const fileName =
                  partIndex === 0
                    ? `${sanitizedName}.geojson`
                    : `${sanitizedName}_part${partIndex + 1}.geojson`;

                // Add metadata to first file to indicate it's split
                if (partIndex === 0) {
                  (partFeatureCollection as any).__split = true;
                  (partFeatureCollection as any).__totalParts = totalParts;
                  (partFeatureCollection as any).__layerName = layer.name;
                }

                const geojsonContent = JSON.stringify(partFeatureCollection);
                folder.file(fileName, geojsonContent);

                // Yield after each part to prevent blocking
                await new Promise((resolve) => setTimeout(resolve, 10));
              }
            } else {
              // Small collection - export normally (compact JSON to save memory)
              const geojsonContent = JSON.stringify(layer.geojson);
              folder.file(`${sanitizedName}.geojson`, geojsonContent);
            }
            exportedCount++;
          } else if (
            layer.type === "point" ||
            layer.type === "line" ||
            layer.type === "polygon"
          ) {
            // Convert point/line/polygon to GeoJSON
            let feature: GeoJSON.Feature | null = null;

            if (layer.type === "point" && layer.position) {
              feature = {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: layer.position,
                },
                properties: {
                  name: layer.name,
                  color: layer.color,
                  radius: layer.radius,
                },
              };
            } else if (layer.type === "line" && layer.path) {
              feature = {
                type: "Feature",
                geometry: {
                  type: "LineString",
                  coordinates: layer.path,
                },
                properties: {
                  name: layer.name,
                  color: layer.color,
                  lineWidth: layer.lineWidth,
                },
              };
            } else if (layer.type === "polygon" && layer.polygon) {
              feature = {
                type: "Feature",
                geometry: {
                  type: "Polygon",
                  coordinates: layer.polygon,
                },
                properties: {
                  name: layer.name,
                  color: layer.color,
                  sectorAngleDeg: layer.sectorAngleDeg,
                  radiusMeters: layer.radiusMeters,
                  bearing: layer.bearing,
                },
              };
            }

            if (feature) {
              const featureCollection: GeoJSON.FeatureCollection = {
                type: "FeatureCollection",
                features: [feature],
              };
              const geojsonContent = JSON.stringify(featureCollection, null, 2);
              folder.file(`${sanitizedName}.geojson`, geojsonContent);
              exportedCount++;
            }
          } else if (layer.type === "annotation" && layer.annotations) {
            // Convert annotations to GeoJSON
            // Split large collections into multiple files
            const annotationCount = layer.annotations.length;
            const MAX_FEATURES_PER_FILE = 2000; // Smaller chunks to prevent crashes

            if (annotationCount > MAX_FEATURES_PER_FILE) {
              // Split into multiple files
              const totalParts = Math.ceil(
                annotationCount / MAX_FEATURES_PER_FILE
              );

              for (let partIndex = 0; partIndex < totalParts; partIndex++) {
                const startIdx = partIndex * MAX_FEATURES_PER_FILE;
                const endIdx = Math.min(
                  startIdx + MAX_FEATURES_PER_FILE,
                  annotationCount
                );
                const batch = layer.annotations.slice(startIdx, endIdx);

                const features: GeoJSON.Feature[] = batch.map((ann) => ({
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: ann.position,
                  },
                  properties: {
                    text: ann.text,
                    color: ann.color,
                    fontSize: ann.fontSize,
                  },
                }));

                const fileName =
                  partIndex === 0
                    ? `${sanitizedName}.geojson`
                    : `${sanitizedName}_part${partIndex + 1}.geojson`;

                const featureCollection: GeoJSON.FeatureCollection = {
                  type: "FeatureCollection",
                  features,
                };

                // Add metadata to first file
                if (partIndex === 0) {
                  (featureCollection as any).__split = true;
                  (featureCollection as any).__totalParts = totalParts;
                  (featureCollection as any).__layerName = layer.name;
                }

                const geojsonContent = JSON.stringify(featureCollection);
                folder.file(fileName, geojsonContent);

                // Yield after each part to prevent blocking
                await new Promise((resolve) => setTimeout(resolve, 10));
              }
            } else {
              // Small collection - process normally
              const features: GeoJSON.Feature[] = layer.annotations.map(
                (ann) => ({
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: ann.position,
                  },
                  properties: {
                    text: ann.text,
                    color: ann.color,
                    fontSize: ann.fontSize,
                  },
                })
              );
              const featureCollection: GeoJSON.FeatureCollection = {
                type: "FeatureCollection",
                features,
              };
              const geojsonContent = JSON.stringify(featureCollection, null, 2);
              folder.file(`${sanitizedName}.geojson`, geojsonContent);
            }
            exportedCount++;
          } else if (layer.type === "nodes" && layer.nodes) {
            // Convert nodes to GeoJSON
            // Split large collections into multiple files
            const nodeCount = layer.nodes.length;
            const MAX_FEATURES_PER_FILE = 2000; // Smaller chunks to prevent crashes

            if (nodeCount > MAX_FEATURES_PER_FILE) {
              // Split into multiple files
              const totalParts = Math.ceil(nodeCount / MAX_FEATURES_PER_FILE);

              for (let partIndex = 0; partIndex < totalParts; partIndex++) {
                const startIdx = partIndex * MAX_FEATURES_PER_FILE;
                const endIdx = Math.min(
                  startIdx + MAX_FEATURES_PER_FILE,
                  nodeCount
                );
                const batch = layer.nodes.slice(startIdx, endIdx);

                const features: GeoJSON.Feature[] = batch.map((node) => ({
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: [node.longitude, node.latitude],
                  },
                  properties: {
                    userId: node.userId,
                    snr: node.snr,
                    rssi: node.rssi,
                    distance: node.distance,
                    hopCount: node.hopCount,
                    connectedNodeIds: node.connectedNodeIds,
                  },
                }));

                const fileName =
                  partIndex === 0
                    ? `${sanitizedName}.geojson`
                    : `${sanitizedName}_part${partIndex + 1}.geojson`;

                const featureCollection: GeoJSON.FeatureCollection = {
                  type: "FeatureCollection",
                  features,
                };

                // Add metadata to first file
                if (partIndex === 0) {
                  (featureCollection as any).__split = true;
                  (featureCollection as any).__totalParts = totalParts;
                  (featureCollection as any).__layerName = layer.name;
                }

                const geojsonContent = JSON.stringify(featureCollection);
                folder.file(fileName, geojsonContent);

                // Yield to prevent blocking after each part
                await new Promise((resolve) => setTimeout(resolve, 10));
              }
            } else {
              // Small collection - process normally
              const features: GeoJSON.Feature[] = layer.nodes.map((node) => ({
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: [node.longitude, node.latitude],
                },
                properties: {
                  userId: node.userId,
                  snr: node.snr,
                  rssi: node.rssi,
                  distance: node.distance,
                  hopCount: node.hopCount,
                  connectedNodeIds: node.connectedNodeIds,
                },
              }));
              const featureCollection: GeoJSON.FeatureCollection = {
                type: "FeatureCollection",
                features,
              };
              const geojsonContent = JSON.stringify(featureCollection, null, 2);
              folder.file(`${sanitizedName}.geojson`, geojsonContent);
            }
            exportedCount++;
          } else if (layer.type === "dem" && layer.bitmap) {
            // Export DEM as PNG to DEM_Layers folder (not in ZIP)
            try {
              let canvas: HTMLCanvasElement | null = null;

              if (layer.bitmap instanceof HTMLCanvasElement) {
                canvas = layer.bitmap;
              } else if (
                layer.bitmap instanceof ImageBitmap ||
                layer.bitmap instanceof HTMLImageElement
              ) {
                // Convert ImageBitmap or Image to canvas
                canvas = document.createElement("canvas");
                canvas.width =
                  layer.bitmap instanceof ImageBitmap
                    ? layer.bitmap.width
                    : layer.bitmap.naturalWidth;
                canvas.height =
                  layer.bitmap instanceof ImageBitmap
                    ? layer.bitmap.height
                    : layer.bitmap.naturalHeight;
                const ctx = canvas.getContext("2d");
                if (ctx) {
                  ctx.drawImage(layer.bitmap, 0, 0);
                }
              }

              if (canvas) {
                // Convert canvas to base64 PNG
                const base64Data = canvas.toDataURL("image/png").split(",")[1];

                // Save to DEM_Layers folder (not in ZIP)
                const storageDir = await getStorageDirectory();
                const fileName = `${layer.id}.png`;
                await Filesystem.writeFile({
                  path: `DEM_Layers/${fileName}`,
                  data: base64Data,
                  directory: storageDir,
                  encoding: Encoding.UTF8, // Base64 is stored as UTF8 string
                  recursive: true,
                });

                exportedCount++;
                console.log(
                  `Exported DEM ${layer.name} to DEM_Layers/${fileName}`
                );
              } else {
                errors.push(
                  `${layer.name}: Could not export DEM (unsupported format)`
                );
              }
            } catch (error) {
              errors.push(
                `${layer.name}: Error exporting DEM - ${
                  error instanceof Error ? error.message : "Unknown error"
                }`
              );
            }
          } else if (layer.type === "connections") {
            // Convert connections to GeoJSON LineString
            // This would need connection data - for now skip or convert if available
            errors.push(
              `${layer.name}: Connection layers export not yet implemented`
            );
          } else {
            errors.push(
              `${layer.name}: Layer type "${layer.type}" not supported for export`
            );
          }

          // Yield to UI thread after each layer to prevent blocking
          // Always yield, even after last layer, to allow UI to update
          await new Promise((resolve) => setTimeout(resolve, 10));
        } catch (error) {
          console.error(`Error exporting layer ${layer.name}:`, error);
          errors.push(
            `${layer.name}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }
      }

      // Add node icon mappings as JSON if available
      if (nodeIconMappings && Object.keys(nodeIconMappings).length > 0) {
        const mappingsContent = JSON.stringify(nodeIconMappings, null, 2);
        folder.file("node_icon_mappings.json", mappingsContent);
      }

      // Add layers.json file with all layer data (DEM files referenced by path)
      // Serialize layers to get proper format with DEM file references
      const serializedLayers = serializeLayers(layers);
      // Set bitmapFilePath for DEM layers
      for (let i = 0; i < serializedLayers.length; i++) {
        if (serializedLayers[i].type === "dem") {
          (serializedLayers[i] as any).bitmapFilePath = `${layers[i].id}.png`;
        }
      }
      const layersJson = {
        version: "1.0",
        layers: serializedLayers,
        nodeIconMappings: nodeIconMappings || {},
      };
      folder.file("layers.json", JSON.stringify(layersJson, null, 2));

      // Generate ZIP file with compression level optimization
      showMessage("Creating ZIP archive...", false);
      // Use lower compression for faster processing and less memory
      // Generate as base64 for Capacitor Filesystem compatibility
      const zipBase64 = await zip.generateAsync({
        type: "base64",
        compression: "DEFLATE",
        compressionOptions: { level: 3 }, // Lower compression = less memory
        streamFiles: true, // Stream files for better memory management
      });

      // Save ZIP to device
      // For binary files, use base64 encoding with the base64 string
      const storageDir = await getStorageDirectory();
      const dirName = getStorageDirectoryName(storageDir);
      const dirPath = getStorageDirectoryPath(storageDir);

      const result = await Filesystem.writeFile({
        path: `HSC_Layers/${zipFileName}`,
        data: zipBase64,
        directory: storageDir,
        encoding: Encoding.UTF8, // Base64 data is stored as UTF8 string
        recursive: true,
      });

      const fullPath = `${dirName}${dirPath}HSC_Layers/${zipFileName}`;
      let message = `Successfully exported ${exportedCount} layer(s) to ZIP file:\n\n📁 Path: ${fullPath}\n\n📍 Full URI: ${result.uri}`;

      if (errors.length > 0) {
        message += `\n\n⚠️ ${errors.length} layer(s) had errors:\n${errors
          .slice(0, 5)
          .join("\n")}${
          errors.length > 5 ? `\n... and ${errors.length - 5} more` : ""
        }`;
      }

      message +=
        "\n\n💡 Tip: Files are saved to your Android device's storage. You can access them using a file manager app.";

      showMessage(message, errors.length > 0);

      return result.uri;
    } catch (error) {
      console.error("Error downloading layers:", error);
      showMessage(
        `Error exporting layers: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        true
      );
      throw error;
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <SidebarGroup className="space-y-3">
      {/* <SidebarGroupLabel className="px-3 py-2 text-sm font-semibold">
        Import / Export Layers
      </SidebarGroupLabel> */}
      <SidebarGroupContent className="space-y-4">
        <div className="space-y-1 px-2">
          <label className="text-sm text-sidebar-foreground/70 block font-medium">
            Import Files
          </label>
          <Input
            type="file"
            accept="*/*"
            className="w-full"
            disabled={isExporting || isImporting}
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
                  setIsImporting(false);
                }
              }
            }}
          />
          {(isExporting || isImporting) && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground px-0">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                {isExporting ? "Exporting layers..." : "Importing files..."}
              </span>
            </div>
          )}
          <p className="text-xs text-muted-foreground px-0">
            Import vector files, raster/DEM, or layer exports (JSON)
          </p>
        </div>

        <div className="px-2 space-y-1">
          <Button
            onClick={async () => {
              try {
                await downloadAllLayers();
              } catch (error) {
                console.error("Failed to download layers:", error);
              }
            }}
            disabled={layers.length === 0 || isExporting || isImporting}
            className="w-full h-10 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-medium shadow-sm hover:shadow-md transition-all duration-200 border-0 rounded-md flex items-center gap-1.5 disabled:opacity-50"
            variant="outline"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Exporting...
              </>
            ) : (
              <>
                <FileDown className="w-4 h-4" /> Export All Layers
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground px-0">
            Export all layers as JSON with complete layer information
          </p>
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default FileSection;
