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
import { fileToDEMRaster, fileToGeoJSON } from "@/lib/utils";
import { Encoding, Filesystem } from "@capacitor/filesystem";
import { FileDown } from "lucide-react";

const FileSection = () => {
  const { layers, setLayers } = useLayers();
  const { nodeIconMappings, setNodeIconMappings } = useNodeIconMappings();
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
      };
      setLayers([...layers, newLayer]);

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
  const extractTiffFromZip = async (file: File): Promise<File | null> => {
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file);

      const tiffFiles = Object.keys(zip.files).filter((name) => {
        const lowerName = name.toLowerCase();
        return lowerName.endsWith(".tif") || lowerName.endsWith(".tiff");
      });

      if (tiffFiles.length === 0) {
        return null;
      }

      const tiffFileName = tiffFiles[0];

      const tiffData = await zip.files[tiffFileName].async("blob");
      const tiffFile = new File([tiffData], tiffFileName, {
        type: "image/tiff",
      });

      return tiffFile;
    } catch (error) {
      console.error("Error extracting TIFF from ZIP:", error);
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
      };

      setLayers([...layers, newLayer]);
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

      const validFeatures = featureCollection.features.filter(
        (feature) => feature && feature.geometry
      );

      if (validFeatures.length === 0) {
        showMessage("Vector file contains no valid geometries.", true);
        return;
      }

      const newLayer: LayerProps = {
        type: "geojson",
        id: generateLayerId(),
        name: file.name.split(".")[0],
        geojson: {
          type: "FeatureCollection",
          features: validFeatures,
        },
        color: [
          Math.floor(Math.random() * 255),
          Math.floor(Math.random() * 255),
          Math.floor(Math.random() * 255),
        ],
        pointRadius: 5,
        lineWidth: 5,
        visible: true,
      };
      setLayers([...layers, newLayer]);
      showMessage(
        `Successfully uploaded ${validFeatures.length} feature(s) from ${file.name}`
      );
    } catch (error) {
      console.error("Error uploading file:", error);
      showMessage(
        `Error uploading file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        true
      );
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
        const tiffFile = await extractTiffFromZip(file);
        if (tiffFile) {
          console.log("Found TIFF in ZIP, processing as DEM");
          await uploadDemFile(tiffFile);
          return;
        }
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
      const rasterExtensions = ["tif", "tiff"];

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
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `layers_export_${timestamp}.json`;

      const exportData = {
        version: "1.0",
        exportDate: new Date().toISOString(),
        totalLayers: layers.length,
        layers: layers,
        nodeIconMappings: nodeIconMappings,
      };

      const jsonContent = JSON.stringify(exportData, null, 2);

      const storageDir = await getStorageDirectory();
      const dirName = getStorageDirectoryName(storageDir);
      const dirPath = getStorageDirectoryPath(storageDir);

      const result = await Filesystem.writeFile({
        path: `HSC_Layers/${filename}`,
        data: jsonContent,
        directory: storageDir,
        encoding: Encoding.UTF8,
        recursive: true,
      });

      const fullPath = `${dirName}${dirPath}HSC_Layers/${filename}`;
      showMessage(
        `Successfully downloaded ${layers.length} layers to Android device:\n\n📁 Path: ${fullPath}\n\n📍 Full URI: ${result.uri}\n\n💡 Tip: Files are saved to your Android device's storage. You can access them using a file manager app.`
      );

      return result.uri;
    } catch (error) {
      console.error("Error downloading layers:", error);
      showMessage(
        `Error downloading layers: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        true
      );
      throw error;
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
            disabled={layers.length === 0}
            className="w-full h-10 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-medium shadow-sm hover:shadow-md transition-all duration-200 border-0 rounded-md flex items-center gap-1.5"
            variant="outline"
          >
            <FileDown className="w-4 h-4" /> Export All Layers
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
