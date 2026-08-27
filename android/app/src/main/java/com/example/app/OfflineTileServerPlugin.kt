package com.example.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import fi.iki.elonen.NanoHTTPD
import java.io.ByteArrayInputStream
import java.io.File

@CapacitorPlugin(name = "OfflineTileServer")
class OfflineTileServerPlugin : Plugin() {

    private var tileServer: TileServer? = null

    /**
     * SAM-friendly callback type so both Java and Kotlin callers can register
     * a raster-tile provider with a single lambda. Java sees this as a
     * functional interface; Kotlin gets SAM conversion for `::method` refs.
     */
    fun interface RasterTileProvider {
        fun provideTile(layerId: String, z: Int, x: Int, y: Int): ByteArray?
    }

    companion object {
        // Raster tile callback registered by RasterTilingPlugin at startup.
        // Receives (layerId, z, x, y) and returns a fully-encoded WebP byte
        // array (cache-hit or freshly-rendered), or null if the layer isn't
        // registered or the tile is out of bounds.
        // @JvmStatic so the standalone Java RasterTilingPlugin can call it
        // the same way the Kotlin plugin does.
        @Volatile private var rasterProvider: RasterTileProvider? = null

        @JvmStatic
        fun registerRasterTileProvider(provider: RasterTileProvider) {
            rasterProvider = provider
        }

        internal fun callRaster(id: String, z: Int, x: Int, y: Int): ByteArray? =
            rasterProvider?.provideTile(id, z, x, y)
    }

    override fun load() {
        super.load()
        // Always start with default path - React will update if needed
        initializeServer()
    }
    
