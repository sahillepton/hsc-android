# Offline Tile Structure Requirements

## Expected Folder Structure

When you select a folder using the tile folder picker, the server expects the following structure **directly inside the selected folder**:

```
<SelectedFolder>/
├── 0/              (zoom level 0)
│   ├── 0/          (x coordinate)
│   │   ├── 0.pbf   (y coordinate)
│   │   └── 1.pbf
│   └── 1/
│       └── ...
├── 1/              (zoom level 1)
│   ├── 0/
│   │   ├── 0.pbf
│   │   └── 1.pbf
│   └── 1/
│       └── ...
├── 2/              (zoom level 2)
│   └── ...
└── ...             (more zoom levels)
```

## Important Notes

1. **No "tiles" subfolder**: The server looks for `{z}/{x}/{y}.pbf` **directly** in the selected folder root.
2. **XYZ Format (default)**: Tiles use standard XYZ numbering (Y increases from north to south).
3. **TMS Format (optional)**: If your tiles use TMS format (Y flipped), enable the TMS toggle in the dialog.

## Example

If you select folder `/storage/emulated/0/MyMaps/`, your structure should be:

```
/storage/emulated/0/MyMaps/
├── 0/
│   ├── 0/
│   │   └── 0.pbf
│   └── 1/
│       └── 0.pbf
├── 1/
│   ├── 0/
│   │   ├── 0.pbf
│   │   └── 1.pbf
│   └── 1/
│       ├── 0.pbf
│       └── 1.pbf
└── 2/
    └── ...
```

## Troubleshooting "Failed to fetch" Errors

### 1. Check Server is Running

- Open Android Logcat and filter by "TileServer"
- Look for: `"Request: /tiles/..."` messages
- If no requests appear, the server might not be started

### 2. Verify Folder Structure

- Make sure tiles are in `{z}/{x}/{y}.pbf` format
- **NOT** in `tiles/{z}/{x}/{y}.pbf` format
- The selected folder should contain the `0/`, `1/`, `2/` directories directly

### 3. Check Permissions

- The app needs persistent URI permission to the selected folder
- If you see "Root DocumentFile is null" in logs, permissions are missing

### 4. Test Server Manually

- The server runs on `http://127.0.0.1:8080`
- It serves tiles at: `http://127.0.0.1:8080/tiles/{z}/{x}/{y}.pbf`
- Example: `http://127.0.0.1:8080/tiles/0/0/0.pbf`

### 5. Common Issues

**Issue**: "Failed to fetch" errors

- **Cause**: Server not started or folder structure wrong
- **Fix**: Check Logcat for server errors, verify folder structure

**Issue**: No tiles render

- **Cause**: Tiles might be in wrong location or format
- **Fix**: Verify `{z}/{x}/{y}.pbf` structure matches exactly

**Issue**: Server starts but returns 404

- **Cause**: Tiles not found at expected path
- **Fix**: Check Logcat for "Tile not found" messages with the path

## Debugging Steps

1. **Check Logcat** (filter: "TileServer"):

   ```
   adb logcat | grep TileServer
   ```

   Look for:

   - "Request: /tiles/..." (server receiving requests)
   - "Served tile..." (tile found and served)
   - "Tile not found..." (tile missing)
   - "Root DocumentFile is null" (permission issue)

2. **Verify Folder Selection**:

   - Open the tile folder dialog
   - Select your folder
   - Check that the URI is saved in preferences

3. **Test a Specific Tile**:

   - Try accessing: `http://127.0.0.1:8080/tiles/0/0/0.pbf`
   - This should return the tile file if it exists

4. **Check MVTLayer Configuration**:
   - The layer uses: `${tileServerUrl}/tiles/{z}/{x}/{y}.pbf`
   - Make sure `tileServerUrl` is set to `http://127.0.0.1:8080`
