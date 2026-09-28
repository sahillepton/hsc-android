#!/usr/bin/env bash
# Cross-compile GDAL with the official Java SWIG bindings for Android.
#
# Outputs (per ABI):
#   android/app/src/main/jniLibs/<abi>/libgdal.so
#   android/app/src/main/jniLibs/<abi>/libproj.so
#   android/app/src/main/jniLibs/<abi>/libtiff.so
#   android/app/src/main/jniLibs/<abi>/libwebp.so
#   android/app/src/main/jniLibs/<abi>/libpng16.so
#   android/app/src/main/jniLibs/<abi>/libjpeg.so
#   android/app/src/main/jniLibs/<abi>/libgdaljni.so   (SWIG JNI plumbing)
#
# ABI-independent:
#   android/app/libs/gdal.jar                          (org.gdal.* Java classes)
#
# Drop-in copies for the integrated MCSA build are also written under
# kt-msca-plugins/jniLibs/<abi>/ and kt-msca-plugins/libs/.
#
# Run on macOS, Linux, or WSL. Requires:
#   - Android NDK r26b or newer (set ANDROID_NDK)
#   - JDK 17+ with javac, jar (set JAVA_HOME)
#   - SWIG 4.x
#   - cmake 3.22+, ninja, autoconf, automake, libtool, pkg-config
#   - Internet access for the source tarballs (~50 MB total)
#
# Usage:
#   ANDROID_NDK=$HOME/Android/Sdk/ndk/26.1.10909125 \
#   JAVA_HOME=/usr/lib/jvm/java-17-openjdk \
#       bash scripts/build-gdal-android.sh
#
# Environment overrides:
#   ABIS               default: "arm64-v8a armeabi-v7a"
#   ANDROID_API        default: 24
#   GDAL_VERSION       default: 3.9.3
#   PROJ_VERSION       default: 9.4.1
#   TIFF_VERSION       default: 4.6.0
#   WEBP_VERSION       default: 1.4.0
#   PNG_VERSION        default: 1.6.43
#   JPEG_VERSION       default: 3.0.4    (libjpeg-turbo)
#   SQLITE_VERSION     default: 3460100  (3.46.1 — required by PROJ)
#   BUILD_DIR          default: $REPO_ROOT/.build/gdal-android
#
# This is a long build (~30–60 min on first run). Subsequent runs reuse
# downloaded sources and partially-built objects.

set -euo pipefail
shopt -s lastpipe

ABIS="${ABIS:-arm64-v8a armeabi-v7a}"
ANDROID_API="${ANDROID_API:-24}"
GDAL_VERSION="${GDAL_VERSION:-3.9.3}"
PROJ_VERSION="${PROJ_VERSION:-9.4.1}"
TIFF_VERSION="${TIFF_VERSION:-4.6.0}"
WEBP_VERSION="${WEBP_VERSION:-1.4.0}"
PNG_VERSION="${PNG_VERSION:-1.6.43}"
JPEG_VERSION="${JPEG_VERSION:-3.0.4}"
SQLITE_VERSION="${SQLITE_VERSION:-3460100}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-$REPO_ROOT/.build/gdal-android}"
SRC_DIR="$BUILD_DIR/src"
INSTALL_ROOT="$BUILD_DIR/install"
JNI_OUT_STANDALONE="$REPO_ROOT/android/app/src/main/jniLibs"
LIBS_OUT_STANDALONE="$REPO_ROOT/android/app/libs"
ASSETS_OUT_STANDALONE="$REPO_ROOT/android/app/src/main/assets"
JNI_OUT_INTEGRATED="$REPO_ROOT/kt-msca-plugins/jniLibs"
LIBS_OUT_INTEGRATED="$REPO_ROOT/kt-msca-plugins/libs"
ASSETS_OUT_INTEGRATED="$REPO_ROOT/kt-msca-plugins/assets"

