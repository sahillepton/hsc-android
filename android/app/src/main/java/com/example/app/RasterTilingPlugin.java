package com.example.app;

import android.graphics.Bitmap;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.gdal.gdal.Band;
import org.gdal.gdal.ColorTable;
import org.gdal.gdal.Dataset;
import org.gdal.gdal.WarpOptions;
import org.gdal.gdal.gdal;
import org.gdal.gdalconst.gdalconstConstants;
import org.gdal.osr.CoordinateTransformation;
import org.gdal.osr.SpatialReference;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Vector;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Capacitor plugin that mirrors the Electron raster-tiling worker on Android,
 * backed by the official GDAL Java SWIG bindings (gdal.jar + libgdaljni.so).
 * <p>
 * Standalone variant for the single-user device build (com.example.app).
 * Cache + dataset registry are NOT user-namespaced — the integrated MCSA
 * variant under kt-msca-plugins/ adds that layer.
 * <p>
 * Static initialiser loads libgdaljni.so, which dlopen()s the rest of the
 * GDAL .so dependencies transitively. Companion init in OfflineTileServer
 * receives our raster-tile callback so /layers/&lt;id&gt;/{z}/{x}/{y}.webp
 * routes back into this plugin.
 */
@CapacitorPlugin(name = "RasterTiling")
public class RasterTilingPlugin extends Plugin {

    private static final String TAG = "RasterTilingPlugin";
    /**
     * Concurrent tile-render slots. Bumped from 4 to 8 to better
     * saturate modern 8-core tablet CPUs (Snapdragon 7+ Gen 3 / 8 Gen 1+).
     * Each tile render is CPU-bound (LZW decode + GDAL Warp + WebP
     * encode), takes ~200-500 ms; with 4 slots, panning into a fresh
     * area with 16 visible tiles meant 4 batches × 300 ms = ~1.2 s of
     * wait. With 8 slots, ~600 ms.
     *
     * Memory cost: each in-flight render holds one Dataset handle +
     * scratch buffers (~5-30 MB). 8 concurrent ≈ 50-250 MB peak,
     * comfortably within the typical 8 GB RAM tablet budget.
     */
    private static final int MAX_INFLIGHT_RENDERS = 8;
    private static final long CACHE_BUDGET_BYTES = 1024L * 1024L * 1024L; // 1 GB
    private static final int WRITES_BETWEEN_BUDGET_CHECKS = 200;
    private static final int TILE_SIZE = 256;
    private static final String TILE_BASE_URL = "http://localhost:8080";
    /** Max open datasets kept for sampleAt() only (tiles still open per-render).
     *  Bumped from 12 to 256 to handle large session uploads (e.g. 150+
     *  small TIFFs). With cap=12, every tap on a fresh layer was a cache
     *  miss → gdal.Open() on tablet flash → ~200-500 ms latency per tap.
     *  Each cached Dataset holds one open fd + GDAL internal state
     *  (~50 KB-1 MB depending on overview chain). 256 ≈ 50 MB ceiling,
     *  comfortably below the typical 1024-fd Android per-process limit. */
    private static final int SAMPLE_DATASET_CACHE_CAP = 256;

    // From ogr_srs_api.h: OAMS_TRADITIONAL_GIS_ORDER=0 (x=lon, y=lat).
    private static final int OAMS_TRADITIONAL_GIS_ORDER = 0;

    static {
        // libgdalalljni.so is the SWIG-generated combined binding
        // (gdal + ogr + osr + gdalconst in one .so). It depends on
        // libgdal.so, libproj.so, libtiff.so, libwebp.so, libpng16.so,
        // libjpeg.so, libsqlite3.so, libc++_shared.so — Android's loader
        // resolves those transitively from the same jniLibs dir.
        System.loadLibrary("gdalalljni");
    }

    // ── Concurrency primitives (mirror Electron worker-client.ts caps) ──
    private final Semaphore renderSlots = new Semaphore(MAX_INFLIGHT_RENDERS, true);
    private final Map<String, Future<byte[]>> inflight = new ConcurrentHashMap<>();
    private final ExecutorService pool = Executors.newFixedThreadPool(MAX_INFLIGHT_RENDERS);
    private final AtomicInteger writeCounter = new AtomicInteger(0);

    /**
     * Dedicated executor for sampleAt() — completely separate from the
     * tile-render `pool` above. Without this, a tap → sampleAt would queue
     * behind any in-flight tile renders (4 concurrent, each ~200-500 ms
     * for an LZW + Warp + WebP encode). When Mapbox is fetching tiles for
     * many visible raster sources, the render pool stays busy for seconds
     * and tap latency ends up at 5-10 seconds, making the tooltip feel
     * frozen.
     *
     * Single thread is sufficient: sampleAt is a single-pixel ReadRaster,
     * sub-millisecond once the dataset is cached. Even N concurrent taps
     * across N layers would complete in milliseconds serialised.
     */
    private final ExecutorService samplePool = Executors.newSingleThreadExecutor();

    /** layerId -> absolute path. Each render opens its own Dataset from
     *  this path to avoid shared-Dataset use-after-close + libtiff strip-
     *  cache contention across threads. */
    private final Map<String, String> layerPaths = new ConcurrentHashMap<>();

    /** layerId -> [lo, hi] stretch range. Computed ONCE in registerLayer
     *  so every tile of a given layer uses the same colour mapping. Without
     *  this, concurrent tiles of the same layer compute slightly different
     *  ranges (race on the Band) and render as visible bands at tile borders. */
    private final Map<String, double[]> layerStats = new ConcurrentHashMap<>();

    /**
     * LRU (access-order) of open GDAL datasets used only by sampleAt().
     * Avoids gdal.Open + full driver setup on every tap when inspecting
     * many zip-imported rasters. Tile rendering still opens its own handles.
     *
     * Lock covers contention between samplePool (sampleAt) and `pool`
     * (register/unregister/closeAll which mutate the cache). Within
     * samplePool itself there's no contention since samplePool is
     * single-threaded.
     */
    private final Object sampleDatasetLock = new Object();
    private final LinkedHashMap<String, Dataset> sampleDatasetByLayerId =
            new LinkedHashMap<>(32, 0.75f, true);

    /**
     * Per-layer cached transformation pipeline used by sampleAt().
     * Building one of these costs an EPSG-4326 lookup + WKT parse + PROJ
     * pipeline construction — typically 50-200 ms on tablet flash on cold
     * disk. Source SRS is constant per layer, so we build once, reuse
     * forever (or until the dataset is evicted from the cache, which also
     * evicts the matching transform).
     *
     * Lifecycle is tied 1:1 with sampleDatasetByLayerId: every put/evict
     * on the dataset map MUST mirror onto sampleTxByLayerId, otherwise
     * the cached transform may reference a freed Dataset's SRS.
     */
    private final LinkedHashMap<String, CoordinateTransformation> sampleTxByLayerId =
            new LinkedHashMap<>(32, 0.75f, true);

