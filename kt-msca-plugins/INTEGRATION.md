# MCSA Capacitor Plugins — Integration Guide

This directory holds **drop-in Kotlin Capacitor plugins** to be copied into the
client's MCSA Android codebase. The package is `org.deal.mcsa.plugins`.
The standalone Android app at `android/app/src/main/java/com/example/app/`
ships the equivalent **Java** versions; one of the two is selected per build.

```
RASTER_TILING_DROP_VERSION = 1.0.0
```

When a future drop is taken, diff against the previous version and apply the
delta — most updates are file-level replacements (the heavy lifting is
prebuilt `.so` files we ship for you).

---

## What this drop adds

A **`RasterTiling` Capacitor plugin** that renders arbitrary GeoTIFFs (palette
/ Byte RGB / Byte gray / Float DEM, including LZW BigTIFFs > 1 GB) on demand,
served as WebP tiles over the existing `OfflineTileServer` NanoHTTPD on
**port 8080**. Same architecture as the Electron desktop side, same
performance contract.

The renderer-side code in this repo (TS) has already been refactored to call
through a platform abstraction (`@/plugins/raster-tiling`) so once the native
plugin is registered no JS changes are needed.

---

## Files to copy into the client's MCSA Android module

All paths below are relative to the **client's** `app/` directory.

### 1. New files (create)

| Source in our repo | Destination in MCSA app |
|---|---|
| `kt-msca-plugins/RasterTilingPlugin.kt` | `app/src/main/java/org/deal/mcsa/plugins/RasterTilingPlugin.kt` |
| `kt-msca-plugins/jniLibs/arm64-v8a/lib*.so` | `app/src/main/jniLibs/arm64-v8a/` |
| `kt-msca-plugins/jniLibs/armeabi-v7a/lib*.so` | `app/src/main/jniLibs/armeabi-v7a/` |
| `kt-msca-plugins/libs/gdal.jar` | `app/libs/gdal.jar` |
| `kt-msca-plugins/assets/proj/proj.db` | `app/src/main/assets/proj/proj.db` |

The `.so` files are:

| File | Size | Role |
|---|---|---|
| `libgdal.so` | ~15 MB | The GDAL library |
| `libproj.so` | ~5 MB | CRS reprojection |
| `libtiff.so` | ~1 MB | (Big)TIFF reader |
| `libwebp.so` | ~600 KB | WebP image format |
| `libpng16.so`, `libjpeg.so` | <1 MB each | PNG / JPEG image format |
| `libsqlite3.so` | ~1 MB | Backs PROJ's `proj.db` |
| `libgdalalljni.so` | ~3-5 MB | Auto-generated SWIG JNI bridge (gdal+ogr+osr+gdalconst combined) |
| `libc++_shared.so` | ~1 MB | NDK C++ runtime |

**There is no C++ source code or `cpp/` directory** — we ship the prebuilt
binaries from `scripts/build-gdal-android.sh`. The client's Gradle build does
not invoke NDK or CMake.

### 2. Replace existing file

| Source | Destination |
|---|---|
| `kt-msca-plugins/OfflineTileServerPlugin.kt` | `app/src/main/java/org/deal/mcsa/plugins/OfflineTileServerPlugin.kt` |

The only new code in this file is:
- A `fun interface RasterTileProvider` (declares the SAM callback)
- A `companion object` with `@JvmStatic registerRasterTileProvider(...)`
- A new route block at the top of `TileServer.serve()` matching
  `^/layers/<id>/<z>/<x>/<y>.webp$`

The existing `/{z}/{x}/{y}.pbf`, `/style.json`, `/fonts/...` routes and
`stopExistingTileServer()` lifecycle are byte-identical — check the diff
before merging if your branch has local changes to that file.

### 3. Required additions to `app/build.gradle`

Add these stanzas if not already present:

```gradle
android {
  defaultConfig {
    ndk { abiFilters 'arm64-v8a', 'armeabi-v7a' }
  }
  packagingOptions { jniLibs { useLegacyPackaging false } }
  sourceSets {
    main {
      jniLibs.srcDirs += ['src/main/jniLibs']
      assets.srcDirs   += ['src/main/assets']
    }
  }
}
dependencies {
  implementation files('libs/gdal.jar')   // GDAL Java SWIG bindings
}
```