# ── Sanity checks ───────────────────────────────────────────────────────
: "${ANDROID_NDK:?ANDROID_NDK must point to your NDK r26b+ install}"
: "${JAVA_HOME:?JAVA_HOME must point to a JDK 17+ install}"
[ -d "$ANDROID_NDK" ] || { echo "ANDROID_NDK=$ANDROID_NDK not a directory"; exit 1; }
[ -d "$JAVA_HOME" ]   || { echo "JAVA_HOME=$JAVA_HOME not a directory"; exit 1; }
command -v swig >/dev/null  || { echo "swig not on PATH"; exit 1; }
command -v cmake >/dev/null || { echo "cmake not on PATH"; exit 1; }

mkdir -p "$BUILD_DIR" "$SRC_DIR"
cd "$BUILD_DIR"

# ── Source fetch helpers ────────────────────────────────────────────────
fetch() {
    local url="$1" out="$2"
    if [ ! -f "$out" ]; then
        echo "==> downloading $(basename "$out")"
        curl -fsSL --retry 3 -o "$out.partial" "$url"
        mv "$out.partial" "$out"
    fi
}
extract() {
    local archive="$1" target_name="$2"
    if [ ! -d "$SRC_DIR/$target_name" ]; then
        echo "==> extracting $(basename "$archive")"
        tar -xf "$archive" -C "$SRC_DIR"
    fi
}

cd "$BUILD_DIR"
fetch "https://download.osgeo.org/gdal/${GDAL_VERSION}/gdal-${GDAL_VERSION}.tar.xz"   "gdal-${GDAL_VERSION}.tar.xz"
fetch "https://download.osgeo.org/proj/proj-${PROJ_VERSION}.tar.gz"                   "proj-${PROJ_VERSION}.tar.gz"
fetch "https://download.osgeo.org/libtiff/tiff-${TIFF_VERSION}.tar.xz"                "tiff-${TIFF_VERSION}.tar.xz"
fetch "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-${WEBP_VERSION}.tar.gz" "libwebp-${WEBP_VERSION}.tar.gz"
fetch "https://download.sourceforge.net/libpng/libpng-${PNG_VERSION}.tar.xz"          "libpng-${PNG_VERSION}.tar.xz"
fetch "https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/${JPEG_VERSION}/libjpeg-turbo-${JPEG_VERSION}.tar.gz" "libjpeg-turbo-${JPEG_VERSION}.tar.gz"
fetch "https://www.sqlite.org/2024/sqlite-autoconf-${SQLITE_VERSION}.tar.gz"          "sqlite-${SQLITE_VERSION}.tar.gz"

extract "gdal-${GDAL_VERSION}.tar.xz"          "gdal-${GDAL_VERSION}"
extract "proj-${PROJ_VERSION}.tar.gz"          "proj-${PROJ_VERSION}"
extract "tiff-${TIFF_VERSION}.tar.xz"          "tiff-${TIFF_VERSION}"
extract "libwebp-${WEBP_VERSION}.tar.gz"       "libwebp-${WEBP_VERSION}"
extract "libpng-${PNG_VERSION}.tar.xz"         "libpng-${PNG_VERSION}"
extract "libjpeg-turbo-${JPEG_VERSION}.tar.gz" "libjpeg-turbo-${JPEG_VERSION}"
extract "sqlite-${SQLITE_VERSION}.tar.gz"      "sqlite-autoconf-${SQLITE_VERSION}"

