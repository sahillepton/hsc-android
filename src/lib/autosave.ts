import type { LayerProps } from "@/lib/definitions";
import { listFilesInDirectory } from "./capacitor-utils";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";

const AUTOSAVE_SESSION_PATH = "HSC_SESSIONS/autosave_session.zip";

// Serialize layers, converting non-serializable data to serializable formats
// Returns serialized layers and bitmaps map (layerId -> blob) for separate storage
export const serializeLayers = async (
  layers: LayerProps[]
): Promise<{
  serialized: LayerProps[];
  bitmaps: Map<string, Blob>;
}> => {
  const serialized: LayerProps[] = [];
  const bitmaps = new Map<string, Blob>();

  for (const layer of layers) {
    const serializedLayer: LayerProps = { ...layer };

    // Handle DEM layers - save bitmaps as separate PNG files in ZIP
    if (layer.type === "dem") {
      // Save bitmap as blob (will be added to ZIP as PNG file)
      // This preserves all pixel data without bloating JSON
      if (layer.bitmap && layer.bitmap instanceof HTMLCanvasElement) {
        try {
          // Convert canvas to blob (PNG format preserves all data)
          const canvas = layer.bitmap;
          const blob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob(
              (blob: Blob | null) => resolve(blob),
              "image/png" // PNG preserves all pixel data including transparency
            );
          });
          if (blob) {
            bitmaps.set(layer.id, blob);
            // Mark that bitmap is saved separately
            (serializedLayer as any).hasBitmap = true;
            (serializedLayer as any).bitmapFileName = `bitmap_${layer.id}.png`;
          }
        } catch (error) {
          console.warn(
            `Failed to convert DEM bitmap to blob for layer ${layer.name}:`,
            error
          );
        }
      }
      delete (serializedLayer as any).bitmap;
      delete (serializedLayer as any).texture;

      // Convert Float32Array to regular array for serialization
      if (serializedLayer.elevationData) {
        const elevationData = serializedLayer.elevationData;
        (serializedLayer as any).elevationData = {
          data: Array.from(elevationData.data), // Convert Float32Array to regular array
          width: elevationData.width,
          height: elevationData.height,
          min: elevationData.min,
          max: elevationData.max,
        };
      }
    }

    serialized.push(serializedLayer);
  }

  return { serialized, bitmaps };
};

// Save layers as ZIP to HSC_SESSIONS folder (file storage, no size limit)
export const saveLayers = async (layers: LayerProps[]): Promise<void> => {
  try {
    // Serialize layers and get bitmaps separately
    const { serialized, bitmaps } = await serializeLayers(layers);

    // Get node icon mappings
    const { loadNodeIconMappings } = await import("./autosave");
    const nodeIconMappings = await loadNodeIconMappings();

    // Create export format (same as downloadAllLayers)
    const exportData = {
      version: "1.0",
      timestamp: new Date().toISOString(),
      layers: serialized,
      nodeIconMappings: nodeIconMappings,
    };

    // Create ZIP using JSZip
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    // Add layers.json to ZIP
    zip.file("layers.json", JSON.stringify(exportData));

    // Add node_icon_mappings.json for compatibility
    if (Object.keys(nodeIconMappings).length > 0) {
      zip.file("node_icon_mappings.json", JSON.stringify(nodeIconMappings));
    }

    // Add bitmap PNG files to ZIP (saves all pixel data)
    for (const [layerId, blob] of bitmaps.entries()) {
      const fileName = `bitmaps/bitmap_${layerId}.png`;
      const arrayBuffer = await blob.arrayBuffer();
      zip.file(fileName, arrayBuffer);
    }

    // Generate ZIP blob
    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
    });

    // Convert blob to base64 for Filesystem API
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      const timeout = setTimeout(() => {
        reader.abort();
        reject(new Error("Base64 conversion timeout"));
      }, 60000); // 60 second timeout for large files

      reader.onload = () => {
        clearTimeout(timeout);
        try {
          const result = reader.result as string;
          const base64Data = result.split(",")[1];
          resolve(base64Data);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Failed to read ZIP blob"));
      };
      reader.readAsDataURL(zipBlob);
    });

    // Ensure HSC_SESSIONS directory exists
    try {
      await Filesystem.mkdir({
        path: "HSC_SESSIONS",
        directory: Directory.Documents,
        recursive: true,
      });
    } catch (error) {
      // Directory might already exist, ignore
    }

    // Save ZIP to Filesystem (no size limit)
    await Filesystem.writeFile({
      path: AUTOSAVE_SESSION_PATH,
      data: base64,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
  } catch (error) {
    console.error("Error autosaving layers:", error);
    // Don't throw - autosave failures shouldn't break the app
  }
};

