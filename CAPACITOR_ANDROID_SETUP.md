# Capacitor Android Setup for File Operations

## Current Implementation

The app now uses alternative methods that don't require the Filesystem plugin to work on Android:

1. **Share API**: Uses the native Android share dialog
2. **Direct Download**: Falls back to blob URL downloads
3. **Clipboard**: Final fallback copies data to clipboard

## If you want to enable Filesystem plugin (Optional)

### 1. Add Permissions to Android Manifest

Add these permissions to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />
```

### 2. Update Capacitor Configuration

Add to `capacitor.config.ts`:

```typescript
{
  plugins: {
    Filesystem: {
      androidRequestAllFilesAccessPermission: true;
    }
  }
}
```

### 3. Sync Android Project

```bash
npx cap sync android
```

### 4. Request Permissions at Runtime

The app would need to request storage permissions when first launched.

## Current Working Methods

### Export Options (in order of preference):

1. **Share Dialog**: Opens Android's native share menu
2. **Direct Download**: Downloads file to device's default download location
3. **Clipboard**: Copies JSON data to clipboard as fallback

### Upload Options:

1. **File Picker**: Uses HTML file input (works on all platforms)
2. **Drag & Drop**: Works on web browsers

## Supported File Formats:

- JSON (layer exports/imports)
- GeoJSON (geographic data)
- CSV (coordinate data)
- SHP/ZIP (shapefiles)

The current implementation provides excellent cross-platform compatibility without requiring special Android permissions.
