package com.example.app

import android.content.Context
import android.content.Intent
import android.net.Uri
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
        val uriString = call.getString("uri")
        if (uriString.isNullOrBlank()) {
            call.reject("URI is required")
            return
        }

        val uri = Uri.parse(uriString)
        val useTms = call.getBoolean("useTms") ?: false

        try {
            stopServerInternal()

            val server = TileServer(
                context = context,
                folderUri = uri,
                port = 8080,
                useTms = useTms
            )

            try {
                // Start server in daemon mode (runs in background thread)
                server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            } catch (e: Exception) {
                throw e
            }
            
            // Give server a moment to initialize
            Thread.sleep(200)
            
            tileServer = server

            val ret = JSObject()
            // Use localhost instead of 127.0.0.1 - some Android WebViews prefer localhost
            val baseUrl = "http://localhost:8080"
            ret.put("baseUrl", baseUrl)
            ret.put("port", 8080)
            call.resolve(ret)
        } catch (e: Exception) {
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

    // Get base directory path for File API access
    private val baseDir: File = when {
        folderUri.scheme == "file" -> {
            // Direct file:// URI
            File(folderUri.path ?: throw IllegalArgumentException("Invalid file URI path"))
        }
        folderUri.scheme == "content" -> {
            // Extract file path from content URI using DocumentsContract
            val docId = android.provider.DocumentsContract.getTreeDocumentId(folderUri)
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
        else -> throw IllegalArgumentException("Unsupported URI scheme: ${folderUri.scheme}")
    }

    override fun serve(session: NanoHTTPD.IHTTPSession): NanoHTTPD.Response {
        return try {
            val uri = session.uri
            
            // Handle style.json request
            if (uri == "/style.json" || uri == "/style.json/") {
                return serveStyleJson()
            }
            
            // Handle tile requests: /{z}/{x}/{y}.pbf (no /tiles/ prefix)
            val tilePattern = Regex("^/(\\d+)/(\\d+)/(\\d+)\\.pbf$")
            val match = tilePattern.find(uri)

            if (match == null) {
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
            NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.INTERNAL_ERROR,
                NanoHTTPD.MIME_PLAINTEXT,
                "Server error: ${e.message}"
            )
        }
    }

    private fun okTileResponse(bytes: ByteArray): NanoHTTPD.Response {
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
     * Serve style.json from root folder, or generate default if not found
     */
    private fun serveStyleJson(): NanoHTTPD.Response {
        // Try to read style.json using File API
        try {
            val styleFile = File(baseDir, "style.json")
            if (styleFile.exists() && styleFile.isFile) {
                val bytes = styleFile.readBytes()
                val res = NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.OK,
                    "application/json",
                    ByteArrayInputStream(bytes),
                    bytes.size.toLong()
                )
                res.addHeader("Cache-Control", "public, max-age=3600")
                res.addHeader("Access-Control-Allow-Origin", "*")
                return res
            }
        } catch (e: Exception) {
            // Ignore and generate default
        }
        
        // Fallback: generate default style.json
        return serveDefaultStyleJson()
    }

    /**
     * Generate default style.json for offline tiles
     */
    private fun serveDefaultStyleJson(): NanoHTTPD.Response {
        val styleJson = """
        {
          "version": 8,
          "id": "86575a9a-670f-4772-be37-2c0c00fe1f68",
          "name": "Offline Map Style",
          "sources": {
            "openmaptiles": {
              "type": "vector",
              "tiles": ["http://localhost:8080/{z}/{x}/{y}.pbf"],
              "minzoom": 0,
              "maxzoom": 14
            }
          },
          "layers": [
            {
              "id": "background",
              "type": "background",
              "layout": {"visibility": "visible"},
              "paint": {
                "background-color": {
                  "stops": [[6, "hsl(47,79%,94%)"], [14, "hsl(42,49%,93%)"]]
                }
              }
            },
            {
              "id": "water",
              "type": "fill",
              "source": "openmaptiles",
              "source-layer": "water",
              "layout": {"visibility": "visible"},
              "paint": {
                "fill-color": [
                  "match",
                  ["get", "intermittent"],
                  1, "hsl(205,91%,83%)",
                  "hsl(204,92%,75%)"
                ],
                "fill-opacity": ["match", ["get", "intermittent"], 1, 0.85, 1],
                "fill-antialias": true
              },
              "filter": ["all"]
            },
            {
              "id": "road_network",
              "type": "line",
              "source": "openmaptiles",
              "source-layer": "transportation",
              "minzoom": 4,
              "layout": {"line-cap": "butt", "line-join": "round", "visibility": "visible"},
              "paint": {
                "line-color": [
                  "match",
                  ["get", "class"],
                  "motorway", "hsl(35,100%,76%)",
                  ["trunk", "primary"], "hsl(48,100%,83%)",
                  "hsl(0,0%,100%)"
                ],
                "line-width": [
                  "interpolate",
                  ["linear", 2],
                  ["zoom"],
                  5, 0.5,
                  10, 1.5,
                  12, 2.5,
                  14, 4,
                  16, 8,
                  20, 24
                ]
              },
              "filter": ["all", ["!=", "brunnel", "tunnel"], ["!in", "class", "ferry", "rail", "transit", "pier", "bridge", "path", "aerialway"]]
            },
            {
              "id": "building",
              "type": "fill",
              "source": "openmaptiles",
              "source-layer": "building",
              "minzoom": 13,
              "layout": {"visibility": "visible"},
              "paint": {
                "fill-color": "hsl(30,6%,73%)",
                "fill-opacity": 0.3,
                "fill-outline-color": {
                  "base": 1,
                  "stops": [[13, "hsla(35, 6%, 79%, 0.3)"], [14, "hsl(35, 6%, 79%)"]]
                }
              }
            },
            {
              "id": "place",
              "type": "symbol",
              "source": "openmaptiles",
              "source-layer": "place",
              "minzoom": 4,
              "layout": {
                "text-font": ["Noto Sans Regular"],
                "text-size": {"stops": [[4, 11], [8, 13], [12, 16], [16, 20]]},
                "text-field": "{name}",
                "visibility": "visible",
                "text-anchor": "bottom",
                "text-max-width": 8
              },
              "paint": {
                "text-color": "hsl(0,0%,20%)",
                "text-halo-color": "hsl(0,0%,100%)",
                "text-halo-width": 1.2
              },
              "filter": ["all", ["!in", "class", "continent", "country", "state", "region", "province", "city", "town"]]
            },
            {
              "id": "city",
              "type": "symbol",
              "source": "openmaptiles",
              "source-layer": "place",
              "minzoom": 4,
              "maxzoom": 16,
              "layout": {
                "text-font": ["Noto Sans Regular"],
                "text-size": {"stops": [[4, 12], [8, 16], [12, 20], [16, 28]]},
                "text-field": "{name}",
                "visibility": "visible",
                "text-anchor": "bottom",
                "text-max-width": 8
              },
              "paint": {
                "text-color": "hsl(0,0%,20%)",
                "text-halo-color": "hsl(0,0%,100%)",
                "text-halo-width": 0.8
              },
              "filter": ["all", ["==", "class", "city"]]
            },
            {
              "id": "country",
              "type": "symbol",
              "source": "openmaptiles",
              "source-layer": "place",
              "minzoom": 1,
              "maxzoom": 12,
              "layout": {
                "text-font": ["Noto Sans Regular"],
                "text-size": {"stops": [[0, 8], [1, 10], [4, 16], [8, 22]]},
                "text-field": "{name}",
                "visibility": "visible",
                "text-max-width": 8
              },
              "paint": {
                "text-color": "hsl(0, 0%, 20%)",
                "text-halo-color": "hsl(0,0%,100%)",
                "text-halo-width": 1
              },
              "filter": ["all", ["==", "class", "country"], ["has", "iso_a2"]]
            }
          ]
        }
        """.trimIndent()
        
        val res = NanoHTTPD.newFixedLengthResponse(
            NanoHTTPD.Response.Status.OK,
            "application/json",
            styleJson
        )
        res.addHeader("Cache-Control", "public, max-age=3600")
        res.addHeader("Access-Control-Allow-Origin", "*")
        return res
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
}