// Deserialize layers, reconstructing non-serializable data
// Accepts optional zip object to load bitmaps from separate PNG files
const deserializeLayers = async (
  layers: LayerProps[],
  zip?: any
): Promise<LayerProps[]> => {
  const deserializedLayers: LayerProps[] = [];

  for (const layer of layers) {
    try {
      const deserialized: LayerProps = { ...layer };

      // Handle DEM layers - reconstruct non-serializable data
      if (layer.type === "dem") {
        // Try to load bitmap from separate PNG file in ZIP
        if ((layer as any).bitmapFileName && zip) {
          try {
            const bitmapFile = zip.file(
              `bitmaps/${(layer as any).bitmapFileName}`
            );
            if (bitmapFile) {
              const blob = await bitmapFile.async("blob");
              const img = new Image();
              const imageUrl = URL.createObjectURL(blob);

              await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                  reject(new Error("Image load timeout"));
                }, 30000); // 30 second timeout for large images

                img.onload = () => {
                  clearTimeout(timeout);
                  URL.revokeObjectURL(imageUrl);
                  // Create a canvas from the loaded image
                  const canvas = document.createElement("canvas");
                  canvas.width = img.width;
                  canvas.height = img.height;
                  const ctx = canvas.getContext("2d");
                  if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    deserialized.bitmap = canvas;
                    deserialized.texture = canvas;
                    resolve();
                  } else {
                    reject(new Error("Failed to get canvas context"));
                  }
                };
                img.onerror = () => {
                  clearTimeout(timeout);
                  URL.revokeObjectURL(imageUrl);
                  reject(new Error("Failed to load image from blob"));
                };
                img.src = imageUrl;
              });
            }
          } catch (error) {
            console.warn(
              `Failed to load bitmap from ZIP for layer ${layer.id}:`,
              error
            );
          }
        }
        // Fallback: try to reconstruct from data URL (for backward compatibility)
        else if ((layer as any).bitmapDataUrl) {
          try {
            const bitmapDataUrl = (layer as any).bitmapDataUrl;
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error("Image load timeout"));
              }, 30000);

              img.onload = () => {
                clearTimeout(timeout);
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                if (ctx) {
                  ctx.drawImage(img, 0, 0);
                  deserialized.bitmap = canvas;
                  deserialized.texture = canvas;
                  resolve();
                } else {
                  reject(new Error("Failed to get canvas context"));
                }
              };
              img.onerror = () => {
                clearTimeout(timeout);
                reject(new Error("Failed to load image from data URL"));
              };
              img.src = bitmapDataUrl;
            });
          } catch (error) {
            console.warn(
              "Failed to reconstruct DEM bitmap from data URL:",
              error
            );
          }
        }

        // Reconstruct Float32Array from regular array
        if (
          (layer as any).elevationData &&
          Array.isArray((layer as any).elevationData.data)
        ) {
          try {
            const elevationData = (layer as any).elevationData;
            deserialized.elevationData = {
              data: new Float32Array(elevationData.data),
              width: elevationData.width,
              height: elevationData.height,
              min: elevationData.min,
              max: elevationData.max,
            };
          } catch (error) {
            console.warn(
              `Failed to reconstruct elevation data for layer ${layer.id}:`,
              error
            );
          }
        }
      }

      deserializedLayers.push(deserialized);
    } catch (error) {
      console.error(
        `Error deserializing layer ${layer.id || "unknown"}:`,
        error
      );
      // Skip this layer but continue with others
    }
  }

  return deserializedLayers;
};

