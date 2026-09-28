# Integration Delta — Raster Tiling on Android

This document is the **delta** on top of the existing `Integration Document 01-04-2026.pdf`. It lists exactly which new files to copy from `mcsa-gis-android/` into `deal_wf_mcsa-develop/` and which existing files have been changed for the new on-device GeoTIFF raster-tiling feature (GDAL via Java SWIG bindings, in-app HTTP server at `localhost:8080`).

If the client team is using the **"Old Dev"** flow from the integration PDF (replace `mcsa-gis-android/` folder, run `yarn install/build/sync`, copy assets), follow that flow exactly **and additionally** apply the steps below — **only the items listed here are new** since the 01-04-2026 PDF.

---

## TL;DR — checklist

| # | Action | Source path (in `mcsa-gis-android/`) | Destination (in `deal_wf_mcsa-develop/`) |
|---|---|---|---|
| 1 | Copy NEW plugin file | `kt-msca-plugins/RasterTilingPlugin.kt` | `app/src/main/java/org/deal/mcsa/plugins/RasterTilingPlugin.kt` |
| 2 | OVERWRITE existing plugin file | `kt-msca-plugins/OfflineTileServerPlugin.kt` | `app/src/main/java/org/deal/mcsa/plugins/OfflineTileServerPlugin.kt` |
| **3–6** | **AUTOMATED** — run `yarn sync:mcsa-gis-android-sync` (the existing PDF Step 9 / Old-Dev Step 2 command). The script now also copies all native artifacts: jniLibs `.so` files (both ABIs), `gdal.jar`, and `proj.db`. **No manual file copies needed.** | — | — |
| 7 | OVERWRITE fragment (now registers RasterTilingPlugin) | `mcsa-fragment-files/GisCapacitorFragment.kt` | `app/src/main/java/org/deal/mcsa/GisCapacitorFragment.kt` |
| 8 | Modify `app/build.gradle.kts` | (see §Step 8 below) | `app/build.gradle.kts` |

Nothing else from the 01-04-2026 PDF needs to be redone. The `Integration Document` plugin list (Step 5) already covers the other plugins; this is purely additive.

---

## Step 1 — Copy `RasterTilingPlugin.kt`

This is a NEW Capacitor plugin (`@CapacitorPlugin(name = "RasterTiling")`). It exposes `probe / buildOverviews / registerLayer / unregisterLayer / sampleAt / getTileBaseUrl / closeAll` to the WebView and serves `/layers/<id>/{z}/{x}/{y}.webp` through the existing NanoHTTPD server.

**From:** `mcsa-gis-android/kt-msca-plugins/RasterTilingPlugin.kt`
**To:** `deal_wf_mcsa-develop/app/src/main/java/org/deal/mcsa/plugins/RasterTilingPlugin.kt`

