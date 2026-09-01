// ─────────────────────────────────────────────────────────────────────────────
// deal_wf_mcsa-develop/app/build.gradle.kts
//
// Final state AFTER applying the 4 raster-tiling additions on top of the
// existing 01-04-2026 PDF integration. Annotations marked  // 8.1 .. 8.4
// indicate the four new blocks introduced by the raster-tiling delta.
//
// Diff vs the client's current file (lines reference d:/desktop/HSC/hsc-gis/
// integration-main/app/build.gradle.kts):
//   8.1  defaultConfig { ndk { abiFilters … } }              → after multiDexEnabled
//   8.2  android { sourceSets { … jniLibs.srcDirs … } }      → new top-level block
//   8.3  android { packaging { jniLibs { useLegacyPackaging = false } } }
//   8.4  dependencies { implementation(files("libs/gdal.jar")) }
// ─────────────────────────────────────────────────────────────────────────────

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.kapt)
    alias(libs.plugins.hilt.android)
    id("kotlin-kapt")
}

android {
    namespace = "org.deal.mcsa"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.deal.mcsa"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
        multiDexEnabled = true

        // 8.1 ── Ship the GDAL .so libs only for the ABIs we cross-compiled
        //        for (arm64-v8a + armeabi-v7a → ~95% of devices). Add
        //        "x86_64" here only if you also need to run on the emulator;
        //        you would then need to commission Lepton to produce x86_64
        //        builds of the GDAL .so set.
        ndk {
            abiFilters.addAll(listOf("arm64-v8a", "armeabi-v7a"))
        }

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            // Disable R8 in debug to prevent plugin loading issues
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions {
        jvmTarget = "11"
    }
    buildFeatures {
        compose = true
    }

    // 8.2 ── Tell Gradle where the prebuilt GDAL .so files live. The path
    //        below is the AGP default, so this block is a safety net rather
    //        than strictly required — but stating it explicitly makes the
    //        drop-in instructions identical for any future re-organisation
    //        of source sets.
    sourceSets {
        getByName("main") {
            jniLibs.srcDirs("src/main/jniLibs")
        }
    }

    // 8.3 ── CRITICAL. Without this, AGP compresses the .so files inside
    //        the APK / AAB and the runtime System.loadLibrary("gdalalljni")
    //        in RasterTilingPlugin's static initialiser will fail with
    //        "dlopen failed: library libgdalalljni.so not found" because
    //        dlopen() needs to mmap the file directly out of the APK.
    //        useLegacyPackaging = false stores .so files uncompressed and
    //        page-aligned (the modern Android default).
    packaging {
        jniLibs {
            useLegacyPackaging = false
        }
    }
}

dependencies {
    val roomVersion = "2.6.1"

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(project(":pjsua2"))
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.constraintlayout)
    implementation(libs.androidx.lifecycle.livedata.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    implementation(libs.androidx.benchmark.common)
    implementation(libs.androidx.fragment.ktx)
    implementation("androidx.compose.material:material-icons-extended:1.7.8")
    implementation("androidx.room:room-runtime:$roomVersion")
    implementation("androidx.room:room-paging:$roomVersion")
    kapt("androidx.room:room-compiler:$roomVersion")
    implementation("androidx.room:room-ktx:$roomVersion")
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.ui.test.junit4)
    debugImplementation(libs.androidx.ui.tooling)
    debugImplementation(libs.androidx.ui.test.manifest)

    //Hilt
    implementation(libs.dagger.hilt.android)
    implementation(libs.hilt.navigation.compose)
    kapt(libs.dagger.hilt.compiler)

    // Capacitor core
    implementation(project(":capacitor-android"))

    // Capacitor plugins
    implementation(project(":capacitor-app"))
    implementation(project(":capacitor-filesystem"))
    implementation(project(":capacitor-geolocation"))
    implementation(project(":capacitor-preferences"))
    implementation(project(":capacitor-share"))
    implementation(project(":capacitor-file-picker"))

    // Cordova plugins compatibility
    implementation(project(":capacitor-cordova-android-plugins"))

    // Geolocation plugin dependencies (required for plugin to work)
    implementation("io.ionic.libs:iongeolocation-android:1.0.0")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.6.4")

    // WebView support (app already has androidx.fragment.ktx)
    implementation("androidx.webkit:webkit:1.12.1")

    // NanoHTTPD for local tile server
    implementation("org.nanohttpd:nanohttpd:2.3.1")

    // MultiDex support (required for apps with >65K methods)
    implementation("androidx.multidex:multidex:2.0.1")

    // 8.4 ── GDAL Java SWIG bindings (org.gdal.gdal.*, org.gdal.osr.*, …)
    //        backing RasterTilingPlugin. ABI-independent — single jar
    //        covers both arm64-v8a and armeabi-v7a. The matching JNI
    //        plumbing lives in src/main/jniLibs/<abi>/libgdalalljni.so
    //        and is loaded at runtime via System.loadLibrary("gdalalljni").
    implementation(files("libs/gdal.jar"))
}
