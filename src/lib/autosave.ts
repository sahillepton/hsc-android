import { Preferences } from "@capacitor/preferences";
import type { LayerProps } from "@/lib/definitions";
import {
  readFileFromFilesystem,
  listFilesInDirectory,
  getStorageDirectory,
} from "./capacitor-utils";
import { Filesystem } from "@capacitor/filesystem";

const AUTOSAVE_KEY = "autosave_layers";
const AUTOSAVE_NODE_ICONS_KEY = "autosave_node_icon_mappings";

// Serialize layers, excluding non-serializable data (bitmaps, canvases, textures)
export const serializeLayers = (layers: LayerProps[]): LayerProps[] => {
  return layers.map((layer) => {
    const serialized: LayerProps = { ...layer };

    // Remove non-serializable properties for DEM layers
    if (layer.type === "dem") {
      delete (serialized as any).bitmap;
      delete (serialized as any).texture;
      // Keep elevationData if it's serializable
      if (serialized.elevationData) {
        // elevationData contains Float32Array which needs special handling
        // For autosave, we'll exclude it to keep the save lightweight
        // The user can re-upload the DEM if needed
        delete (serialized as any).elevationData;
      }
    }

    return serialized;
  });
};

// Save layers to Capacitor Preferences
export const saveLayers = async (layers: LayerProps[]): Promise<void> => {
  try {
    const serialized = serializeLayers(layers);
    const data = JSON.stringify(serialized);

    await Preferences.set({
      key: AUTOSAVE_KEY,
      value: data,
    });

    console.log(`Autosaved ${layers.length} layer(s)`);
  } catch (error) {
    console.error("Error autosaving layers:", error);
    // Don't throw - autosave failures shouldn't break the app
  }
};

// Load layers from Capacitor Preferences
export const loadLayers = async (): Promise<LayerProps[]> => {
  try {
    const { value } = await Preferences.get({ key: AUTOSAVE_KEY });

    if (!value) {
      return [];
    }

    const layers = JSON.parse(value) as LayerProps[];
    console.log(`Loaded ${layers.length} layer(s) from autosave`);
    return layers;
  } catch (error) {
    console.error("Error loading autosaved layers:", error);
    return [];
  }
};

// Save node icon mappings
export const saveNodeIconMappings = async (
  mappings: Record<string, string>
): Promise<void> => {
  try {
    const data = JSON.stringify(mappings);

    await Preferences.set({
      key: AUTOSAVE_NODE_ICONS_KEY,
      value: data,
    });
  } catch (error) {
    console.error("Error autosaving node icon mappings:", error);
  }
};

// Load node icon mappings
export const loadNodeIconMappings = async (): Promise<
  Record<string, string>
> => {
  try {
    const { value } = await Preferences.get({ key: AUTOSAVE_NODE_ICONS_KEY });

    if (!value) {
      return {};
    }

    return JSON.parse(value) as Record<string, string>;
  } catch (error) {
    console.error("Error loading autosaved node icon mappings:", error);
    return {};
  }
};

// Clear autosave data
export const clearAutosave = async (): Promise<void> => {
  try {
    await Preferences.remove({ key: AUTOSAVE_KEY });
    await Preferences.remove({ key: AUTOSAVE_NODE_ICONS_KEY });
    console.log("Autosave data cleared");
  } catch (error) {
    console.error("Error clearing autosave:", error);
  }
};

// Load layers from a file on app startup
export const loadLayersFromFile = async (
  filePath?: string
): Promise<LayerProps[]> => {
  try {
    const storageDir = await getStorageDirectory();

    // If no file path provided, try to find the most recent export or default file
    if (!filePath) {
      // Try to find a default layers.json file first
      try {
        const defaultPath = "layers.json";
        const content = await readFileFromFilesystem(defaultPath, storageDir);
        if (typeof content !== "string") {
          throw new Error("File content is not a string");
        }
        const importData = JSON.parse(content);

        if (importData.version && Array.isArray(importData.layers)) {
          console.log(
            `Loaded ${importData.layers.length} layers from ${defaultPath}`
          );
          return importData.layers;
        }
      } catch (error) {
        // Default file doesn't exist, try to find most recent export
        console.log("Default layers.json not found, searching for exports...");
      }

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
            return importData.layers;
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
            return importData.layers;
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
      return importData.layers;
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