# ── Per-ABI build ───────────────────────────────────────────────────────
build_abi() {
    local ABI="$1"
    local INSTALL="$INSTALL_ROOT/$ABI"
    local TOOLCHAIN="$ANDROID_NDK/build/cmake/android.toolchain.cmake"

    case "$ABI" in
        arm64-v8a)    HOST=aarch64-linux-android ;;
        armeabi-v7a)  HOST=armv7a-linux-androideabi ;;
        x86_64)       HOST=x86_64-linux-android ;;
        *) echo "unknown ABI: $ABI"; exit 1 ;;
    esac

    mkdir -p "$INSTALL"
    echo "════════════════════════════════════════════════════════════════"
    echo "  Building for $ABI (Android API $ANDROID_API)"
    echo "════════════════════════════════════════════════════════════════"

    local CMAKE_ARGS=(
        -G Ninja
        -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN"
        -DANDROID_ABI="$ABI"
        -DANDROID_PLATFORM="android-$ANDROID_API"
        -DANDROID_STL=c++_shared
        -DCMAKE_INSTALL_PREFIX="$INSTALL"
        -DCMAKE_PREFIX_PATH="$INSTALL"
        -DCMAKE_FIND_ROOT_PATH="$INSTALL"
        -DBUILD_SHARED_LIBS=ON
        -DCMAKE_BUILD_TYPE=Release
    )

    # ── 1. zlib comes with the NDK; nothing to build.
    # ── 2. libjpeg-turbo
    if [ ! -f "$INSTALL/lib/libjpeg.so" ]; then
        echo "── libjpeg-turbo $JPEG_VERSION"
        cmake -B "build-jpeg-$ABI" -S "$SRC_DIR/libjpeg-turbo-${JPEG_VERSION}" \
            "${CMAKE_ARGS[@]}" -DENABLE_STATIC=OFF -DWITH_TURBOJPEG=OFF
        cmake --build "build-jpeg-$ABI" --target install
    fi
    # ── 3. libpng
    if [ ! -f "$INSTALL/lib/libpng16.so" ]; then
        echo "── libpng $PNG_VERSION"
        cmake -B "build-png-$ABI" -S "$SRC_DIR/libpng-${PNG_VERSION}" \
            "${CMAKE_ARGS[@]}" -DPNG_SHARED=ON -DPNG_STATIC=OFF -DPNG_TESTS=OFF
        cmake --build "build-png-$ABI" --target install
    fi
    # ── 4. libwebp
    if [ ! -f "$INSTALL/lib/libwebp.so" ]; then
        echo "── libwebp $WEBP_VERSION"
        cmake -B "build-webp-$ABI" -S "$SRC_DIR/libwebp-${WEBP_VERSION}" \
            "${CMAKE_ARGS[@]}" -DWEBP_BUILD_ANIM_UTILS=OFF \
            -DWEBP_BUILD_CWEBP=OFF -DWEBP_BUILD_DWEBP=OFF \
            -DWEBP_BUILD_GIF2WEBP=OFF -DWEBP_BUILD_IMG2WEBP=OFF \
            -DWEBP_BUILD_VWEBP=OFF -DWEBP_BUILD_WEBPINFO=OFF \
            -DWEBP_BUILD_WEBPMUX=OFF -DWEBP_BUILD_EXTRAS=OFF
        cmake --build "build-webp-$ABI" --target install
    fi
    # ── 5. libtiff
    if [ ! -f "$INSTALL/lib/libtiff.so" ]; then
        echo "── libtiff $TIFF_VERSION"
        cmake -B "build-tiff-$ABI" -S "$SRC_DIR/tiff-${TIFF_VERSION}" \
            "${CMAKE_ARGS[@]}" -Dtiff-tools=OFF -Dtiff-tests=OFF \
            -Dtiff-contrib=OFF -Dtiff-docs=OFF -Dlzma=OFF -Dzstd=OFF
        cmake --build "build-tiff-$ABI" --target install
    fi
    # ── 6. sqlite (PROJ requires it)
    if [ ! -f "$INSTALL/lib/libsqlite3.so" ]; then
        echo "── sqlite $SQLITE_VERSION"
        cmake -B "build-sqlite-$ABI" -S "$SRC_DIR/sqlite-autoconf-${SQLITE_VERSION}" \
            "${CMAKE_ARGS[@]}" || {
            # sqlite-autoconf doesn't ship CMakeLists; build with autoconf+make
            local SDIR="$SRC_DIR/sqlite-autoconf-${SQLITE_VERSION}"
            local BDIR="$BUILD_DIR/build-sqlite-$ABI"
            mkdir -p "$BDIR" && cd "$BDIR"
            local TC="$ANDROID_NDK/toolchains/llvm/prebuilt/$(uname -s | tr A-Z a-z)-x86_64"
            local CC="$TC/bin/${HOST}${ANDROID_API}-clang"
            CC="$CC" "$SDIR/configure" --host="$HOST" --prefix="$INSTALL" --disable-static
            make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu)"
            make install
            cd "$BUILD_DIR"
        }
        # If cmake worked above, install will have already run.
        if [ -d "$BUILD_DIR/build-sqlite-$ABI/CMakeFiles" ]; then
            cmake --build "$BUILD_DIR/build-sqlite-$ABI" --target install
        fi
    fi
    # ── 7. PROJ
    if [ ! -f "$INSTALL/lib/libproj.so" ]; then
        echo "── PROJ $PROJ_VERSION"
        # PROJ needs to RUN sqlite3 at build time to generate proj.db. Our
        # cross-compiled sqlite3 is an Android arm64 binary that won't
        # execute on the x86_64 host, so point PROJ at the host's sqlite3
        # binary (installed via `sudo apt install sqlite3`).
        HOST_SQLITE3="$(command -v sqlite3 || true)"
        if [ -z "$HOST_SQLITE3" ]; then
            echo "ERROR: host sqlite3 not found. Run: sudo apt install -y sqlite3"
            exit 1
        fi
        cmake -B "build-proj-$ABI" -S "$SRC_DIR/proj-${PROJ_VERSION}" \
            "${CMAKE_ARGS[@]}" -DBUILD_TESTING=OFF -DBUILD_APPS=OFF \
            -DENABLE_CURL=OFF -DENABLE_TIFF=ON \
            -DEXE_SQLITE3="$HOST_SQLITE3"
        cmake --build "build-proj-$ABI" --target install
    fi
    # ── 8. GDAL with Java bindings
    if [ ! -f "$INSTALL/lib/libgdal.so" ] || [ ! -f "$INSTALL/lib/libgdaljni.so" ]; then
        echo "── GDAL $GDAL_VERSION (with Java SWIG bindings)"
        cmake -B "build-gdal-$ABI" -S "$SRC_DIR/gdal-${GDAL_VERSION}" \
            "${CMAKE_ARGS[@]}" \
            -DBUILD_JAVA_BINDINGS=ON \
            -DBUILD_PYTHON_BINDINGS=OFF \
            -DBUILD_CSHARP_BINDINGS=OFF \
            -DBUILD_APPS=OFF \
            -DBUILD_TESTING=OFF \
            -DBUILD_DOCS=OFF \
            -DGDAL_USE_TIFF=ON \
            -DGDAL_USE_GEOTIFF_INTERNAL=ON \
            -DGDAL_USE_PNG=ON \
            -DGDAL_USE_JPEG=ON \
            -DGDAL_USE_WEBP=ON \
            -DGDAL_USE_GEOS=OFF \
            -DGDAL_USE_CURL=OFF \
            -DGDAL_USE_NETCDF=OFF \
            -DGDAL_USE_HDF5=OFF \
            -DGDAL_USE_SQLITE3=ON \
            -DOGR_BUILD_OPTIONAL_DRIVERS=OFF \
            -DGDAL_BUILD_OPTIONAL_DRIVERS=OFF \
            -DGDAL_ENABLE_DRIVER_GTIFF=ON \
            -DGDAL_ENABLE_DRIVER_MEM=ON \
            -DGDAL_ENABLE_DRIVER_VRT=ON \
            -DGDAL_ENABLE_DRIVER_HFA=ON \
            -DJAVA_HOME="$JAVA_HOME"
        cmake --build "build-gdal-$ABI" --target install
    fi

    # ── Stage outputs ──
    mkdir -p "$JNI_OUT_STANDALONE/$ABI" "$JNI_OUT_INTEGRATED/$ABI"
    # Plain .so set in $INSTALL/lib/. libsharpyuv is a libwebp 1.4 sub-library
    # that libwebp.so dlopen()s at load time — it must ship alongside.
    for SO in libgdal.so libproj.so libtiff.so libwebp.so libsharpyuv.so libpng16.so libjpeg.so libsqlite3.so; do
        if [ -f "$INSTALL/lib/$SO" ]; then
            cp -f "$INSTALL/lib/$SO" "$JNI_OUT_STANDALONE/$ABI/$SO"
            cp -f "$INSTALL/lib/$SO" "$JNI_OUT_INTEGRATED/$ABI/$SO"
        fi
    done
    # GDAL Java SWIG bindings live under $INSTALL/lib/jni/. As of GDAL 3.9 the
    # combined binding is libgdalalljni.so (gdal+ogr+osr+gdalconst in one .so).
    if [ -f "$INSTALL/lib/jni/libgdalalljni.so" ]; then
        cp -f "$INSTALL/lib/jni/libgdalalljni.so" "$JNI_OUT_STANDALONE/$ABI/libgdalalljni.so"
        cp -f "$INSTALL/lib/jni/libgdalalljni.so" "$JNI_OUT_INTEGRATED/$ABI/libgdalalljni.so"
    fi
    # NDK's c++_shared runtime
    local SYSROOT_LIB="$ANDROID_NDK/toolchains/llvm/prebuilt/$(uname -s | tr A-Z a-z)-x86_64/sysroot/usr/lib/$HOST"
    if [ -f "$SYSROOT_LIB/libc++_shared.so" ]; then
        cp -f "$SYSROOT_LIB/libc++_shared.so" "$JNI_OUT_STANDALONE/$ABI/"
        cp -f "$SYSROOT_LIB/libc++_shared.so" "$JNI_OUT_INTEGRATED/$ABI/"
    fi

    # Copy gdal.jar — NOT installed by cmake into $INSTALL; lives in the build
    # dir under swig/java/. ABI-independent, so first one we find wins.
    local JAR="$BUILD_DIR/build-gdal-$ABI/swig/java/gdal.jar"
    if [ -f "$JAR" ]; then
        mkdir -p "$LIBS_OUT_STANDALONE" "$LIBS_OUT_INTEGRATED"
        cp -f "$JAR" "$LIBS_OUT_STANDALONE/gdal.jar"
        cp -f "$JAR" "$LIBS_OUT_INTEGRATED/gdal.jar"
    fi

    # PROJ database (ABI-independent).
    local PROJ_DB
    PROJ_DB="$(find "$INSTALL/share/proj" -name 'proj.db' 2>/dev/null | head -1)"
    if [ -n "$PROJ_DB" ]; then
        mkdir -p "$ASSETS_OUT_STANDALONE/proj" "$ASSETS_OUT_INTEGRATED/proj"
        cp -f "$PROJ_DB" "$ASSETS_OUT_STANDALONE/proj/proj.db"
        cp -f "$PROJ_DB" "$ASSETS_OUT_INTEGRATED/proj/proj.db"
    fi
}

for ABI in $ABIS; do
    build_abi "$ABI"
done

echo
echo "════════════════════════════════════════════════════════════════"
echo "  GDAL Android cross-compile complete"
echo "════════════════════════════════════════════════════════════════"
echo "  Standalone:"
echo "    .so   → $JNI_OUT_STANDALONE/<abi>/"
echo "    .jar  → $LIBS_OUT_STANDALONE/gdal.jar"
echo "    proj  → $ASSETS_OUT_STANDALONE/proj/proj.db"
echo "  Integrated drop-in:"
echo "    .so   → $JNI_OUT_INTEGRATED/<abi>/"
echo "    .jar  → $LIBS_OUT_INTEGRATED/gdal.jar"
echo "    proj  → $ASSETS_OUT_INTEGRATED/proj/proj.db"
echo
echo "Next:"
echo "  • cd android && ./gradlew :app:assembleDebug"
echo "  • adb install -r app/build/outputs/apk/debug/app-debug.apk"
echo "  • adb logcat | grep RasterTilingPlugin"
