package com.example.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.documentfile.provider.DocumentFile
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import fi.iki.elonen.NanoHTTPD
import java.io.ByteArrayInputStream

@CapacitorPlugin(name = "OfflineTileServer")
class OfflineTileServerPlugin : Plugin() {

    private val TAG = "CAPACITOR_OfflineTileServer"
    private var tileServer: TileServer? = null

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

            // Save for future sessions
            val prefs = context.getSharedPreferences("tile_server_prefs", Context.MODE_PRIVATE)
            prefs.edit().putString("tile_folder_uri", treeUri.toString()).apply()

            val ret = JSObject()
            ret.put("uri", treeUri.toString())
            call.resolve(ret)
        } catch (e: Exception) {
            Log.e(TAG, "CAPACITOR_HAHA Error selecting folder", e)
            call.reject("Failed to select folder: ${e.message}")
        }
    }

    @PluginMethod
    fun getSavedFolderUri(call: PluginCall) {
        val prefs = context.getSharedPreferences("tile_server_prefs", Context.MODE_PRIVATE)
        val uriString = prefs.getString("tile_folder_uri", null)

        val ret = JSObject()
        ret.put("uri", uriString)
        call.resolve(ret)
    }

    @PluginMethod
    fun startTileServer(call: PluginCall) {
        Log.d(TAG, "CAPACITOR_HAHA startTileServer called")
        val uriString = call.getString("uri")
        if (uriString.isNullOrBlank()) {
            Log.e(TAG, "CAPACITOR_HAHA URI is null or blank")
            call.reject("URI is required")
            return
        }

        Log.d(TAG, "CAPACITOR_HAHA Parsing URI: $uriString")
        val uri = Uri.parse(uriString)
        val useTms = call.getBoolean("useTms") ?: false
        Log.d(TAG, "CAPACITOR_HAHA TMS format: $useTms")

        try {
            Log.d(TAG, "CAPACITOR_HAHA Stopping existing server if running...")
            stopServerInternal()

            Log.d(TAG, "CAPACITOR_HAHA Creating TileServer instance...")
            val server = TileServer(
                context = context,
                folderUri = uri,
                port = 8080,
                useTms = useTms
            )

            Log.d(TAG, "CAPACITOR_HAHA Starting server on port 8080...")
            try {
                // Start server in daemon mode (runs in background thread)
                server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
                Log.d(TAG, "CAPACITOR_HAHA server.start() completed without exception")
            } catch (e: Exception) {
                Log.e(TAG, "CAPACITOR_HAHA ❌ Exception during server.start():", e)
                Log.e(TAG, "CAPACITOR_HAHA Exception type: ${e.javaClass.name}")
                Log.e(TAG, "CAPACITOR_HAHA Exception message: ${e.message}")
                e.printStackTrace()
                throw e
            }
            
            // Give server a moment to initialize
            Thread.sleep(200)
            
            // Verify server is actually running
            val isAlive = try {
                val alive = server.isAlive
                Log.d(TAG, "CAPACITOR_HAHA Server isAlive check: $alive")
                alive
            } catch (e: Exception) {
                Log.e(TAG, "CAPACITOR_HAHA Error checking isAlive:", e)
                false
            }
            
            // Check if server is listening on the port
            val listeningPort = try {
                server.listeningPort
            } catch (e: Exception) {
                -1
            }
            
            if (isAlive && listeningPort > 0) {
                Log.d(TAG, "CAPACITOR_HAHA ✅ Tile server started successfully!")
                Log.d(TAG, "CAPACITOR_HAHA    - Port: $listeningPort")
                Log.d(TAG, "CAPACITOR_HAHA    - isAlive: $isAlive")
                Log.d(TAG, "CAPACITOR_HAHA    - Server should be accessible at: http://127.0.0.1:$listeningPort")
            } else {
                Log.w(TAG, "CAPACITOR_HAHA ⚠️ Server start() completed but verification failed")
                Log.w(TAG, "CAPACITOR_HAHA    - isAlive: $isAlive")
                Log.w(TAG, "CAPACITOR_HAHA    - listeningPort: $listeningPort")
                Log.w(TAG, "CAPACITOR_HAHA    - Continuing anyway, but server might not be accessible...")
            }
            
            tileServer = server

            val ret = JSObject()
            // Use localhost instead of 127.0.0.1 - some Android WebViews prefer localhost
            val baseUrl = "http://localhost:8080"
            ret.put("baseUrl", baseUrl)
            ret.put("port", 8080)
            Log.d(TAG, "CAPACITOR_HAHA Resolving call with baseUrl: $baseUrl")
            call.resolve(ret)
        } catch (e: Exception) {
            Log.e(TAG, "CAPACITOR_HAHA ❌ Error starting tile server", e)
            Log.e(TAG, "CAPACITOR_HAHA Exception type: ${e.javaClass.simpleName}")
            Log.e(TAG, "CAPACITOR_HAHA Exception message: ${e.message}")
            e.printStackTrace()
            call.reject("Failed to start tile server: ${e.message}")
        }
    }

    @PluginMethod
    fun stopTileServer(call: PluginCall) {
        stopServerInternal()
        call.resolve()
    }

    private fun stopServerInternal() {
        tileServer?.stop()
        tileServer = null
    }
}

