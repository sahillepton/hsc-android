package org.deal.mcsa.plugins

import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

@CapacitorPlugin(name = "ZipFolder")
class ZipFolderPlugin : Plugin() {

    private val main = Handler(Looper.getMainLooper())

    data class ExtractedFileInfo(
        var absolutePath: String = "",
        var name: String = "",
        var type: String = "",
        var size: Long = 0
    )

    @PluginMethod
    fun zipHscSessionsFolder(call: PluginCall) {
        Thread {
            try {
                // Source folder: /Android/data/com.example.app/files/documents/HSC-SESSIONS
                var docsRoot = context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS)
                if (docsRoot == null) {
                    docsRoot = context.filesDir
                }

                val sourceDir = File(docsRoot, "HSC-SESSIONS")

                // Check if source directory exists
                if (!sourceDir.exists() || !sourceDir.isDirectory) {
                    main.post { call.reject("HSC-SESSIONS folder does not exist") }
                    return@Thread
                }

                // Check if directory is empty
                val files = sourceDir.listFiles()
                if (files == null || files.isEmpty()) {
                    main.post { call.reject("NOTHING_TO_DOWNLOAD") }
                    return@Thread
                }

                // Generate filename: GIS-DATA 12-16-2025 12-33-02.zip
                // Note: Replace invalid filename characters (/, :) with dashes
                val dateFormat = SimpleDateFormat("MM-dd-yyyy", Locale.US)
                val timeFormat = SimpleDateFormat("HH-mm-ss", Locale.US)
                val now = Date()
                val dateStr = dateFormat.format(now)
                val timeStr = timeFormat.format(now)
                val zipFileName = "GIS-DATA $dateStr $timeStr.zip"

                // Destination: Public Documents folder (/storage/emulated/0/Documents)
                // Same location where manifest.json is saved via Capacitor's Directory.Documents
                val publicDocsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS)
                if (publicDocsDir == null) {
                    main.post { call.reject("Cannot access Documents directory") }
                    return@Thread
                }

                // Ensure directory exists (same as manifest saving does with recursive: true)
                if (!publicDocsDir.exists()) {
                    val created = publicDocsDir.mkdirs()
                    if (!created && !publicDocsDir.exists()) {
                        main.post { call.reject("Failed to create Documents directory: ${publicDocsDir.absolutePath}") }
                        return@Thread
                    }
                }

                // Verify directory exists and is writable
                if (!publicDocsDir.exists()) {
                    main.post { call.reject("Documents directory does not exist: ${publicDocsDir.absolutePath}") }
                    return@Thread
                }

                if (!publicDocsDir.canWrite()) {
                    main.post { call.reject("Documents directory is not writable: ${publicDocsDir.absolutePath}") }
                    return@Thread
                }

                val outZip = File(publicDocsDir, zipFileName)

                // Ensure parent directory of the file exists (should be publicDocsDir, but double-check)
                val zipParent = outZip.parentFile
                if (zipParent != null && !zipParent.exists()) {
                    val created = zipParent.mkdirs()
                    if (!created && !zipParent.exists()) {
                        main.post { call.reject("Failed to create parent directory: ${zipParent.absolutePath}") }
                        return@Thread
                    }
                }

                // Delete existing zip if it exists
                if (outZip.exists()) {
                    outZip.delete()
                }

                // Ensure we can create the file (test by creating empty file first)
                try {
                    val created = outZip.createNewFile()
                    if (!created && !outZip.exists()) {
                        main.post { call.reject("Cannot create zip file: ${outZip.absolutePath}") }
                        return@Thread
                    }
                    // Delete the empty file, we'll create it properly below
                    if (created) {
                        outZip.delete()
                    }
                } catch (e: Exception) {
                    main.post { call.reject("Failed to create zip file: ${e.message}") }
                    return@Thread
                }

                // Compute total bytes for progress
                val totalBytes = folderSize(sourceDir)

                // Create ZIP
                val written = longArrayOf(0L)
                FileOutputStream(outZip).use { fos ->
                    ZipOutputStream(fos).use { zos ->
                        zipDirRecursive(sourceDir, sourceDir, zos, totalBytes, written)
                    }
                }

                val ret = JSObject()
                ret.put("absolutePath", outZip.absolutePath)
                ret.put("fileName", zipFileName)
                ret.put("size", outZip.length())

                main.post { call.resolve(ret) }

            } catch (e: Exception) {
                main.post { call.reject("zipHscSessionsFolder failed: ${e.message}") }
            }
        }.start()
    }

    private fun zipDirRecursive(
        rootDir: File,
        current: File,
        zos: ZipOutputStream,
        totalBytes: Long,
        written: LongArray
    ) {
        val files = current.listFiles() ?: return
        val buffer = ByteArray(1024 * 1024)

        for (f in files) {
            if (f.isDirectory) {
                zipDirRecursive(rootDir, f, zos, totalBytes, written)
            } else {
                val relativePath = rootDir.toURI().relativize(f.toURI()).path
                val entry = ZipEntry(relativePath)
                zos.putNextEntry(entry)

                BufferedInputStream(FileInputStream(f)).use { bis ->
                    var count: Int
                    while (bis.read(buffer).also { count = it } != -1) {
                        zos.write(buffer, 0, count)
                        written[0] += count
                    }
                }

                zos.closeEntry()
            }
        }
    }

    private fun folderSize(dir: File): Long {
        var size = 0L
        val files = dir.listFiles() ?: return 0L
        for (f in files) {
            size += if (f.isDirectory) folderSize(f) else f.length()
        }
        return size
    }

    @PluginMethod
    fun zipManifestFiles(call: PluginCall) {
        Thread {
            try {
                val filesArray = call.getArray("files")

                if (filesArray == null || filesArray.length() == 0) {
                    main.post { call.reject("NOTHING_TO_DOWNLOAD") }
                    return@Thread
                }

                // Generate filename: GIS-DATA MM-dd-yyyy HH-mm-ss.zip
                val dateFormat = SimpleDateFormat("MM-dd-yyyy", Locale.US)
                val timeFormat = SimpleDateFormat("HH-mm-ss", Locale.US)
                val now = Date()
                val dateStr = dateFormat.format(now)
                val timeStr = timeFormat.format(now)
                val zipFileName = "GIS-DATA $dateStr $timeStr.zip"

                // Destination: Public Documents folder
                val publicDocsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS)
                if (publicDocsDir == null) {
                    main.post { call.reject("Cannot access Documents directory") }
                    return@Thread
                }

                // Ensure directory exists
                if (!publicDocsDir.exists()) {
                    val created = publicDocsDir.mkdirs()
                    if (!created && !publicDocsDir.exists()) {
                        main.post { call.reject("Failed to create Documents directory: ${publicDocsDir.absolutePath}") }
                        return@Thread
                    }
                }

                if (!publicDocsDir.canWrite()) {
                    main.post { call.reject("Documents directory is not writable: ${publicDocsDir.absolutePath}") }
                    return@Thread
                }

                val outZip = File(publicDocsDir, zipFileName)

                // Delete existing zip if it exists
                if (outZip.exists()) {
                    outZip.delete()
                }

                val buffer = ByteArray(1024 * 1024) // 1MB buffer

                var filesAdded = 0
                var filesSkipped = 0

                FileOutputStream(outZip).use { fos ->
                    ZipOutputStream(fos).use { zos ->
                        // Add files from manifest
                        if (filesArray != null && filesArray.length() > 0) {
                            Log.d("ZipFolderPlugin", "Processing ${filesArray.length()} files from manifest")
                            for (i in 0 until filesArray.length()) {
                                val obj = filesArray.get(i)

                                // Handle different object types from Capacitor
                                var absolutePath: String? = null
                                var originalName: String? = null

                                when (obj) {
                                    is JSObject -> {
                                        absolutePath = obj.getString("absolutePath")
                                        originalName = obj.getString("originalName")
                                    }
                                    is JSONObject -> {
                                        // Extract from JSONObject
                                        absolutePath = obj.optString("absolutePath", null)
                                        originalName = obj.optString("originalName", null)
                                    }
                                    is Map<*, *> -> {
                                        // Extract from Map
                                        absolutePath = obj["absolutePath"]?.toString()
                                        originalName = obj["originalName"]?.toString()
                                    }
                                    else -> {
                                        Log.w("ZipFolderPlugin", "File $i is not a recognized object type: ${obj?.javaClass?.name ?: "null"}, obj: $obj")
                                        filesSkipped++
                                        continue
                                    }
                                }

                                Log.d("ZipFolderPlugin", "Processing file: $originalName at $absolutePath")

                                if (absolutePath == null || originalName == null) {
                                    Log.w("ZipFolderPlugin", "File $i missing absolutePath or originalName, skipping")
                                    filesSkipped++
                                    continue
                                }

                                val sourceFile = File(absolutePath)
                                if (!sourceFile.exists()) {
                                    Log.w("ZipFolderPlugin", "File does not exist: $absolutePath")
                                    filesSkipped++
                                    continue
                                }
                                if (!sourceFile.isFile) {
                                    Log.w("ZipFolderPlugin", "Path is not a file: $absolutePath")
                                    filesSkipped++
                                    continue
                                }

                                // Add file to ZIP with original name
                                val entry = ZipEntry(originalName)
                                zos.putNextEntry(entry)

                                BufferedInputStream(FileInputStream(sourceFile)).use { bis ->
                                    var count: Int
                                    var fileSize = 0L
                                    while (bis.read(buffer).also { count = it } != -1) {
                                        zos.write(buffer, 0, count)
                                        fileSize += count
                                    }
                                    Log.d("ZipFolderPlugin", "Added file to ZIP: $originalName ($fileSize bytes)")
                                    filesAdded++
                                }

                                zos.closeEntry()
                            }
                        } else {
                            Log.d("ZipFolderPlugin", "No files array or empty files array")
                        }

                        Log.d("ZipFolderPlugin", "Files added: $filesAdded, skipped: $filesSkipped")
                    }
                }

                // Force sync to ensure file is written to disk
                try {
                    FileOutputStream(outZip, true).use { syncFos ->
                        syncFos.fd.sync()
                    }
                } catch (syncEx: Exception) {
                    Log.w("ZipFolderPlugin", "Could not sync file: ${syncEx.message}")
                }

                val zipSize = outZip.length()
                Log.d("ZipFolderPlugin", "ZIP file created: $zipFileName (size: $zipSize bytes)")

                if (zipSize == 0L) {
                    Log.e("ZipFolderPlugin", "WARNING: ZIP file is empty! Files added: $filesAdded, skipped: $filesSkipped")
                }

                val ret = JSObject()
                ret.put("absolutePath", outZip.absolutePath)
                ret.put("fileName", zipFileName)
                ret.put("size", zipSize)

                main.post { call.resolve(ret) }

            } catch (e: Exception) {
                main.post { call.reject("zipManifestFiles failed: ${e.message}") }
            }
        }.start()
    }

    @PluginMethod
    fun extractZipRecursive(call: PluginCall) {
        val zipPath = call.getString("zipPath")
        val outputDirParam = call.getString("outputDir")

        if (zipPath.isNullOrEmpty()) {
            main.post { call.reject("zipPath is required") }
            return
        }

        val outputDir = if (outputDirParam.isNullOrEmpty()) "HSC-SESSIONS/FILES" else outputDirParam

        Thread {
            try {
                var docsRoot = context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS)
                if (docsRoot == null) docsRoot = context.filesDir

                val destDir = File(docsRoot, outputDir)
                if (!destDir.exists()) {
                    val created = destDir.mkdirs()
                    if (!created && !destDir.exists()) {
                        main.post { call.reject("Failed to create output directory: ${destDir.absolutePath}") }
                        return@Thread
                    }
                }

                val zipFile = File(zipPath)
                if (!zipFile.exists()) {
                    main.post { call.reject("ZIP file does not exist: $zipPath") }
                    return@Thread
                }

                val extractedFiles = extractRecursive(zipFile, destDir, 0, 10)
                val finalFiles = processShapefiles(extractedFiles, destDir)

                val filesArray = JSArray()
                for (file in finalFiles) {
                    val fileObj = JSObject()
                    fileObj.put("absolutePath", file.absolutePath)
                    fileObj.put("name", file.name)
                    fileObj.put("type", file.type)
                    fileObj.put("size", file.size)
                    filesArray.put(fileObj)
                }

                val result = JSObject()
                result.put("files", filesArray)

                main.post { call.resolve(result) }

            } catch (e: Exception) {
                main.post { call.reject("Extraction failed: ${e.message}") }
            }
        }.start()
    }

    private fun extractRecursive(zipFile: File, destDir: File, depth: Int, maxDepth: Int): MutableList<ExtractedFileInfo> {
        val extractedFiles = mutableListOf<ExtractedFileInfo>()

        if (depth > maxDepth) return extractedFiles

        val buffer = ByteArray(8192)

        ZipInputStream(BufferedInputStream(FileInputStream(zipFile))).use { zis ->
            var entry: ZipEntry? = zis.nextEntry

            while (entry != null) {
                val entryName = entry.name

                if (!entry.isDirectory) {
                    if (entryName.lowercase().endsWith(".zip")) {
                        val zipFileName = File(entryName).name
                        val tempZip = File(destDir, "temp_${System.currentTimeMillis()}_$zipFileName")

                        FileOutputStream(tempZip).use { fos ->
                            BufferedOutputStream(fos).use { bos ->
                                var len: Int
                                while (zis.read(buffer).also { len = it } > 0) {
                                    bos.write(buffer, 0, len)
                                }
                            }
                        }

                        val nestedFiles = extractRecursive(tempZip, destDir, depth + 1, maxDepth)
                        extractedFiles.addAll(nestedFiles)

                        if (tempZip.exists()) {
                            if (!tempZip.delete()) {
                                tempZip.deleteOnExit()
                            }
                        }
                    } else {
                        var fileName = File(entryName).name
                        
                        // Check if file extension is allowed
                        val lowerName = fileName.lowercase()
                        val lastDot = lowerName.lastIndexOf('.')
                        if (lastDot > 0 && lastDot < lowerName.length - 1) {
                            val extension = lowerName.substring(lastDot + 1)
                            val allowedExtensions = setOf(
                                // Raster/DEM formats
                                "tif",
                                "tiff",
                                "hgt",
                                "dett",
                                // Vector formats
                                "geojson",
                                "json",
                                "csv",
                                "gpx",
                                "kml",
                                "kmz",
                                "wkt",
                                // Shapefile components (will be grouped into ZIP)
                                "shp",
                                "shx",
                                "dbf",
                                "prj",
                                // Archive format (for containing the above formats)
                                "zip"
                            )
                            
                            if (!allowedExtensions.contains(extension)) {
                                // Skip this file - don't extract it
                                zis.closeEntry()
                                entry = zis.nextEntry
                                continue
                            }
                        }
                        
                        var outputFile = File(destDir, fileName)

                        var counter = 1
                        var baseName = fileName
                        var extension = ""
                        val dotIndex = fileName.lastIndexOf('.')
                        if (dotIndex > 0) {
                            baseName = fileName.substring(0, dotIndex)
                            extension = fileName.substring(dotIndex)
                        }

                        while (outputFile.exists()) {
                            outputFile = File(destDir, "${baseName}_${counter}$extension")
                            counter++
                        }

                        outputFile.parentFile?.mkdirs()

                        FileOutputStream(outputFile).use { fos ->
                            BufferedOutputStream(fos).use { bos ->
                                var len: Int
                                while (zis.read(buffer).also { len = it } > 0) {
                                    bos.write(buffer, 0, len)
                                }
                            }
                        }

                        // Determine file type (reuse lowerName variable name after file is written)
                        val lowerNameFinal = outputFile.name.lowercase()
                        val fileType = when {
                            lowerNameFinal.endsWith(".tif") || lowerNameFinal.endsWith(".tiff") ||
                            lowerNameFinal.endsWith(".hgt") || lowerNameFinal.endsWith(".dett") -> "tiff"
                            lowerNameFinal.endsWith(".shp") || lowerNameFinal.endsWith(".shx") ||
                            lowerNameFinal.endsWith(".dbf") || lowerNameFinal.endsWith(".prj") -> "shapefile_component"
                            else -> "vector"
                        }

                        extractedFiles.add(ExtractedFileInfo(
                            absolutePath = outputFile.absolutePath,
                            name = outputFile.name,
                            type = fileType,
                            size = outputFile.length()
                        ))
                    }
                }

                zis.closeEntry()
                entry = zis.nextEntry
            }
        }

        return extractedFiles
    }

    private fun processShapefiles(files: MutableList<ExtractedFileInfo>, destDir: File): List<ExtractedFileInfo> {
        val shapefileGroups = mutableMapOf<String, MutableList<ExtractedFileInfo>>()

        for (file in files) {
            val lowerName = file.name.lowercase()
            if (lowerName.endsWith(".shp") || lowerName.endsWith(".shx") ||
                lowerName.endsWith(".dbf") || lowerName.endsWith(".prj")) {
                val baseName = lowerName.replace(Regex("\\.(shp|shx|dbf|prj)$"), "")
                shapefileGroups.getOrPut(baseName) { mutableListOf() }.add(file)
            }
        }

        val result = mutableListOf<ExtractedFileInfo>()
        val processedComponentPaths = mutableSetOf<String>()

        for ((baseName, components) in shapefileGroups) {
            var hasShp = false
            var hasShx = false
            var hasDbf = false

            for (comp in components) {
                val lower = comp.name.lowercase()
                when {
                    lower.endsWith(".shp") -> hasShp = true
                    lower.endsWith(".shx") -> hasShx = true
                    lower.endsWith(".dbf") -> hasDbf = true
                }
            }

            if (hasShp && hasShx && hasDbf) {
                var zipFile = File(destDir, "$baseName.zip")
                var counter = 1
                while (zipFile.exists()) {
                    zipFile = File(destDir, "${baseName}_$counter.zip")
                    counter++
                }

                ZipOutputStream(FileOutputStream(zipFile)).use { zos ->
                    val buffer = ByteArray(8192)

                    for (component in components) {
                        val compFile = File(component.absolutePath)
                        if (!compFile.exists()) continue

                        val entry = ZipEntry(component.name)
                        zos.putNextEntry(entry)

                        BufferedInputStream(FileInputStream(compFile)).use { bis ->
                            var len: Int
                            while (bis.read(buffer).also { len = it } > 0) {
                                zos.write(buffer, 0, len)
                            }
                        }
                        zos.closeEntry()
                    }
                }

                for (component in components) {
                    val compFile = File(component.absolutePath)
                    if (compFile.exists()) compFile.delete()
                    processedComponentPaths.add(component.absolutePath)
                }

                result.add(ExtractedFileInfo(
                    absolutePath = zipFile.absolutePath,
                    name = zipFile.name,
                    type = "shapefile",
                    size = zipFile.length()
                ))
            } else {
                for (comp in components) {
                    comp.type = "vector"
                    result.add(comp)
                }
            }
        }

        for (file in files) {
            if (file.type == "shapefile_component" && file.absolutePath in processedComponentPaths) {
                continue
            }
            result.add(file)
        }

        return result
    }
}

