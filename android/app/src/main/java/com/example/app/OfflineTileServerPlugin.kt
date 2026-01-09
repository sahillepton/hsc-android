package com.example.app

import android.content.Context
import android.content.Intent
import android.net.Uri
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

    private val root: DocumentFile? = DocumentFile.fromTreeUri(context, folderUri)

    override fun serve(session: NanoHTTPD.IHTTPSession): NanoHTTPD.Response {
        return try {
            val uri = session.uri
            
            // Handle style.json request
            if (uri == "/style.json" || uri == "/style.json/") {
                return serveStyleJson()
            }
            
            // Handle fonts/glyphs request: /fonts/{fontstack}/{range}.pbf
            val fontPattern = Regex("^/fonts/([^/]+)/(\\d+)-(\\d+)\\.pbf$")
            val fontMatch = fontPattern.find(uri)
            if (fontMatch != null) {
                val fontstack = fontMatch.groupValues[1]
                val rangeStart = fontMatch.groupValues[2]
                val rangeEnd = fontMatch.groupValues[3]
                return serveFontGlyphs(fontstack, rangeStart, rangeEnd)
            }
            
            // Handle sprite requests: /sprite.{ext} or /sprite@2x.{ext}
            val spritePattern = Regex("^/sprite(@2x)?\\.(json|png)$")
            val spriteMatch = spritePattern.find(uri)
            if (spriteMatch != null) {
                val scale = if (spriteMatch.groupValues[1].isNotEmpty()) "2x" else "1x"
                val ext = spriteMatch.groupValues[2]
                return serveSprite(scale, ext)
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
            // Try requested zoom level first, then fallback to lower zoom levels
            val bytes = readTileBytesWithFallback(zStr, xStr, yStr)
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
            val bytes = readTileBytes(currentZ.toString(), currentX.toString(), currentY.toString())
            if (bytes != null) {
                return bytes
            }
            
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
        val rootDir = root ?: return null

        try {
            // Get /{z} directory - always query filesystem directly
            val zDir = rootDir.findFile(z)
            if (zDir == null || !zDir.exists() || !zDir.isDirectory) {
                return null
            }
            
            // Get /{z}/{x} directory - always query filesystem directly
            val xDir = zDir.findFile(x)
            if (xDir == null || !xDir.exists() || !xDir.isDirectory) {
                return null
            }
            
            // Get /{z}/{x}/{y}.pbf file - always query filesystem directly
            val fileName = "$y.pbf"
            val tileFile = xDir.findFile(fileName)
            if (tileFile == null || !tileFile.exists() || !tileFile.isFile) {
                return null
            }

            val bytes = context.contentResolver.openInputStream(tileFile.uri)?.use { it.readBytes() }
            return bytes
        } catch (e: Exception) {
            return null
        }
    }

    /**
     * Serve style.json from root folder, or generate default if not found
     */
    private fun serveStyleJson(): NanoHTTPD.Response {
        val rootDir = root ?: return errorResponse("Root directory not available")
        
        // Try to read style.json from root folder first
        try {
            val styleFile = rootDir.findFile("style.json")
            if (styleFile != null && styleFile.exists() && styleFile.isFile) {
                val bytes = context.contentResolver.openInputStream(styleFile.uri)?.use { it.readBytes() }
                if (bytes != null) {
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
          ],
          "glyphs": "http://localhost:8080/fonts/{fontstack}/{range}.pbf",
          "sprite": "http://localhost:8080/sprite"
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
     * Serve font glyphs from fonts/{fontstack}/{rangeStart}-{rangeEnd}.pbf
     */
    private fun serveFontGlyphs(fontstack: String, rangeStart: String, rangeEnd: String): NanoHTTPD.Response {
        val rootDir = root ?: return errorResponse("Root directory not available")
        
        try {
            // Look for fonts/{fontstack}/{rangeStart}-{rangeEnd}.pbf
            val fontsDir = rootDir.findFile("fonts")
            if (fontsDir == null || !fontsDir.exists() || !fontsDir.isDirectory) {
                return emptyFontResponse()
            }
            
            val fontstackDir = fontsDir.findFile(fontstack)
            if (fontstackDir == null || !fontstackDir.exists() || !fontstackDir.isDirectory) {
                return emptyFontResponse()
            }
            
            val fontFileName = "$rangeStart-$rangeEnd.pbf"
            val fontFile = fontstackDir.findFile(fontFileName)
            if (fontFile == null || !fontFile.exists() || !fontFile.isFile) {
                return emptyFontResponse()
            }
            
            val bytes = context.contentResolver.openInputStream(fontFile.uri)?.use { it.readBytes() }
            if (bytes != null && bytes.isNotEmpty()) {
                val res = NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.OK,
                    "application/x-protobuf",
                    ByteArrayInputStream(bytes),
                    bytes.size.toLong()
                )
                res.addHeader("Cache-Control", "public, max-age=86400")
                res.addHeader("Access-Control-Allow-Origin", "*")
                return res
            }
        } catch (e: Exception) {
            // Ignore and return empty font
        }
        
        // Return empty font if not found (Mapbox will fallback to system fonts)
        return emptyFontResponse()
    }

    /**
     * Return empty font response (fallback to system fonts)
     */
    private fun emptyFontResponse(): NanoHTTPD.Response {
        val emptyPbf = ByteArray(0)
        val res = NanoHTTPD.newFixedLengthResponse(
            NanoHTTPD.Response.Status.OK,
            "application/x-protobuf",
            ByteArrayInputStream(emptyPbf),
            emptyPbf.size.toLong()
        )
        res.addHeader("Cache-Control", "public, max-age=86400")
        res.addHeader("Access-Control-Allow-Origin", "*")
        return res
    }

    /**
     * Serve sprite files: sprite.json, sprite.png, sprite@2x.png
     */
    private fun serveSprite(scale: String, ext: String): NanoHTTPD.Response {
        val rootDir = root ?: return errorResponse("Root directory not available")
        
        try {
            val fileName = if (scale == "2x") "sprite@2x.$ext" else "sprite.$ext"
            val spriteFile = rootDir.findFile(fileName)
            
            if (spriteFile == null || !spriteFile.exists() || !spriteFile.isFile) {
                return emptySpriteResponse(ext)
            }
            
            val bytes = context.contentResolver.openInputStream(spriteFile.uri)?.use { it.readBytes() }
            if (bytes != null && bytes.isNotEmpty()) {
                val contentType = if (ext == "json") "application/json" else "image/png"
                val res = NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.OK,
                    contentType,
                    ByteArrayInputStream(bytes),
                    bytes.size.toLong()
                )
                res.addHeader("Cache-Control", "public, max-age=86400")
                res.addHeader("Access-Control-Allow-Origin", "*")
                return res
            }
        } catch (e: Exception) {
            // Ignore and return empty sprite
        }
        
        return emptySpriteResponse(ext)
    }

    /**
     * Return empty sprite response
     */
    private fun emptySpriteResponse(ext: String): NanoHTTPD.Response {
        if (ext == "json") {
            val emptySprite = "{}"
            val res = NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.OK,
                "application/json",
                emptySprite
            )
            res.addHeader("Cache-Control", "public, max-age=86400")
            res.addHeader("Access-Control-Allow-Origin", "*")
            return res
        } else {
            // Return 204 No Content for PNG if not available
            return NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.NO_CONTENT,
                "image/png",
                ""
            )
        }
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
