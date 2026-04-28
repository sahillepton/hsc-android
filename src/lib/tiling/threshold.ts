// Decide whether an uploaded raster should take the tiling path or stay
// on the existing in-renderer BitmapLayer flow.
//
// Threshold per user spec: > 2 MB → tiling. Anything above this routes
// through the gdal-async worker; only tiny rasters (favicons, thumbnails)
// stay on the parseDemFile path.

const SIZE_BYTES_THRESHOLD = 2 * 1024 * 1024;

export function shouldTile(sizeBytes: number): boolean {
  return sizeBytes > SIZE_BYTES_THRESHOLD;
}

export const TILING_THRESHOLD_BYTES = SIZE_BYTES_THRESHOLD;
