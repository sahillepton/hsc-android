package org.deal.mcsa.plugins

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

@CapacitorPlugin(name = "NativeUploader")
class NativeUploaderPlugin : Plugin() {

    private val ioExecutor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    @PluginMethod
    fun pickAndStageMany(call: PluginCall) {
        call.setKeepAlive(true)

        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }

        startActivityForResult(call, intent, "onPickedFiles")
    }

    @PluginMethod
    fun deleteFile(call: PluginCall) {
        val absolutePath = call.getString("absolutePath")
        if (absolutePath.isNullOrEmpty()) {
            call.reject("absolutePath is required")
            return
        }

        ioExecutor.execute {
            try {
                val file = File(absolutePath)
                if (!file.exists()) {
                    rejectOnMain(call, "File does not exist: $absolutePath")
                    return@execute
                }

                val deleted = file.delete()
                if (deleted) {
                    resolveOnMain(call, JSObject())
                } else {
                    rejectOnMain(call, "Failed to delete file: $absolutePath")
                }
            } catch (e: Exception) {
                rejectOnMain(call, "Error deleting file: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun saveExtractedFile(call: PluginCall) {
        val base64Data = call.getString("base64Data")
        val fileName = call.getString("fileName")
        
        if (base64Data.isNullOrEmpty()) {
            call.reject("base64Data is required")
            return
        }
        if (fileName.isNullOrEmpty()) {
            call.reject("fileName is required")
            return
        }

        ioExecutor.execute {
            try {
                // Use the same directory as pickAndStageMany
                var docsRoot = context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS)
                if (docsRoot == null) docsRoot = context.filesDir

                val destDir = File(docsRoot, "HSC-SESSIONS/FILES")
                destDir.mkdirs()

                val finalFile = File(destDir, fileName)

                // Decode base64 and write to file
                val fileData = Base64.decode(base64Data, Base64.DEFAULT)
                FileOutputStream(finalFile).use { out ->
                    out.write(fileData)
                    out.flush()
                }

                var mimeType = call.getString("mimeType")
                if (mimeType == null) mimeType = "application/octet-stream"

                val result = JSObject()
                result.put("absolutePath", finalFile.absolutePath)
                result.put("logicalPath", "DOCUMENTS/HSC-SESSIONS/FILES/${finalFile.name}")
                result.put("size", finalFile.length())
                result.put("mimeType", mimeType)

                resolveOnMain(call, result)
            } catch (e: Exception) {
                rejectOnMain(call, "Save failed: ${e.message}")
            }
        }
    }

    @ActivityCallback
    private fun onPickedFiles(call: PluginCall, result: ActivityResult) {
        val resultCode = result.resultCode
        val data = result.data

        if (resultCode == Activity.RESULT_CANCELED) {
            rejectOnMain(call, "User cancelled")
            return
        }

        if (data == null) {
            rejectOnMain(call, "No intent data returned")
            return
        }

        var maxFiles = call.getInt("maxFiles") ?: 2
        if (maxFiles < 1) maxFiles = 1
        if (maxFiles > 2) maxFiles = 2

        val uris = mutableListOf<Uri>()
        val clipData = data.clipData

        if (clipData != null) {
            for (i in 0 until clipData.itemCount) {
                if (uris.size >= maxFiles) break
                clipData.getItemAt(i).uri?.let { uris.add(it) }
            }
        } else {
            data.data?.let { uris.add(it) }
        }

        if (uris.isEmpty()) {
            rejectOnMain(call, "No file(s) selected")
            return
        }

        val finalUris = uris.toList()

        ioExecutor.execute {
            try {
                var docsRoot = context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS)
                if (docsRoot == null) docsRoot = context.filesDir

                val destDir = File(docsRoot, "HSC-SESSIONS/FILES")
                destDir.mkdirs()

                val results = JSArray()
                val stamp = System.currentTimeMillis()

                for ((idx, uri) in finalUris.withIndex()) {
                    var originalName = getDisplayName(uri)
                    if (originalName.isNullOrBlank()) {
                        originalName = "upload_${stamp}_$idx"
                    }

                    // Note: File extension validation is done in JavaScript to show proper error messages
                    // All files are staged here, validation happens later in handleUpload

                    val safeName = originalName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
                    val stampedName = "${stamp}_${idx}_$safeName"

                    val partial = File(destDir, "$stampedName.partial")
                    val finalFile = File(destDir, stampedName)

                    val expectedSize = getSize(uri)
                    var written = 0L
                    var lastEmitMs = 0L

                    context.contentResolver.openInputStream(uri)?.use { input ->
                        FileOutputStream(partial).use { out ->
                            val buf = ByteArray(1024 * 1024) // 1MB chunks
                            var read: Int
                            while (input.read(buf).also { read = it } != -1) {
                                out.write(buf, 0, read)
                                written += read

                                val nowMs = SystemClock.uptimeMillis()
                                if (nowMs - lastEmitMs >= 250) {
                                    lastEmitMs = nowMs
                                    val ev = JSObject()
                                    ev.put("fileIndex", idx)
                                    ev.put("bytesWritten", written)
                                    ev.put("totalBytes", expectedSize)
                                    ev.put("originalName", originalName)
                                    notifyOnMain("uploadProgress", ev)
                                }
                            }
                            out.flush()
                        }
                    } ?: throw IllegalStateException("Unable to open input stream")

                    if (finalFile.exists()) {
                        finalFile.delete()
                    }
                    if (!partial.renameTo(finalFile)) {
                        throw IllegalStateException("Rename failed")
                    }

                    var mimeType = context.contentResolver.getType(uri)
                    if (mimeType == null) mimeType = "application/octet-stream"

                    val one = JSObject()
                    one.put("absolutePath", finalFile.absolutePath)
                    one.put("logicalPath", "DOCUMENTS/HSC-SESSIONS/FILES/${finalFile.name}")
                    one.put("size", finalFile.length())
                    one.put("mimeType", mimeType)
                    one.put("status", "staged")
                    one.put("originalName", originalName)

                    results.put(one)
                }

                val ret = JSObject()
                ret.put("files", results)
                resolveOnMain(call, ret)

            } catch (e: Exception) {
                rejectOnMain(call, "Stage failed: ${e.message}")
            }
        }
    }

    private fun resolveOnMain(call: PluginCall, ret: JSObject) {
        main.post {
            try {
                call.resolve(ret)
            } finally {
                call.setKeepAlive(false)
            }
        }
    }

    private fun rejectOnMain(call: PluginCall, msg: String) {
        main.post {
            try {
                call.reject(msg)
            } finally {
                call.setKeepAlive(false)
            }
        }
    }

    private fun notifyOnMain(eventName: String, data: JSObject) {
        main.post { notifyListeners(eventName, data) }
    }

    private fun getDisplayName(uri: Uri): String? {
        return try {
            context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) cursor.getString(idx) else null
                } else null
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun getSize(uri: Uri): Long {
        return try {
            context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (idx >= 0) cursor.getLong(idx) else -1L
                } else -1L
            } ?: -1L
        } catch (e: Exception) {
            -1L
        }
    }
}

