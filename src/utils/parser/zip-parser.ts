export type ValidFile = {
  file: File;
  type: "tiff" | "vector" | "shapefile";
  name: string;
};

/**
 * Find all valid files in ZIP for sequential processing (handles nested ZIPs)
 */
export async function findAllValidFilesInZip(
  zipFile: File,
  depth: number = 0,
  maxDepth: number = 10
): Promise<ValidFile[]> {
  if (depth > maxDepth) {
    console.warn("Maximum ZIP nesting depth reached, skipping nested ZIP");
    return [];
  }

  try {
    const JSZip = (await import("jszip")).default;
    const { isFileExtensionAllowed } = await import(
      "@/lib/allowed-file-extensions"
    );
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

    // Find all TIFF files (only allowed extensions)
    const tiffFiles = Object.keys(zip.files).filter((name) => {
      const lowerName = name.toLowerCase();
      if (zip.files[name].dir) return false;
      if (!isFileExtensionAllowed(name)) return false; // Skip non-allowed files
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

    // Find all vector files (only allowed extensions)
    const vectorFiles = Object.keys(zip.files).filter((name) => {
      const lowerName = name.toLowerCase();
      if (zip.files[name].dir) return false;
      // Skip ZIP files (already processed above)
      if (lowerName.endsWith(".zip")) return false;
      // Skip non-allowed file extensions
      if (!isFileExtensionAllowed(name)) return false;
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

    // Find shapefile components and group them (only allowed extensions)
    const shapefileComponents = Object.keys(zip.files).filter((name) => {
      const lowerName = name.toLowerCase();
      if (zip.files[name].dir) return false;
      if (!isFileExtensionAllowed(name)) return false; // Skip non-allowed files
      return (
        lowerName.endsWith(".shp") ||
        lowerName.endsWith(".shx") ||
        lowerName.endsWith(".dbf")
      );
    });

    if (shapefileComponents.length > 0) {
      const shapefileGroups = new Map<string, string[]>();
      for (const fileName of shapefileComponents) {
        const baseName = fileName.toLowerCase().replace(/\.(shp|shx|dbf)$/, "");
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
            const JSZip = (await import("jszip")).default;
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
}
