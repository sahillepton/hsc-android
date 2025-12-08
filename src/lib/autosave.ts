import type { LayerProps } from "@/lib/definitions";
import {
  readFileFromFilesystem,
  getStorageDirectory,
  fileToBase64,
} from "./capacitor-utils";
import { Filesystem, Encoding } from "@capacitor/filesystem";
import { isSketchLayer } from "./sketch-layers";

const SKETCH_LAYERS_FOLDER = "sketch_layers";
const UPLOADED_LAYERS_FOLDER = "uploaded_layers";

// Serialize a single layer, removing non-serializable data
const serializeLayer = (layer: LayerProps): any => {
  const serialized: any = { ...layer };

  // Remove non-serializable properties
  delete serialized.bitmap;
  delete serialized.texture;

  // Convert Float32Array to regular array for DEM layers
  if (layer.type === "dem" && layer.elevationData) {
    serialized.elevationData = {
      data: Array.from(layer.elevationData.data),
      width: layer.elevationData.width,
      height: layer.elevationData.height,
      min: layer.elevationData.min,
      max: layer.elevationData.max,
    };
  }

  return serialized;
};

// Save a single sketch layer to its own JSON file
export const saveSketchLayer = async (layer: LayerProps): Promise<void> => {
  try {
    if (!isSketchLayer(layer)) {
      console.warn(
        `Layer ${layer.id} is not a sketch layer, skipping sketch save`
      );
      return;
    }

    const storageDir = await getStorageDirectory();
    const serialized = serializeLayer(layer);
    const data = JSON.stringify(serialized, null, 2);
    const fileName = `${layer.id}.json`;

    await Filesystem.writeFile({
      path: `${SKETCH_LAYERS_FOLDER}/${fileName}`,
      data: data,
      directory: storageDir,
      encoding: Encoding.UTF8,
      recursive: true,
    });

    console.log(
      `Saved sketch layer ${layer.id} to ${SKETCH_LAYERS_FOLDER}/${fileName}`
    );
  } catch (error) {
    console.error(`Error saving sketch layer ${layer.id}:`, error);
  }
};

// Delete a sketch layer file
export const deleteSketchLayer = async (layerId: string): Promise<void> => {
  try {
    const storageDir = await getStorageDirectory();
    const fileName = `${layerId}.json`;

    try {
      await Filesystem.deleteFile({
        path: `${SKETCH_LAYERS_FOLDER}/${fileName}`,
        directory: storageDir,
      });
      console.log(
        `Deleted sketch layer file ${SKETCH_LAYERS_FOLDER}/${fileName}`
      );
    } catch (fileError: any) {
      // File doesn't exist, that's okay
      if (fileError.message?.includes("does not exist")) {
        console.log(
          `Sketch layer file ${SKETCH_LAYERS_FOLDER}/${fileName} not found`
        );
      } else {
        throw fileError;
      }
    }
  } catch (error) {
    console.error(`Error deleting sketch layer ${layerId}:`, error);
  }
};

// Save uploaded layer file content to folder
export const saveUploadedLayerFile = async (
  layerId: string,
  fileName: string,
  fileContent: string | ArrayBuffer | File
): Promise<void> => {
  try {
    const storageDir = await getStorageDirectory();
    const layerFolder = `${UPLOADED_LAYERS_FOLDER}/${layerId}`;

    let data: string;
    let encoding: Encoding = Encoding.UTF8;

    if (fileContent instanceof File) {
      // Convert File to base64
      data = await fileToBase64(fileContent);
      encoding = Encoding.UTF8; // Base64 is stored as UTF8 string
    } else if (fileContent instanceof ArrayBuffer) {
      // Convert ArrayBuffer to base64
      const bytes = new Uint8Array(fileContent);
      const binary = Array.from(bytes)
        .map((byte) => String.fromCharCode(byte))
        .join("");
      data = btoa(binary);
      encoding = Encoding.UTF8;
    } else {
      // Already a string
      data = fileContent;
      encoding = Encoding.UTF8;
    }

    await Filesystem.writeFile({
      path: `${layerFolder}/${fileName}`,
      data: data,
      directory: storageDir,
      encoding: encoding,
      recursive: true,
    });

    console.log(
      `Saved uploaded file ${fileName} for layer ${layerId} to ${layerFolder}`
    );
  } catch (error) {
    console.error(`Error saving uploaded layer file for ${layerId}:`, error);
  }
};

// Save uploaded layer metadata (layer info without file data)
export const saveUploadedLayerMetadata = async (
  layer: LayerProps
): Promise<void> => {
  try {
    if (isSketchLayer(layer)) {
      console.warn(
        `Layer ${layer.id} is a sketch layer, skipping uploaded layer save`
      );
      return;
    }

    const storageDir = await getStorageDirectory();
    const layerFolder = `${UPLOADED_LAYERS_FOLDER}/${layer.id}`;
    const serialized = serializeLayer(layer);
    const data = JSON.stringify(serialized, null, 2);

    await Filesystem.writeFile({
      path: `${layerFolder}/metadata.json`,
      data: data,
      directory: storageDir,
      encoding: Encoding.UTF8,
      recursive: true,
    });

    console.log(`Saved uploaded layer metadata for ${layer.id}`);
  } catch (error) {
    console.error(
      `Error saving uploaded layer metadata for ${layer.id}:`,
      error
    );
  }
};

