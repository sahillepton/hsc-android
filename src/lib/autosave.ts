import { Preferences } from "@capacitor/preferences";
import type { LayerProps } from "@/lib/definitions";
import {
  readFileFromFilesystem,
  listFilesInDirectory,
  getStorageDirectory,
} from "./capacitor-utils";
import { Filesystem, Encoding } from "@capacitor/filesystem";

const AUTOSAVE_KEY = "autosave_layers";
const AUTOSAVE_NODE_ICONS_KEY = "autosave_node_icon_mappings";
const AUTOSAVE_FILE_NAME = "layers.json";
const DEM_FOLDER_NAME = "DEM_Layers";

// Serialize layers, converting non-serializable data to serializable formats
// For DEM layers, we'll save the bitmap as a file and store the file path
export const serializeLayers = (layers: LayerProps[]): LayerProps[] => {
  return layers.map((layer) => {
    const serialized: LayerProps = { ...layer };

    // Handle DEM layers - store file path reference instead of data
    if (layer.type === "dem") {
      // Store file path reference (will be set during saveLayers)
      // If bitmapFilePath already exists, keep it; otherwise it will be set during save
      if (!(serialized as any).bitmapFilePath) {
        // Generate a filename based on layer ID
        (serialized as any).bitmapFilePath = `${layer.id}.png`;
      }
      delete (serialized as any).bitmap;
      delete (serialized as any).texture;

      // Convert Float32Array to regular array for serialization
      if (serialized.elevationData) {
        const elevationData = serialized.elevationData;
        (serialized as any).elevationData = {
          data: Array.from(elevationData.data), // Convert Float32Array to regular array
          width: elevationData.width,
          height: elevationData.height,
          min: elevationData.min,
          max: elevationData.max,
        };
      }
    }

    return serialized;
  });
};

// Save layers to file (same approach as export)
// For DEM layers, saves bitmap files to DEM_Layers folder
export const saveLayers = async (
  layers: LayerProps[],
  nodeIconMappings?: Record<string, string>
): Promise<void> => {
  try {
    const storageDir = await getStorageDirectory();

    // First, save DEM bitmap files to DEM_Layers folder
    for (const layer of layers) {
      if (layer.type === "dem" && layer.bitmap) {
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

            // Save to DEM_Layers folder
            const fileName = `${layer.id}.png`;
            await Filesystem.writeFile({
              path: `${DEM_FOLDER_NAME}/${fileName}`,
              data: base64Data,
              directory: storageDir,
              encoding: Encoding.UTF8, // Base64 is stored as UTF8 string
              recursive: true,
            });

            console.log(
              `Saved DEM bitmap for layer ${layer.id} to ${DEM_FOLDER_NAME}/${fileName}`
            );
          }
        } catch (error) {
          console.error(
            `Error saving DEM bitmap for layer ${layer.id}:`,
            error
          );
          // Continue with other layers even if one fails
        }
      }
    }

    // Now serialize layers (DEM layers will have bitmapFilePath set)
    const serialized = serializeLayers(layers);

    // Set bitmapFilePath for DEM layers
    for (let i = 0; i < serialized.length; i++) {
      if (serialized[i].type === "dem") {
        (serialized[i] as any).bitmapFilePath = `${layers[i].id}.png`;
      }
    }

    // Create export format with version and layers array (same as export)
    const exportData = {
      version: "1.0",
      layers: serialized,
      nodeIconMappings: nodeIconMappings || {},
    };

    const data = JSON.stringify(exportData, null, 2);

    // Check data size
    const dataSizeMB = new Blob([data]).size / (1024 * 1024);
    if (dataSizeMB > 10) {
      console.warn(
        `Autosave data is large (${dataSizeMB.toFixed(
          2
        )}MB). Saving may take a moment.`
      );
    }

    // Write to file (same location as exports would use)
    await Filesystem.writeFile({
      path: AUTOSAVE_FILE_NAME,
      data: data,
      directory: storageDir,
      encoding: Encoding.UTF8,
      recursive: true,
    });

    console.log(
      `Autosaved ${
        layers.length
      } layer(s) to ${AUTOSAVE_FILE_NAME} (${dataSizeMB.toFixed(2)}MB)`
    );
  } catch (error) {
    console.error("Error autosaving layers to file:", error);
    // Log layer types for debugging
    const layerTypes = layers.map((l) => l.type).join(", ");
    console.error(`Failed to autosave layers. Types: ${layerTypes}`);
    // Don't throw - autosave failures shouldn't break the app
  }
};

