import type { LayerProps } from "@/lib/definitions";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SidebarGroup, SidebarGroupContent } from "../ui/sidebar";
import { showMessage } from "@/lib/capacitor-utils";
import { toast } from "@/lib/toast";
import { useLayers, useNodeIconMappings } from "@/store/layers-store";
import { generateLayerId } from "@/lib/layers";
import {
  fileToDEMRaster,
  fileToGeoJSON,
  generateRandomColor,
} from "@/lib/utils";
import { Encoding, Filesystem, Directory } from "@capacitor/filesystem";
import { FileDown, Loader2 } from "lucide-react";
import { useState } from "react";

type FileSectionProps = {
  fixedDirectory?: Directory;
  fixedPath?: string;
};

const FileSection = ({ fixedDirectory, fixedPath }: FileSectionProps = {}) => {
  const { layers, setLayers, addLayer } = useLayers();
  const { nodeIconMappings, setNodeIconMappings } = useNodeIconMappings();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const uploadDemFile = async (file: File) => {
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
      // Use addLayer to ensure proper state updates and prevent overwriting
      addLayer(newLayer);

      if (isDefaultBounds) {
        showMessage(
          `DEM uploaded with default bounds (may not be correctly positioned). Use a georeferenced GeoTIFF for accurate positioning.`
        );
      } else {
        showMessage(`Successfully uploaded DEM: ${file.name}`);
      }
    } catch (error) {
      console.error("Error uploading DEM file:", error);
      showMessage(
        `Error uploading DEM: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        true
      );
    }
  };

  // const extractTiffFromZip = async (file: File): Promise<File[]> => {
  //   try {
  //     const JSZip = (await import("jszip")).default;
  //     const zip = await JSZip.loadAsync(file);

  //     // Find all TIFF and HGT files in the ZIP (including in subfolders)
  //     const tiffFiles = Object.keys(zip.files).filter((name) => {
  //       const lowerName = name.toLowerCase();
  //       // Skip directories
  //       if (zip.files[name].dir) {
  //         return false;
  //       }
  //       return (
  //         lowerName.endsWith(".tif") ||
  //         lowerName.endsWith(".tiff") ||
  //         lowerName.endsWith(".hgt") ||
  //         lowerName.endsWith(".dett")
  //       );
  //     });

  //     if (tiffFiles.length === 0) {
  //       return [];
  //     }

  //     // Extract all TIFF files
  //     const extractedFiles: File[] = [];
  //     for (const fileName of tiffFiles) {
  //       try {
  //         const fileData = await zip.files[fileName].async("blob");
  //         // Extract just the filename without folder path
  //         const baseFileName = fileName.split("/").pop() || fileName;
  //         // Determine MIME type based on extension
  //         const lowerName = fileName.toLowerCase();
  //         let mimeType = "image/tiff";
  //         if (lowerName.endsWith(".hgt")) {
  //           mimeType = "application/octet-stream";
  //         }
  //         const extractedFile = new File([fileData], baseFileName, {
  //           type: mimeType,
  //         });
  //         extractedFiles.push(extractedFile);
  //       } catch (error) {
  //         console.error(`Error extracting ${fileName} from ZIP:`, error);
  //       }
  //     }

  //     return extractedFiles;
  //   } catch (error) {
  //     console.error("Error extracting TIFF from ZIP:", error);
  //     return [];
  //   }
  // };

  // Extract all vector files (GeoJSON, CSV, GPX, KML, KMZ) from ZIP
  // const extractVectorFilesFromZip = async (file: File): Promise<File[]> => {
  //   try {
  //     const JSZip = (await import("jszip")).default;
  //     const zip = await JSZip.loadAsync(file);

  //     // Find all vector files in the ZIP (including in subfolders)
  //     const vectorFiles = Object.keys(zip.files).filter((name) => {
  //       const lowerName = name.toLowerCase();
  //       // Skip directories
  //       if (zip.files[name].dir) {
  //         return false;
  //       }
  //       // Check for vector file extensions
  //       // Note: We allow files in "layers_export" folders (these are our exported ZIPs)
  //       // but exclude the old JSON export format files
  //       const isOldExportFormat =
  //         lowerName.includes("layers_export") &&
  //         lowerName.endsWith(".json") &&
  //         !lowerName.includes("/"); // Root level JSON files with "layers_export" in name
  //       return (
  //         lowerName.endsWith(".geojson") ||
  //         (lowerName.endsWith(".json") &&
  //           !lowerName.includes("node_icon_mappings") &&
  //           !isOldExportFormat) ||
  //         lowerName.endsWith(".csv") ||
  //         lowerName.endsWith(".gpx") ||
  //         lowerName.endsWith(".kml") ||
  //         lowerName.endsWith(".kmz")
  //       );
  //     });

  //     if (vectorFiles.length === 0) {
  //       return [];
  //     }

  //     // Extract all vector files
  //     const extractedFiles: File[] = [];
  //     for (const fileName of vectorFiles) {
  //       try {
  //         const fileData = await zip.files[fileName].async("blob");
  //         // Extract just the filename without folder path
  //         const baseFileName = fileName.split("/").pop() || fileName;
  //         // Determine MIME type based on extension
  //         const lowerName = fileName.toLowerCase();
  //         let mimeType = "application/octet-stream";
  //         if (lowerName.endsWith(".geojson") || lowerName.endsWith(".json")) {
  //           mimeType = "application/json";
  //         } else if (lowerName.endsWith(".csv")) {
  //           mimeType = "text/csv";
  //         } else if (lowerName.endsWith(".gpx")) {
  //           mimeType = "application/gpx+xml";
  //         } else if (lowerName.endsWith(".kml")) {
  //           mimeType = "application/vnd.google-earth.kml+xml";
  //         } else if (lowerName.endsWith(".kmz")) {
  //           mimeType = "application/vnd.google-earth.kmz";
  //         }
  //         const extractedFile = new File([fileData], baseFileName, {
  //           type: mimeType,
  //         });
  //         extractedFiles.push(extractedFile);
  //       } catch (error) {
  //         console.error(`Error extracting ${fileName} from ZIP:`, error);
  //       }
  //     }

  //     return extractedFiles;
  //   } catch (error) {
  //     console.error("Error extracting vector files from ZIP:", error);
  //     return [];
  //   }
  // };

  // Find all valid files in ZIP for sequential processing (handles nested ZIPs)
  type ValidFile = {
    file: File;
    type: "tiff" | "vector" | "shapefile";
    name: string;
  };

  const findAllValidFilesInZip = async (
    zipFile: File,
    depth: number = 0,
    maxDepth: number = 10
  ): Promise<ValidFile[]> => {
    if (depth > maxDepth) {
      console.warn("Maximum ZIP nesting depth reached, skipping nested ZIP");
      return [];
    }

    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(zipFile);
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
          const nestedZipFile = new File([nestedZipData], nestedZipName, {
            type: "application/zip",
          });
          const nestedFiles = await findAllValidFilesInZip(
            nestedZipFile,
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
          const fileData = await zip.files[fileName].async("blob");
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
          console.error(`Error extracting ${fileName} from ZIP:`, error);
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
          lowerName.endsWith(".kmz")
        );
      });

      for (const fileName of vectorFiles) {
        try {
          const fileData = await zip.files[fileName].async("blob");
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
          console.error(`Error extracting ${fileName} from ZIP:`, error);
        }
      }

      // Find shapefile components and group them
      const shapefileComponents = Object.keys(zip.files).filter((name) => {
        const lowerName = name.toLowerCase();
        if (zip.files[name].dir) return false;
        return (
          lowerName.endsWith(".shp") ||
          lowerName.endsWith(".shx") ||
          lowerName.endsWith(".dbf")
        );
      });

      if (shapefileComponents.length > 0) {
        const shapefileGroups = new Map<string, string[]>();
        for (const fileName of shapefileComponents) {
          const baseName = fileName
            .toLowerCase()
            .replace(/\.(shp|shx|dbf)$/, "");
          if (!shapefileGroups.has(baseName)) {
            shapefileGroups.set(baseName, []);
          }
          shapefileGroups.get(baseName)!.push(fileName);
        }

        for (const [baseName, files] of shapefileGroups.entries()) {
          const hasShp = files.some((f) => f.toLowerCase().endsWith(".shp"));
          const hasShx = files.some((f) => f.toLowerCase().endsWith(".shx"));
          const hasDbf = files.some((f) => f.toLowerCase().endsWith(".dbf"));

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
              console.error(
                `Error creating shapefile ZIP for ${baseName}:`,
                error
              );
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

  // Extract shapefile components from ZIP
  // const extractShapefileFromZip = async (file: File): Promise<File | null> => {
  //   try {
  //     const JSZip = (await import("jszip")).default;
  //     const zip = await JSZip.loadAsync(file);

  //     // Find all shapefile components (.shp, .shx, .dbf)
  //     const shapefileComponents = Object.keys(zip.files).filter((name) => {
  //       const lowerName = name.toLowerCase();
  //       if (zip.files[name].dir) {
  //         return false;
  //       }
  //       return (
  //         lowerName.endsWith(".shp") ||
  //         lowerName.endsWith(".shx") ||
  //         lowerName.endsWith(".dbf")
  //       );
  //     });

  //     if (shapefileComponents.length === 0) {
  //       return null;
  //     }

  //     // Group shapefile components by base name
  //     const shapefileGroups = new Map<string, string[]>();
  //     for (const fileName of shapefileComponents) {
  //       const baseName = fileName.toLowerCase().replace(/\.(shp|shx|dbf)$/, "");
  //       if (!shapefileGroups.has(baseName)) {
  //         shapefileGroups.set(baseName, []);
  //       }
  //       shapefileGroups.get(baseName)!.push(fileName);
  //     }

  //     // Find a complete shapefile (has .shp, .shx, and .dbf)
  //     for (const [baseName, files] of shapefileGroups.entries()) {
  //       const hasShp = files.some((f) => f.toLowerCase().endsWith(".shp"));
  //       const hasShx = files.some((f) => f.toLowerCase().endsWith(".shx"));
  //       const hasDbf = files.some((f) => f.toLowerCase().endsWith(".dbf"));

  //       if (hasShp && hasShx && hasDbf) {
  //         // Create a new ZIP with just this shapefile's components
  //         const shapefileZip = new JSZip();
  //         for (const fileName of files) {
  //           const fileData = await zip.files[fileName].async("blob");
  //           shapefileZip.file(fileName, fileData);
  //         }

  //         // Generate the shapefile ZIP as a blob
  //         const zipBlob = await shapefileZip.generateAsync({
  //           type: "blob",
  //           compression: "DEFLATE",
  //         });

  //         // Return as a File object
  //         return new File([zipBlob], `${baseName}.zip`, {
  //           type: "application/zip",
  //         });
  //       }
  //     }

  //     return null;
  //   } catch (error) {
  //     console.error("Error extracting shapefile from ZIP:", error);
  //     return null;
  //   }
  // };
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

        setTimeout(() => {
          setLayers(importData.layers);

          if (importData.nodeIconMappings) {
            setNodeIconMappings(importData.nodeIconMappings);
          }

          setTimeout(() => {
            showMessage(
              `Successfully imported ${importData.layers.length} layers from ${file.name}`
            );
          }, 500);
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

      showMessage(errorMessage, true);
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
        showMessage(
          "Invalid annotation file format. Could not convert to GeoJSON.",
          true
        );
        return;
      }

      if (geojson.features.length === 0) {
        showMessage("Annotation file contains no features.", true);
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
        showMessage(
          "No valid annotations found. Features must have text/label/name/annotation properties.",
          true
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

      // Use addLayer to ensure proper state updates and prevent overwriting
      addLayer(newLayer);
      showMessage(
        `Successfully uploaded ${annotations.length} annotation(s) from ${file.name}`
      );
    } catch (error) {
      console.error("Error uploading annotation file:", error);
      showMessage(
        `Error uploading annotation file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        true
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

  const uploadGeoJsonFile = async (file: File) => {
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
        showMessage(
          "Invalid vector file format. Could not convert to GeoJSON.",
          true
        );
        return;
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
        showMessage(
          `Unsupported GeoJSON structure: ${rawGeojson.type ?? "Unknown type"}`,
          true
        );
        return;
      }

      if (!Array.isArray(featureCollection.features)) {
        showMessage("Invalid GeoJSON format: features is not an array.", true);
        return;
      }

      if (featureCollection.features.length === 0) {
        showMessage("Vector file contains no features.", true);
        return;
      }

      const featureCount = featureCollection.features.length;

      // Show uploading message with feature count
      showMessage(
        `Uploading ${featureCount.toLocaleString()} features...`,
        false
      );

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
        showMessage("Vector file contains no valid geometries.", true);
        return;
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
        color: generateRandomColor(),
        pointRadius: extractedPointRadius ?? 5,
        lineWidth: extractedLineWidth ?? 5,
        visible: true,
        uploadedAt: Date.now(),
      } as LayerProps & { uploadedAt: number };
      // Use addLayer to ensure proper state updates and prevent overwriting
      // This prevents overwriting when importing multiple files from ZIP
      addLayer(newLayer);
      showMessage(
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

      showMessage(`Error uploading file: ${errorMessage}`, true);
    }
  };

  const handleFileImport = async (file: File) => {
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

      if (ext === "json") {
        const isLayerExport = await importLayersFromJson(file);
        if (isLayerExport) {
          return;
        }
      }

      if (ext === "zip") {
        setIsImporting(true);
        try {
          // Find all valid files in ZIP
          const validFiles = await findAllValidFilesInZip(file);

          if (validFiles.length === 0) {
            showMessage(
              "No supported files found in ZIP. The ZIP should contain GeoJSON, TIFF, CSV, GPX, KML, KMZ, or shapefile files.",
              true
            );
            setIsImporting(false);
            return;
          }

          showMessage(
            `Found ${validFiles.length} valid file(s) in ZIP. Processing sequentially...`,
            false
          );

          // Process files sequentially - one at a time
          let successCount = 0;
          let errorCount = 0;
          const typeCounts = { tiff: 0, vector: 0, shapefile: 0 };

          for (let i = 0; i < validFiles.length; i++) {
            const validFile = validFiles[i];
            try {
              showMessage(
                `Processing ${i + 1}/${validFiles.length}: ${
                  validFile.name
                }...`,
                false
              );

              if (validFile.type === "tiff") {
                await uploadDemFile(validFile.file);
                typeCounts.tiff++;
                successCount++;
              } else if (
                validFile.type === "vector" ||
                validFile.type === "shapefile"
              ) {
                await uploadGeoJsonFile(validFile.file);
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
              showMessage(
                `Error processing ${validFile.name}: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
                true
              );
            }
          }

          // Check for node_icon_mappings.json
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
              showMessage("Imported node icon mappings.", false);
            }
          } catch (error) {
            console.error("Error importing node icon mappings:", error);
          }

          // Show final success message with counts
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
            showMessage(
              `Successfully imported ${successCount} layer(s) from ZIP (${parts.join(
                ", "
              )}).${errorCount > 0 ? ` ${errorCount} file(s) failed.` : ""}`,
              errorCount > 0
            );
          } else {
            showMessage(
              "No files could be imported. Check errors above.",
              true
            );
          }
          setIsImporting(false);
          return;
        } catch (error) {
          console.error("Error processing ZIP file:", error);
          showMessage(
            `Error processing ZIP file: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
            true
          );
          setIsImporting(false);
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
          showMessage(
            `Unsupported file type: .${ext} (${
              file.type || "unknown type"
            }). Supported formats:\n` +
              `Layer Export: JSON (with layers array)\n` +
              `Vector: ${vectorExtensions
                .filter((e) => e !== "json")
                .join(", ")}, JSON\n` +
              `Raster/DEM: ${rasterExtensions.join(", ")}, ZIP (with TIFF)\n` +
              `Note: ZIP files are checked for TIFF files first, then processed as shapefiles if no TIFF found.`,
            true
          );
        }
      }
    } catch (error) {
      console.error("Error importing file:", error);
      showMessage(
        `Error importing file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        true
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
            // Export DEM as TIFF
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
                // Convert canvas to blob (Promise-based)
                const blob = await new Promise<Blob | null>((resolve) => {
                  canvas!.toBlob(resolve, "image/png", 1.0);
                });

                if (blob) {
                  const arrayBuffer = await blob.arrayBuffer();
                  folder.file(`${sanitizedName}.tiff`, arrayBuffer);
                  exportedCount++;
                } else {
                  errors.push(`${layer.name}: Failed to convert DEM to image`);
                }
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
      const storageDir = fixedDirectory || Directory.Documents;
      const savePath = fixedPath || `HSC_Layers/${zipFileName}`;

      const result = await Filesystem.writeFile({
        path: savePath,
        data: zipBase64,
        directory: storageDir,
        encoding: Encoding.UTF8, // Base64 data is stored as UTF8 string
        recursive: true,
      });

      let message = `Successfully exported ${exportedCount} layer(s) to ZIP file:\n\n📁 Path: ${savePath}\n\n📍 Full URI: ${result.uri}`;

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

// Export downloadAllLayers function for use in other components
export const downloadAllLayers = async (
  layers: LayerProps[],
  nodeIconMappings: Record<string, string>,
  fixedDirectory?: Directory,
  fixedPath?: string
) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const folderName = `layers_export_${timestamp}`;
  const zipFileName = `${folderName}.zip`;

  const toastId = toast.loading(`Exporting ${layers.length} layer(s)...`);

  // Layers should already have zoom ranges calculated in the store
  // Just log to verify

  // Import JSZip dynamically
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const folder = zip.folder(folderName);

  if (!folder) {
    throw new Error("Failed to create ZIP folder");
  }

  let exportedCount = 0;
  const errors: string[] = [];

  // Process each layer (same logic as in FileSection component)
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layer = layers[layerIndex];

    if (layers.length > 5) {
      toast.update(
        toastId,
        `Exporting layer ${layerIndex + 1} of ${layers.length}: ${
          layer.name
        }...`,
        "loading"
      );
    }
    try {
      const sanitizedName = layer.name
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .substring(0, 100);

      if (layer.type === "geojson" && layer.geojson) {
        const featureCount = layer.geojson.features?.length || 0;
        const MAX_FEATURES_PER_FILE = 2000;

        if (featureCount > MAX_FEATURES_PER_FILE) {
          const totalParts = Math.ceil(featureCount / MAX_FEATURES_PER_FILE);

          for (let partIndex = 0; partIndex < totalParts; partIndex++) {
            const startIdx = partIndex * MAX_FEATURES_PER_FILE;
            const endIdx = Math.min(
              startIdx + MAX_FEATURES_PER_FILE,
              featureCount
            );
            const partFeatures = layer.geojson.features.slice(startIdx, endIdx);

            const partFeatureCollection: GeoJSON.FeatureCollection = {
              type: "FeatureCollection",
              features: partFeatures,
            };

            const fileName =
              partIndex === 0
                ? `${sanitizedName}.geojson`
                : `${sanitizedName}_part${partIndex + 1}.geojson`;

            if (partIndex === 0) {
              (partFeatureCollection as any).__split = true;
              (partFeatureCollection as any).__totalParts = totalParts;
              (partFeatureCollection as any).__layerName = layer.name;
            }

            const geojsonContent = JSON.stringify(partFeatureCollection);
            folder.file(fileName, geojsonContent);
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        } else {
          const geojsonContent = JSON.stringify(layer.geojson);
          folder.file(`${sanitizedName}.geojson`, geojsonContent);
        }
        exportedCount++;
      } else if (
        layer.type === "point" ||
        layer.type === "line" ||
        layer.type === "polygon"
      ) {
        let feature: GeoJSON.Feature | null = null;

        if (layer.type === "point" && layer.position) {
          feature = {
            type: "Feature",
            geometry: { type: "Point", coordinates: layer.position },
            properties: {
              name: layer.name,
              color: layer.color,
              radius: layer.radius,
            },
          };
        } else if (layer.type === "line" && layer.path) {
          feature = {
            type: "Feature",
            geometry: { type: "LineString", coordinates: layer.path },
            properties: {
              name: layer.name,
              color: layer.color,
              lineWidth: layer.lineWidth,
            },
          };
        } else if (layer.type === "polygon" && layer.polygon) {
          feature = {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: layer.polygon },
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
        const annotationCount = layer.annotations.length;
        const MAX_FEATURES_PER_FILE = 2000;

        if (annotationCount > MAX_FEATURES_PER_FILE) {
          const totalParts = Math.ceil(annotationCount / MAX_FEATURES_PER_FILE);

          for (let partIndex = 0; partIndex < totalParts; partIndex++) {
            const startIdx = partIndex * MAX_FEATURES_PER_FILE;
            const endIdx = Math.min(
              startIdx + MAX_FEATURES_PER_FILE,
              annotationCount
            );
            const batch = layer.annotations.slice(startIdx, endIdx);

            const features: GeoJSON.Feature[] = batch.map((ann) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: ann.position },
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

            if (partIndex === 0) {
              (featureCollection as any).__split = true;
              (featureCollection as any).__totalParts = totalParts;
              (featureCollection as any).__layerName = layer.name;
            }

            const geojsonContent = JSON.stringify(featureCollection);
            folder.file(fileName, geojsonContent);
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        } else {
          const features: GeoJSON.Feature[] = layer.annotations.map((ann) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: ann.position },
            properties: {
              text: ann.text,
              color: ann.color,
              fontSize: ann.fontSize,
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
      } else if (layer.type === "nodes" && layer.nodes) {
        const nodeCount = layer.nodes.length;
        const MAX_FEATURES_PER_FILE = 2000;

        if (nodeCount > MAX_FEATURES_PER_FILE) {
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

            if (partIndex === 0) {
              (featureCollection as any).__split = true;
              (featureCollection as any).__totalParts = totalParts;
              (featureCollection as any).__layerName = layer.name;
            }

            const geojsonContent = JSON.stringify(featureCollection);
            folder.file(fileName, geojsonContent);
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        } else {
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
        try {
          let canvas: HTMLCanvasElement | null = null;

          if (layer.bitmap instanceof HTMLCanvasElement) {
            canvas = layer.bitmap;
          } else if (
            layer.bitmap instanceof ImageBitmap ||
            layer.bitmap instanceof HTMLImageElement
          ) {
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
            const blob = await new Promise<Blob | null>((resolve) => {
              canvas!.toBlob(resolve, "image/png", 1.0);
            });

            if (blob) {
              const arrayBuffer = await blob.arrayBuffer();
              folder.file(`${sanitizedName}.tiff`, arrayBuffer);
              exportedCount++;
            } else {
              errors.push(`${layer.name}: Failed to convert DEM to image`);
            }
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
        errors.push(
          `${layer.name}: Connection layers export not yet implemented`
        );
      } else {
        errors.push(
          `${layer.name}: Layer type "${layer.type}" not supported for export`
        );
      }

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

  if (nodeIconMappings && Object.keys(nodeIconMappings).length > 0) {
    const mappingsContent = JSON.stringify(nodeIconMappings, null, 2);
    folder.file("node_icon_mappings.json", mappingsContent);
  }

  toast.update(toastId, "Creating ZIP archive...", "loading");
  const zipBase64 = await zip.generateAsync({
    type: "base64",
    compression: "DEFLATE",
    compressionOptions: { level: 3 },
    streamFiles: true,
  });

  const storageDir = fixedDirectory || Directory.Documents;
  const savePath = fixedPath || `HSC_Layers/${zipFileName}`;

  const result = await Filesystem.writeFile({
    path: savePath,
    data: zipBase64,
    directory: storageDir,
    encoding: Encoding.UTF8,
    recursive: true,
  });

  let message = `Successfully exported ${exportedCount} layer(s) to ZIP file. Path: ${savePath}`;

  if (errors.length > 0) {
    message += ` (${errors.length} layer(s) had errors)`;
    toast.update(toastId, message, "error");
  } else {
    toast.update(toastId, message, "success");
  }

  return result.uri;
};

export default FileSection;
