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

---

## Hardware BACK button on the GIS screen

**What the GIS web app does on its own, with no host changes:** one back press
dismisses one layer of its own UI, innermost first — tooltip, then an in-progress
sketch, then rubber-band zoom, then the Route/Measurement/Network/Layers panels.

**What it does when nothing of its own is open** depends on whether you have
given it somewhere to go:

| Situation | Behaviour |
| --- | --- |
| You provide `GisHostNavigation.goBack()` | The GIS app calls it — you navigate (pop your stack, switch tab, whatever "leave the GIS screen" means to you) |
| You do not | "Press back again to exit", then `App.exitApp()` on a second press within 2 s |

**Read the second row carefully if you embed us.** `App.exitApp()` is
`Activity.finish()`, so without the hook a back press on the GIS screen closes
**your** activity — the whole MCSA app, not just the GIS tab. That is the
behaviour that was asked for, and the two-press confirmation is there so it takes
a deliberate double press rather than one stray tap. If closing the app is not
what you want — and on a SIP handset, dropping out mid-call usually is not —
wire the hook in Option A and the exit path is never reached.

### Why a hook is needed at all

There is no way for the web layer to "pass the press through" to you. Capacitor's
`AppPlugin` registers an **enabled** `OnBackPressedCallback` on the **activity's**
`OnBackPressedDispatcher` (`AppPlugin.load()`), and when the web layer has a
`backButton` listener its native handler only notifies JavaScript — it does not
call your callbacks and there is no `preventDefault`. So the press is consumed by
Capacitor whatever the web layer decides.

Two consequences worth knowing before you wire this up:

- **A plain Compose `BackHandler` in `GisScreen` will not fire.**
  `OnBackPressedDispatcher` runs the most recently added enabled callback first.
  Your `BackHandler` is added when the composable enters composition; Capacitor's
  is added later, when the bridge is created in the fragment's `onViewCreated`
  (`GisCapacitorFragment.load()`). Capacitor's therefore wins.
- **`GisCapacitorFragment.handleBackPress()` is never reached** unless something
  calls it. It only walks WebView history, and the GIS app pushes no history
  entries, so it would return `false` regardless.

### Option A — give the GIS screen a way to ask you to navigate (recommended)

Keeps the GIS app's own back behaviour (panels close first) and puts your
navigation at the end of the chain. Add one small plugin:

```kotlin
package org.deal.mcsa.plugins

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Lets the GIS web app hand a back press back to the host once it has nothing of
 * its own left to close.
 */
@CapacitorPlugin(name = "GisHostNavigation")
class GisHostNavigationPlugin : Plugin() {
    companion object {
        /** Set by the host. Runs on the UI thread. */
        @JvmStatic
        var onBackRequested: (() -> Unit)? = null
    }

    @PluginMethod
    fun goBack(call: PluginCall) {
        activity.runOnUiThread { onBackRequested?.invoke() }
        call.resolve()
    }
}
```

Register it alongside the others in `GisCapacitorFragment.onCreate()`:

```kotlin
registerPlugin(GisHostNavigationPlugin::class.java)
```

Then point it at whatever "leave the GIS tab" means in your navigation — for
example in `GisScreen`:

```kotlin
val activity = LocalActivity.current as FragmentActivity
DisposableEffect(Unit) {
    GisHostNavigationPlugin.onBackRequested = {
        // your own navigation: switch tab, pop the nav controller, finish, …
        onLeaveGis()
    }
    onDispose { GisHostNavigationPlugin.onBackRequested = null }
}
```

The GIS app calls `goBack()` only after its own panels are closed, so a user on
the GIS tab presses back a few times to clear the map UI and then once more to
leave the screen — the usual Android feel.

### Option B — take back entirely for yourself

Add this to the host's `app/src/main/assets/capacitor.config.json`:

```json
{
  "appId": "com.example.app",
  "appName": "mcsa-gis-android",
  "webDir": "dist",
  "plugins": { "App": { "disableBackButtonHandler": true } }
}
```

Capacitor then creates its callback **disabled**, the press reaches your own
`BackHandler`/`onBackPressed`, and your navigation works with no plugin. The
trade-off: the GIS app never sees back at all, so its panels and in-progress
sketches no longer close on back — the user must close them with their own ✕
buttons.

## Versioning future drops

When we ship a new `kt-msca-plugins/` drop (bug fixes, GDAL bumps), bump
`RASTER_TILING_DROP_VERSION` at the top of this file. Diff against the
version you integrated last and apply the delta. Most updates are:

- New `.so` set under `kt-msca-plugins/jniLibs/` (replace wholesale)
- Updated `gdal.jar` (replace wholesale)
- Optional Kotlin plugin tweaks (read the diff, apply if relevant)

The Capacitor JS surface is stable — JS bundle changes don't require
re-integration unless this version log says otherwise.