// Deserialize layers, reconstructing non-serializable data
export const deserializeLayers = async (
  layers: LayerProps[]
): Promise<LayerProps[]> => {
  const deserializedLayers: LayerProps[] = [];
  const storageDir = await getStorageDirectory();

  for (const layer of layers) {
    const deserialized: LayerProps = { ...layer };

    // Handle DEM layers - reconstruct non-serializable data
    if (layer.type === "dem") {
      // Try to load bitmap from file first (new approach)
      const bitmapFilePath = (layer as any).bitmapFilePath;
      if (bitmapFilePath) {
        try {
          const filePath = `${DEM_FOLDER_NAME}/${bitmapFilePath}`;
          const base64Data = await readFileFromFilesystem(filePath, storageDir);

          if (typeof base64Data === "string") {
            // Convert base64 to data URL
            const dataUrl = `data:image/png;base64,${base64Data}`;
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => {
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
              img.onerror = () =>
                reject(new Error("Failed to load image from file"));
              img.src = dataUrl;
            });
            console.log(`Loaded DEM bitmap from ${filePath}`);
          }
        } catch (fileError) {
          console.warn(`Failed to load DEM bitmap from file: ${fileError}`);
          // Fall back to data URL if file doesn't exist (backward compatibility)
          if ((layer as any).bitmapDataUrl) {
            try {
              const bitmapDataUrl = (layer as any).bitmapDataUrl;
              const img = new Image();
              await new Promise<void>((resolve, reject) => {
                img.onload = () => {
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
                img.onerror = () =>
                  reject(new Error("Failed to load image from data URL"));
                img.src = bitmapDataUrl;
              });
              console.log(`Loaded DEM bitmap from data URL (fallback)`);
            } catch (error) {
              console.warn(
                "Failed to reconstruct DEM bitmap from data URL:",
                error
              );
            }
          }
        }
      } else if ((layer as any).bitmapDataUrl) {
        // Fallback: reconstruct bitmap from data URL (old format)
        try {
          const bitmapDataUrl = (layer as any).bitmapDataUrl;
          const img = new Image();
          await new Promise<void>((resolve, reject) => {
            img.onload = () => {
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
            img.onerror = () =>
              reject(new Error("Failed to load image from data URL"));
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
        const elevationData = (layer as any).elevationData;
        deserialized.elevationData = {
          data: new Float32Array(elevationData.data), // Convert array back to Float32Array
          width: elevationData.width,
          height: elevationData.height,
          min: elevationData.min,
          max: elevationData.max,
        };
      }
    }

    deserializedLayers.push(deserialized);
  }

  return deserializedLayers;
};

// Load layers from file (autosave file)
export const loadLayers = async (): Promise<LayerProps[]> => {
  try {
    const storageDir = await getStorageDirectory();

    try {
      const content = await readFileFromFilesystem(
        AUTOSAVE_FILE_NAME,
        storageDir
      );
      if (typeof content !== "string") {
        return [];
      }

      const importData = JSON.parse(content);

      if (importData.version && Array.isArray(importData.layers)) {
        const deserializedLayers = await deserializeLayers(importData.layers);
        console.log(
          `Loaded ${deserializedLayers.length} layer(s) from ${AUTOSAVE_FILE_NAME}`
        );
        return deserializedLayers;
      }

      return [];
    } catch (fileError) {
      // File doesn't exist or can't be read, try Preferences as fallback
      console.log(
        `${AUTOSAVE_FILE_NAME} not found, trying Preferences fallback...`
      );
      try {
        const { value } = await Preferences.get({ key: AUTOSAVE_KEY });
        if (value) {
          const layers = JSON.parse(value) as LayerProps[];
          const deserializedLayers = await deserializeLayers(layers);
          console.log(
            `Loaded ${deserializedLayers.length} layer(s) from Preferences fallback`
          );
          return deserializedLayers;
        }
      } catch (prefError) {
        console.log("No autosave found in Preferences either");
      }
      return [];
    }
  } catch (error) {
    console.error("Error loading autosaved layers:", error);
    return [];
  }
};

// Save node icon mappings (now included in layers.json file)
export const saveNodeIconMappings = async (
  _mappings: Record<string, string>
): Promise<void> => {
  // Node icon mappings are now saved together with layers in layers.json
  // This function is kept for backward compatibility but doesn't need to do anything
  // since saveLayers now includes nodeIconMappings
};

// Load node icon mappings (now from layers.json file)
export const loadNodeIconMappings = async (): Promise<
  Record<string, string>
> => {
  try {
    const storageDir = await getStorageDirectory();

    try {
      const content = await readFileFromFilesystem(
        AUTOSAVE_FILE_NAME,
        storageDir
      );
      if (typeof content !== "string") {
        return {};
      }

      const importData = JSON.parse(content);

      if (
        importData.nodeIconMappings &&
        typeof importData.nodeIconMappings === "object"
      ) {
        console.log(`Loaded node icon mappings from ${AUTOSAVE_FILE_NAME}`);
        return importData.nodeIconMappings;
      }

      return {};
    } catch (fileError) {
      // File doesn't exist, try Preferences as fallback
      try {
        const { value } = await Preferences.get({
          key: AUTOSAVE_NODE_ICONS_KEY,
        });
        if (value) {
          return JSON.parse(value);
        }
      } catch (prefError) {
        // No fallback data
      }
      return {};
    }
  } catch (error) {
    console.error("Error loading node icon mappings:", error);
    return {};
  }
};

// Clear autosave data
export const clearAutosave = async (): Promise<void> => {
  try {
    const storageDir = await getStorageDirectory();

    // Delete the autosave file
    try {
      await Filesystem.deleteFile({
        path: AUTOSAVE_FILE_NAME,
        directory: storageDir,
      });
      console.log(`Autosave file ${AUTOSAVE_FILE_NAME} deleted`);
    } catch (fileError) {
      // File doesn't exist, that's okay
      console.log(`Autosave file ${AUTOSAVE_FILE_NAME} not found`);
    }

    // Also clear Preferences for backward compatibility
    await Preferences.remove({ key: AUTOSAVE_KEY });
    await Preferences.remove({ key: AUTOSAVE_NODE_ICONS_KEY });
    console.log("Autosave data cleared");
  } catch (error) {
    console.error("Error clearing autosave:", error);
  }
};

// Load layers from a file on app startup (for manual exports)
export const loadLayersFromFile = async (
  filePath?: string
): Promise<LayerProps[]> => {
  try {
    const storageDir = await getStorageDirectory();

    // If no file path provided, try to find the most recent export
    if (!filePath) {
      // Note: layers.json is now used for autosave, so we skip it here
      // and look for manual export files instead

      // Try to find the most recent export in HSC_Layers folder
      try {
        const hscLayersPath = "HSC_Layers";
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
          const content = await readFileFromFilesystem(fullPath, storageDir);
          if (typeof content !== "string") {
            throw new Error("File content is not a string");
          }
          const importData = JSON.parse(content);

          if (importData.version && Array.isArray(importData.layers)) {
            console.log(
              `Loaded ${importData.layers.length} layers from ${fullPath}`
            );
            return await deserializeLayers(importData.layers);
          }
        }
      } catch (error) {
        // HSC_Layers folder doesn't exist or is empty
        console.log("No export files found in HSC_Layers folder");
      }

      // Try to find any JSON file in the storage directory
      try {
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
          if (!fileName) {
            throw new Error("Invalid file name");
          }
          const content = await readFileFromFilesystem(fileName, storageDir);
          if (typeof content !== "string") {
            throw new Error("File content is not a string");
          }
          const importData = JSON.parse(content);

          if (importData.version && Array.isArray(importData.layers)) {
            console.log(
              `Loaded ${importData.layers.length} layers from ${fileName}`
            );
            return await deserializeLayers(importData.layers);
          }
        }
      } catch (error) {
        console.log("No layer files found in storage directory");
      }

      return [];
    }

    // Load from specified file path
    const content = await readFileFromFilesystem(filePath, storageDir);
    if (typeof content !== "string") {
      throw new Error("File content is not a string");
    }
    const importData = JSON.parse(content);

    if (importData.version && Array.isArray(importData.layers)) {
      console.log(`Loaded ${importData.layers.length} layers from ${filePath}`);
      return await deserializeLayers(importData.layers);
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
    const storageDir = await getStorageDirectory();

    // Try to find node_icon_mappings.json
    const defaultPath = filePath || "node_icon_mappings.json";

    try {
      const content = await readFileFromFilesystem(defaultPath, storageDir);
      if (typeof content !== "string") {
        throw new Error("File content is not a string");
      }
      const mappings = JSON.parse(content);
      console.log(`Loaded node icon mappings from ${defaultPath}`);
      return mappings;
    } catch (error) {
      // File doesn't exist, return empty object
      return {};
    }
  } catch (error) {
    console.error("Error loading node icon mappings from file:", error);
    return {};
  }
};