~10 LOC, additive. **No `externalNativeBuild { cmake { ... } }` block needed.**
Doesn't conflict with Capacitor's own gradle includes.

### 4. Register the plugin in `MainActivity`

In your existing `registerPlugins(...)` block in `MainActivity`, add one line
after the `OfflineTileServer` registration:

```kotlin
registerPlugin(RasterTilingPlugin::class.java)
```

Order matters slightly: `RasterTilingPlugin.load()` calls
`OfflineTileServerPlugin.registerRasterTileProvider(...)` at startup, so as
long as both are registered before `super.onCreate(...)` (the existing
pattern in the standalone build) the call lands on the static companion of
the already-loaded class.

### 5. AndroidManifest.xml

**No changes required.** No new permissions; raster files are read from the
same external-files dir that `NativeUploader` already populates. No INTERNET
permission needed (server is loopback only).

---

## What does NOT change

- Existing JS bridge calls (`Capacitor.Plugins.OfflineTileServer.*`,
  `Capacitor.Plugins.SessionInfo.*`, `NativeUploader.*`, etc.) continue to
  work unchanged.
- The existing pbf vector-tile route, `style.json`, font glyph routes.
- `UserPreferencesManager` — `RasterTilingPlugin.kt` calls
  `UserPreferencesManager.getUsername(context)` for per-user cache
  namespacing. If `getUsername()` returns null/blank (pre-login), the plugin
  falls back to the literal `"_default"` directory so it still works during
  app boot.

---

## Backward compatibility

The renderer feature-detects via
`Capacitor.isPluginAvailable('RasterTiling')` — a stale client integration
that hasn't taken this drop yet still boots and just falls back to the old
BitmapLayer path for >2 MB rasters. So the JS bundle and the native plugin
can be deployed independently.

---

## APK size impact

+45–50 MB across both ABIs.

**Mitigation**: ship as App Bundle (`./gradlew bundleRelease`) — Play splits
per ABI so each user only downloads arm64 OR armv7, not both, halving the
per-install cost.

---

## NDK / CMake install requirement: NONE

Our build script (run on our side, not yours) cross-compiles GDAL and
produces the prebuilt `.so` + `gdal.jar`. Your Gradle build doesn't invoke
NDK or CMake — it just packages the bytes we ship.

Your CI/dev machines need nothing extra beyond what they already have for
the existing Capacitor build.

---

## Smoke-test checklist before shipping

```bash
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb logcat -c && adb logcat | grep -E "RasterTiling|OfflineTileServer"
```

What you should see on first launch:
1. `RasterTilingPlugin: GDAL <version> registered, PROJ_LIB=/data/.../proj`
2. `TileServer: Server initialized with default path: ...`

If you see `UnsatisfiedLinkError: dlopen failed: library "libgdalalljni.so" not found`,
the `.so` files weren't packaged — recheck `jniLibs.srcDirs` in `build.gradle`
and the `app/src/main/jniLibs/<abi>/` directory layout.

End-to-end sanity:

1. Upload a small `<2 MB` raster → should still render via the renderer's
   BitmapLayer path. Logcat should NOT show any `RasterTilingPlugin.*` calls.
2. Upload `clutter-india-25m.tif` (or any >2 MB GeoTIFF) → toast should show
   `Probing → Optimizing → Ready`, then map paints raster tiles. Pinch to a
   high zoom; tile fetch URLs are
   `http://localhost:8080/layers/<id>/<z>/<x>/<y>.webp`.
3. Hover anywhere over the raster → tooltip shows a numeric pixel value
   within ~150 ms.
4. Kill app → reopen → previously uploaded raster restores from manifest and
   renders from disk cache (no re-tile).
5. Delete the layer → file unlinks cleanly (no `EBUSY`).

---

## Versioning future drops

When we ship a new `kt-msca-plugins/` drop (bug fixes, GDAL bumps), bump
`RASTER_TILING_DROP_VERSION` at the top of this file. Diff against the
version you integrated last and apply the delta. Most updates are:

- New `.so` set under `kt-msca-plugins/jniLibs/` (replace wholesale)
- Updated `gdal.jar` (replace wholesale)
- Optional Kotlin plugin tweaks (read the diff, apply if relevant)

The Capacitor JS surface is stable — JS bundle changes don't require
re-integration unless this version log says otherwise.