    /** Cached dtype name per layer (constant per Dataset). Avoids
     *  re-stringifying GetRasterDataType on every sample. */
    private final Map<String, String> sampleDtypeByLayerId = new ConcurrentHashMap<>();

    // ── Lifecycle ────────────────────────────────────────────────────────

    @Override
    public void load() {
        super.load();
        try {
            copyProjDbIfMissing();
            gdal.AllRegister();
            gdal.PushErrorHandler("CPLQuietErrorHandler");
            gdal.SetConfigOption(
                    "PROJ_LIB",
                    new File(getContext().getFilesDir(), "proj").getAbsolutePath());
            // Hand the offline tile server our raster-tile callback so
            // /layers/<id>/{z}/{x}/{y}.webp routes back into this plugin.
            // Kotlin companion's @JvmStatic exposes registerRasterTileProvider as a
            // plain static method; the lambda needs (String, Integer, Integer, Integer) -> byte[].
            OfflineTileServerPlugin.registerRasterTileProvider(
                    (id, z, x, y) -> serveTile(id, z, x, y));
            Log.d(TAG, "GDAL " + gdal.VersionInfo("RELEASE_NAME") + " registered, "
                    + "PROJ_LIB=" + new File(getContext().getFilesDir(), "proj").getAbsolutePath());
        } catch (Throwable t) {
            Log.e(TAG, "RasterTiling load() failed", t);
        }
    }

    // ── PluginMethods ────────────────────────────────────────────────────