    private fun getDefaultTilesDir(): File {
        // Default path: Internal storage/Documents/tiles (public)
        val documentsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS)
        val tilesDir = File(documentsDir, "tiles")
        if (!tilesDir.exists()) {
            tilesDir.mkdirs()
        }
        return tilesDir
    }
    
    private fun initializeServer() {
        try {
            // Check storage permission first (Android 11+)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                if (!android.os.Environment.isExternalStorageManager()) {
                    android.util.Log.w("TileServer", "Storage permission not granted - server will start but may fail to read files")
                }
            }
            
            // Always use default path on startup - React manages saved paths via Capacitor Preferences
            val defaultDir = getDefaultTilesDir()
            val defaultUri = Uri.parse("file://${defaultDir.absolutePath}")
            
            val server = TileServer(
                context = context,
                folderUri = defaultUri,
                port = 8080,
                useTms = false
            )
            
            server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            tileServer = server
            android.util.Log.d("TileServer", "Server initialized with default path: ${defaultDir.absolutePath}")
        } catch (e: Exception) {
            android.util.Log.e("TileServer", "Failed to initialize server: ${e.message}", e)
        }
    }

    @PluginMethod
    fun selectTileFolder(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            )
        }
        startActivityForResult(call, intent, "onFolderSelected")
    }

    @ActivityCallback
    fun onFolderSelected(call: PluginCall, result: ActivityResult) {
        if (result.resultCode != android.app.Activity.RESULT_OK) {
            call.reject("User cancelled folder selection")
            return
        }

        val treeUri = result.data?.data
        if (treeUri == null) {
            call.reject("No folder selected")
            return
        }

        try {
            // Persist read permission
            val takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION
            context.contentResolver.takePersistableUriPermission(treeUri, takeFlags)

            // REMOVED: Don't save to SharedPreferences - React manages via Capacitor Preferences
            // val prefs = context.getSharedPreferences("tile_server_prefs", Context.MODE_PRIVATE)
            // prefs.edit().putString("tile_folder_uri", treeUri.toString()).apply()

            val ret = JSObject()
            ret.put("uri", treeUri.toString())
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to select folder: ${e.message}")
        }
    }

    @PluginMethod
    fun getSavedFolderUri(call: PluginCall) {
        // REMOVED: React manages storage via Capacitor Preferences
        // Always return null - React will read from Capacitor Preferences
        val ret = JSObject()
        ret.put("uri", null)
        call.resolve(ret)
    }

    @PluginMethod
    fun updateFolderPath(call: PluginCall) {
        val uriString = call.getString("uri")
        if (uriString.isNullOrBlank()) {
            call.reject("URI is required")
            return
        }

        val uri = Uri.parse(uriString)
        val useTms = call.getBoolean("useTms") ?: false

        try {
            // Ensure server is running (initialize if needed)
            if (tileServer == null) {
                initializeServer()
            }
            
            // Update the folder path without restarting server
            tileServer?.updateFolderPath(uri, useTms)

            val ret = JSObject()
            val baseUrl = "http://localhost:8080"
            ret.put("baseUrl", baseUrl)
            ret.put("port", 8080)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to update folder path: ${e.message}")
        }
    }
    
    @PluginMethod
    fun getServerUrl(call: PluginCall) {
        val ret = JSObject()
        val baseUrl = "http://localhost:8080"
        ret.put("baseUrl", baseUrl)
        ret.put("port", 8080)
        call.resolve(ret)
    }
    
    @PluginMethod
    fun basemapSetFolder(call: PluginCall) {
        val path = call.getString("path")
        try {
            if (tileServer == null) {
                initializeServer()
            }
            if (path.isNullOrBlank()) {
                tileServer?.updateBasemapFolder(null)
            } else {
                tileServer?.updateBasemapFolder(Uri.parse(path))
            }
            val ret = JSObject()
            ret.put("ok", true)
            ret.put("baseUrl", "http://localhost:8080")
            ret.put("port", 8080)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to set base map folder: ${e.message}")
        }
    }

    @PluginMethod
    fun checkStoragePermission(call: PluginCall) {
        val ret = JSObject()
        val hasPermission = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            // Android 11+ (API 30+) - Check MANAGE_EXTERNAL_STORAGE
            android.os.Environment.isExternalStorageManager()
        } else {
            // Android 10 and below - Check READ_EXTERNAL_STORAGE
            val permission = android.Manifest.permission.READ_EXTERNAL_STORAGE
            android.content.pm.PackageManager.PERMISSION_GRANTED == 
                context.checkSelfPermission(permission)
        }
        ret.put("hasPermission", hasPermission)
        call.resolve(ret)
    }
}

/**
 * Lightweight HTTP server that serves tiles from a user-selected SAF folder:
 * <selectedFolder>/{z}/{x}/{y}.pbf
 */
