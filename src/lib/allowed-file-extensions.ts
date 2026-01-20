/**
 * List of file extensions that are allowed for upload
 * Only GIS-related files are allowed
 */
export const ALLOWED_FILE_EXTENSIONS = new Set([
  // Raster/DEM formats
  "tif",
  "tiff",
  "hgt",
  "dett",
  // Vector formats
  "geojson",
  "json", // GeoJSON format
  "csv",
  "gpx",
  "kml",
  "kmz",
  "wkt",
  // Shapefile components (will be grouped into ZIP)
  "shp",
  "shx",
  "dbf",
  "prj",
  // Archive format (for containing the above formats)
  "zip",
]);

/**
 * Check if a file extension is allowed
 * @param fileName - The file name to check
 * @returns true if the file extension is allowed, false otherwise
 */
export function isFileExtensionAllowed(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  const lastDot = lowerName.lastIndexOf(".");

  if (lastDot === -1 || lastDot === lowerName.length - 1) {
    // No extension or extension is empty
    return false;
  }

  const extension = lowerName.substring(lastDot + 1);
  return ALLOWED_FILE_EXTENSIONS.has(extension);
}

/**
 * Get a user-friendly message for blocked file types
 */
export function getBlockedFileMessage(fileName: string): string {
  return `File type not supported: ${fileName}. Only GIS-related files are allowed.`;
}