    @PluginMethod
    public void probe(PluginCall call) {
        final String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }
        replyAsync(call, () -> {
            Dataset ds = gdal.Open(path, gdalconstConstants.GA_ReadOnly);
            if (ds == null) {
                throw new IOException("GDAL Open failed for " + path
                        + ": " + gdal.GetLastErrorMsg());
            }
            try {
                return probeDataset(ds, path);
            } finally {
                try { ds.delete(); } catch (Throwable ignored) {}
            }
        });
    }

    @PluginMethod
    public void buildOverviews(PluginCall call) {
        final String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }
        replyAsync(call, () -> buildOverviewsImpl(path));
    }

    @PluginMethod
    public void registerLayer(PluginCall call) {
        final String layerId = call.getString("layerId");
        final String path = call.getString("path");
        if (layerId == null || layerId.isEmpty() || path == null || path.isEmpty()) {
            call.reject("layerId and path are required");
            return;
        }
        // Dispatch to thread pool — gdal.Open + ComputeRasterMinMax can take
        // seconds on large rasters, and registerLayer is invoked by Capacitor
        // on the main thread. Without this hop we hit Android's ANR watchdog
        // and the app gets killed.
        replyAsync(call, () -> registerLayerImpl(layerId, path));
    }

    private JSObject registerLayerImpl(String layerId, String path) throws Exception {
        // Open once just to validate the file + compute stats. We DON'T
        // cache the Dataset — every render opens its own (see renderTileRgba)
        // to avoid use-after-close races and libtiff strip-cache contention.
        Dataset ds = gdal.Open(path, gdalconstConstants.GA_ReadOnly);
        if (ds == null) {
            throw new Exception("Open failed: " + gdal.GetLastErrorMsg());
        }
        synchronized (sampleDatasetLock) {
            closeSampleDatasetLocked(layerId);
        }
        layerPaths.put(layerId, path);

        // Pre-compute the value range ONCE for float/int sources so every
        // tile of this layer renders with the same colour mapping (no
        // tile-boundary lines from concurrent stats races).
        //
        // approxOK=1 reads from the smallest overview level (we built one
        // during the upload's optimize phase) — fast (~ms) and low-memory.
        // approxOK=0 reads the WHOLE raster which OOMs on multi-GB files.
        // ComputeRasterMinMax always recomputes (never reads cached PAM
        // stats), so approxOK=1 is safe wrt NoData pollution.
        try {
            Band b = ds.GetRasterBand(1);
            int dt = b.GetRasterDataType();
            boolean isFloatish = dt != gdalconstConstants.GDT_Byte
                    && b.GetColorTable() == null;
            if (isFloatish) {
                Double nd = readNoData(b);
                // Order of attempts:
                //  1. ComputeStatistics(approxOK=true) — NoData-aware (uses
                //     a histogram pass that masks the band's NoData value),
                //     uses overviews so it's fast on large rasters.
                //  2. ComputeRasterMinMax(approxOK=1) — also NoData-aware
                //     in modern GDAL but doesn't always (returns whatever
                //     extreme it finds in the overview).
                //  3. GetStatistics — last resort, may return cached PAM
                //     stats that include NoData. We REJECT a result that
                //     equals the band's NoData value rather than using it.
                double[] sMin = {0}, sMax = {0}, sMean = {0}, sStd = {0};
                int rc = b.ComputeStatistics(true, sMin, sMax, sMean, sStd);
                boolean ok = rc == gdalconstConstants.CE_None
                        && sMax[0] > sMin[0]
                        && (nd == null || (sMin[0] != nd && sMax[0] != nd));
                if (ok) {
                    layerStats.put(layerId, new double[]{ sMin[0], sMax[0] });
                    Log.d(TAG, "registerLayer " + layerId
                            + " range=[" + sMin[0] + ", " + sMax[0]
                            + "] (ComputeStatistics) noData=" + nd);
                } else {
                    double[] mm = {0, 0};
                    try {
                        b.ComputeRasterMinMax(mm, 1);
                    } catch (Throwable ignored) {}
                    if (mm[1] > mm[0]
                            && (nd == null || (mm[0] != nd && mm[1] != nd))) {
                        layerStats.put(layerId, new double[]{ mm[0], mm[1] });
                        Log.d(TAG, "registerLayer " + layerId
                                + " range=[" + mm[0] + ", " + mm[1]
                                + "] (ComputeRasterMinMax) noData=" + nd);
                    } else {
                        // Both GDAL paths returned NoData-polluted ranges
                        // (typically because the .aux.xml sidecar has cached
                        // stats from a tool that didn't filter NoData).
                        // Compute it ourselves: read a downsampled overview
                        // and walk pixels skipping NoData.
                        double[] manual = computeRangeManually(b, nd);
                        if (manual != null) {
                            layerStats.put(layerId, manual);
                            Log.d(TAG, "registerLayer " + layerId
                                    + " range=[" + manual[0] + ", " + manual[1]
                                    + "] (manual histogram) noData=" + nd);
                        } else {
                            Log.e(TAG, "registerLayer " + layerId
                                    + " stats unusable: ComputeStatistics rc=" + rc
                                    + " min=" + sMin[0] + " max=" + sMax[0]
                                    + "; ComputeRasterMinMax min=" + mm[0]
                                    + " max=" + mm[1] + " noData=" + nd
                                    + " — tiles will use [0,255]");
                        }
                    }
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "stats precompute failed for " + layerId
                    + " — tiles will fall back to per-call compute", t);
        } finally {
            try { ds.delete(); } catch (Throwable ignored) {}
        }

        JSObject ret = new JSObject();
        ret.put("ok", true);
        return ret;
    }

    /**
     * Manual min/max scan of a downsampled view of the band, ignoring
     * NoData and non-finite values. Last-resort fallback when GDAL's own
     * stats functions return PAM-cached polluted values. Returns null if
     * unable to find any valid pixels.
     */
    private static double[] computeRangeManually(Band b, Double noData) {
        // Read the smallest overview (or a 512×512 sample of the source if
        // no overviews exist) into a Float32 buffer.
        Band scanBand = b;
        int ovrCount = b.GetOverviewCount();
        if (ovrCount > 0) {
            scanBand = b.GetOverview(ovrCount - 1);
        }
        int w = Math.min(scanBand.GetXSize(), 1024);
        int h = Math.min(scanBand.GetYSize(), 1024);
        if (w <= 0 || h <= 0) return null;
        float[] buf;
        try {
            buf = new float[w * h];
            int rc = scanBand.ReadRaster(0, 0, scanBand.GetXSize(), scanBand.GetYSize(),
                    w, h, gdalconstConstants.GDT_Float32, buf);
            // Some GDAL Java overloads don't take buf_xsize/buf_ysize separately
            // — fall back to direct read at the overview's native size.
            if (rc != gdalconstConstants.CE_None) {
                w = scanBand.GetXSize();
                h = scanBand.GetYSize();
                buf = new float[w * h];
                scanBand.ReadRaster(0, 0, w, h, gdalconstConstants.GDT_Float32, buf);
            }
        } catch (Throwable t) {
            return null;
        }
        double lo = Double.POSITIVE_INFINITY;
        double hi = Double.NEGATIVE_INFINITY;
        boolean hasNoData = noData != null;
        for (float fv : buf) {
            if (Float.isNaN(fv) || Float.isInfinite(fv)) continue;
            double v = fv;
            if (hasNoData && v == noData) continue;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
        if (lo == Double.POSITIVE_INFINITY || hi == Double.NEGATIVE_INFINITY || hi <= lo) {
            return null;
        }
        return new double[]{ lo, hi };
    }

    @PluginMethod
    public void unregisterLayer(PluginCall call) {
        final String layerId = call.getString("layerId");
        if (layerId == null || layerId.isEmpty()) {
            call.reject("layerId is required");
            return;
        }
        synchronized (sampleDatasetLock) {
            closeSampleDatasetLocked(layerId);
        }
        layerPaths.remove(layerId);
        layerStats.remove(layerId);
        try {
            deleteRecursively(cacheDir(layerId));
        } catch (Throwable t) {
            Log.w(TAG, "unregisterLayer cache sweep failed", t);
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void sampleAt(PluginCall call) {
        final String layerId = call.getString("layerId");
        final Double lon = call.getDouble("lon");
        final Double lat = call.getDouble("lat");
        if (layerId == null || layerId.isEmpty() || lon == null || lat == null) {
            call.reject("layerId, lon, lat required");
            return;
        }
        // Dispatch on samplePool — see field comment for why this can't
        // share the tile-render `pool`. Decouples tap latency from
        // background tile rendering.
        replyAsyncOn(samplePool, call, () -> sampleAtImpl(layerId, lon, lat));
    }

    @PluginMethod
    public void getTileBaseUrl(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("baseUrl", TILE_BASE_URL);
        call.resolve(ret);
    }

    @PluginMethod
    public void closeAll(PluginCall call) {
        synchronized (sampleDatasetLock) {
            clearAllSampleDatasetsLocked();
        }
        layerPaths.clear();
        layerStats.clear();
        // Sweep the on-disk tile cache. closeAll is only invoked by the
        // user-initiated "Delete Session" flush, so wiping every layer's
        // cache here matches the expected nuke-everything semantics. Without
        // this, HSC-TILES/<layerId>/ folders linger after the source
        // .tif files are unlinked.
        try {
            File root = new File(getContext().getExternalFilesDir(null), "HSC-TILES");
            if (root.exists()) deleteRecursively(root);
        } catch (Throwable t) {
            Log.w(TAG, "closeAll cache sweep failed", t);
        }
        JSObject ret = new JSObject();
        ret.put("closed", true);
        call.resolve(ret);
    }

    // ── Tile serving (called from OfflineTileServer's NanoHTTPD route) ───

    /**
     * Returns the WebP bytes for /layers/&lt;layerId&gt;/&lt;z&gt;/&lt;x&gt;/&lt;y&gt;.webp,
     * or null if the layer isn't registered or we hit an unrecoverable error.
     * Disk cache → in-flight dedup → 4-slot semaphore → GDAL Warp + WebP.
     */
    private byte[] serveTile(String layerId, int z, int x, int y) {
        byte[] cached = readDiskCache(layerId, z, x, y);
        if (cached != null) return cached;

        final String dedupKey = layerId + "|" + z + "/" + x + "/" + y;
        Future<byte[]> fut = inflight.computeIfAbsent(dedupKey, k -> pool.submit(() -> {
            try {
                renderSlots.acquire();
                try {
                    byte[] rgba = renderTileRgba(layerId, z, x, y);
                    if (rgba == null) return null;
                    byte[] webp = encodeWebpLossless(rgba, TILE_SIZE, TILE_SIZE);
                    writeDiskCache(layerId, z, x, y, webp);
                    if (writeCounter.incrementAndGet() % WRITES_BETWEEN_BUDGET_CHECKS == 0) {
                        enforceCacheBudget();
                    }
                    return webp;
                } finally {
                    renderSlots.release();
                }
            } catch (Throwable t) {
                Log.e(TAG, "renderTile " + layerId + "/" + z + "/" + x + "/" + y + " failed", t);
                return null;
            } finally {
                inflight.remove(dedupKey);
            }
        }));
        try {
            return fut.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        } catch (ExecutionException e) {
            Log.e(TAG, "serveTile execution failed", e.getCause());
            return null;
        }
    }

    /**
     * GDAL warp pipeline. For palette sources we first Translate to a VRT
     * with `-expand rgba` so the palette → RGBA expansion happens inside C++
     * (the Java SWIG `ColorTable.GetColorEntry()` returns `java.awt.Color`
     * which doesn't exist on Android, so we never call it).
     *
     * Each render opens its OWN Dataset and closes it before returning.
     * Shared-Dataset access from multiple render threads + closeAll/
     * unregisterLayer was producing two failure modes:
     *  (a) NPE on Band.GetColorTable() when the Dataset was delete()d
     *      mid-render (use-after-close race)
     *  (b) TIFFReadEncodedStrip() failures when libtiff's internal block
     *      cache raced across threads.
     * Per-call open eliminates both. The OS file cache makes the open
     * itself cheap (~10-50 ms) on subsequent tiles.
     */
    private byte[] renderTileRgba(String layerId, int z, int x, int y) {
        String path = layerPaths.get(layerId);
        if (path == null) return null;
        Dataset src = gdal.Open(path, gdalconstConstants.GA_ReadOnly);
        if (src == null) return null;
        try {
            return renderTileRgbaWithSrc(layerId, src, z, x, y);
        } finally {
            try { src.delete(); } catch (Throwable ignored) {}
        }
    }

    private byte[] renderTileRgbaWithSrc(String layerId, Dataset src, int z, int x, int y) {
        double[] bounds = tileBounds3857(z, x, y);
        boolean isPalette = src.GetRasterBand(1).GetColorTable() != null;

        // For palette sources, expand to RGBA via a virtual Translate so
        // gdal.Warp sees an RGBA dataset and we never need to read the
        // ColorTable from Java.
        Dataset translateOut = null;
        Dataset warpInput = src;
        String translatePath = null;
        if (isPalette) {
            translatePath = "/vsimem/expand_" + Thread.currentThread().getId()
                    + "_" + System.nanoTime() + ".vrt";
            Vector<String> tArgs = new Vector<>(Arrays.asList(
                    "-of", "VRT",
                    "-expand", "rgba"
            ));
            translateOut = gdal.Translate(translatePath, src,
                    new org.gdal.gdal.TranslateOptions(tArgs));
            if (translateOut == null) {
                Log.w(TAG, "Translate(-expand rgba) returned null: " + gdal.GetLastErrorMsg());
                return null;
            }
            warpInput = translateOut;
        }

        String resampling = isPalette ? "near" : "bilinear";
        String vsipath = "/vsimem/warp_" + Thread.currentThread().getId()
                + "_" + System.nanoTime() + ".tif";
        Vector<String> warpArgs = new Vector<>(Arrays.asList(
                "-of", "MEM",
                "-r", resampling,
                "-ts", String.valueOf(TILE_SIZE), String.valueOf(TILE_SIZE),
                "-te",
                String.valueOf(bounds[0]), String.valueOf(bounds[1]),
                String.valueOf(bounds[2]), String.valueOf(bounds[3]),
                "-t_srs", "EPSG:3857",
                "-dstalpha",
                "-ovr", "AUTO"
        ));
        // src is thread-local (per-call open) so we can call Warp directly —
        // no synchronization needed since each thread has its own Dataset.
        Dataset warped = gdal.Warp(
                vsipath, new Dataset[]{warpInput}, new WarpOptions(warpArgs));
        if (warped == null) {
            Log.w(TAG, "Warp returned null: " + gdal.GetLastErrorMsg());
            try { if (translateOut != null) translateOut.delete(); } catch (Throwable ignored) {}
            try { if (translatePath != null) gdal.Unlink(translatePath); } catch (Throwable ignored) {}
            return null;
        }
        try {
            return composeRgbaFromWarped(layerId, warped, isPalette, src);
        } finally {
            try { warped.delete(); } catch (Throwable ignored) {}
            try { gdal.Unlink(vsipath); } catch (Throwable ignored) {}
            try { if (translateOut != null) translateOut.delete(); } catch (Throwable ignored) {}
            try { if (translatePath != null) gdal.Unlink(translatePath); } catch (Throwable ignored) {}
        }
    }

    /**
     * Reads the warped dataset's bands and produces a 256×256 RGBA8888 byte
     * buffer. Branches by SOURCE shape (not warp output) since -dstalpha
     * always adds a coverage mask.
     */
    private byte[] composeRgbaFromWarped(String layerId, Dataset warped, boolean isPalette, Dataset srcForStats) {
        int w = TILE_SIZE;
        int h = TILE_SIZE;
        int totalBands = warped.GetRasterCount();
        int alphaBandIdx = totalBands; // -dstalpha guarantees last = mask
        byte[] mask = new byte[w * h];
        warped.GetRasterBand(alphaBandIdx).ReadRaster(
                0, 0, w, h, gdalconstConstants.GDT_Byte, mask);

        Band srcBand1 = srcForStats.GetRasterBand(1);
        int srcDtype = srcBand1.GetRasterDataType();
        int srcBandCount = srcForStats.GetRasterCount();
        boolean isByteRGB = !isPalette
                && srcDtype == gdalconstConstants.GDT_Byte && srcBandCount >= 3;
        boolean isByteGray = !isPalette
                && srcDtype == gdalconstConstants.GDT_Byte && srcBandCount < 3;

        byte[] out = new byte[w * h * 4];
        if (isPalette) {
            // Source was Translate-expanded to RGBA before warp, so the
            // warped output now has 5 bands: R, G, B, palette-alpha, coverage.
            // Final alpha = min(coverage-mask, palette-alpha).
            byte[] r = new byte[w * h];
            byte[] g = new byte[w * h];
            byte[] b = new byte[w * h];
            byte[] pa = new byte[w * h];
            warped.GetRasterBand(1).ReadRaster(0, 0, w, h, gdalconstConstants.GDT_Byte, r);
            warped.GetRasterBand(2).ReadRaster(0, 0, w, h, gdalconstConstants.GDT_Byte, g);
            warped.GetRasterBand(3).ReadRaster(0, 0, w, h, gdalconstConstants.GDT_Byte, b);
            warped.GetRasterBand(4).ReadRaster(0, 0, w, h, gdalconstConstants.GDT_Byte, pa);
            for (int i = 0; i < w * h; i++) {
                int o = i * 4;
                out[o] = r[i];
                out[o + 1] = g[i];
                out[o + 2] = b[i];
                int coverage = mask[i] & 0xff;
                int paletteA = pa[i] & 0xff;
                out[o + 3] = (byte) Math.min(coverage, paletteA);
            }
        } else if (isByteRGB) {
            byte[] r = new byte[w * h];
            byte[] g = new byte[w * h];
            byte[] b = new byte[w * h];
            warped.GetRasterBand(1).ReadRaster(0, 0, w, h, gdalconstConstants.GDT_Byte, r);
            warped.GetRasterBand(2).ReadRaster(0, 0, w, h, gdalconstConstants.GDT_Byte, g);
            warped.GetRasterBand(3).ReadRaster(0, 0, w, h, gdalconstConstants.GDT_Byte, b);
            for (int i = 0; i < w * h; i++) {
                int o = i * 4;
                out[o] = r[i];
                out[o + 1] = g[i];
                out[o + 2] = b[i];
                out[o + 3] = mask[i];
            }
        } else if (isByteGray) {
            byte[] gr = new byte[w * h];
            warped.GetRasterBand(1).ReadRaster(0, 0, w, h, gdalconstConstants.GDT_Byte, gr);
            for (int i = 0; i < w * h; i++) {
                int o = i * 4;
                out[o] = gr[i];
                out[o + 1] = gr[i];
                out[o + 2] = gr[i];
                out[o + 3] = mask[i];
            }
        } else {
            // Float/Int DEM path: map through a colour ramp (signal/RSRP red
            // gradient or terrain ramp) — same as the Electron worker.
            Band band = warped.GetRasterBand(1);
            float[] pixels = new float[w * h];
            band.ReadRaster(0, 0, w, h, gdalconstConstants.GDT_Float32, pixels);
            Band sb = srcForStats.GetRasterBand(1);
            Double noData = readNoData(sb);
            double lo, hi;
            // Use the precomputed range (set in registerLayer). Falls back to
            // a per-call ComputeRasterMinMax only if registerLayer wasn't run
            // for this layer (shouldn't happen in normal flow).
            double[] cached = layerStats.get(layerId);
            if (cached != null) {
                lo = cached[0];
                hi = cached[1];
            } else {
                // Fallback only if registerLayer's precompute didn't run.
                // approxOK=1 to avoid OOMing on large files.
                double[] mm = {0, 0};
                try {
                    sb.ComputeRasterMinMax(mm, 1);
                    lo = mm[0]; hi = mm[1];
                } catch (Throwable t) {
                    lo = 0; hi = 255;
                }
            }
            double span = (hi - lo);
            if (span <= 0) span = 1;
            String rampKind = pickFloatRamp(srcForStats.GetDescription(), lo, hi);
            byte[] lut = buildFloatLut(rampKind);
            double noDataFloor = lo - 0.05 * span;
            boolean hasNoData = noData != null;
            for (int i = 0; i < w * h; i++) {
                int o = i * 4;
                int coverage = mask[i] & 0xff;
                double v = pixels[i];
                boolean isNoData = (hasNoData && v == noData)
                        || Double.isNaN(v) || Double.isInfinite(v)
                        || v < noDataFloor;
                if (coverage == 0 || isNoData) {
                    out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0;
                    continue;
                }
                double t2 = (v - lo) / span;
                if (t2 < 0) t2 = 0;
                if (t2 > 1) t2 = 1;
                int lutIdx = Math.min(255, (int) (t2 * 256));
                int li = lutIdx * 4;
                out[o] = lut[li];
                out[o + 1] = lut[li + 1];
                out[o + 2] = lut[li + 2];
                out[o + 3] = mask[i];
            }
        }
        return out;
    }

    private byte[] encodeWebpLossless(byte[] rgba, int w, int h) {
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        bmp.copyPixelsFromBuffer(ByteBuffer.wrap(rgba));
        ByteArrayOutputStream baos = new ByteArrayOutputStream(rgba.length / 8);
        Bitmap.CompressFormat format = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? Bitmap.CompressFormat.WEBP_LOSSLESS
                : Bitmap.CompressFormat.WEBP;
        bmp.compress(format, 100, baos);
        bmp.recycle();
        return baos.toByteArray();
    }

    // ── probe / sampleAt internals ───────────────────────────────────────

    private JSObject probeDataset(Dataset ds, String path) {
        int w = ds.GetRasterXSize();
        int h = ds.GetRasterYSize();
        int bandCount = ds.GetRasterCount();
        double[] gt = ds.GetGeoTransform();
        String srsWkt = ds.GetProjection();
        SpatialReference srs = new SpatialReference();
        String sourceCrs = null;
        if (srsWkt != null && !srsWkt.isEmpty()) {
            try {
                srs.ImportFromWkt(srsWkt);
                String code = srs.GetAuthorityCode(null);
                sourceCrs = code != null ? "EPSG:" + code : srsWkt;
            } catch (Throwable t) {
                sourceCrs = srsWkt;
            }
        }

        Band band1 = ds.GetRasterBand(1);
        String dtype = gdalDataTypeName(band1.GetRasterDataType());

        double[] sMin = {0}, sMax = {0}, sMean = {0}, sStd = {0};
        band1.GetStatistics(1, 1, sMin, sMax, sMean, sStd);
        readNoData(band1); // touch to validate

        // Palette: GDAL Java SWIG's ColorTable.GetColorEntry returns
        // java.awt.Color which doesn't exist on Android, so we can't read
        // entries here. We DO know whether a color table is present (used to
        // pick rendering strategy in renderTileRgba). Return a non-null
        // length-only palette array so the renderer's layer-type heuristic
        // still treats the layer as palette-typed; entries are zeros.
        ColorTable ct = band1.GetColorTable();
        JSArray paletteArr = null;
        if (ct != null) {
            paletteArr = new JSArray();
            for (int i = 0; i < ct.GetCount(); i++) {
                JSArray rgba = new JSArray();
                rgba.put(0); rgba.put(0); rgba.put(0); rgba.put(0);
                paletteArr.put(rgba);
            }
        }

        double[] boundsWgs84 = computeWgs84Bounds(gt, w, h, srs);
        double pixelSize = Math.abs(gt[1]);
        int nativeZoom = estimateNativeZoom(pixelSize);

        JSObject ret = new JSObject();
        ret.put("width", w);
        ret.put("height", h);
        ret.put("bands", bandCount);
        ret.put("dtype", dtype);
        ret.put("sourceCrs", sourceCrs);
        if (boundsWgs84 != null) {
            JSArray arr = new JSArray();
            try {
                for (double v : boundsWgs84) arr.put(v);
            } catch (org.json.JSONException ignored) { /* finite doubles only */ }
            ret.put("boundsWgs84", arr);
        } else {
            ret.put("boundsWgs84", JSONObject.NULL);
        }
        ret.put("palette", paletteArr != null ? paletteArr : JSONObject.NULL);
        ret.put("min", sMin[0]);
        ret.put("max", sMax[0]);
        ret.put("pixelSize", pixelSize);
        ret.put("nativeZoom", nativeZoom);
        ret.put("colorInterp", colorInterpName(band1.GetRasterColorInterpretation()));
        return ret;
    }

    private JSObject buildOverviewsImpl(String path) throws IOException {
        Dataset ds = gdal.Open(path, gdalconstConstants.GA_Update);
        if (ds == null) ds = gdal.Open(path, gdalconstConstants.GA_ReadOnly);
        if (ds == null) throw new IOException("Open failed: " + gdal.GetLastErrorMsg());
        try {
            int w = ds.GetRasterXSize();
            int h = ds.GetRasterYSize();
            Band band1 = ds.GetRasterBand(1);
            boolean isPalette = band1.GetColorTable() != null;
            boolean tooSmall = Math.max(w, h) < 4096;
            int existing = band1.GetOverviewCount();

            if (tooSmall) {
                JSObject r = new JSObject();
                r.put("built", false); r.put("reason", "too-small");
                r.put("width", w); r.put("height", h);
                return r;
            }
            if (existing > 0) {
                JSObject r = new JSObject();
                r.put("built", false); r.put("reason", "already-exists");
                r.put("count", existing); r.put("width", w); r.put("height", h);
                return r;
            }
            String resampling = isPalette ? "NEAREST" : "AVERAGE";
            int[] levels = {2, 4, 8, 16, 32};
            int rc = ds.BuildOverviews(resampling, levels);
            if (rc != gdalconstConstants.CE_None) {
                throw new IOException("BuildOverviews failed: " + gdal.GetLastErrorMsg());
            }
            JSObject r = new JSObject();
            r.put("built", true);
            r.put("kind", resampling.toLowerCase());
            JSArray arr = new JSArray();
            for (int l : levels) arr.put(l);
            r.put("levels", arr);
            r.put("count", levels.length);
            r.put("width", w); r.put("height", h);
            return r;
        } finally {
            try { ds.delete(); } catch (Throwable ignored) {}
        }
    }

    /**
     * Evict a single layer's cached sample state. Called when a cached
     * Dataset turns out to be invalid OR when a layer is unregistered.
     * No external lock — invoked only from the single-threaded samplePool.
     */
    private void closeSampleDatasetLocked(String layerId) {
        Dataset ds = sampleDatasetByLayerId.remove(layerId);
        if (ds != null) {
            try { ds.delete(); } catch (Throwable ignored) {}
        }
        CoordinateTransformation tx = sampleTxByLayerId.remove(layerId);
        if (tx != null) {
            try { tx.delete(); } catch (Throwable ignored) {}
        }
        sampleDtypeByLayerId.remove(layerId);
    }

    /**
     * LRU-evict the least-recently-used cached sample state. Mirrors
     * eviction across the dataset, transform, and dtype caches.
     */
    private void evictOldestSampleDatasetLocked() {
        Iterator<Map.Entry<String, Dataset>> it = sampleDatasetByLayerId.entrySet().iterator();
        if (!it.hasNext()) return;
        Map.Entry<String, Dataset> e = it.next();
        String layerId = e.getKey();
        it.remove();
        try { e.getValue().delete(); } catch (Throwable ignored) {}
        CoordinateTransformation tx = sampleTxByLayerId.remove(layerId);
        if (tx != null) {
            try { tx.delete(); } catch (Throwable ignored) {}
        }
        sampleDtypeByLayerId.remove(layerId);
    }

    private void clearAllSampleDatasetsLocked() {
        for (Dataset ds : sampleDatasetByLayerId.values()) {
            try { ds.delete(); } catch (Throwable ignored) {}
        }
        sampleDatasetByLayerId.clear();
        for (CoordinateTransformation tx : sampleTxByLayerId.values()) {
            try { tx.delete(); } catch (Throwable ignored) {}
        }
        sampleTxByLayerId.clear();
        sampleDtypeByLayerId.clear();
    }

    /**
     * Per-layer transformation builder. Slow on cold call (PROJ DB hit
     * + WKT parse), so we run it ONCE per layer and cache the result.
     * Returns null if the dataset has no usable projection.
     */
    private CoordinateTransformation buildAndCacheTransform(
            String layerId, Dataset ds) {
        String srsWkt = ds.GetProjection();
        SpatialReference src = new SpatialReference();
        src.ImportFromWkt(srsWkt != null ? srsWkt : "");
        try { src.SetAxisMappingStrategy(OAMS_TRADITIONAL_GIS_ORDER); } catch (Throwable ignored) {}
        SpatialReference wgs84 = new SpatialReference();
        wgs84.ImportFromEPSG(4326);
        try { wgs84.SetAxisMappingStrategy(OAMS_TRADITIONAL_GIS_ORDER); } catch (Throwable ignored) {}
        CoordinateTransformation tx;
        try {
            tx = new CoordinateTransformation(wgs84, src);
        } catch (Throwable t) {
            Log.w(TAG, "buildAndCacheTransform failed for " + layerId, t);
            return null;
        }
        sampleTxByLayerId.put(layerId, tx);
        return tx;
    }

    /**
     * sampleAt fast path. Holds sampleDatasetLock to prevent races
     * with register/unregister/closeAll which mutate the cache from
     * the tile-render `pool`. Lock contention is near-zero since
     * those flows are user-initiated (rare) while sampleAt is the
     * sole hot consumer.
     *
     * Cost breakdown after caching:
     *   • Cache hit  → ~1-5 ms (TransformPoint + ReadRaster + JSON marshal)
     *   • Cache miss → ~200-500 ms (gdal.Open) + ~50-200 ms (PROJ setup)
     *                  + ~5 ms work, ONCE per layer
     */
    private JSObject sampleAtImpl(String layerId, double lon, double lat) {
        // Timing instrumentation. Look in `adb logcat -s RasterTilingPlugin -v time`
        // to see exact step costs. Remove the Log.d calls once profiling is done
        // — they add ~0.05 ms each, negligible vs. real work.
        long tEntry = System.nanoTime();
        synchronized (sampleDatasetLock) {
            long tLock = System.nanoTime();
            String path = layerPaths.get(layerId);
            if (path == null) {
                JSObject r = new JSObject();
                r.put("value", JSONObject.NULL);
                r.put("dtype", "");
                return r;
            }

            Dataset ds = sampleDatasetByLayerId.get(layerId);
            CoordinateTransformation tx = sampleTxByLayerId.get(layerId);
            String cachedDtype = sampleDtypeByLayerId.get(layerId);

            if (ds != null && tx != null && cachedDtype != null) {
                try {
                    JSObject r = sampleAtFast(ds, tx, cachedDtype, lon, lat);
                    long tDone = System.nanoTime();
                    Log.d(TAG, String.format(
                            "sampleAt[%s] HIT lock=%.1fms total=%.1fms",
                            layerId,
                            (tLock - tEntry) / 1e6,
                            (tDone - tEntry) / 1e6));
                    return r;
                } catch (Throwable t) {
                    Log.w(TAG, "sampleAt cached state invalid, reopening", t);
                    closeSampleDatasetLocked(layerId);
                    ds = null;
                    tx = null;
                    cachedDtype = null;
                }
            }

            // Cold path: open dataset + build transform + cache both.
            while (sampleDatasetByLayerId.size() >= SAMPLE_DATASET_CACHE_CAP) {
                evictOldestSampleDatasetLocked();
            }
            long tBeforeOpen = System.nanoTime();
            ds = gdal.Open(path, gdalconstConstants.GA_ReadOnly);
            long tAfterOpen = System.nanoTime();
            if (ds == null) {
                JSObject r = new JSObject();
                r.put("value", JSONObject.NULL);
                r.put("dtype", "");
                return r;
            }
            sampleDatasetByLayerId.put(layerId, ds);
            tx = buildAndCacheTransform(layerId, ds);
            long tAfterTx = System.nanoTime();
            if (tx == null) {
                JSObject r = new JSObject();
                r.put("value", JSONObject.NULL);
                r.put("dtype", "");
                return r;
            }
            cachedDtype = gdalDataTypeName(ds.GetRasterBand(1).GetRasterDataType());
            JSObject r = sampleAtFast(ds, tx, cachedDtype, lon, lat);
            long tDone = System.nanoTime();
            sampleDtypeByLayerId.put(layerId, cachedDtype);
            Log.d(TAG, String.format(
                    "sampleAt[%s] MISS lock=%.1fms open=%.1fms tx=%.1fms sample=%.1fms total=%.1fms",
                    layerId,
                    (tLock - tEntry) / 1e6,
                    (tAfterOpen - tBeforeOpen) / 1e6,
                    (tAfterTx - tAfterOpen) / 1e6,
                    (tDone - tAfterTx) / 1e6,
                    (tDone - tEntry) / 1e6));
            return r;
        }
    }

    /**
     * Hot path: takes pre-built dataset, transform, and dtype string —
     * does ONLY the per-pixel work. Sub-millisecond on a tablet for the
     * ReadRaster of 1 pixel; no PROJ DB I/O, no SRS reconstruction.
     */
    private JSObject sampleAtFast(
            Dataset ds, CoordinateTransformation tx, String dtype,
            double lon, double lat) {
        double[] gt = ds.GetGeoTransform();
        Band band = ds.GetRasterBand(1);

        double[] pt = tx.TransformPoint(lon, lat);
        double sx = pt[0];
        double sy = pt[1];

        double det = gt[1] * gt[5] - gt[2] * gt[4];
        if (det == 0.0) {
            JSObject r = new JSObject();
            r.put("value", JSONObject.NULL); r.put("dtype", dtype);
            return r;
        }
        int px = (int) ((gt[5] * (sx - gt[0]) - gt[2] * (sy - gt[3])) / det);
        int py = (int) ((-gt[4] * (sx - gt[0]) + gt[1] * (sy - gt[3])) / det);
        if (px < 0 || py < 0 || px >= ds.GetRasterXSize() || py >= ds.GetRasterYSize()) {
            JSObject r = new JSObject();
            r.put("value", JSONObject.NULL); r.put("dtype", dtype);
            return r;
        }
        int readType = band.GetRasterDataType();
        Double value;
        if (readType == gdalconstConstants.GDT_Byte
                || readType == gdalconstConstants.GDT_UInt16
                || readType == gdalconstConstants.GDT_Int16
                || readType == gdalconstConstants.GDT_UInt32
                || readType == gdalconstConstants.GDT_Int32) {
            int[] buf = new int[1];
            band.ReadRaster(px, py, 1, 1, gdalconstConstants.GDT_Int32, buf);
            value = (double) buf[0];
        } else {
            float[] buf = new float[1];
            band.ReadRaster(px, py, 1, 1, gdalconstConstants.GDT_Float32, buf);
            value = (double) buf[0];
        }
        Double nd = readNoData(band);
        Object finalVal = (nd != null && value.equals(nd)) ? null : value;
        JSObject r = new JSObject();
        r.put("value", finalVal != null ? finalVal : JSONObject.NULL);
        r.put("dtype", dtype);
        return r;
    }

    // ── Disk cache ───────────────────────────────────────────────────────

    private File cacheDir(String layerId) {
        File root = new File(getContext().getExternalFilesDir(null), "HSC-TILES");
        File dir = new File(root, layerId);
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private File tileFile(String layerId, int z, int x, int y) {
        File f = new File(cacheDir(layerId), z + "/" + x + "/" + y + ".webp");
        File parent = f.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        return f;
    }

    private byte[] readDiskCache(String layerId, int z, int x, int y) {
        File f = tileFile(layerId, z, x, y);
        if (!f.exists() || !f.isFile()) return null;
        try {
            byte[] bytes = readAll(f);
            f.setLastModified(System.currentTimeMillis()); // touch for LRU
            return bytes;
        } catch (Throwable t) {
            return null;
        }
    }

    private void writeDiskCache(String layerId, int z, int x, int y, byte[] bytes) {
        try (FileOutputStream out = new FileOutputStream(tileFile(layerId, z, x, y))) {
            out.write(bytes);
        } catch (Throwable t) {
            Log.w(TAG, "tile cache write failed", t);
        }
    }

    private void enforceCacheBudget() {
        File root = new File(getContext().getExternalFilesDir(null), "HSC-TILES");
        if (!root.exists()) return;
        List<File> files = new ArrayList<>();
        collectFiles(root, files);
        long total = 0;
        for (File f : files) total += f.length();
        if (total <= CACHE_BUDGET_BYTES) return;
        Collections.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        long freed = 0;
        for (File f : files) {
            if (total - freed <= CACHE_BUDGET_BYTES) break;
            long sz = f.length();
            if (f.delete()) freed += sz;
        }
    }

    private void collectFiles(File dir, List<File> out) {
        File[] kids = dir.listFiles();
        if (kids == null) return;
        for (File k : kids) {
            if (k.isDirectory()) collectFiles(k, out);
            else if (k.isFile() && (k.getName().endsWith(".webp") || k.getName().endsWith(".png"))) {
                out.add(k);
            }
        }
    }

    private static void deleteRecursively(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteRecursively(k);
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private static byte[] readAll(File f) throws IOException {
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            ByteArrayOutputStream baos = new ByteArrayOutputStream((int) f.length());
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) baos.write(buf, 0, n);
            return baos.toByteArray();
        }
    }

    // ── proj.db bootstrap ────────────────────────────────────────────────

    private void copyProjDbIfMissing() {
        File target = new File(new File(getContext().getFilesDir(), "proj"), "proj.db");
        if (target.exists() && target.length() > 0) return;
        File parent = target.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        try (InputStream in = getContext().getAssets().open("proj/proj.db");
             FileOutputStream out = new FileOutputStream(target)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } catch (Throwable t) {
            Log.e(TAG, "proj.db copy failed — reprojection may be unreliable", t);
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────


    private static Double readNoData(Band band) {
        try {
            Double[] out = new Double[1];
            band.GetNoDataValue(out);
            return out[0];
        } catch (Throwable t) {
            return null;
        }
    }

    private static String gdalDataTypeName(int t) {
        if (t == gdalconstConstants.GDT_Byte) return "Byte";
        if (t == gdalconstConstants.GDT_UInt16) return "UInt16";
        if (t == gdalconstConstants.GDT_Int16) return "Int16";
        if (t == gdalconstConstants.GDT_UInt32) return "UInt32";
        if (t == gdalconstConstants.GDT_Int32) return "Int32";
        if (t == gdalconstConstants.GDT_Float32) return "Float32";
        if (t == gdalconstConstants.GDT_Float64) return "Float64";
        return "Unknown";
    }

    private static String colorInterpName(int c) {
        if (c == gdalconstConstants.GCI_GrayIndex) return "Gray";
        if (c == gdalconstConstants.GCI_PaletteIndex) return "Palette";
        if (c == gdalconstConstants.GCI_RedBand) return "Red";
        if (c == gdalconstConstants.GCI_GreenBand) return "Green";
        if (c == gdalconstConstants.GCI_BlueBand) return "Blue";
        if (c == gdalconstConstants.GCI_AlphaBand) return "Alpha";
        return "Other";
    }

    private static double[] computeWgs84Bounds(double[] gt, int w, int h, SpatialReference srs) {
        if (gt == null || gt.length < 6) return null;
        double x0 = gt[0];
        double y0 = gt[3];
        double x1 = gt[0] + w * gt[1] + h * gt[2];
        double y1 = gt[3] + w * gt[4] + h * gt[5];
        double minX = Math.min(x0, x1);
        double maxX = Math.max(x0, x1);
        double minY = Math.min(y0, y1);
        double maxY = Math.max(y0, y1);

        SpatialReference wgs84 = new SpatialReference();
        wgs84.ImportFromEPSG(4326);
        try { wgs84.SetAxisMappingStrategy(OAMS_TRADITIONAL_GIS_ORDER); } catch (Throwable ignored) {}
        try { srs.SetAxisMappingStrategy(OAMS_TRADITIONAL_GIS_ORDER); } catch (Throwable ignored) {}
        try {
            CoordinateTransformation tx = new CoordinateTransformation(srs, wgs84);
            double[] sw = tx.TransformPoint(minX, minY);
            double[] ne = tx.TransformPoint(maxX, maxY);
            return new double[]{
                    Math.min(sw[0], ne[0]),
                    Math.min(sw[1], ne[1]),
                    Math.max(sw[0], ne[0]),
                    Math.max(sw[1], ne[1]),
            };
        } catch (Throwable t) {
            return null;
        }
    }

    /**
     * Pick a colour ramp ("signal" or "dem") from filename hints + value
     * range. Mirrors electron/tiling/worker.cjs#pickFloatRamp.
     */
    private static String pickFloatRamp(String fileName, double min, double max) {
        String n = (fileName != null ? fileName : "").toLowerCase();
        if (n.matches(".*(rsrp|rssi|sinr|rsrq|servingss|bestserver|gsm|lte|4g|5g).*")) {
            return "signal";
        }
        if (min < -30 && max < 10 && min > -200) return "signal";
        return "dem";
    }

    /**
     * Build a 256×4 RGBA LUT for the named ramp. Stops are interpolated
     * linearly. Mirrors electron/tiling/worker.cjs#buildFloatLut.
     * "signal" : RdYlGn-style (low = dark red, high = green)
     * "dem"    : terrain (low = blue, mid = green/yellow, high = white)
     */
    private static byte[] buildFloatLut(String kind) {
        double[][] stops;
        if ("signal".equals(kind)) {
            stops = new double[][]{
                    {0.0, 165, 0, 38},
                    {0.2, 215, 48, 39},
                    {0.4, 244, 109, 67},
                    {0.5, 253, 174, 97},
                    {0.6, 254, 224, 139},
                    {0.7, 217, 239, 139},
                    {0.8, 166, 217, 106},
                    {0.9, 102, 189, 99},
                    {1.0, 26, 152, 80},
            };
        } else {
            stops = new double[][]{
                    {0.0, 3, 71, 117},
                    {0.05, 16, 132, 169},
                    {0.1, 80, 158, 47},
                    {0.3, 165, 192, 64},
                    {0.5, 217, 191, 121},
                    {0.7, 171, 124, 68},
                    {0.85, 122, 86, 58},
                    {1.0, 255, 255, 255},
            };
        }
        byte[] lut = new byte[256 * 4];
        for (int i = 0; i < 256; i++) {
            double t = i / 255.0;
            double[] s0 = stops[0];
            double[] s1 = stops[stops.length - 1];
            for (int k = 1; k < stops.length; k++) {
                if (stops[k][0] >= t) {
                    s0 = stops[k - 1];
                    s1 = stops[k];
                    break;
                }
            }
            double span = s1[0] - s0[0];
            if (span == 0) span = 1;
            double f = (t - s0[0]) / span;
            int li = i * 4;
            lut[li]     = (byte) Math.round(s0[1] + (s1[1] - s0[1]) * f);
            lut[li + 1] = (byte) Math.round(s0[2] + (s1[2] - s0[2]) * f);
            lut[li + 2] = (byte) Math.round(s0[3] + (s1[3] - s0[3]) * f);
            lut[li + 3] = (byte) 255;
        }
        return lut;
    }

    private static int estimateNativeZoom(double pixelSizeDegOrM) {
        double px = pixelSizeDegOrM < 0.01 ? pixelSizeDegOrM * 111320.0 : pixelSizeDegOrM;
        if (px <= 0.0) return 13;
        double z = Math.log(156543.03392 / px) / Math.log(2.0);
        int zi = (int) z;
        return Math.max(0, Math.min(22, zi));
    }

    private static double[] tileBounds3857(int z, int x, int y) {
        long n = 1L << z;
        double lonW = (double) x / n * 360.0 - 180.0;
        double lonE = (double) (x + 1) / n * 360.0 - 180.0;
        double mN = Math.PI - 2.0 * Math.PI * (double) y / n;
        double mS = Math.PI - 2.0 * Math.PI * (double) (y + 1) / n;
        double latN = Math.toDegrees(Math.atan(Math.sinh(mN)));
        double latS = Math.toDegrees(Math.atan(Math.sinh(mS)));
        double r = 6378137.0;
        return new double[]{
                lonW * Math.PI / 180.0 * r,
                r * Math.log(Math.tan(Math.PI / 4.0 + latS * Math.PI / 180.0 / 2.0)),
                lonE * Math.PI / 180.0 * r,
                r * Math.log(Math.tan(Math.PI / 4.0 + latN * Math.PI / 180.0 / 2.0)),
        };
    }

    /** Functional interface for things that can throw checked exceptions. */
    @FunctionalInterface
    private interface ThrowingSupplier<T> { T get() throws Exception; }

    /**
     * Run [block] on the thread pool, resolve/reject the PluginCall when it
     * finishes. Capacitor accepts resolve/reject from any thread.
     */
    private void replyAsync(PluginCall call, ThrowingSupplier<JSObject> block) {
        replyAsyncOn(pool, call, block);
    }

    /** Variant that lets the caller pick a specific executor. Used by
     *  sampleAt() to dispatch onto the dedicated samplePool so taps don't
     *  queue behind tile renders. */
    private void replyAsyncOn(
            ExecutorService executor, PluginCall call, ThrowingSupplier<JSObject> block) {
        executor.submit(() -> {
            try {
                JSObject r = block.get();
                call.resolve(r);
            } catch (Throwable e) {
                Log.e(TAG, "PluginMethod failed", e);
                String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                // PluginCall.reject only takes (String, Exception) — coerce.
                Exception ex = (e instanceof Exception) ? (Exception) e : new Exception(e);
                call.reject(msg, ex);
            }
        });
    }
}
