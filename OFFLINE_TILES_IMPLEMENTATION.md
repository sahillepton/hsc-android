# Offline Vector Tiles Implementation

This document describes the production-ready implementation for serving offline PBF vector tiles in the Android app.

## Architecture Overview

The solution uses a **local HTTP server** running on Android to serve tiles, avoiding loading tiles into JavaScript memory. This approach:

- ✅ Minimizes frontend processing
- ✅ Leverages native file I/O performance
- ✅ Uses LRU caching for frequently accessed tiles
- ✅ Supports SAF (Storage Access Framework) for folder access
- ✅ Persists folder access across app restarts

## Components

### 1. Android Native Plugin (`OfflineTileServerPlugin.kt`)

**Location:** `android/app/src/main/java/com/example/app/OfflineTileServerPlugin.kt`

**Features:**

- SAF folder picker with persistent URI permissions
- Local HTTP server (NanoHTTPD) on `127.0.0.1:8080`
- LRU cache (100 tiles, ~50MB)
- Direct file reading from SAF URIs
- TMS format support (Y-coordinate flipping)

**Methods:**

- `selectTileFolder()` - Opens Android folder picker
- `startTileServer({ uri, useTms? })` - Starts server with folder URI
- `stopTileServer()` - Stops the server
- `getSavedFolderUri()` - Retrieves saved folder from previous session

### 2. TypeScript Interface

**Location:** `src/plugins/offline-tile-server/index.ts`

Provides type-safe access to the native plugin from JavaScript.

### 3. React Components

**Location:** `src/components/map/tile-folder-dialog.tsx`

Dialog component for folder selection with server management.

### 4. Map Integration

**Location:** `src/components/map/index.tsx`

- Initializes tile server on app startup
- Adds `MVTLayer` from `@deck.gl/geo-layers` when server is running
- Configures layer to load from `http://127.0.0.1:8080/tiles/{z}/{x}/{y}.pbf`

## Usage

### 1. Select Tile Folder

Click the folder icon button in the map controls to open the folder picker. Select the directory containing tiles in `tiles/{z}/{x}/{y}.pbf` format.

### 2. Server Starts Automatically

When a folder is selected:

- Server starts on `http://127.0.0.1:8080`
- Folder URI is saved for future sessions
- Tiles are served with proper headers (`Content-Type: application/x-protobuf`)

### 3. Tiles Render in deck.gl

The `MVTLayer` automatically loads tiles from the server and renders them on the map.

## Tile Format Support

### XYZ Format (Default)

Tiles organized as: `tiles/{z}/{x}/{y}.pbf`

This is the standard format used by most tile servers.

### TMS Format (Optional)

If your tiles use TMS format (Y-coordinate flipped), set `useTms: true` when starting the server:

```typescript
await OfflineTileServer.startTileServer({
  uri: selectedUri,
  useTms: true, // Enable TMS format
});
```

The server will automatically flip the Y coordinate: `y_tms = (2^z - 1) - y_xyz`

## File Structure

Your tile folder should have this structure:

```
/tiles/
  /0/
    /0/
      0.pbf
  /1/
    /0/
      0.pbf
      1.pbf
    /1/
      0.pbf
      1.pbf
  /2/
    ...
```

## Performance Optimizations

1. **LRU Cache**: Frequently accessed tiles are cached in memory (max 100 tiles)
2. **Direct File I/O**: Native Android file reading (no JS overhead)
3. **SAF Persistence**: Folder access survives app restarts
4. **Localhost Binding**: Server only accessible from the app (security)

## Error Handling

- Missing tiles return HTTP 404
- Invalid requests return HTTP 400
- Server errors return HTTP 500
- All errors are logged to Android logcat

## Dependencies

**Android:**

- `org.nanohttpd:nanohttpd:2.3.1` - Lightweight HTTP server

**Frontend:**

- `@deck.gl/geo-layers:^9.2.2` - MVTLayer for vector tiles
- `deck.gl:^9.2.2` - Core deck.gl library

## Security

- Server binds only to `127.0.0.1` (localhost)
- No external network access
- SAF permissions are scoped to selected folder only

## Troubleshooting

### Tiles Not Loading

1. Check Android logcat for server errors
2. Verify folder structure matches `tiles/{z}/{x}/{y}.pbf`
3. Ensure folder URI is still valid (may need to re-select after Android updates)

### Server Won't Start

1. Check if port 8080 is already in use
2. Verify SAF permissions are granted
3. Check logcat for detailed error messages

### Tiles Appear Flipped

If tiles appear vertically flipped, your tiles may be in TMS format. Set `useTms: true` when starting the server.

## Future Enhancements

- Configurable cache size
- Multiple tile sources
- Tile compression
- Background tile preloading
- Tile validation
