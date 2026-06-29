package org.deal.mcsa.plugins

import android.graphics.Bitmap
import android.os.Build
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.deal.mcsa.utility.UserPreferencesManager
import org.gdal.gdal.Dataset
import org.gdal.gdal.WarpOptions
import org.gdal.gdal.gdal
import org.gdal.gdalconst.gdalconstConstants
import org.gdal.osr.CoordinateTransformation
import org.gdal.osr.SpatialReference
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.util.LinkedHashMap
import java.util.Vector
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sinh

/**
 * Capacitor plugin that mirrors the Electron raster-tiling worker on Android,
 * backed by the official GDAL Java SWIG bindings (gdal.jar + libgdaljni.so).
 *
 * Per-user variant: cache + dataset registry keyed by the active username
 * from [UserPreferencesManager] so two users on the same device never see
 * each other's tiles.
 *
 * Drop-in for the integrated MCSA app. Package mirrors the existing
 * org.deal.mcsa.plugins layout. Companion init loads libgdaljni.so, which
 * dlopen()s the rest of the GDAL .so dependencies transitively.
 */
@CapacitorPlugin(name = "RasterTiling")
class RasterTilingPlugin : Plugin() {

    companion object {
        private const val TAG = "RasterTilingPlugin"
        private const val MAX_INFLIGHT_RENDERS = 4
        private const val CACHE_BUDGET_BYTES = 1L * 1024L * 1024L * 1024L // 1 GB
        private const val WRITES_BETWEEN_BUDGET_CHECKS = 200
        private const val TILE_SIZE = 256
        private const val TILE_BASE_URL = "http://localhost:8080"
        /** sampleAt() dataset LRU cap; tile rendering still opens per-tile handles. */
        private const val SAMPLE_DATASET_CACHE_CAP = 12

        // OGR axis mapping strategy. From ogr_srs_api.h:
        //   OAMS_TRADITIONAL_GIS_ORDER = 0   (x = lon/easting, y = lat/northing)
        //   OAMS_AUTHORITY_COMPLIANT   = 1
        //   OAMS_CUSTOM                = 2
        // Hardcoding the integer instead of importing osr.OAMS_* avoids the
        // SWIG-binding-version drift we hit on Electron with axis order.
        private const val OAMS_TRADITIONAL_GIS_ORDER = 0

        init {
            // libgdalalljni.so is the SWIG-generated combined binding
            // (gdal + ogr + osr + gdalconst in one .so). It depends on
            // libgdal.so, libproj.so, libtiff.so, libwebp.so, libpng16.so,
            // libjpeg.so, libsqlite3.so, libc++_shared.so — Android's loader
            // resolves those transitively from the same jniLibs dir.
            System.loadLibrary("gdalalljni")
        }
    }

    // ── Concurrency primitives (mirror Electron worker-client.ts caps) ──
    private val renderSlots = Semaphore(MAX_INFLIGHT_RENDERS)
    private val inflight = ConcurrentHashMap<String, Deferred<ByteArray?>>()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val writeCounter = AtomicInteger(0)

    /** registryKey → absolute path. Each render opens its own Dataset from
     *  this path to avoid shared-Dataset use-after-close + libtiff strip-
     *  cache contention across threads.
     *  registryKey = "<username>|<layerId>" so multi-user devices keep their
     *  per-user dataset registries isolated. */
    private val layerPaths = ConcurrentHashMap<String, String>()

    /**
     * registryKey -> [lo, hi] stretch range. Computed ONCE in registerLayer
     * so every tile of a given layer renders with the same colour mapping.
     * Without this, concurrent tiles race on the Band's PAM stats and end
     * up with slightly-different ranges → visible tile-boundary lines and
     * wrong-end-of-LUT colour patches.
     */
    private val layerStats = ConcurrentHashMap<String, DoubleArray>()

    private val sampleDsLock = Any()
    private val sampleDatasetByKey = LinkedHashMap<String, Dataset>(32, 0.75f, true)

    private fun removeSampleDsLocked(registryKey: String) {
        sampleDatasetByKey.remove(registryKey)?.let { ds ->
            try {
                ds.delete()
            } catch (_: Throwable) {
            }
        }
    }

    private fun evictOldestSampleDsLocked() {
        val it = sampleDatasetByKey.entries.iterator()
        if (!it.hasNext()) return
        val (_, ds) = it.next()
        it.remove()
        try {
            ds.delete()
        } catch (_: Throwable) {
        }
    }

