# Android Raster-Tiling Setup — Laptop Prerequisites

This document is the from-scratch setup guide for getting the Android raster-tiling pipeline (GDAL + Java SWIG bindings inside a Capacitor plugin) building and running on a fresh laptop.

There are **two paths**:

| Path | When to take it | Time |
|------|-----------------|------|
| **A. Use prebuilt native libs** | You just want to build the APK and run it. The repo already ships `libgdal.so` + `libgdalalljni.so` + `gdal.jar` checked in under `android/app/src/main/jniLibs/` and `android/app/libs/`. **This is the common case.** | ~30 min |
| **B. Rebuild GDAL from source** | The .so files were lost, you need to bump GDAL versions, or you're targeting a new ABI. Cross-compiles GDAL 3.9.3 + PROJ 9.4.1 + libtiff/webp/png/jpeg via Android NDK. | ~60–90 min on first run |

If you only need **Path A**, skip directly to [§3 Path A](#3-path-a--build-the-apk-with-prebuilt-binaries).

---

## 1. Common prerequisites (both paths)

These are needed on every laptop regardless of which path you take.

### 1.1 Hardware / OS

| Requirement | Minimum |
|---|---|
| OS | Windows 10/11, macOS 12+, or Ubuntu 22.04+ |
| RAM | 8 GB (16 GB recommended for emulator) |
| Free disk | 25 GB (Android SDK + NDK + repo + build cache) |
| CPU | x86_64 with virtualisation enabled (for the emulator) |

### 1.2 Node.js + Yarn

The renderer (Vite + React) and Capacitor sync use Node.

```bash
# Install Node 20 LTS (use nvm-windows on Windows, nvm on mac/linux)
node --version    # must be >= 20
npm --version

# Yarn classic (the repo uses yarn for Capacitor sync)
npm install --global yarn
yarn --version    # >= 1.22
```

### 1.3 Java JDK

Gradle 8.7 + Capacitor 7 require **JDK 21** to compile. The repo is configured to **auto-download JDK 21 via the foojay-resolver** the first time `./gradlew` runs, so you do **not** need a system JDK 21 — but you **do** need at least JDK 17 installed so Gradle itself can boot.

```bash
# Windows: install Eclipse Temurin 17 (or 21) via Adoptium installer
# macOS:
brew install --cask temurin@17
# Ubuntu:
sudo apt install -y openjdk-17-jdk

java -version    # should report 17 or 21
echo $JAVA_HOME  # must be set
```

The first Android build will silently fetch JDK 21 into `~/.gradle/jdks/` (configured in [android/settings.gradle](../android/settings.gradle) and [android/build.gradle](../android/build.gradle)). No further action needed.

### 1.4 Android Studio / SDK / NDK

Easiest install path is via Android Studio.

1. Download Android Studio Hedgehog or newer from https://developer.android.com/studio.
2. During setup, accept the SDK licenses and let it install:
   - **Android SDK Platform 35** (compileSdk/targetSdk)
   - **Android SDK Build-Tools 34.0.0+**
   - **Android SDK Platform-Tools** (provides `adb`)
   - **NDK r26d** (`26.3.11579264`) — required for both paths.
   - **CMake 3.22.1+**

Set environment variables (add to `~/.bashrc` / `~/.zshrc` / Windows env):

```bash
export ANDROID_HOME="$HOME/Android/Sdk"           # Linux/macOS
# or on Windows:  ANDROID_HOME=C:\Users\<you>\AppData\Local\Android\Sdk
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_NDK="$ANDROID_HOME/ndk/26.3.11579264"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"

adb version    # confirm tools on PATH
```

Verify the NDK directory exists:

```bash
ls "$ANDROID_NDK/build/cmake/android.toolchain.cmake"
```

### 1.5 Git

```bash
git --version    # any modern version
```

---

## 2. Clone the repo

```bash
# Anywhere you keep your projects
git clone <repo-url> mcsa-gis-android
cd mcsa-gis-android

# The current working branch
git checkout windows-setup
```

Install the JS dependencies once:

```bash
yarn install
# (or: npm install — but yarn matches the lockfile)
```

Verify the prebuilt native artifacts are present:

```bash
ls android/app/src/main/jniLibs/arm64-v8a/
# Should list:
#   libgdal.so  libgdalalljni.so  libproj.so  libtiff.so  libwebp.so
#   libpng16.so  libjpeg.so  libsqlite3.so  libsharpyuv.so  libc++_shared.so

ls android/app/libs/
# Should list: gdal.jar
```

If those files are present, **skip §4 (Path B) entirely** — you can go straight to building.

---

## 3. Path A — Build the APK with prebuilt binaries

### 3.1 Build the renderer + sync to Android

Capacitor expects the Vite-built JS in `dist/`, then mirrors it into `android/app/src/main/assets/public/`.

```bash
# Build the React app for production (or dev — same flow)
yarn build

# Copy the built assets + plugin metadata into android/
npx cap sync android
```

### 3.2 Open in Android Studio

```bash
npx cap open android
```

This launches Android Studio with the `android/` Gradle project already configured. The first launch will:

- Auto-fetch JDK 21 via foojay (one-time, ~200 MB → `~/.gradle/jdks/`).
- Run Gradle sync — should finish without errors.

### 3.3 Build & install on a device

Plug in an Android device with **USB debugging enabled** (Settings → Developer options) or start an emulator (AVD Manager → arm64-v8a image is preferred).

From Android Studio: **Run → Run 'app'**.

Or from CLI:

```bash
cd android
./gradlew assembleDebug         # produces app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb logcat | grep -E "RasterTiling|OfflineTileServer"
```

You should see `RasterTilingPlugin: GDAL <version> registered` shortly after launch. Upload a `.tif` from the in-app file picker — the raster should render via `/layers/<id>/{z}/{x}/{y}.webp` served by the in-app NanoHTTPD on `localhost:8080`.

If `System.loadLibrary("gdalalljni")` fails with `UnsatisfiedLinkError`, the `.so` files weren't packaged — recheck the `jniLibs/` listing from §2.

---

## 4. Path B — Rebuild GDAL from source

Take this path only if the prebuilt `.so` files are missing or you need to change GDAL versions / ABIs.

### 4.1 Linux / macOS host requirements

The cross-compile script ([scripts/build-gdal-android.sh](../scripts/build-gdal-android.sh)) runs on Linux, macOS, or **WSL2 Ubuntu 24.04** on Windows. It does **not** run on native Windows.

Install the toolchain:

```bash
# Ubuntu / WSL Ubuntu 24.04
sudo apt update
sudo apt install -y build-essential autoconf automake libtool pkg-config \
                    cmake ninja-build swig curl xz-utils tar \
                    openjdk-21-jdk

# macOS (Homebrew)
brew install autoconf automake libtool pkg-config cmake ninja swig curl
brew install --cask temurin@21
```

Confirm versions:

```bash
swig -version          # >= 4.0
cmake --version        # >= 3.22
ninja --version
javac -version         # 21.x
```

### 4.2 Set the build environment

```bash
# Required
export ANDROID_NDK="$HOME/Android/Sdk/ndk/26.3.11579264"
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64    # adjust for your distro

# Sanity
[ -d "$ANDROID_NDK/build/cmake" ] && echo "NDK OK"
[ -d "$JAVA_HOME" ] && echo "JDK OK"
```

### 4.3 Run the build

```bash
cd /path/to/mcsa-gis-android

# Long build — ~60–90 min on first run, ~10 min on incremental rebuilds.
# Builds for both ABIs by default (arm64-v8a + armeabi-v7a).
bash scripts/build-gdal-android.sh
```

**Optional environment overrides:**

| Var | Default | Purpose |
|---|---|---|
| `ABIS` | `"arm64-v8a armeabi-v7a"` | ABIs to build. Add `x86_64` for emulator support. |
| `ANDROID_API` | `24` | Minimum API the .so will run on. |
| `GDAL_VERSION` | `3.9.3` | Source tarball to fetch from osgeo.org. |
| `PROJ_VERSION` | `9.4.1` | |
| `TIFF_VERSION` | `4.6.0` | |
| `WEBP_VERSION` | `1.4.0` | |
| `PNG_VERSION` | `1.6.43` | |
| `JPEG_VERSION` | `3.0.4` | libjpeg-turbo. |
| `SQLITE_VERSION` | `3460100` | Required by PROJ. |
| `BUILD_DIR` | `$REPO_ROOT/.build/gdal-android` | Where source tarballs + intermediate objects land. |

Example with single ABI for faster iteration:

```bash
ABIS=arm64-v8a bash scripts/build-gdal-android.sh
```

### 4.4 What the script does

1. Downloads source tarballs for GDAL, PROJ, libtiff, libwebp, libpng, libjpeg-turbo, sqlite.
2. For each ABI, in dependency order:
   - libjpeg-turbo → libpng → libwebp → libtiff → sqlite → PROJ → GDAL
3. Each lib is `cmake --build`'d via the NDK toolchain into `$BUILD_DIR/install/<abi>/`.
4. **GDAL is configured with `-DBUILD_JAVA_BINDINGS=ON`** which invokes SWIG to generate `org.gdal.*` Java classes + the JNI plumbing (`libgdalalljni.so`).
5. Outputs are copied into:
   - `android/app/src/main/jniLibs/<abi>/lib*.so` (standalone build)
   - `android/app/libs/gdal.jar`
   - `android/app/src/main/assets/proj/proj.db`
   - **And mirrored** into `kt-msca-plugins/jniLibs/`, `kt-msca-plugins/libs/`, `kt-msca-plugins/assets/` (so the integrated MCSA drop-in stays in sync).

### 4.5 Sanity-check the outputs

```bash
ls -lh android/app/src/main/jniLibs/arm64-v8a/
# libgdal.so          ~15 MB
# libgdalalljni.so    ~3 MB
# libproj.so          ~5 MB
# libtiff.so          ~1 MB
# libwebp.so          ~600 KB
# libpng16.so         ~250 KB
# libjpeg.so          ~400 KB
# libc++_shared.so    ~1.5 MB

ls -lh android/app/libs/gdal.jar
# ~2 MB
```

Now follow [§3 Path A](#3-path-a--build-the-apk-with-prebuilt-binaries) to actually build the APK.

---

## 5. Verify on device

After installing the debug APK:

```bash
# Watch the plugin boot logs:
adb logcat -s RasterTilingPlugin OfflineTileServerPlugin

# Expected on first launch:
# RasterTilingPlugin: GDAL 3.9.3 registered, PROJ_LIB=/data/.../proj
# OfflineTileServerPlugin: Started NanoHTTPD on :8080
```

Smoke test:

1. Tap the upload icon → pick a `.tif` larger than 2 MB.
2. Toast should progress through *Probing → Optimizing → Tiling*.
3. The map should render the raster at the layer's native zoom — pan/zoom and tiles fill in.
4. Hover/tap on the raster → tooltip shows a real pixel value (palette index for Byte rasters, dBm for Float, elevation for DEM).
5. Open zoom-controls → trash icon → **Delete Session** → both the source `.tif` and `HSC-TILES/<layerId>/` are wiped.

---

## 6. Updating the integrated MCSA drop

The `kt-msca-plugins/` directory is an **export** to the client's separate Kotlin app. After making changes here, run:

```bash
yarn sync:mcsa-gis-android-sync
```

This syncs the updated `.so` files, `gdal.jar`, `proj.db`, and Kotlin plugin sources into the integration target. The client copies these into their own `app/src/main/jniLibs/`, `app/libs/`, `app/src/main/assets/proj/`, and `app/src/main/java/org/deal/mcsa/plugins/` directories.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `UnsatisfiedLinkError: dlopen failed: cannot locate symbol "..."` | One of the .so dependencies isn't packaged. | Re-run §2 listing. If missing, redo Path B for the affected ABI. |
| Gradle sync fails with "JDK 21 not found" | foojay-resolver couldn't reach api.foojay.io. | Either give Gradle internet access on first run, or install JDK 21 manually and set `JAVA_HOME` to it. |
| `swig: command not found` during Path B | SWIG wasn't installed. | `sudo apt install swig` or `brew install swig`. |
| Raster never paints, only blank tiles | `proj.db` not copied to `filesDir/proj/` | Check `RasterTilingPlugin.copyProjDbIfMissing()` log output. The asset must exist at `android/app/src/main/assets/proj/proj.db`. |
| `EBUSY`/`EPERM` deleting `.tif` | Plugin still holds the file via an open `Dataset`. | The flush flow already calls `RasterTiling.closeAll()` before deletion. If reproducing, confirm `closeAll` is firing in logcat. |
| APK is huge (~250 MB) | Both ABIs packaged unsplit. | Build as App Bundle: `./gradlew bundleRelease` — Play splits by ABI on install. |

---

## 8. Quick-reference — every command in order

A new laptop, end-to-end, Path A only:

```bash
# 1. Toolchain (once per laptop)
# Install Node 20, Android Studio with SDK Platform 35 + NDK r26d + Build-Tools, JDK 17.
# Set ANDROID_HOME, ANDROID_NDK, JAVA_HOME.

# 2. Clone & install
git clone <repo-url> mcsa-gis-android
cd mcsa-gis-android
git checkout windows-setup
yarn install

# 3. Build & sync
yarn build
npx cap sync android

# 4. Run on device
npx cap open android       # then click ▶ Run, or:
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb logcat -s RasterTilingPlugin OfflineTileServerPlugin
```