// Load layers from ZIP file in HSC_SESSIONS folder (file storage)
export const loadLayers = async (): Promise<LayerProps[]> => {
  try {
    // Try to load from autosave session file
    // Read as base64 for binary ZIP file
    const result = await Filesystem.readFile({
      path: AUTOSAVE_SESSION_PATH,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });

    const content = result.data;
    if (!content || typeof content !== "string" || content.trim() === "") {
      return [];
    }

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
    if (!layersFile) {
      console.warn("No layers.json found in autosave ZIP");
      return [];
    }

    const layersJson = await layersFile.async("string");
    const importData = JSON.parse(layersJson);

    if (!importData.version || !Array.isArray(importData.layers)) {
      console.error("Invalid autosave ZIP structure");
      return [];
    }

    // Load node icon mappings if present
    const nodeIconMappingsFile = zip.file("node_icon_mappings.json");
    if (nodeIconMappingsFile) {
      try {
        const mappingsJson = await nodeIconMappingsFile.async("string");
        const mappings = JSON.parse(mappingsJson);
        // Save to file storage (not Preferences)
        await saveNodeIconMappings(mappings);
      } catch (error) {
        console.warn("Failed to load node icon mappings from ZIP:", error);
      }
    }

    // Deserialize layers with bitmaps from ZIP
    const deserializedLayers = await deserializeLayers(importData.layers, zip);

    return deserializedLayers;
  } catch (error) {
    console.error("Error loading autosaved layers:", error);
    return [];
  }
};