    private fun clearSampleDsLocked() {
        for (ds in sampleDatasetByKey.values) {
            try {
                ds.delete()
            } catch (_: Throwable) {
            }
        }
        sampleDatasetByKey.clear()
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    override fun load() {
        super.load()
        try {
            copyProjDbIfMissing()
            gdal.AllRegister()
            // Quiet the default GDAL stderr handler — we'd rather see errors
            // surface as failed tile responses than spam Logcat with CPL_DEBUG.
            gdal.PushErrorHandler("CPLQuietErrorHandler")
            gdal.SetConfigOption(
                "PROJ_LIB",
                File(context.filesDir, "proj").absolutePath,
            )
            // Hand the offline tile server our raster-tile callback so
            // /layers/<id>/{z}/{x}/{y}.webp routes back into this plugin.
            OfflineTileServerPlugin.registerRasterTileProvider(::serveTile)
            Log.d(
                TAG,
                "GDAL ${gdal.VersionInfo("RELEASE_NAME")} registered, " +
                    "PROJ_LIB=${File(context.filesDir, "proj").absolutePath}",
            )
        } catch (t: Throwable) {
            Log.e(TAG, "RasterTiling load() failed", t)
        }
    }

    // ── PluginMethods ────────────────────────────────────────────────────

    @PluginMethod
    fun probe(call: PluginCall) {
        val path = call.getString("path")
        if (path.isNullOrBlank()) {
            call.reject("path is required")
            return
        }
        scope.runBlockingReply(call) {
            val ds = gdal.Open(path, gdalconstConstants.GA_ReadOnly)
                ?: error("GDAL Open failed for $path: ${gdal.GetLastErrorMsg()}")
            try {
                probeDataset(ds, path)
            } finally {
                ds.delete()
            }
        }
    }

    @PluginMethod
    fun buildOverviews(call: PluginCall) {
        val path = call.getString("path")
        if (path.isNullOrBlank()) {
            call.reject("path is required")
            return
        }
        scope.runBlockingReply(call) { buildOverviewsImpl(path) }
    }

    @PluginMethod
    fun registerLayer(call: PluginCall) {
        val layerId = call.getString("layerId")
        val path = call.getString("path")
        if (layerId.isNullOrBlank() || path.isNullOrBlank()) {
            call.reject("layerId and path are required")
            return
        }
        // Dispatch to IO scope — gdal.Open + ComputeRasterMinMax can take
        // seconds on large rasters, and registerLayer is invoked by Capacitor
        // on the main thread. Without this hop we hit Android's ANR watchdog.
        scope.runBlockingReply(call) {
            registerLayerImpl(layerId, path)
        }
    }

    private fun registerLayerImpl(layerId: String, path: String): JSObject {
        val key = keyFor(layerId)
        // Open once just to validate + compute stats. Don't cache the Dataset;
        // every render opens its own to avoid cross-thread use-after-close.
        val ds = gdal.Open(path, gdalconstConstants.GA_ReadOnly)
            ?: throw RuntimeException("Open failed: ${gdal.GetLastErrorMsg()}")
        synchronized(sampleDsLock) {
            removeSampleDsLocked(key)
        }
        layerPaths[key] = path

        // Pre-compute the value range ONCE for float/int sources so every
        // tile of this layer renders with the same colour mapping.
        //
        // approxOK=1 reads from the smallest overview (built during upload)
        // — fast and low-memory. approxOK=0 reads the WHOLE raster which
        // OOMs on multi-GB files. ComputeRasterMinMax always recomputes
        // (never reads cached PAM stats), so approxOK=1 is safe wrt NoData.
        try {
            val b = ds.GetRasterBand(1)
            val dt = b.GetRasterDataType()
            val isFloatish = dt != gdalconstConstants.GDT_Byte && b.GetColorTable() == null
            if (isFloatish) {
                val nd = readNoData(b)
                // 1. ComputeStatistics(approxOK=true) — NoData-aware.
                // 2. ComputeRasterMinMax(approxOK=1) — fallback.
                // 3. Reject NoData-polluted results outright (better to
                //    fall back to per-call recompute than colour wrongly).
                val sMin = doubleArrayOf(0.0)
                val sMax = doubleArrayOf(0.0)
                val sMean = doubleArrayOf(0.0)
                val sStd = doubleArrayOf(0.0)
                val rc = b.ComputeStatistics(true, sMin, sMax, sMean, sStd)
                val ok = rc == gdalconstConstants.CE_None &&
                    sMax[0] > sMin[0] &&
                    (nd == null || (sMin[0] != nd && sMax[0] != nd))
                if (ok) {
                    layerStats[key] = doubleArrayOf(sMin[0], sMax[0])
                    Log.d(TAG, "registerLayer $key range=[${sMin[0]}, ${sMax[0]}] " +
                            "(ComputeStatistics) noData=$nd")
                } else {
                    val mm = doubleArrayOf(0.0, 0.0)
                    try { b.ComputeRasterMinMax(mm, 1) } catch (_: Throwable) {}
                    if (mm[1] > mm[0] && (nd == null || (mm[0] != nd && mm[1] != nd))) {
                        layerStats[key] = doubleArrayOf(mm[0], mm[1])
                        Log.d(TAG, "registerLayer $key range=[${mm[0]}, ${mm[1]}] " +
                                "(ComputeRasterMinMax) noData=$nd")
                    } else {
                        // Manual histogram fallback: read smallest overview,
                        // walk pixels skipping NoData. Used when GDAL's stats
                        // are polluted by PAM cache.
                        val manual = computeRangeManually(b, nd)
                        if (manual != null) {
                            layerStats[key] = manual
                            Log.d(TAG, "registerLayer $key range=[${manual[0]}, ${manual[1]}] " +
                                    "(manual histogram) noData=$nd")
                        } else {
                            Log.e(TAG, "registerLayer $key stats unusable: " +
                                    "ComputeStatistics rc=$rc min=${sMin[0]} max=${sMax[0]}; " +
                                    "ComputeRasterMinMax min=${mm[0]} max=${mm[1]} " +
                                    "noData=$nd — tiles will use [0,255]")
                        }
                    }
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "stats precompute failed for $key — will fall back to per-call", t)
        } finally {
            try { ds.delete() } catch (_: Throwable) {}
        }

        return JSObject().apply { put("ok", true) }
    }

    /**
     * Manual min/max scan of a downsampled view of the band, ignoring
     * NoData and non-finite values. Last-resort fallback when GDAL's stats
     * functions return PAM-cached polluted values. Returns null on failure.
     */
    private fun computeRangeManually(b: org.gdal.gdal.Band, noData: Double?): DoubleArray? {
        val ovrCount = b.GetOverviewCount()
        val scanBand = if (ovrCount > 0) b.GetOverview(ovrCount - 1) else b
        val w = minOf(scanBand.GetXSize(), 1024)
        val h = minOf(scanBand.GetYSize(), 1024)
        if (w <= 0 || h <= 0) return null
        val buf: FloatArray = try {
            val tmp = FloatArray(w * h)
            val rc = scanBand.ReadRaster(
                0, 0, scanBand.GetXSize(), scanBand.GetYSize(),
                w, h, gdalconstConstants.GDT_Float32, tmp,
            )
            if (rc != gdalconstConstants.CE_None) {
                val full = FloatArray(scanBand.GetXSize() * scanBand.GetYSize())
                scanBand.ReadRaster(
                    0, 0, scanBand.GetXSize(), scanBand.GetYSize(),
                    gdalconstConstants.GDT_Float32, full,
                )
                full
            } else tmp
        } catch (_: Throwable) {
            return null
        }
        var lo = Double.POSITIVE_INFINITY
        var hi = Double.NEGATIVE_INFINITY
        for (fv in buf) {
            if (fv.isNaN() || fv.isInfinite()) continue
            val v = fv.toDouble()
            if (noData != null && v == noData) continue
            if (v < lo) lo = v
            if (v > hi) hi = v
        }
        return if (lo == Double.POSITIVE_INFINITY || hi <= lo) null
               else doubleArrayOf(lo, hi)
    }

    @PluginMethod
    fun unregisterLayer(call: PluginCall) {
        val layerId = call.getString("layerId")
        if (layerId.isNullOrBlank()) {
            call.reject("layerId is required")
            return
        }
        val key = keyFor(layerId)
        synchronized(sampleDsLock) {
            removeSampleDsLocked(key)
        }
        layerPaths.remove(key)
        layerStats.remove(key)
        // Sweep on-disk tile cache for this layer.
        try {
            cacheDir(layerId).deleteRecursively()
        } catch (t: Throwable) {
            Log.w(TAG, "unregisterLayer cache sweep failed", t)
        }
        val ret = JSObject().apply { put("ok", true) }
        call.resolve(ret)
    }

    @PluginMethod
    fun sampleAt(call: PluginCall) {
        val layerId = call.getString("layerId")
        val lon = call.getDouble("lon")
        val lat = call.getDouble("lat")
        if (layerId.isNullOrBlank() || lon == null || lat == null) {
            call.reject("layerId, lon, lat required")
            return
        }
        scope.runBlockingReply(call) {
            sampleAtImpl(layerId, lon, lat)
        }
    }

    @PluginMethod
    fun getTileBaseUrl(call: PluginCall) {
        val ret = JSObject().apply { put("baseUrl", TILE_BASE_URL) }
        call.resolve(ret)
    }

    @PluginMethod
    fun closeAll(call: PluginCall) {
        synchronized(sampleDsLock) {
            clearSampleDsLocked()
        }
        layerPaths.clear()
        layerStats.clear()
        // Sweep the current user's on-disk tile cache. closeAll is only
        // invoked by the user-initiated "Delete Session" flush, so wiping
        // every layer's cache here matches the nuke-everything semantics.
        // Stay scoped to currentUser() so other users on the same device
        // keep their caches.
        try {
            val root = File(context.getExternalFilesDir(null), "HSC-TILES")
            File(root, currentUser()).deleteRecursively()
        } catch (t: Throwable) {
            Log.w(TAG, "closeAll cache sweep failed", t)
        }
        val ret = JSObject().apply { put("closed", true) }
        call.resolve(ret)
    }

    // ── Tile serving (called from OfflineTileServer's NanoHTTPD route) ───

    /**
     * Returns the WebP bytes for /layers/<layerId>/<z>/<x>/<y>.webp, or null
     * if the layer isn't registered or we hit an unrecoverable error.
     * Disk cache → in-flight dedup → 4-slot semaphore → GDAL Warp + WebP.
     */
    private fun serveTile(layerId: String, z: Int, x: Int, y: Int): ByteArray? {
        val key = keyFor(layerId)
        val cached = readDiskCache(layerId, z, x, y)
        if (cached != null) return cached

        val dedupKey = "$key|$z/$x/$y"
        val deferred = inflight.computeIfAbsent(dedupKey) {
            scope.async {
                try {
                    renderSlots.withPermit {
                        val rgba = renderTileRgba(key, z, x, y)
                            ?: return@withPermit null
                        val webp = encodeWebpLossless(rgba, TILE_SIZE, TILE_SIZE)
                        writeDiskCache(layerId, z, x, y, webp)
                        if (writeCounter.incrementAndGet() % WRITES_BETWEEN_BUDGET_CHECKS == 0) {
                            enforceCacheBudget()
                        }
                        webp
                    }
                } catch (t: Throwable) {
                    Log.e(TAG, "renderTile $layerId/$z/$x/$y failed", t)
                    null
                } finally {
                    inflight.remove(dedupKey)
                }
            }
        }
        return runBlocking { deferred.await() }
    }

    /**
     * GDAL warp pipeline. Each render opens its own Dataset and closes it
     * before returning — see Java twin for rationale (use-after-close +
     * libtiff strip-cache races on shared Dataset handles).
     */
    private fun renderTileRgba(registryKey: String, z: Int, x: Int, y: Int): ByteArray? {
        val path = layerPaths[registryKey] ?: return null
        val src = gdal.Open(path, gdalconstConstants.GA_ReadOnly) ?: return null
        try {
            return renderTileRgbaWithSrc(registryKey, src, z, x, y)
        } finally {
            try { src.delete() } catch (_: Throwable) {}
        }
    }

    private fun renderTileRgbaWithSrc(
        registryKey: String, src: Dataset, z: Int, x: Int, y: Int,
    ): ByteArray? {
        val (minX, minY, maxX, maxY) = tileBounds3857(z, x, y)
        val isPalette = src.GetRasterBand(1).GetColorTable() != null

        // Palette sources: expand to RGBA via a virtual Translate so warp sees
        // a 4-band RGBA dataset and we never need to call ColorTable.GetColorEntry
        // (which returns java.awt.Color — not available on Android).
        var translateOut: Dataset? = null
        var translatePath: String? = null
        val warpInput: Dataset = if (isPalette) {
            translatePath = "/vsimem/expand_${Thread.currentThread().id}_${System.nanoTime()}.vrt"
            val tArgs = Vector<String>().apply {
                addAll(listOf("-of", "VRT", "-expand", "rgba"))
            }
            val expanded = gdal.Translate(translatePath, src, org.gdal.gdal.TranslateOptions(tArgs))
                ?: run {
                    Log.w(TAG, "Translate(-expand rgba) returned null: ${gdal.GetLastErrorMsg()}")
                    return null
                }
            translateOut = expanded
            expanded
        } else src

        val resampling = if (isPalette) "near" else "bilinear"
        val vsipath = "/vsimem/warp_${Thread.currentThread().id}_${System.nanoTime()}.tif"
        val warpArgs = Vector<String>().apply {
            addAll(
                listOf(
                    "-of", "MEM",
                    "-r", resampling,
                    "-ts", TILE_SIZE.toString(), TILE_SIZE.toString(),
                    "-te",
                    minX.toString(), minY.toString(), maxX.toString(), maxY.toString(),
                    "-t_srs", "EPSG:3857",
                    "-dstalpha",
                    "-ovr", "AUTO",
                ),
            )
        }
        // src is thread-local (per-call open) so no synchronization needed.
        val warped: Dataset = gdal.Warp(vsipath, arrayOf(warpInput), WarpOptions(warpArgs))
            ?: run {
            Log.w(TAG, "Warp returned null: ${gdal.GetLastErrorMsg()}")
            try { translateOut?.delete() } catch (_: Throwable) {}
            try { translatePath?.let { gdal.Unlink(it) } } catch (_: Throwable) {}
            return null
        }
        try {
            return composeRgbaFromWarped(registryKey, warped, isPalette, src)
        } finally {
            try { warped.delete() } catch (_: Throwable) {}
            try { gdal.Unlink(vsipath) } catch (_: Throwable) {}
            try { translateOut?.delete() } catch (_: Throwable) {}
            try { translatePath?.let { gdal.Unlink(it) } } catch (_: Throwable) {}
        }
    }

    /**
     * Reads the warped dataset's bands and produces a 256×256 RGBA8888 byte
     * buffer ready for Bitmap.compress. Branches on the *source* shape, not
     * the warp output, because -dstalpha always adds a coverage mask:
     * - palette  : src already Translate-expanded to RGBA, warp = 5 bands
     *              (R, G, B, palette-alpha, coverage)
     * - RGB byte : warp = 4 bands (R, G, B + alpha)
     * - gray byte: warp = 2 bands (gray + alpha) → replicate to RGB
     * - float DEM: warp = 2 bands (float + alpha) → linear stretch min..max → gray
     *
     * Final alpha = min(coverage, dataAlpha) so partial-coverage tile edges
     * fade properly instead of flashing opaque palette[0] black around small
     * source rasters (the ddnLCC bug fix from Electron, ported).
     */
    private fun composeRgbaFromWarped(
        registryKey: String,
        warped: Dataset,
        isPalette: Boolean,
        srcForStats: Dataset,
    ): ByteArray {
        val w = TILE_SIZE
        val h = TILE_SIZE
        val totalBands = warped.GetRasterCount()
        // -dstalpha guarantees the last band is the coverage mask.
        val alphaBandIdx = totalBands
        val mask = ByteArray(w * h)
        warped.GetRasterBand(alphaBandIdx).ReadRaster(
            0, 0, w, h, gdalconstConstants.GDT_Byte, mask,
        )

        // Classify by SOURCE shape, not warp output.
        val srcBand1 = srcForStats.GetRasterBand(1)
        val srcDtype = srcBand1.GetRasterDataType()
        val srcBandCount = srcForStats.GetRasterCount()
        val isByteRGB = !isPalette &&
            srcDtype == gdalconstConstants.GDT_Byte && srcBandCount >= 3
        val isByteGray = !isPalette &&
            srcDtype == gdalconstConstants.GDT_Byte && srcBandCount < 3

        val out = ByteArray(w * h * 4)
        when {
            isPalette -> {
                // Source was Translate-expanded to RGBA before warp, so warp
                // output has 5 bands: R, G, B, palette-alpha, coverage.
                val r = ByteArray(w * h)
                val g = ByteArray(w * h)
                val b = ByteArray(w * h)
                val pa = ByteArray(w * h)
                warped.GetRasterBand(1).ReadRaster(0, 0, w, h, gdalconstConstants.GDT_Byte, r)
                warped.GetRasterBand(2).ReadRaster(0, 0, w, h, gdalconstConstants.GDT_Byte, g)
                warped.GetRasterBand(3).ReadRaster(0, 0, w, h, gdalconstConstants.GDT_Byte, b)
                warped.GetRasterBand(4).ReadRaster(0, 0, w, h, gdalconstConstants.GDT_Byte, pa)
                for (i in 0 until w * h) {
                    val o = i * 4
                    out[o + 0] = r[i]
                    out[o + 1] = g[i]
                    out[o + 2] = b[i]
                    val coverage = mask[i].toInt() and 0xff
                    val paletteA = pa[i].toInt() and 0xff
                    out[o + 3] = min(coverage, paletteA).toByte()
                }
            }
            isByteRGB -> {
                // RGB byte source: warp output bands 1-3 are R,G,B; band 4 is mask.
                val r = ByteArray(w * h)
                val g = ByteArray(w * h)
                val b = ByteArray(w * h)
                warped.GetRasterBand(1).ReadRaster(0, 0, w, h, gdalconstConstants.GDT_Byte, r)
                warped.GetRasterBand(2).ReadRaster(0, 0, w, h, gdalconstConstants.GDT_Byte, g)
                warped.GetRasterBand(3).ReadRaster(0, 0, w, h, gdalconstConstants.GDT_Byte, b)
                for (i in 0 until w * h) {
                    val o = i * 4
                    out[o + 0] = r[i]
                    out[o + 1] = g[i]
                    out[o + 2] = b[i]
                    out[o + 3] = mask[i]
                }
            }
            isByteGray -> {
                // Single-band byte (gray) + warp mask. Replicate gray to RGB.
                val gr = ByteArray(w * h)
                warped.GetRasterBand(1).ReadRaster(
                    0, 0, w, h, gdalconstConstants.GDT_Byte, gr,
                )
                for (i in 0 until w * h) {
                    val o = i * 4
                    out[o + 0] = gr[i]
                    out[o + 1] = gr[i]
                    out[o + 2] = gr[i]
                    out[o + 3] = mask[i]
                }
            }
            else -> {
                // Float / Int DEM path: map through colour ramp (signal/RSRP
                // red-yellow-green or terrain). Mirrors Electron worker.
                val band = warped.GetRasterBand(1)
                val pixels = FloatArray(w * h)
                band.ReadRaster(
                    0, 0, w, h, gdalconstConstants.GDT_Float32, pixels,
                )
                val srcBand = srcForStats.GetRasterBand(1)
                val noData = readNoData(srcBand)
                // Use the precomputed range from registerLayer so all tiles
                // of this layer use the same colour mapping.
                val cached = layerStats[registryKey]
                var lo: Double
                var hi: Double
                if (cached != null) {
                    lo = cached[0]; hi = cached[1]
                } else {
                    // Fallback only if registerLayer's precompute didn't run.
                    // approxOK=1 to avoid OOMing on large files.
                    val mm = doubleArrayOf(0.0, 0.0)
                    try {
                        srcBand.ComputeRasterMinMax(mm, 1)
                        lo = mm[0]; hi = mm[1]
                    } catch (_: Throwable) {
                        lo = 0.0; hi = 255.0
                    }
                }
                val span = (hi - lo).takeIf { it > 0.0 } ?: 1.0
                val rampKind = pickFloatRamp(srcForStats.GetDescription(), lo, hi)
                val lut = buildFloatLut(rampKind)
                val noDataFloor = lo - 0.05 * span
                for (i in 0 until w * h) {
                    val o = i * 4
                    val v = pixels[i].toDouble()
                    val coverage = mask[i].toInt() and 0xff
                    val isNoData = (noData != null && v == noData) ||
                        v.isNaN() || v.isInfinite() || v < noDataFloor
                    if (coverage == 0 || isNoData) {
                        out[o + 0] = 0
                        out[o + 1] = 0
                        out[o + 2] = 0
                        out[o + 3] = 0
                        continue
                    }
                    val t2 = ((v - lo) / span).coerceIn(0.0, 1.0)
                    val lutIdx = min(255, (t2 * 256.0).toInt())
                    val li = lutIdx * 4
                    out[o + 0] = lut[li]
                    out[o + 1] = lut[li + 1]
                    out[o + 2] = lut[li + 2]
                    out[o + 3] = mask[i]
                }
            }
        }
        return out
    }

    private fun encodeWebpLossless(rgba: ByteArray, w: Int, h: Int): ByteArray {
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        bmp.copyPixelsFromBuffer(ByteBuffer.wrap(rgba))
        val baos = ByteArrayOutputStream(rgba.size / 8)
        val format = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
            Bitmap.CompressFormat.WEBP_LOSSLESS
        else
            @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP
        bmp.compress(format, 100, baos)
        bmp.recycle()
        return baos.toByteArray()
    }

    // ── probe / sampleAt internals ───────────────────────────────────────

    private fun probeDataset(ds: Dataset, path: String): JSObject {
        val w = ds.GetRasterXSize()
        val h = ds.GetRasterYSize()
        val bandCount = ds.GetRasterCount()
        val gt = ds.GetGeoTransform()
        val srsWkt = ds.GetProjection()
        val srs = SpatialReference()
        var sourceCrs: String? = null
        if (!srsWkt.isNullOrBlank()) {
            try {
                srs.ImportFromWkt(srsWkt)
                sourceCrs = srs.GetAuthorityCode(null)?.let {
                    "EPSG:$it"
                } ?: srsWkt
            } catch (_: Throwable) {
                sourceCrs = srsWkt
            }
        }

        val band1 = ds.GetRasterBand(1)
        val dtype = gdalDataTypeName(band1.GetRasterDataType())

        // Stats. allowApprox=1, force=1 — fast even on 1 GB BigTIFFs.
        val sMin = doubleArrayOf(0.0)
        val sMax = doubleArrayOf(0.0)
        val sMean = doubleArrayOf(0.0)
        val sStd = doubleArrayOf(0.0)
        band1.GetStatistics(1, 1, sMin, sMax, sMean, sStd)
        // NoData read for surface — composeRgbaFromWarped's DEM ramp branch
        // skips NoData pixels per-tile, which mirrors the Electron worker
        // fix for the AP_4G red/green checkerboard pollution.
        readNoData(band1) // touch to validate; result not used here directly
        val minV = sMin[0]
        val maxV = sMax[0]

        // Palette: GDAL Java SWIG's ColorTable.GetColorEntry returns
        // java.awt.Color which doesn't exist on Android, so we can't read
        // entries here. Return zero-filled length-only palette so the
        // renderer's layer-type heuristic still treats the layer as
        // palette-typed; entries themselves are unused for tiled rasters.
        val ct = band1.GetColorTable()
        val palette = if (ct != null) {
            val arr = JSArray()
            for (i in 0 until ct.GetCount()) {
                val rgba = JSArray().apply {
                    put(0); put(0); put(0); put(0)
                }
                arr.put(rgba)
            }
            arr
        } else null

        // Bounds in WGS84.
        val boundsWgs84 = computeWgs84Bounds(gt, w, h, srs)

        // Pixel size + native zoom: replicate Electron's heuristic.
        val pixelSize = kotlin.math.abs(gt[1])
        val nativeZoom = estimateNativeZoom(pixelSize)

        return JSObject().apply {
            put("width", w)
            put("height", h)
            put("bands", bandCount)
            put("dtype", dtype)
            put("sourceCrs", sourceCrs)
            if (boundsWgs84 != null) {
                val arr = JSArray().apply {
                    for (v in boundsWgs84) put(v)
                }
                put("boundsWgs84", arr)
            } else {
                put("boundsWgs84", JSObject.NULL)
            }
            if (palette != null) put("palette", palette) else put("palette", JSObject.NULL)
            put("min", minV)
            put("max", maxV)
            put("pixelSize", pixelSize)
            put("nativeZoom", nativeZoom)
            put("colorInterp", colorInterpName(band1.GetRasterColorInterpretation()))
        }
    }

    private fun buildOverviewsImpl(path: String): JSObject {
        val ds = gdal.Open(path, gdalconstConstants.GA_Update)
            ?: gdal.Open(path, gdalconstConstants.GA_ReadOnly)
            ?: error("Open failed: ${gdal.GetLastErrorMsg()}")
        try {
            val w = ds.GetRasterXSize()
            val h = ds.GetRasterYSize()
            val band1 = ds.GetRasterBand(1)
            val isPalette = band1.GetColorTable() != null
            val tooSmall = max(w, h) < 4096
            val existing = band1.GetOverviewCount()

            if (tooSmall) {
                return JSObject().apply {
                    put("built", false); put("reason", "too-small")
                    put("width", w); put("height", h)
                }
            }
            if (existing > 0) {
                return JSObject().apply {
                    put("built", false); put("reason", "already-exists")
                    put("count", existing); put("width", w); put("height", h)
                }
            }

            val resampling = if (isPalette) "NEAREST" else "AVERAGE"
            val levels = intArrayOf(2, 4, 8, 16, 32)
            val rc = ds.BuildOverviews(resampling, levels)
            if (rc != gdalconstConstants.CE_None) {
                error("BuildOverviews failed: ${gdal.GetLastErrorMsg()}")
            }
            return JSObject().apply {
                put("built", true)
                put("kind", resampling.lowercase())
                val arr = JSArray().apply { for (l in levels) put(l) }
                put("levels", arr)
                put("count", levels.size)
                put("width", w); put("height", h)
            }
        } finally {
            ds.delete()
        }
    }

    private fun sampleAtImpl(layerId: String, lon: Double, lat: Double): JSObject {
        val key = keyFor(layerId)
        synchronized(sampleDsLock) {
            val path = layerPaths[key] ?: return JSObject().apply {
                put("value", JSObject.NULL)
                put("dtype", "")
            }
            var ds = sampleDatasetByKey[key]
            if (ds != null) {
                try {
                    return sampleAtImplWithDs(ds, lon, lat)
                } catch (t: Throwable) {
                    Log.w(TAG, "sampleAt cached dataset invalid, reopening", t)
                    removeSampleDsLocked(key)
                }
            }
            while (sampleDatasetByKey.size >= SAMPLE_DATASET_CACHE_CAP) {
                evictOldestSampleDsLocked()
            }
            ds = gdal.Open(path, gdalconstConstants.GA_ReadOnly)
                ?: return JSObject().apply {
                    put("value", JSObject.NULL)
                    put("dtype", "")
                }
            sampleDatasetByKey[key] = ds
            return sampleAtImplWithDs(ds, lon, lat)
        }
    }

    private fun sampleAtImplWithDs(ds: Dataset, lon: Double, lat: Double): JSObject {
        val srsWkt = ds.GetProjection()
        val gt = ds.GetGeoTransform()
        val band = ds.GetRasterBand(1)
        val dtype = gdalDataTypeName(band.GetRasterDataType())

        // WGS84 → source CRS. SWIG's CoordinateTransformation honours the
        // PROJ axis-mapping; for projected sources we pass (lon, lat); for
        // geographic sources we still pass (lon, lat) because OSR's default
        // mapping after IsProjected() returns 1 is X=easting, Y=northing.
        val src = SpatialReference()
        src.ImportFromWkt(srsWkt ?: "")
        // Force traditional GIS axis order so we can always pass (x=lon, y=lat).
        try {
            src.SetAxisMappingStrategy(OAMS_TRADITIONAL_GIS_ORDER)
        } catch (_: Throwable) { /* older PROJ may not expose this */ }
        val wgs84 = SpatialReference().apply {
            ImportFromEPSG(4326)
            try { SetAxisMappingStrategy(OAMS_TRADITIONAL_GIS_ORDER) } catch (_: Throwable) {}
        }
        val tx = CoordinateTransformation(wgs84, src)
        val pt = tx.TransformPoint(lon, lat)
        val sx = pt[0]
        val sy = pt[1]

        // Inverse geo-transform.
        val det = gt[1] * gt[5] - gt[2] * gt[4]
        if (det == 0.0) return JSObject().apply {
            put("value", JSObject.NULL); put("dtype", dtype)
        }
        val px = ((gt[5] * (sx - gt[0]) - gt[2] * (sy - gt[3])) / det).toInt()
        val py = ((-gt[4] * (sx - gt[0]) + gt[1] * (sy - gt[3])) / det).toInt()
        if (px < 0 || py < 0 || px >= ds.GetRasterXSize() || py >= ds.GetRasterYSize()) {
            return JSObject().apply { put("value", JSObject.NULL); put("dtype", dtype) }
        }

        val readType = band.GetRasterDataType()
        val value: Double? = when (readType) {
            gdalconstConstants.GDT_Byte, gdalconstConstants.GDT_UInt16,
            gdalconstConstants.GDT_Int16, gdalconstConstants.GDT_UInt32,
            gdalconstConstants.GDT_Int32 -> {
                val buf = IntArray(1)
                band.ReadRaster(px, py, 1, 1, gdalconstConstants.GDT_Int32, buf)
                buf[0].toDouble()
            }
            else -> {
                val buf = FloatArray(1)
                band.ReadRaster(px, py, 1, 1, gdalconstConstants.GDT_Float32, buf)
                buf[0].toDouble()
            }
        }
        val nd = readNoData(band)
        val finalVal: Any? = if (value != null && nd != null && value == nd) null else value

        return JSObject().apply {
            put("value", finalVal ?: JSObject.NULL)
            put("dtype", dtype)
        }
    }

    // ── Per-user namespacing ─────────────────────────────────────────────

    private fun currentUser(): String =
        UserPreferencesManager.getUsername(context)
            ?.takeIf { it.isNotBlank() }
            ?.let { sanitizeForPath(it) }
            ?: "_default"

    private fun keyFor(layerId: String) = "${currentUser()}|$layerId"

    private fun cacheDir(layerId: String): File {
        val root = File(context.getExternalFilesDir(null), "HSC-TILES")
        val userRoot = File(root, currentUser())
        return File(userRoot, layerId).apply { mkdirs() }
    }

    private fun sanitizeForPath(s: String): String =
        s.replace(Regex("[^A-Za-z0-9._-]"), "_")

    // ── Disk cache ───────────────────────────────────────────────────────

    private fun tileFile(layerId: String, z: Int, x: Int, y: Int): File =
        File(cacheDir(layerId), "$z/$x/$y.webp").apply {
            parentFile?.mkdirs()
        }

    private fun readDiskCache(layerId: String, z: Int, x: Int, y: Int): ByteArray? {
        val f = tileFile(layerId, z, x, y)
        return if (f.exists() && f.isFile) {
            try {
                val bytes = f.readBytes()
                f.setLastModified(System.currentTimeMillis()) // touch for LRU
                bytes
            } catch (_: Throwable) {
                null
            }
        } else null
    }

    private fun writeDiskCache(layerId: String, z: Int, x: Int, y: Int, bytes: ByteArray) {
        try {
            tileFile(layerId, z, x, y).writeBytes(bytes)
        } catch (t: Throwable) {
            Log.w(TAG, "tile cache write failed", t)
        }
    }

    /**
     * Walk every layer's cache dir, total bytes, and if over budget delete
     * oldest-mtime files first until under. Cheap enough at the 1-in-200
     * rate we run it.
     */
    private fun enforceCacheBudget() {
        val root = File(context.getExternalFilesDir(null), "HSC-TILES")
        if (!root.exists()) return
        val files = root.walkTopDown()
            .filter { it.isFile && (it.name.endsWith(".webp") || it.name.endsWith(".png")) }
            .toList()
        val total = files.sumOf { it.length() }
        if (total <= CACHE_BUDGET_BYTES) return
        val sorted = files.sortedBy { it.lastModified() }
        var freed = 0L
        for (f in sorted) {
            if (total - freed <= CACHE_BUDGET_BYTES) break
            val sz = f.length()
            if (f.delete()) freed += sz
        }
    }

    // ── proj.db bootstrap ────────────────────────────────────────────────

    private fun copyProjDbIfMissing() {
        val target = File(File(context.filesDir, "proj"), "proj.db")
        if (target.exists() && target.length() > 0) return
        target.parentFile?.mkdirs()
        try {
            context.assets.open("proj/proj.db").use { input ->
                target.outputStream().use { out -> input.copyTo(out) }
            }
        } catch (t: Throwable) {
            Log.e(TAG, "proj.db copy failed — reprojection may be unreliable", t)
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────


    private fun gdalDataTypeName(t: Int): String = when (t) {
        gdalconstConstants.GDT_Byte -> "Byte"
        gdalconstConstants.GDT_UInt16 -> "UInt16"
        gdalconstConstants.GDT_Int16 -> "Int16"
        gdalconstConstants.GDT_UInt32 -> "UInt32"
        gdalconstConstants.GDT_Int32 -> "Int32"
        gdalconstConstants.GDT_Float32 -> "Float32"
        gdalconstConstants.GDT_Float64 -> "Float64"
        else -> "Unknown"
    }

    private fun colorInterpName(c: Int): String = when (c) {
        gdalconstConstants.GCI_GrayIndex -> "Gray"
        gdalconstConstants.GCI_PaletteIndex -> "Palette"
        gdalconstConstants.GCI_RedBand -> "Red"
        gdalconstConstants.GCI_GreenBand -> "Green"
        gdalconstConstants.GCI_BlueBand -> "Blue"
        gdalconstConstants.GCI_AlphaBand -> "Alpha"
        else -> "Other"
    }

    private fun computeWgs84Bounds(
        gt: DoubleArray, w: Int, h: Int, srs: SpatialReference,
    ): DoubleArray? {
        if (gt.size < 6) return null
        val x0 = gt[0]
        val y0 = gt[3]
        val x1 = gt[0] + w * gt[1] + h * gt[2]
        val y1 = gt[3] + w * gt[4] + h * gt[5]
        val minX = min(x0, x1)
        val maxX = max(x0, x1)
        val minY = min(y0, y1)
        val maxY = max(y0, y1)

        val wgs84 = SpatialReference().apply {
            ImportFromEPSG(4326)
            try { SetAxisMappingStrategy(OAMS_TRADITIONAL_GIS_ORDER) } catch (_: Throwable) {}
        }
        try { srs.SetAxisMappingStrategy(OAMS_TRADITIONAL_GIS_ORDER) } catch (_: Throwable) {}
        val tx = CoordinateTransformation(srs, wgs84)
        return try {
            val sw = tx.TransformPoint(minX, minY)
            val ne = tx.TransformPoint(maxX, maxY)
            doubleArrayOf(
                min(sw[0], ne[0]),
                min(sw[1], ne[1]),
                max(sw[0], ne[0]),
                max(sw[1], ne[1]),
            )
        } catch (_: Throwable) {
            null
        }
    }

    /**
     * Pick a colour ramp ("signal" or "dem") from filename hints + value
     * range. Mirrors electron/tiling/worker.cjs#pickFloatRamp.
     */
    private fun pickFloatRamp(fileName: String?, min: Double, max: Double): String {
        val n = (fileName ?: "").lowercase()
        if (Regex("rsrp|rssi|sinr|rsrq|servingss|bestserver|gsm|lte|4g|5g").containsMatchIn(n)) {
            return "signal"
        }
        if (min < -30 && max < 10 && min > -200) return "signal"
        return "dem"
    }

    /**
     * Build a 256×4 RGBA LUT for the named ramp. Mirrors
     * electron/tiling/worker.cjs#buildFloatLut.
     */
    private fun buildFloatLut(kind: String): ByteArray {
        val stops: Array<DoubleArray> = if (kind == "signal") {
            arrayOf(
                doubleArrayOf(0.0, 165.0, 0.0, 38.0),
                doubleArrayOf(0.2, 215.0, 48.0, 39.0),
                doubleArrayOf(0.4, 244.0, 109.0, 67.0),
                doubleArrayOf(0.5, 253.0, 174.0, 97.0),
                doubleArrayOf(0.6, 254.0, 224.0, 139.0),
                doubleArrayOf(0.7, 217.0, 239.0, 139.0),
                doubleArrayOf(0.8, 166.0, 217.0, 106.0),
                doubleArrayOf(0.9, 102.0, 189.0, 99.0),
                doubleArrayOf(1.0, 26.0, 152.0, 80.0),
            )
        } else {
            arrayOf(
                doubleArrayOf(0.0, 3.0, 71.0, 117.0),
                doubleArrayOf(0.05, 16.0, 132.0, 169.0),
                doubleArrayOf(0.1, 80.0, 158.0, 47.0),
                doubleArrayOf(0.3, 165.0, 192.0, 64.0),
                doubleArrayOf(0.5, 217.0, 191.0, 121.0),
                doubleArrayOf(0.7, 171.0, 124.0, 68.0),
                doubleArrayOf(0.85, 122.0, 86.0, 58.0),
                doubleArrayOf(1.0, 255.0, 255.0, 255.0),
            )
        }
        val lut = ByteArray(256 * 4)
        for (i in 0 until 256) {
            val t = i / 255.0
            var s0 = stops[0]
            var s1 = stops[stops.size - 1]
            for (k in 1 until stops.size) {
                if (stops[k][0] >= t) {
                    s0 = stops[k - 1]
                    s1 = stops[k]
                    break
                }
            }
            val span = (s1[0] - s0[0]).takeIf { it != 0.0 } ?: 1.0
            val f = (t - s0[0]) / span
            val li = i * 4
            lut[li]     = (s0[1] + (s1[1] - s0[1]) * f).toInt().toByte()
            lut[li + 1] = (s0[2] + (s1[2] - s0[2]) * f).toInt().toByte()
            lut[li + 2] = (s0[3] + (s1[3] - s0[3]) * f).toInt().toByte()
            lut[li + 3] = 255.toByte()
        }
        return lut
    }

    private fun estimateNativeZoom(pixelSizeDegOrM: Double): Int {
        // Web Mercator at zoom z has ~ 156543 / 2^z metres per pixel at the
        // equator. If the source pixel size is in degrees, convert (≈ 111320 m/deg
        // at the equator). We use a coarse heuristic — same as Electron worker.
        val px = if (pixelSizeDegOrM < 0.01) pixelSizeDegOrM * 111320.0 else pixelSizeDegOrM
        if (px <= 0.0) return 13
        val z = ln(156543.03392 / px) / ln(2.0)
        return z.toInt().coerceIn(0, 22)
    }

    private fun tileBounds3857(z: Int, x: Int, y: Int): DoubleArray {
        // Standard XYZ → EPSG:3857 metre bounds.
        val n = 1L shl z
        fun lon(xt: Long): Double = xt.toDouble() / n.toDouble() * 360.0 - 180.0
        fun lat(yt: Long): Double {
            val m = PI - 2.0 * PI * yt.toDouble() / n.toDouble()
            return Math.toDegrees(atan(sinh(m)))
        }
        val w = lon(x.toLong())
        val e = lon(x.toLong() + 1)
        val nLat = lat(y.toLong())
        val sLat = lat(y.toLong() + 1)
        // Convert to Web Mercator metres.
        val r = 6378137.0
        fun toMercX(lonDeg: Double) = lonDeg * PI / 180.0 * r
        fun toMercY(latDeg: Double): Double {
            val rad = latDeg * PI / 180.0
            return r * ln(kotlin.math.tan(PI / 4.0 + rad / 2.0))
        }
        return doubleArrayOf(toMercX(w), toMercY(sLat), toMercX(e), toMercY(nLat))
    }

    /**
     * Read GDAL Band NoData value. SWIG generates `Band.GetNoDataValue(Double[])`
     * as an out-parameter setter — fills `val[0]` with the boxed Double or
     * leaves it null if the band has no NoData declared. Returns null on any
     * failure (older binding versions occasionally throw on unset bands).
     */
    private fun readNoData(band: org.gdal.gdal.Band): Double? = try {
        val out = arrayOfNulls<Double>(1)
        band.GetNoDataValue(out)
        out[0]
    } catch (_: Throwable) {
        null
    }

    /**
     * Helper: dispatch [block] to the IO scope, resolve/reject the PluginCall
     * when it finishes. Capacitor accepts resolve/reject from any thread, so
     * no UI-thread post is needed.
     */
    private fun CoroutineScope.runBlockingReply(
        call: PluginCall,
        block: suspend () -> JSObject,
    ) {
        launch {
            try {
                call.resolve(block())
            } catch (e: Throwable) {
                Log.e(TAG, "PluginMethod failed", e)
                // PluginCall.reject(String, Exception) doesn't accept Throwable
                // (Errors like OutOfMemoryError fall through). Narrow first;
                // for non-Exception Throwables, fall back to the message-only
                // overload so we still surface a useful error to JS.
                val msg = e.message ?: e.javaClass.simpleName
                if (e is Exception) call.reject(msg, e) else call.reject(msg)
            }
        }
    }
}