/**
 * Lightweight HTTP server that serves tiles from a user-selected SAF folder:
 * <selectedFolder>/{z}/{x}/{y}.pbf
 */
class TileServer(
    private val context: Context,
    private val folderUri: Uri,
    private val port: Int,
    private val useTms: Boolean = false
) : NanoHTTPD("127.0.0.1", port) {

    private val TAG = "CAPACITOR_TileServer"

    init {
        Log.d(TAG, "CAPACITOR_HAHA TileServer constructor called")
        Log.d(TAG, "CAPACITOR_HAHA   - Port: $port")
        Log.d(TAG, "CAPACITOR_HAHA   - Folder URI: $folderUri")
        Log.d(TAG, "CAPACITOR_HAHA   - TMS format: $useTms")
    }

    private val root: DocumentFile? = DocumentFile.fromTreeUri(context, folderUri).also {
        if (it == null) {
            Log.e(TAG, "CAPACITOR_HAHA ⚠️ Failed to create DocumentFile from URI: $folderUri")
            Log.e(TAG, "CAPACITOR_HAHA    This usually means the URI permission was not granted or is invalid")
        } else {
            Log.d(TAG, "CAPACITOR_HAHA ✅ DocumentFile created successfully from URI")
            Log.d(TAG, "CAPACITOR_HAHA    Root exists: ${it.exists()}")
            Log.d(TAG, "CAPACITOR_HAHA    Root is directory: ${it.isDirectory}")
            Log.d(TAG, "CAPACITOR_HAHA    Root name: ${it.name}")
        }
    }

    override fun serve(session: NanoHTTPD.IHTTPSession): NanoHTTPD.Response {
        return try {
            val uri = session.uri
            val method = session.method?.name ?: "UNKNOWN"
            Log.d(TAG, "CAPACITOR_HAHA Incoming request: $method $uri")
            // Expect: /{z}/{x}/{y}.pbf (no /tiles/ prefix)
            val tilePattern = Regex("^/(\\d+)/(\\d+)/(\\d+)\\.pbf$")
            val match = tilePattern.find(uri)

            if (match == null) {
                Log.w(TAG, "CAPACITOR_HAHA Invalid tile request pattern: $uri (expected: /{z}/{x}/{y}.pbf)")
                return NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.NOT_FOUND,
                    NanoHTTPD.MIME_PLAINTEXT,
                    "Not Found - Invalid pattern. Expected: /{z}/{x}/{y}.pbf"
                )
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
                Log.d(TAG, "CAPACITOR_HAHA Requested tile: z=$originalZ, x=$originalX, y=$originalY (TMS) -> z=$zStr, x=$xStr, y=$yStr (XYZ)")
            } else {
                Log.d(TAG, "CAPACITOR_HAHA Requested tile: z=$zStr, x=$xStr, y=$yStr")
            }

            // Always read directly from filesystem - no caching
            // Try requested zoom level first, then fallback to lower zoom levels
            val bytes = readTileBytesWithFallback(zStr, xStr, yStr)
                ?: run {
                    Log.e(TAG, "CAPACITOR_HAHA ❌ Tile NOT FOUND: z=$originalZ, x=$originalX, y=$originalY (checked down to zoom 0)")
                    return NanoHTTPD.newFixedLengthResponse(
                        NanoHTTPD.Response.Status.NOT_FOUND,
                        NanoHTTPD.MIME_PLAINTEXT,
                        "Tile not found: z=$originalZ, x=$originalX, y=$originalY"
                    )
                }

            okTileResponse(bytes)
        } catch (e: Exception) {
            Log.e(TAG, "CAPACITOR_HAHA ❌ Exception in serve() method", e)
            e.printStackTrace()
            NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.INTERNAL_ERROR,
                NanoHTTPD.MIME_PLAINTEXT,
                "Server error: ${e.message}"
            )
        }
    }

    private fun okTileResponse(bytes: ByteArray): NanoHTTPD.Response {
        Log.d(TAG, "CAPACITOR_HAHA Served tile (${bytes.size} bytes)")
        val res = NanoHTTPD.newFixedLengthResponse(
            NanoHTTPD.Response.Status.OK,
            "application/x-protobuf",
            ByteArrayInputStream(bytes),
            bytes.size.toLong()
        )
        res.addHeader("Cache-Control", "public, max-age=3600")
        res.addHeader("Access-Control-Allow-Origin", "*")
        return res
    }

    /**
     * Reads tile with fallback to lower zoom levels.
     * If requested tile z/x/y doesn't exist, tries z-1/x/2/y/2, z-2/x/4/y/4, etc.
     * Always reads directly from filesystem - no caching.
     */
    private fun readTileBytesWithFallback(z: String, x: String, y: String): ByteArray? {
        var currentZ = z.toIntOrNull() ?: return null
        var currentX = x.toLongOrNull() ?: return null
        var currentY = y.toLongOrNull() ?: return null
        val originalZ = currentZ
        val originalX = currentX
        val originalY = currentY
        
        // Try requested zoom level first, then go down one zoom level at a time
        while (currentZ >= 0) {
            Log.d(TAG, "CAPACITOR_HAHA Checking tile: z=$currentZ, x=$currentX, y=$currentY")
            val bytes = readTileBytes(currentZ.toString(), currentX.toString(), currentY.toString())
            if (bytes != null) {
                if (currentZ < originalZ) {
                    Log.d(TAG, "CAPACITOR_HAHA ✅ Using fallback tile: z=$currentZ, x=$currentX, y=$currentY (requested: z=$originalZ, x=$originalX, y=$originalY)")
                } else {
                    Log.d(TAG, "CAPACITOR_HAHA ✅ Found requested tile: z=$currentZ, x=$currentX, y=$currentY")
                }
                return bytes
            }
            
            Log.d(TAG, "CAPACITOR_HAHA ❌ Tile not found: z=$currentZ, x=$currentX, y=$currentY")
            
            // Move to lower zoom level: divide x and y by 2
            if (currentZ > 0) {
                currentZ--
                currentX /= 2
                currentY /= 2
            } else {
                break
            }
        }
        
        return null
    }

    /**
     * Reads tile from:
     * <selectedFolder>/{z}/{x}/{y}.pbf
     *
     * Always reads directly from filesystem - no caching.
     */
    private fun readTileBytes(z: String, x: String, y: String): ByteArray? {
        val rootDir = root ?: run {
            Log.e(TAG, "CAPACITOR_HAHA ❌ Root DocumentFile is null. Check folderUri permission.")
            return null
        }

        try {
            Log.d(TAG, "CAPACITOR_HAHA Reading tile: z=$z, x=$x, y=$y")
            Log.d(TAG, "CAPACITOR_HAHA   Root directory exists: ${rootDir.exists()}, isDirectory: ${rootDir.isDirectory}, name: ${rootDir.name}")
            
            // Get /{z} directory - always query filesystem directly
            val zDir = rootDir.findFile(z)
            if (zDir == null) {
                Log.w(TAG, "CAPACITOR_HAHA   ❌ Zoom directory not found: $z")
                // List available directories for debugging
                val children = rootDir.listFiles()
                if (children != null && children.isNotEmpty()) {
                    Log.d(TAG, "CAPACITOR_HAHA   Available directories in root: ${children.map { it.name }.take(10).joinToString()}")
                }
                return null
            }
            Log.d(TAG, "CAPACITOR_HAHA   ✅ Found z directory: ${zDir.name}, exists: ${zDir.exists()}, isDir: ${zDir.isDirectory}")
            if (!zDir.exists() || !zDir.isDirectory) {
                Log.w(TAG, "CAPACITOR_HAHA   ❌ z directory invalid: exists=${zDir.exists()}, isDirectory=${zDir.isDirectory}")
                return null
            }
            
            // Get /{z}/{x} directory - always query filesystem directly
            val xDir = zDir.findFile(x)
            if (xDir == null) {
                Log.w(TAG, "CAPACITOR_HAHA   ❌ X directory not found: $z/$x")
                // List available directories for debugging
                val children = zDir.listFiles()
                if (children != null && children.isNotEmpty()) {
                    Log.d(TAG, "CAPACITOR_HAHA   Available directories in z=$z: ${children.map { it.name }.take(10).joinToString()}")
                }
                return null
            }
            Log.d(TAG, "CAPACITOR_HAHA   ✅ Found x directory: ${xDir.name}, exists: ${xDir.exists()}, isDir: ${xDir.isDirectory}")
            if (!xDir.exists() || !xDir.isDirectory) {
                Log.w(TAG, "CAPACITOR_HAHA   ❌ x directory invalid: exists=${xDir.exists()}, isDirectory=${xDir.isDirectory}")
                return null
            }
            
            // Get /{z}/{x}/{y}.pbf file - always query filesystem directly
            val fileName = "$y.pbf"
            Log.d(TAG, "CAPACITOR_HAHA   Looking for file: $fileName in directory $z/$x")
            val tileFile = xDir.findFile(fileName)
            if (tileFile == null) {
                Log.w(TAG, "CAPACITOR_HAHA   ❌ Tile file not found: $z/$x/$fileName")
                // List ALL available files for debugging
                val children = xDir.listFiles()
                if (children != null) {
                    if (children.isEmpty()) {
                        Log.w(TAG, "CAPACITOR_HAHA   Directory $z/$x is EMPTY - no files found!")
                    } else {
                        Log.d(TAG, "CAPACITOR_HAHA   Total files in $z/$x: ${children.size}")
                        Log.d(TAG, "CAPACITOR_HAHA   ALL files in $z/$x: ${children.map { it.name }.joinToString(", ")}")
                        // Check if there's a file with similar name (case sensitivity issue?)
                        val similar = children.filter { it.name.equals(fileName, ignoreCase = true) }
                        if (similar.isNotEmpty()) {
                            Log.w(TAG, "CAPACITOR_HAHA   ⚠️ Found similar filename (case mismatch?): ${similar.map { it.name }.joinToString()}")
                        }
                    }
                } else {
                    Log.w(TAG, "CAPACITOR_HAHA   Could not list files in directory $z/$x - listFiles() returned null")
                }
                return null
            }
            Log.d(TAG, "CAPACITOR_HAHA   ✅ Found tile file: ${tileFile.name}, exists: ${tileFile.exists()}, isFile: ${tileFile.isFile}")
            if (!tileFile.exists() || !tileFile.isFile) {
                Log.w(TAG, "CAPACITOR_HAHA   ❌ Tile file invalid: exists=${tileFile.exists()}, isFile=${tileFile.isFile}")
                return null
            }

            val bytes = context.contentResolver.openInputStream(tileFile.uri)?.use { it.readBytes() }
            if (bytes != null) {
                Log.d(TAG, "CAPACITOR_HAHA ✅ Successfully read tile $z/$x/$y.pbf (${bytes.size} bytes)")
            } else {
                Log.e(TAG, "CAPACITOR_HAHA ❌ Failed to read bytes from tile file: $z/$x/$y.pbf")
            }
            return bytes
        } catch (e: Exception) {
            Log.e(TAG, "CAPACITOR_HAHA ❌ Exception reading tile $z/$x/$y", e)
            e.printStackTrace()
            return null
        }
    }
}