It uses `org.deal.mcsa.utility.UserPreferencesManager.getUsername(context)` (already in the client's codebase — same source already used by `SessionInfoPlugin.kt`) to namespace tile cache directories per user. No further wiring required.

---

## Step 2 — OVERWRITE `OfflineTileServerPlugin.kt`

The existing `OfflineTileServerPlugin.kt` from the 01-04-2026 PDF has been **modified** to expose a raster-tile callback hook (`@JvmStatic registerRasterTileProvider`) and to add a `/layers/...` route handler in front of the existing pbf/style/font routes. **The pbf/style/font flow is byte-identical** — only the new raster route is added, plus the companion-object hook the new `RasterTilingPlugin` calls during `load()`.

**From:** `mcsa-gis-android/kt-msca-plugins/OfflineTileServerPlugin.kt`
**To:** `deal_wf_mcsa-develop/app/src/main/java/org/deal/mcsa/plugins/OfflineTileServerPlugin.kt`

Replace the entire file. No manifest or `MainActivity` changes needed.

---

## Steps 3–6 — AUTOMATED via `yarn sync:mcsa-gis-android-sync`

Native artifacts are no longer hand-copied. The existing sync script (`scripts/sync-integration-assets.mjs` — already part of the PDF's Old-Dev Step 2 / new-dev Step 9 command) now mirrors all of this in one shot. Just run:

```bash
cd mcsa-gis-android
yarn sync:mcsa-gis-android-sync
```

…and the script copies, **in addition to** the existing web bundle / Capacitor metadata that PDF already documents:

| Source (in `mcsa-gis-android/`) | Destination (in `deal_wf_mcsa-develop/`) |
|---|---|
| `kt-msca-plugins/jniLibs/arm64-v8a/*.so`   *(10 files, ~25 MB)* | `app/src/main/jniLibs/arm64-v8a/` |
| `kt-msca-plugins/jniLibs/armeabi-v7a/*.so` *(10 files, ~20 MB)* | `app/src/main/jniLibs/armeabi-v7a/` |
| `kt-msca-plugins/libs/gdal.jar`             *(~2 MB)*           | `app/libs/gdal.jar` |
| `kt-msca-plugins/assets/proj/proj.db`       *(~9 MB)*           | `app/src/main/assets/proj/proj.db` |

The script creates target directories as needed and overwrites existing files, so it's safe to re-run on every Lepton drop. The `.so` set per ABI is:

```
libc++_shared.so   libgdal.so       libgdalalljni.so   libjpeg.so
libpng16.so        libproj.so       libsharpyuv.so     libsqlite3.so
libtiff.so         libwebp.so
```

`libgdalalljni.so` is the SWIG-generated JNI bridge `dlopen`'d by `System.loadLibrary("gdalalljni")` in `RasterTilingPlugin`'s static initialiser — it transitively pulls in the other `.so`s.

> **No manual file copies needed for Steps 3–6.** If `yarn sync:mcsa-gis-android-sync` succeeds, all native artifacts are in place.

---

## Step 7 — OVERWRITE `GisCapacitorFragment.kt`

The fragment now also calls `registerPlugin(RasterTilingPlugin::class.java)`. All other plugin registrations are unchanged.

**From:** `mcsa-gis-android/mcsa-fragment-files/GisCapacitorFragment.kt`
**To:** `deal_wf_mcsa-develop/app/src/main/java/org/deal/mcsa/GisCapacitorFragment.kt`

If your client codebase has manually-edited registrations, the only addition required is one line:

```kotlin
import org.deal.mcsa.plugins.RasterTilingPlugin
// ...
registerPlugin(RasterTilingPlugin::class.java)
```

---

## Step 8 — Modify `app/build.gradle.kts`

Add the following four pieces inside the existing `android { … }` and `dependencies { … }` blocks. **Additive only** — do not remove anything that's already in the file from the 01-04-2026 PDF.

### 8.1 ABI filter (inside `android { defaultConfig { … } }`)

```kotlin
defaultConfig {
    // ... existing configs (multiDexEnabled = true, etc.) ...

    // Ship only ARM ABIs (arm64-v8a + armeabi-v7a). x86_64 is not built.
    ndk {
        abiFilters.addAll(listOf("arm64-v8a", "armeabi-v7a"))
    }
}
```

### 8.2 jniLibs source dir (inside `android { sourceSets { … } }`)

```kotlin
sourceSets {
    getByName("main") {
        // Existing srcDirs stay as-is; just confirm jniLibs points to the
        // new directory we're populating in Steps 3 & 4.
        jniLibs.srcDirs("src/main/jniLibs")
    }
}
```

If your `app/build.gradle.kts` does not currently declare a `sourceSets { … }` block, add the one above as-is. The default `jniLibs.srcDir` is already `src/main/jniLibs/`, so this line is a safety net rather than strictly required.

### 8.3 jniLibs packaging option (inside `android { packagingOptions { … } }`, or `packaging { … }` on AGP 8.4+)

```kotlin
packaging {
    jniLibs {
        useLegacyPackaging = false
    }
}
```

This makes the AAB / APK store the `.so` files uncompressed and page-aligned, which is required for `System.loadLibrary` to work correctly on Android 6+ when the libraries are loaded from the APK (no extraction step). Without this, you will see `UnsatisfiedLinkError: dlopen failed: library "libgdalalljni.so" not found`.

### 8.4 Add `gdal.jar` to dependencies (inside `dependencies { … }`)

```kotlin
dependencies {
    // ... existing implementation(project(":capacitor-android")), etc. ...

    // GDAL Java SWIG bindings — backs RasterTilingPlugin.
    implementation(files("libs/gdal.jar"))
}
```

The 01-04-2026 PDF already configures all the other dependencies (`capacitor-android`, `capacitor-app`, `nanohttpd`, etc.) — only this single new line is required.

### 8.5 — NOT REQUIRED

The following are **NOT** needed:
- ❌ No `externalNativeBuild { cmake { … } }` block — we ship prebuilt `.so` files only.
- ❌ No NDK install on the client's build machine — Lepton produces the `.so` files.
- ❌ No new `AndroidManifest.xml` permissions — raster files are read from the same external-files dir that `NativeUploaderPlugin` already populates. No `INTERNET` permission needed (server is loopback).

---

## Verification (after build & install)

```bash
adb logcat -s RasterTilingPlugin OfflineTileServerPlugin
```

Expected on first launch:

```
RasterTilingPlugin: GDAL <version> registered, PROJ_LIB=/data/.../proj
OfflineTileServerPlugin: Started NanoHTTPD on :8080
```

Smoke test:

1. Open the GIS screen in the integrated app.
2. Tap the upload icon → pick a `.tif` larger than 2 MB.
3. Toast progresses *Probing → Optimizing → Tiling*.
4. The map paints the raster; pan/zoom and tiles fill in.
5. Tap on a painted pixel → tooltip shows a real value (palette index for Byte rasters, Float dBm, elevation for DEM).
6. Tap on an unpainted area inside the bounding box (NoData) → no tooltip.
7. Open zoom-controls → trash icon → **Delete Session** → both the source `.tif` and `HSC-TILES/<username>/<layerId>/` are wiped.

If `System.loadLibrary("gdalalljni")` fails with `UnsatisfiedLinkError`, the `.so` files weren't packaged — recheck Step 3/4 listing and Step 8.3 packaging option.

---

## What did NOT change since the 01-04-2026 PDF

For clarity — these existing integration steps from the PDF stay the same and do **not** need to be redone:

- ✅ Step 1 of PDF — root `build.gradle.kts`, `settings.gradle.kts`, `.gitignore` — unchanged.
- ✅ Step 2 of PDF — `app/build.gradle.kts` MultiDex / R8 / dependencies — unchanged. (The only addition is in §Step 8 above, which is purely additive.)
- ✅ Step 3 of PDF — `AndroidManifest.xml` permissions / FileProvider / configChanges — unchanged.
- ✅ Step 4 of PDF — `file_paths.xml` / `variables.gradle` — unchanged.
- ✅ Step 6 of PDF — `GisCapacitorFragment.kt` — REPLACED via §Step 7 above (only one new `registerPlugin` line).
- ✅ Step 7 of PDF — `GisScreen.kt` — unchanged.
- ✅ Step 8 of PDF — Navigation hook in `HomeScreen.kt` — unchanged.
- ✅ Step 9 of PDF — `dist/*` + `capacitor.plugins.json` + `capacitor.config.json` web-asset copy — unchanged. (Run `yarn build && npx cap sync` and re-copy as usual.)
- ✅ Step 10 of PDF — `BaseActivity.kt` / `themes.xml` / `HomeActivity.kt` / `MCSADealApp.kt` / `proguard-rules.pro` / `HomeScreen.kt` screenshot fix — unchanged.

Specifically: the existing `proguard-rules.pro` rule `-keep class org.deal.mcsa.plugins.** { *; }` from PDF Step 10 already covers the new `RasterTilingPlugin`, so **no proguard updates are required**.

---

## Summary — exact actions on the client side

```
COPY (manual, once per drop):
  mcsa-gis-android/kt-msca-plugins/RasterTilingPlugin.kt
    → deal_wf_mcsa-develop/app/src/main/java/org/deal/mcsa/plugins/RasterTilingPlugin.kt

  mcsa-gis-android/kt-msca-plugins/OfflineTileServerPlugin.kt           [overwrite]
    → deal_wf_mcsa-develop/app/src/main/java/org/deal/mcsa/plugins/OfflineTileServerPlugin.kt

  mcsa-gis-android/mcsa-fragment-files/GisCapacitorFragment.kt          [overwrite]
    → deal_wf_mcsa-develop/app/src/main/java/org/deal/mcsa/GisCapacitorFragment.kt

AUTOMATED (yarn sync:mcsa-gis-android-sync):
  jniLibs/arm64-v8a/*.so      (10 files)   → app/src/main/jniLibs/arm64-v8a/
  jniLibs/armeabi-v7a/*.so    (10 files)   → app/src/main/jniLibs/armeabi-v7a/
  libs/gdal.jar                            → app/libs/gdal.jar
  assets/proj/proj.db                      → app/src/main/assets/proj/proj.db

EDIT (one-time):
  deal_wf_mcsa-develop/app/build.gradle.kts   [4 additive blocks — see §Step 8]
```

That's the complete delta. The client copies 3 Kotlin source files, runs the existing sync command, and applies the gradle additions once. Subsequent Lepton drops just re-run `yarn sync:mcsa-gis-android-sync` — native artifacts refresh themselves.
