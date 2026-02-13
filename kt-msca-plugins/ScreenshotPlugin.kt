package org.deal.mcsa.plugins

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Log
import android.view.PixelCopy
import android.view.View
import android.view.Window
import android.webkit.WebView
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@CapacitorPlugin(name = "Screenshot")
class ScreenshotPlugin : Plugin() {

    @PluginMethod
    fun captureAndSave(call: PluginCall) {
        call.setKeepAlive(true)
        
        try {
            // Get the Activity from the plugin context
            val activity = activity ?: run {
                call.reject("Activity is not available")
                return
            }

            val window = activity.window ?: run {
                call.reject("Window is not available")
                return
            }

            // Get window dimensions
            val decorView = window.decorView
            val width = decorView.width
            val height = decorView.height

            if (width <= 0 || height <= 0) {
                Log.e("ScreenshotPlugin", "Invalid window dimensions: ${width}x${height}")
                call.reject("Invalid window dimensions")
                return
            }

            // Create bitmap with window dimensions
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)

            // Use PixelCopy to capture the actual rendered window surface (API 26+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                PixelCopy.request(window, bitmap, { copyResult ->
                    if (copyResult == PixelCopy.SUCCESS) {
                        // Successfully captured the window surface (including WebView)
                        val savedPath = saveToGallery(bitmap)
                        if (savedPath != null) {
                            val result = JSObject()
                            result.put("success", true)
                            result.put("path", savedPath)
                            call.resolve(result)
                        } else {
                            call.reject("Failed to save screenshot to gallery")
                        }
                    } else {
                        Log.e("ScreenshotPlugin", "PixelCopy failed: $copyResult")
                        call.reject("Failed to capture screenshot: PixelCopy error $copyResult")
                    }
                    call.setKeepAlive(false)
                }, Handler(Looper.getMainLooper()))
            } else {
                call.reject("Screenshot requires Android API 26 or higher")
                call.setKeepAlive(false)
            }

        } catch (e: Exception) {
            Log.e("ScreenshotPlugin", "Error capturing screenshot", e)
            call.reject("Screenshot failed: ${e.message}")
            call.setKeepAlive(false)
        }
    }


    private fun saveToGallery(bitmap: Bitmap): String? {
        val context = context ?: return null

        return try {
            val fileName = "HSC_Map_${SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())}.png"
            val mimeType = "image/png"

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10+ (API 29+) - Use MediaStore API
                val contentValues = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                    put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/HSC Maps")
                }

                val uri = context.contentResolver.insert(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    contentValues
                )

                if (uri == null) {
                    Log.e("ScreenshotPlugin", "Failed to create MediaStore entry")
                    return null
                }

                context.contentResolver.openOutputStream(uri)?.use { outputStream ->
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream)
                    outputStream.flush()
                }

                // Return the URI path
                uri.toString()
            } else {
                // Android 9 and below - Use legacy file system
                val picturesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
                val hscDir = File(picturesDir, "HSC Maps")
                if (!hscDir.exists()) {
                    if (!hscDir.mkdirs()) {
                        Log.e("ScreenshotPlugin", "Failed to create directory")
                        return null
                    }
                }

                val imageFile = File(hscDir, fileName)
                FileOutputStream(imageFile).use { fos ->
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, fos)
                    fos.flush()
                }

                // Notify media scanner
                val mediaScanIntent = android.content.Intent(android.content.Intent.ACTION_MEDIA_SCANNER_SCAN_FILE).apply {
                    data = Uri.fromFile(imageFile)
                }
                context.sendBroadcast(mediaScanIntent)

                imageFile.absolutePath
            }
        } catch (e: IOException) {
            Log.e("ScreenshotPlugin", "Error saving bitmap", e)
            null
        }
    }
}