// Delete uploaded layer folder and all its contents
export const deleteUploadedLayer = async (layerId: string): Promise<void> => {
  try {
    const storageDir = await getStorageDirectory();
    const layerFolder = `${UPLOADED_LAYERS_FOLDER}/${layerId}`;

    try {
      // Try to delete the entire folder
      await Filesystem.rmdir({
        path: layerFolder,
        directory: storageDir,
        recursive: true,
      });
      console.log(`Deleted uploaded layer folder ${layerFolder}`);
    } catch (fileError: any) {
      // Folder doesn't exist, that's okay
      if (fileError.message?.includes("does not exist")) {
        console.log(`Uploaded layer folder ${layerFolder} not found`);
      } else {
        throw fileError;
      }
    }
  } catch (error) {
    console.error(`Error deleting uploaded layer ${layerId}:`, error);
  }
};

// Load all sketch layers
export const loadSketchLayers = async (): Promise<LayerProps[]> => {
  try {
    const storageDir = await getStorageDirectory();
    const layers: LayerProps[] = [];

    try {
      const files = await Filesystem.readdir({
        path: SKETCH_LAYERS_FOLDER,
        directory: storageDir,
      });

      for (const file of files.files || []) {
        if (file.name && file.name.endsWith(".json")) {
          try {
            const content = await readFileFromFilesystem(
              `${SKETCH_LAYERS_FOLDER}/${file.name}`,
              storageDir
            );
            if (typeof content === "string") {
              const layer = JSON.parse(content) as LayerProps;
              layers.push(layer);
            }
          } catch (error) {
            console.error(
              `Error loading sketch layer from ${file.name}:`,
              error
            );
          }
        }
      }
    } catch (dirError: any) {
      // Folder doesn't exist yet, that's okay
      if (dirError.message?.includes("does not exist")) {
        console.log(`Sketch layers folder ${SKETCH_LAYERS_FOLDER} not found`);
      } else {
        throw dirError;
      }
    }

    console.log(`Loaded ${layers.length} sketch layer(s)`);
    return layers;
  } catch (error) {
    console.error("Error loading sketch layers:", error);
    return [];
  }
};

// Load all uploaded layers
export const loadUploadedLayers = async (): Promise<LayerProps[]> => {
  try {
    const storageDir = await getStorageDirectory();
    const layers: LayerProps[] = [];

    try {
      const folders = await Filesystem.readdir({
        path: UPLOADED_LAYERS_FOLDER,
        directory: storageDir,
      });

      for (const folder of folders.files || []) {
        if (folder.type === "directory" || !folder.type) {
          // Try to load metadata.json from this folder
          try {
            const content = await readFileFromFilesystem(
              `${UPLOADED_LAYERS_FOLDER}/${folder.name}/metadata.json`,
              storageDir
            );
            if (typeof content === "string") {
              const layer = JSON.parse(content) as LayerProps;

              // For DEM layers, try to load bitmap from saved files
              if (layer.type === "dem") {
                try {
                  // Look for bitmap file in the folder
                  const layerFiles = await Filesystem.readdir({
                    path: `${UPLOADED_LAYERS_FOLDER}/${folder.name}`,
                    directory: storageDir,
                  });

                  const bitmapFile = (layerFiles.files || []).find(
                    (f: any) =>
                      f.name &&
                      (f.name.endsWith(".png") ||
                        f.name.endsWith(".jpg") ||
                        f.name.endsWith(".jpeg"))
                  );

                  if (bitmapFile) {
                    const base64Data = await readFileFromFilesystem(
                      `${UPLOADED_LAYERS_FOLDER}/${folder.name}/${bitmapFile.name}`,
                      storageDir
                    );

                    if (typeof base64Data === "string") {
                      const dataUrl = `data:image/png;base64,${base64Data}`;
                      const img = new Image();
                      await new Promise<void>((resolve, reject) => {
                        img.onload = () => {
                          const canvas = document.createElement("canvas");
                          canvas.width = img.width;
                          canvas.height = img.height;
                          const ctx = canvas.getContext("2d");
                          if (ctx) {
                            ctx.drawImage(img, 0, 0);
                            layer.bitmap = canvas;
                            layer.texture = canvas;
                            resolve();
                          } else {
                            reject(new Error("Failed to get canvas context"));
                          }
                        };
                        img.onerror = () =>
                          reject(new Error("Failed to load image"));
                        img.src = dataUrl;
                      });
                    }
                  }
                } catch (bitmapError) {
                  console.warn(
                    `Failed to load bitmap for DEM layer ${layer.id}:`,
                    bitmapError
                  );
                }

                // Reconstruct Float32Array from elevation data
                if (
                  (layer as any).elevationData &&
                  Array.isArray((layer as any).elevationData.data)
                ) {
                  const elevationData = (layer as any).elevationData;
                  layer.elevationData = {
                    data: new Float32Array(elevationData.data),
                    width: elevationData.width,
                    height: elevationData.height,
                    min: elevationData.min,
                    max: elevationData.max,
                  };
                }
              }

              layers.push(layer);
            }
          } catch (error) {
            console.error(
              `Error loading uploaded layer from ${folder.name}:`,
              error
            );
          }
        }
      }
    } catch (dirError: any) {
      // Folder doesn't exist yet, that's okay
      if (dirError.message?.includes("does not exist")) {
        console.log(
          `Uploaded layers folder ${UPLOADED_LAYERS_FOLDER} not found`
        );
      } else {
        throw dirError;
      }
    }

    console.log(`Loaded ${layers.length} uploaded layer(s)`);
    return layers;
  } catch (error) {
    console.error("Error loading uploaded layers:", error);
    return [];
  }
};