// Save node icon mappings to file storage
export const saveNodeIconMappings = async (
  mappings: Record<string, string>
): Promise<void> => {
  try {
    const data = JSON.stringify(mappings);
    const filePath = "HSC_SESSIONS/node_icon_mappings.json";

    // Ensure directory exists
    try {
      await Filesystem.mkdir({
        path: "HSC_SESSIONS",
        directory: Directory.Documents,
        recursive: true,
      });
    } catch (error) {
      // Directory might already exist
    }

    await Filesystem.writeFile({
      path: filePath,
      data: data,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
  } catch (error) {
    console.error("Error saving node icon mappings:", error);
  }
};

// Load node icon mappings from file storage
export const loadNodeIconMappings = async (): Promise<
  Record<string, string>
> => {
  try {
    const filePath = "HSC_SESSIONS/node_icon_mappings.json";
    const result = await Filesystem.readFile({
      path: filePath,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });

    const content = result.data;
    if (!content || typeof content !== "string" || content.trim() === "") {
      return {};
    }

    return JSON.parse(content) as Record<string, string>;
  } catch (error) {
    console.error("Error loading node icon mappings:", error);
    return {};
  }
};

// Clear autosave data from file storage
export const clearAutosave = async (): Promise<void> => {
  try {
    // Delete session ZIP file
    try {
      await Filesystem.deleteFile({
        path: AUTOSAVE_SESSION_PATH,
        directory: Directory.Documents,
      });
    } catch (error) {
      // File might not exist, ignore
    }

    // Delete node icon mappings file
    try {
      await Filesystem.deleteFile({
        path: "HSC_SESSIONS/node_icon_mappings.json",
        directory: Directory.Documents,
      });
    } catch (error) {
      // File might not exist, ignore
    }
  } catch (error) {
    console.error("Error clearing autosave:", error);
  }
};

// Load layers from a file on app startup
export const loadLayersFromFile = async (
  filePath?: string
): Promise<LayerProps[]> => {
  try {
    const storageDir = Directory.Documents;

    // If no file path provided, try to find the most recent export or default file
    if (!filePath) {
      // Try to find a default layers.json file first
      const defaultPath = "layers.json";
      const result = await Filesystem.readFile({
        path: defaultPath,
        directory: storageDir,
        encoding: Encoding.UTF8,
      });
      const content = result.data;
      if (content && typeof content === "string" && content.trim() !== "") {
        try {
          const importData = JSON.parse(content);
          if (importData.version && Array.isArray(importData.layers)) {
            return await deserializeLayers(importData.layers, undefined);
          }
        } catch (parseError) {
          // Invalid JSON, continue to next option
        }
      }

      // Try to find the most recent export in HSC_Layers folder
      const hscLayersPath = "HSC_Layers";
      try {
        const files = await Filesystem.readdir({
          path: hscLayersPath,
          directory: storageDir,
        });

        // Filter for JSON files (not ZIP files)
        const jsonFiles = (files.files || [])
          .filter((file: any) => !file.type && file.name?.endsWith(".json"))
          .sort((a: any, b: any) => {
            // Sort by modification time if available, otherwise by name (newest first)
            const aTime = a.mtime || 0;
            const bTime = b.mtime || 0;
            return bTime - aTime;
          });

        if (jsonFiles.length > 0) {
          const mostRecentFile = jsonFiles[0];
          const fullPath = `${hscLayersPath}/${mostRecentFile.name}`;
          const result = await Filesystem.readFile({
            path: fullPath,
            directory: storageDir,
            encoding: Encoding.UTF8,
          });
          const content = result.data;
          if (content && typeof content === "string" && content.trim() !== "") {
            try {
              const importData = JSON.parse(content);
              if (importData.version && Array.isArray(importData.layers)) {
                return await deserializeLayers(importData.layers, undefined);
              }
            } catch (parseError) {
              // Invalid JSON, continue
            }
          }
        }
      } catch (error) {
        // HSC_Layers folder doesn't exist or is empty
        console.log("No export files found in HSC_Layers folder");
      }

      // Try to find any JSON file in the storage directory
      const files = await listFilesInDirectory(storageDir);
      const jsonFiles = (files || [])
        .filter((file: any) => {
          const name = file.name || file;
          return (
            typeof name === "string" &&
            name.endsWith(".json") &&
            (name.includes("layers") || name.includes("export"))
          );
        })
        .sort((a: any, b: any) => {
          const aTime = a.mtime || 0;
          const bTime = b.mtime || 0;
          return bTime - aTime;
        });

      if (jsonFiles.length > 0) {
        const mostRecentFile = jsonFiles[0];
        const fileName =
          typeof mostRecentFile === "string"
            ? mostRecentFile
            : mostRecentFile.name || "";
        if (fileName) {
          const result = await Filesystem.readFile({
            path: fileName,
            directory: storageDir,
            encoding: Encoding.UTF8,
          });
          const content = result.data;
          if (content && typeof content === "string" && content.trim() !== "") {
            try {
              const importData = JSON.parse(content);
              if (importData.version && Array.isArray(importData.layers)) {
                return await deserializeLayers(importData.layers, undefined);
              }
            } catch (parseError) {
              // Invalid JSON
            }
          }
        }
      }

      return [];
    }

    // Load from specified file path
    const result = await Filesystem.readFile({
      path: filePath,
      directory: storageDir,
      encoding: Encoding.UTF8,
    });
    const content = result.data;
    if (!content || typeof content !== "string" || content.trim() === "") {
      return [];
    }

    try {
      const importData = JSON.parse(content);
      if (importData.version && Array.isArray(importData.layers)) {
        return await deserializeLayers(importData.layers, undefined);
      }
    } catch (parseError) {
      // Invalid JSON
    }

    return [];
  } catch (error) {
    console.error("Error loading layers from file:", error);
    return [];
  }
};

// Load node icon mappings from file
export const loadNodeIconMappingsFromFile = async (
  filePath?: string
): Promise<Record<string, string>> => {
  try {
    const storageDir = Directory.Documents;

    // Try to find node_icon_mappings.json in HSC_Layers folder
    const defaultPath = filePath || "HSC_Layers/node_icon_mappings.json";

    const result = await Filesystem.readFile({
      path: defaultPath,
      directory: storageDir,
      encoding: Encoding.UTF8,
    });
    const content = result.data;
    if (!content || typeof content !== "string" || content.trim() === "") {
      // File doesn't exist, return empty object
      return {};
    }

    try {
      const mappings = JSON.parse(content);
      return mappings;
    } catch (parseError) {
      // Invalid JSON, return empty object
      return {};
    }
  } catch (error) {
    console.error("Error loading node icon mappings from file:", error);
    return {};
  }
};