class TileServer(
    private val context: Context,
    folderUri: Uri,
    private val port: Int,
    private var useTms: Boolean = false
) : NanoHTTPD("127.0.0.1", port) {

    // Mutable base directory - can be updated without restarting server
    @Volatile
    private var baseDir: File = resolveBaseDir(folderUri)
    
    private fun resolveBaseDir(uri: Uri): File = when {
        uri.scheme == "file" -> {
            // Direct file:// URI
            File(uri.path ?: throw IllegalArgumentException("Invalid file URI path"))
        }
        uri.scheme == "content" -> {
            // Extract file path from content URI using DocumentsContract
            val docId = android.provider.DocumentsContract.getTreeDocumentId(uri)
            val split = docId.split(":")
            if (split.size == 2) {
                val type = split[0]
                val relPath = split[1]
                if (type == "primary") {
                    // Primary external storage
                    val externalStorage = android.os.Environment.getExternalStorageDirectory()
                    File(externalStorage, relPath)
                } else {
                    // Other storage volumes
                    val storageManager = context.getSystemService(android.os.storage.StorageManager::class.java)
                    val storageVolumes = storageManager?.storageVolumes
                    val volume = storageVolumes?.find { it.uuid == type }
                    volume?.directory?.let { volumeDir ->
                        File(volumeDir, relPath)
                    } ?: throw IllegalArgumentException("Cannot resolve storage volume: $type")
                }
            } else {
                throw IllegalArgumentException("Invalid document ID format: $docId")
            }
        }
        else -> throw IllegalArgumentException("Unsupported URI scheme: ${uri.scheme}")
    }
    
    /**
     * Update the folder path without restarting the server
     */
    fun updateFolderPath(newFolderUri: Uri, newUseTms: Boolean = false) {
        baseDir = resolveBaseDir(newFolderUri)
        useTms = newUseTms
        android.util.Log.d("TileServer", "Folder path updated to: ${baseDir.absolutePath}")
    }

    /**
     * Custom base map folder, served under /basemap/ (swappable at runtime, same
     * server/port). Null when no custom base map is selected. Kept separate from
     * `baseDir` so the default tiles + user raster layers are never disturbed.
     */
    @Volatile
    private var basemapDir: File? = null

    fun updateBasemapFolder(newUri: Uri?) {
        basemapDir = try {
            newUri?.let { resolveBaseDir(it) }
        } catch (e: Exception) {
            android.util.Log.e("TileServer", "basemap folder resolve failed: ${e.message}")
            null
        }
        android.util.Log.d("TileServer", "Base map folder: ${basemapDir?.absolutePath ?: "(cleared)"}")
    }

    override fun serve(session: NanoHTTPD.IHTTPSession): NanoHTTPD.Response {
        return try {
            val uri = session.uri

            // Raster tile route delegated to RasterTilingPlugin (if registered).
            // Pattern: /layers/<layerId>/<z>/<x>/<y>.webp
            // Sits before the pbf pattern so a layerId starting with digits
            // can't be mis-routed into the vector path.
            val rasterPattern = Regex("^/layers/([^/]+)/(\\d+)/(\\d+)/(\\d+)\\.webp$")
            val rasterMatch = rasterPattern.find(uri)
            if (rasterMatch != null) {
                val (id, zStr, xStr, yStr) = rasterMatch.destructured
                val bytes = OfflineTileServerPlugin.callRaster(
                    id, zStr.toInt(), xStr.toInt(), yStr.toInt()
                )
                return if (bytes != null) {
                    val res = NanoHTTPD.newFixedLengthResponse(
                        NanoHTTPD.Response.Status.OK,
                        "image/webp",
                        ByteArrayInputStream(bytes),
                        bytes.size.toLong()
                    )
                    res.addHeader("Cache-Control", "public, max-age=31536000, immutable")
                    res.addHeader("Access-Control-Allow-Origin", "*")
                    res
                } else {
                    val res = NanoHTTPD.newFixedLengthResponse(
                        NanoHTTPD.Response.Status.NOT_FOUND,
                        NanoHTTPD.MIME_PLAINTEXT,
                        "Raster tile not found: $id z=$zStr x=$xStr y=$yStr"
                    )
                    res.addHeader("Access-Control-Allow-Origin", "*")
                    res
                }
            }

            // ── /basemap/... — custom base map tiles + config.txt ──
            // Served from `basemapDir` (swappable via basemapSetFolder) with the
            // same immutable-cache policy as the raster route. The default tiles
            // (served from baseDir) and the stable port stay untouched.
            // ── /basemap/__levels — the zoom levels this pack actually has ──
            // Replaces the minZoom/maxZoom that config.txt used to declare: the
            // SERVER owns the folder, so it can list the numeric z subdirectories
            // directly instead of the app being told, or guessing by probing tiles
            // (which misreads a pack whose 0/0 tile is absent at deeper levels).
            // The deepest level is the pack's MAX NATIVE ZOOM - the last level with
            // real tiles, past which the renderer upscales rather than requesting
            // tiles that would 404. Not a cap on how far the user may zoom.
            //
            // Answered BEFORE the generic file route below, so a folder that
            // happens to contain a "__levels" entry cannot shadow it.
            if (uri == "/basemap/__levels") {
                val dir = basemapDir ?: return corsNotFound("No base map folder set")
                val levels = (dir.listFiles() ?: emptyArray())
                    .filter { it.isDirectory }
                    .mapNotNull { it.name.toIntOrNull() }
                    .sorted()

                // Extras used to CHECK the projection/format picked in the Map
                // Tiles dialog, so a wrong pick is reported instead of silently
                // rendering a blank map:
                //   sampleExt   - the extension really used on disk
                //   probeZ/maxX - widest column index at the shallowest level. A
                //     Mercator grid has at most 2^z columns, so more than that
                //     only fits EPSG:4326.
                // All locals are `val` so they stay smart-castable below.
                val probeZ = levels.firstOrNull()
                val zDir = probeZ?.let { File(dir, it.toString()) }
                val xs = (zDir?.listFiles() ?: emptyArray())
                    .filter { it.isDirectory }
                    .mapNotNull { it.name.toIntOrNull() }
                    .sorted()
                val maxX = xs.lastOrNull()
                val sampleExt = if (zDir != null && xs.isNotEmpty()) {
                    (File(zDir, xs.first().toString()).listFiles() ?: emptyArray())
                        .firstOrNull { it.isFile && it.extension.isNotEmpty() }
                        ?.extension
                        ?.lowercase()
                        // Constrained charset so the value is always JSON-safe.
                        ?.takeIf { it.matches(Regex("^[a-z0-9]{1,5}$")) }
                } else null

                val body = StringBuilder("{\"levels\":[")
                    .append(levels.joinToString(","))
                    .append("]")
                    .apply {
                        if (probeZ != null) append(",\"probeZ\":").append(probeZ)
                        if (maxX != null) append(",\"maxX\":").append(maxX)
                        if (sampleExt != null) {
                            append(",\"sampleExt\":\"").append(sampleExt).append("\"")
                        }
                    }
                    .append("}")
                    .toString()
                val res = NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.OK,
                    "application/json",
                    body
                )
                // Deliberately NOT cached: the folder can be swapped at runtime.
                res.addHeader("Cache-Control", "no-store")
                res.addHeader("Access-Control-Allow-Origin", "*")
                return res
            }

            if (uri == "/basemap" || uri.startsWith("/basemap/")) {
                val dir = basemapDir ?: return corsNotFound("No base map folder set")
                val rel = uri.removePrefix("/basemap").removePrefix("/")
                val file = File(dir, rel)
                // Path-guard: must stay within the base map folder (separator-aware
                // so a sibling like ".../tiles2" can't match ".../tiles").
                val dirCanon = dir.canonicalPath
                val fileCanon = file.canonicalPath
                if (fileCanon != dirCanon &&
                    !fileCanon.startsWith(dirCanon + File.separator)
                ) {
                    val res = NanoHTTPD.newFixedLengthResponse(
                        NanoHTTPD.Response.Status.FORBIDDEN,
                        NanoHTTPD.MIME_PLAINTEXT,
                        "Forbidden"
                    )
                    res.addHeader("Access-Control-Allow-Origin", "*")
                    return res
                }
                if (!file.exists() || !file.isFile) {
                    return corsNotFound("Not found")
                }
                val bytes = file.readBytes()
                val res = NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.OK,
                    basemapMime(file.name),
                    ByteArrayInputStream(bytes),
                    bytes.size.toLong()
                )
                res.addHeader("Cache-Control", "public, max-age=31536000, immutable")
                res.addHeader("Access-Control-Allow-Origin", "*")
                return res
            }

            // Handle style.json request
            if (uri == "/style.json" || uri == "/style.json/") {
                return serveStyleJson()
            }

            // Handle font glyph requests: /fonts/{fontstack}/{range}.pbf
            val fontPattern = Regex("^/fonts/([^/]+)/([^/]+)\\.pbf$")
            val fontMatch = fontPattern.find(uri)

            if (fontMatch != null) {
                val (fontstack, range) = fontMatch.destructured
                return serveFontGlyph(fontstack, range)
            }

            // Handle tile requests: /{z}/{x}/{y}.pbf (no /tiles/ prefix)
            val tilePattern = Regex("^/(\\d+)/(\\d+)/(\\d+)\\.pbf$")
            val match = tilePattern.find(uri)

            if (match == null) {
                val res = NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.NOT_FOUND,
                    NanoHTTPD.MIME_PLAINTEXT,
                    "Not Found - Invalid pattern. Expected: /{z}/{x}/{y}.pbf"
                )
                res.addHeader("Access-Control-Allow-Origin", "*")
                return res
            }

            var (zStr, xStr, yStr) = match.destructured
            val originalZ = zStr
            val originalX = xStr
            val originalY = yStr

            // TMS flip if required
            if (useTms) {
                val z = zStr.toInt()
                val maxY = (1 shl z) - 1
                val y = yStr.toInt()
                yStr = (maxY - y).toString()
            }

            // Always read directly from filesystem - no caching
            // No fallback - if tile doesn't exist, return 404
            val bytes = readTileBytes(zStr, xStr, yStr)
                ?: run {
                    return NanoHTTPD.newFixedLengthResponse(
                        NanoHTTPD.Response.Status.NOT_FOUND,
                        NanoHTTPD.MIME_PLAINTEXT,
                        "Tile not found: z=$originalZ, x=$originalX, y=$originalY"
                    )
                }

            okTileResponse(bytes)
        } catch (e: Exception) {
            val res = NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.INTERNAL_ERROR,
                NanoHTTPD.MIME_PLAINTEXT,
                "Server error: ${e.message}"
            )
            res.addHeader("Access-Control-Allow-Origin", "*")
            return res
        }
    }

    private fun okTileResponse(bytes: ByteArray): NanoHTTPD.Response {
        val res = NanoHTTPD.newFixedLengthResponse(
            NanoHTTPD.Response.Status.OK,
            "application/x-protobuf",
            ByteArrayInputStream(bytes),
            bytes.size.toLong()
        )
        res.addHeader("Cache-Control", "no-cache, no-store, must-revalidate")
        res.addHeader("Pragma", "no-cache")
        res.addHeader("Expires", "0")
        res.addHeader("Access-Control-Allow-Origin", "*")
        return res
    }

    /**
     * Reads tile from:
     * <selectedFolder>/{z}/{x}/{y}.pbf
     *
     * Uses direct File API for fast access.
     * Returns null if tile doesn't exist (no fallback to lower zoom levels).
     */
    private fun readTileBytes(z: String, x: String, y: String): ByteArray? {
        try {
            val tileFile = File(baseDir, "$z/$x/$y.pbf")
            if (tileFile.exists() && tileFile.isFile) {
                return tileFile.readBytes()
            }
        } catch (e: Exception) {
            // Return null on any error
        }
        return null
    }

    /**
     * Serve style.json from root folder.
     * Returns 404 if style.json is not found - NEVER serves default style.
     */
    private fun serveStyleJson(): NanoHTTPD.Response {
        // Try to read style.json using File API
        try {
            val styleFile = File(baseDir, "style.json")
            if (styleFile.exists() && styleFile.isFile && styleFile.canRead()) {
                val bytes = styleFile.readBytes()
                val res = NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.OK,
                    "application/json",
                    ByteArrayInputStream(bytes),
                    bytes.size.toLong()
                )
                res.addHeader("Cache-Control", "no-cache, no-store, must-revalidate")
                res.addHeader("Pragma", "no-cache")
                res.addHeader("Expires", "0")
                res.addHeader("Access-Control-Allow-Origin", "*")
                return res
            } else {
                android.util.Log.w("TileServer", "style.json not accessible: exists=${styleFile.exists()}, canRead=${styleFile.canRead()}")
            }
        } catch (e: java.io.FileNotFoundException) {
            android.util.Log.w("TileServer", "Permission denied reading style.json - storage permission may be required")
            // Return 403 Forbidden for permission errors
            val res = NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.FORBIDDEN,
                "application/json",
                "{\"error\": \"Permission denied. Please grant storage permission in app settings.\"}"
            )
            res.addHeader("Access-Control-Allow-Origin", "*")
            return res
        } catch (e: Exception) {
            android.util.Log.e("TileServer", "Error reading style.json: ${e.message}", e)
            // Return 500 error for other errors
            val res = NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.INTERNAL_ERROR,
                "application/json",
                "{\"error\": \"Server error: ${e.message}\"}"
            )
            res.addHeader("Access-Control-Allow-Origin", "*")
            return res
        }
        
        // No fallback - return 404 if style.json doesn't exist
        val res = NanoHTTPD.newFixedLengthResponse(
            NanoHTTPD.Response.Status.NOT_FOUND,
            NanoHTTPD.MIME_PLAINTEXT,
            "style.json not found in tile directory"
        )
        res.addHeader("Access-Control-Allow-Origin", "*")
        return res
    }

    /**
     * Serve font glyph file from:
     * <selectedFolder>/fonts/{fontstack}/{range}.pbf
     */
    private fun serveFontGlyph(fontstack: String, range: String): NanoHTTPD.Response {
        try {
            // Decode URL-encoded fontstack (e.g., "Open%20Sans%20Regular" -> "Open Sans Regular")
            val decodedFontstack = java.net.URLDecoder.decode(fontstack, "UTF-8")
            val fontFile = File(baseDir, "fonts/$decodedFontstack/$range.pbf")
            
            if (fontFile.exists() && fontFile.isFile) {
                val bytes = fontFile.readBytes()
                val res = NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.OK,
                    "application/x-protobuf",
                    ByteArrayInputStream(bytes),
                    bytes.size.toLong()
                )
                res.addHeader("Cache-Control", "no-cache, no-store, must-revalidate")
                res.addHeader("Pragma", "no-cache")
                res.addHeader("Expires", "0")
                res.addHeader("Access-Control-Allow-Origin", "*")
                return res
            }
        } catch (e: Exception) {
            // Log error but continue to return 404
            android.util.Log.e("TileServer", "Error reading font: ${e.message}")
        }
        
        return NanoHTTPD.newFixedLengthResponse(
            NanoHTTPD.Response.Status.NOT_FOUND,
            NanoHTTPD.MIME_PLAINTEXT,
            "Font glyph not found: $fontstack/$range.pbf"
        )
    }

    /**
     * Helper to return error response
     */
    private fun errorResponse(message: String): NanoHTTPD.Response {
        return NanoHTTPD.newFixedLengthResponse(
            NanoHTTPD.Response.Status.NOT_FOUND,
            NanoHTTPD.MIME_PLAINTEXT,
            message
        )
    }

    /** 404 with the CORS header (browser tile loads require it). */
    private fun corsNotFound(message: String): NanoHTTPD.Response {
        val res = NanoHTTPD.newFixedLengthResponse(
            NanoHTTPD.Response.Status.NOT_FOUND,
            NanoHTTPD.MIME_PLAINTEXT,
            message
        )
        res.addHeader("Access-Control-Allow-Origin", "*")
        return res
    }

    /** MIME type for a base map file by extension. */
    private fun basemapMime(name: String): String {
        val n = name.lowercase()
        return when {
            n.endsWith(".png") -> "image/png"
            n.endsWith(".jpg") || n.endsWith(".jpeg") -> "image/jpeg"
            n.endsWith(".webp") -> "image/webp"
            n.endsWith(".json") -> "application/json"
            n.endsWith(".txt") -> "text/plain"
            n.endsWith(".pbf") -> "application/x-protobuf"
            else -> "application/octet-stream"
        }
    }
}