// Load all layers (both sketch and uploaded)
export const loadLayers = async (): Promise<LayerProps[]> => {
  const sketchLayers = await loadSketchLayers();
  const uploadedLayers = await loadUploadedLayers();
  return [...sketchLayers, ...uploadedLayers];
};

// Save all layers (called from store on updates)
export const saveLayers = async (
  layers: LayerProps[],
  nodeIconMappings?: Record<string, string>
): Promise<void> => {
  try {
    // Separate sketch and uploaded layers
    const sketchLayers = layers.filter(isSketchLayer);
    const uploadedLayers = layers.filter((l) => !isSketchLayer(l));

    // Save each sketch layer to its own file
    for (const layer of sketchLayers) {
      await saveSketchLayer(layer);
    }

    // Save metadata for each uploaded layer
    for (const layer of uploadedLayers) {
      await saveUploadedLayerMetadata(layer);
    }

    // Save node icon mappings separately (for backward compatibility)
    if (nodeIconMappings && Object.keys(nodeIconMappings).length > 0) {
      const storageDir = await getStorageDirectory();
      const mappingsData = JSON.stringify(nodeIconMappings, null, 2);
      await Filesystem.writeFile({
        path: "node_icon_mappings.json",
        data: mappingsData,
        directory: storageDir,
        encoding: Encoding.UTF8,
        recursive: true,
      });
    }

    console.log(
      `Autosaved ${sketchLayers.length} sketch layer(s) and ${uploadedLayers.length} uploaded layer(s)`
    );
  } catch (error) {
    console.error("Error autosaving layers:", error);
  }
};

// Handle layer deletion
export const handleLayerDeletion = async (layer: LayerProps): Promise<void> => {
  if (isSketchLayer(layer)) {
    await deleteSketchLayer(layer.id);
  } else {
    await deleteUploadedLayer(layer.id);
  }
};

// Load node icon mappings
export const loadNodeIconMappings = async (): Promise<
  Record<string, string>
> => {
  try {
    const storageDir = await getStorageDirectory();
    try {
      const content = await readFileFromFilesystem(
        "node_icon_mappings.json",
        storageDir
      );
      if (typeof content === "string") {
        return JSON.parse(content);
      }
    } catch (fileError) {
      // File doesn't exist, return empty object
    }
    return {};
  } catch (error) {
    console.error("Error loading node icon mappings:", error);
    return {};
  }
};

// Clear all autosave data
export const clearAutosave = async (): Promise<void> => {
  try {
    const storageDir = await getStorageDirectory();

    // Delete sketch layers folder
    try {
      await Filesystem.rmdir({
        path: SKETCH_LAYERS_FOLDER,
        directory: storageDir,
        recursive: true,
      });
    } catch (error) {
      // Folder doesn't exist, that's okay
    }

    // Delete uploaded layers folder
    try {
      await Filesystem.rmdir({
        path: UPLOADED_LAYERS_FOLDER,
        directory: storageDir,
        recursive: true,
      });
    } catch (error) {
      // Folder doesn't exist, that's okay
    }

    // Delete node icon mappings
    try {
      await Filesystem.deleteFile({
        path: "node_icon_mappings.json",
        directory: storageDir,
      });
    } catch (error) {
      // File doesn't exist, that's okay
    }

    console.log("Autosave data cleared");
  } catch (error) {
    console.error("Error clearing autosave:", error);
  }
};

// Legacy functions for backward compatibility
export const serializeLayers = (layers: LayerProps[]): LayerProps[] => {
  return layers.map(serializeLayer);
};

export const deserializeLayers = async (
  layers: LayerProps[]
): Promise<LayerProps[]> => {
  // This is now handled in loadUploadedLayers for DEM layers
  // For other layer types, just return as-is
  return layers;
};

export const saveNodeIconMappings = async (
  _mappings: Record<string, string>
): Promise<void> => {
  // Node icon mappings are saved in saveLayers
  // This function is kept for backward compatibility
};

export const loadLayersFromFile = async (
  _filePath?: string
): Promise<LayerProps[]> => {
  // Legacy function - not used in new implementation
  return [];
};

export const loadNodeIconMappingsFromFile = async (
  _filePath?: string
): Promise<Record<string, string>> => {
  // Legacy function - not used in new implementation
  return {};
};
