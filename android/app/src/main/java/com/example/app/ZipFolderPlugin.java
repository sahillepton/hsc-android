package com.example.app;

import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

@CapacitorPlugin(name = "ZipFolder")
public class ZipFolderPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void zipHscSessionsFolder(PluginCall call) {
        new Thread(() -> {
            try {
                // Source folder: /Android/data/com.example.app/files/documents/HSC-SESSIONS
                File docsRoot = getContext().getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
                if (docsRoot == null) {
                    docsRoot = getContext().getFilesDir();
                }
                
                File sourceDir = new File(docsRoot, "HSC-SESSIONS");
                
                // Check if source directory exists
                if (!sourceDir.exists() || !sourceDir.isDirectory()) {
                    main.post(() -> call.reject("HSC-SESSIONS folder does not exist"));
                    return;
                }
                
                // Check if directory is empty
                File[] files = sourceDir.listFiles();
                if (files == null || files.length == 0) {
                    main.post(() -> call.reject("NOTHING_TO_DOWNLOAD"));
                    return;
                }
                
                // Generate filename: GIS-DATA 12-16-2025 12-33-02.zip
                // Note: Replace invalid filename characters (/, :) with dashes
                SimpleDateFormat dateFormat = new SimpleDateFormat("MM-dd-yyyy", Locale.US);
                SimpleDateFormat timeFormat = new SimpleDateFormat("HH-mm-ss", Locale.US);
                Date now = new Date();
                String dateStr = dateFormat.format(now);
                String timeStr = timeFormat.format(now);
                String zipFileName = String.format("GIS-DATA %s %s.zip", dateStr, timeStr);
                
                // Destination: Public Documents folder (/storage/emulated/0/Documents)
                // Same location where manifest.json is saved via Capacitor's Directory.Documents
                File publicDocsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
                if (publicDocsDir == null) {
                    main.post(() -> call.reject("Cannot access Documents directory"));
                    return;
                }
                
                // Ensure directory exists (same as manifest saving does with recursive: true)
                if (!publicDocsDir.exists()) {
                    boolean created = publicDocsDir.mkdirs();
                    if (!created && !publicDocsDir.exists()) {
                        main.post(() -> call.reject("Failed to create Documents directory: " + publicDocsDir.getAbsolutePath()));
                        return;
                    }
                }
                
                // Verify directory exists and is writable
                if (!publicDocsDir.exists()) {
                    main.post(() -> call.reject("Documents directory does not exist: " + publicDocsDir.getAbsolutePath()));
                    return;
                }
                
                if (!publicDocsDir.canWrite()) {
                    main.post(() -> call.reject("Documents directory is not writable: " + publicDocsDir.getAbsolutePath()));
                    return;
                }
                
                File outZip = new File(publicDocsDir, zipFileName);
                
                // Ensure parent directory of the file exists (should be publicDocsDir, but double-check)
                File zipParent = outZip.getParentFile();
                if (zipParent != null && !zipParent.exists()) {
                    boolean created = zipParent.mkdirs();
                    if (!created && !zipParent.exists()) {
                        main.post(() -> call.reject("Failed to create parent directory: " + zipParent.getAbsolutePath()));
                        return;
                    }
                }
                
                // Delete existing zip if it exists
                if (outZip.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    outZip.delete();
                }
                
                // Ensure we can create the file (test by creating empty file first)
                try {
                    boolean created = outZip.createNewFile();
                    if (!created && !outZip.exists()) {
                        main.post(() -> call.reject("Cannot create zip file: " + outZip.getAbsolutePath()));
                        return;
                    }
                    // Delete the empty file, we'll create it properly below
                    if (created) {
                        //noinspection ResultOfMethodCallIgnored
                        outZip.delete();
                    }
                } catch (Exception e) {
                    main.post(() -> call.reject("Failed to create zip file: " + e.getMessage()));
                    return;
                }
                
                // Compute total bytes for progress
                long totalBytes = folderSize(sourceDir);
                
                // Create ZIP
                long[] written = new long[]{0L};
                try (FileOutputStream fos = new FileOutputStream(outZip);
                     ZipOutputStream zos = new ZipOutputStream(fos)) {
                    
                    zipDirRecursive(sourceDir, sourceDir, zos, totalBytes, written);
                }
                
                JSObject ret = new JSObject();
                ret.put("absolutePath", outZip.getAbsolutePath());
                ret.put("fileName", zipFileName);
                ret.put("size", outZip.length());
                
                main.post(() -> call.resolve(ret));
                
            } catch (Exception e) {
                main.post(() -> call.reject("zipHscSessionsFolder failed: " + e.getMessage()));
            }
        }).start();
    }
    
    private void zipDirRecursive(File rootDir, File current, ZipOutputStream zos,
                                 long totalBytes, long[] written) throws Exception {
        
        File[] files = current.listFiles();
        if (files == null) return;
        
        byte[] buffer = new byte[1024 * 1024]; // 1MB
        for (File f : files) {
            if (f.isDirectory()) {
                zipDirRecursive(rootDir, f, zos, totalBytes, written);
            } else {
                String relativePath = rootDir.toURI().relativize(f.toURI()).getPath();
                ZipEntry entry = new ZipEntry(relativePath);
                zos.putNextEntry(entry);
                
                try (BufferedInputStream bis = new BufferedInputStream(new FileInputStream(f))) {
                    int count;
                    while ((count = bis.read(buffer)) != -1) {
                        zos.write(buffer, 0, count);
                        written[0] += count;
                    }
                }
                
                zos.closeEntry();
            }
        }
    }
    
    private long folderSize(File dir) {
        long size = 0L;
        File[] files = dir.listFiles();
        if (files == null) return 0L;
        for (File f : files) {
            if (f.isDirectory()) size += folderSize(f);
            else size += f.length();
        }
        return size;
    }

    // Helper class to store extracted file information
    private static class ExtractedFileInfo {
        String absolutePath;
        String name;
        String type; // "vector", "tiff", "shapefile"
        long size;
    }

    @PluginMethod
    public void zipManifestFiles(PluginCall call) {
        new Thread(() -> {
            try {
                JSArray filesArray = call.getArray("files");
                
                if (filesArray == null || filesArray.length() == 0) {
                    main.post(() -> call.reject("NOTHING_TO_DOWNLOAD"));
                    return;
                }
                
                // Generate filename: GIS-DATA MM-dd-yyyy HH-mm-ss.zip
                SimpleDateFormat dateFormat = new SimpleDateFormat("MM-dd-yyyy", Locale.US);
                SimpleDateFormat timeFormat = new SimpleDateFormat("HH-mm-ss", Locale.US);
                Date now = new Date();
                String dateStr = dateFormat.format(now);
                String timeStr = timeFormat.format(now);
                String zipFileName = String.format("GIS-DATA %s %s.zip", dateStr, timeStr);
                
                // Destination: Public Documents folder
                File publicDocsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
                if (publicDocsDir == null) {
                    main.post(() -> call.reject("Cannot access Documents directory"));
                    return;
                }
                
                // Ensure directory exists
                if (!publicDocsDir.exists()) {
                    boolean created = publicDocsDir.mkdirs();
                    if (!created && !publicDocsDir.exists()) {
                        main.post(() -> call.reject("Failed to create Documents directory: " + publicDocsDir.getAbsolutePath()));
                        return;
                    }
                }
                
                if (!publicDocsDir.canWrite()) {
                    main.post(() -> call.reject("Documents directory is not writable: " + publicDocsDir.getAbsolutePath()));
                    return;
                }
                
                File outZip = new File(publicDocsDir, zipFileName);
                
                // Delete existing zip if it exists
                if (outZip.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    outZip.delete();
                }
                
                byte[] buffer = new byte[1024 * 1024]; // 1MB buffer
                
                int filesAdded = 0;
                int filesSkipped = 0;
                
                try (FileOutputStream fos = new FileOutputStream(outZip);
                     ZipOutputStream zos = new ZipOutputStream(fos)) {
                    
                    // Add files from manifest
                    if (filesArray != null && filesArray.length() > 0) {
                        android.util.Log.d("ZipFolderPlugin", "Processing " + filesArray.length() + " files from manifest");
                        for (int i = 0; i < filesArray.length(); i++) {
                            Object obj = filesArray.get(i);
                            JSObject fileObj = null;
                            
                            // Handle different object types from Capacitor
                            String absolutePath = null;
                            String originalName = null;
                            
                            if (obj instanceof JSObject) {
                                fileObj = (JSObject) obj;
                                absolutePath = fileObj.getString("absolutePath");
                                originalName = fileObj.getString("originalName");
                            } else if (obj instanceof org.json.JSONObject) {
                                // Extract from JSONObject
                                org.json.JSONObject jsonObj = (org.json.JSONObject) obj;
                                absolutePath = jsonObj.optString("absolutePath", null);
                                originalName = jsonObj.optString("originalName", null);
                            } else if (obj instanceof java.util.Map) {
                                // Extract from Map
                                @SuppressWarnings("unchecked")
                                java.util.Map<String, Object> map = (java.util.Map<String, Object>) obj;
                                Object absPathObj = map.get("absolutePath");
                                Object origNameObj = map.get("originalName");
                                absolutePath = absPathObj != null ? absPathObj.toString() : null;
                                originalName = origNameObj != null ? origNameObj.toString() : null;
                            } else {
                                android.util.Log.w("ZipFolderPlugin", "File " + i + " is not a recognized object type: " + (obj != null ? obj.getClass().getName() : "null") + ", obj: " + obj);
                                filesSkipped++;
                                continue;
                            }
                            
                            android.util.Log.d("ZipFolderPlugin", "Processing file: " + originalName + " at " + absolutePath);
                            
                            if (absolutePath == null || originalName == null) {
                                android.util.Log.w("ZipFolderPlugin", "File " + i + " missing absolutePath or originalName, skipping");
                                filesSkipped++;
                                continue;
                            }
                            
                            File sourceFile = new File(absolutePath);
                            if (!sourceFile.exists()) {
                                android.util.Log.w("ZipFolderPlugin", "File does not exist: " + absolutePath);
                                filesSkipped++;
                                continue;
                            }
                            if (!sourceFile.isFile()) {
                                android.util.Log.w("ZipFolderPlugin", "Path is not a file: " + absolutePath);
                                filesSkipped++;
                                continue;
                            }
                            
                            // Add file to ZIP with original name
                            ZipEntry entry = new ZipEntry(originalName);
                            zos.putNextEntry(entry);
                            
                            try (BufferedInputStream bis = new BufferedInputStream(new FileInputStream(sourceFile))) {
                                int count;
                                long fileSize = 0;
                                while ((count = bis.read(buffer)) != -1) {
                                    zos.write(buffer, 0, count);
                                    fileSize += count;
                                }
                                android.util.Log.d("ZipFolderPlugin", "Added file to ZIP: " + originalName + " (" + fileSize + " bytes)");
                                filesAdded++;
                            }
                            
                            zos.closeEntry();
                        }
                    } else {
                        android.util.Log.d("ZipFolderPlugin", "No files array or empty files array");
                    }
                    
                    android.util.Log.d("ZipFolderPlugin", "Files added: " + filesAdded + ", skipped: " + filesSkipped);
                }
                
                // Force sync to ensure file is written to disk
                try {
                    java.io.FileOutputStream syncFos = new java.io.FileOutputStream(outZip, true);
                    syncFos.getFD().sync();
                    syncFos.close();
                } catch (Exception syncEx) {
                    android.util.Log.w("ZipFolderPlugin", "Could not sync file: " + syncEx.getMessage());
                }
                
                long zipSize = outZip.length();
                android.util.Log.d("ZipFolderPlugin", "ZIP file created: " + zipFileName + " (size: " + zipSize + " bytes)");
                
                if (zipSize == 0) {
                    android.util.Log.e("ZipFolderPlugin", "WARNING: ZIP file is empty! Files added: " + filesAdded + ", skipped: " + filesSkipped);
                }
                
                JSObject ret = new JSObject();
                ret.put("absolutePath", outZip.getAbsolutePath());
                ret.put("fileName", zipFileName);
                ret.put("size", zipSize);
                
                main.post(() -> call.resolve(ret));
                
            } catch (Exception e) {
                main.post(() -> call.reject("zipManifestFiles failed: " + e.getMessage()));
            }
        }).start();
    }

    @PluginMethod
    public void extractZipRecursive(PluginCall call) {
        String zipPath = call.getString("zipPath");
        String outputDirParam = call.getString("outputDir");
        
        if (zipPath == null || zipPath.isEmpty()) {
            main.post(() -> call.reject("zipPath is required"));
            return;
        }
        
        // Make outputDir final for use in lambda
        final String outputDir = (outputDirParam == null || outputDirParam.isEmpty()) 
            ? "HSC-SESSIONS/FILES" 
            : outputDirParam;

        new Thread(() -> {
            try {
                // Get destination directory
                File docsRoot = getContext().getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
                if (docsRoot == null) {
                    docsRoot = getContext().getFilesDir();
                }
                
                File destDir = new File(docsRoot, outputDir);
                if (!destDir.exists()) {
                    boolean created = destDir.mkdirs();
                    if (!created && !destDir.exists()) {
                        main.post(() -> call.reject("Failed to create output directory: " + destDir.getAbsolutePath()));
                        return;
                    }
                }

                // Extract ZIP recursively
                File zipFile = new File(zipPath);
                if (!zipFile.exists()) {
                    main.post(() -> call.reject("ZIP file does not exist: " + zipPath));
                    return;
                }

                List<ExtractedFileInfo> extractedFiles = extractRecursive(zipFile, destDir, 0, 10);

                // Group shapefiles and re-zip them
                List<ExtractedFileInfo> finalFiles = processShapefiles(extractedFiles, destDir);

                // Build result array
                JSArray filesArray = new JSArray();
                for (ExtractedFileInfo file : finalFiles) {
                    JSObject fileObj = new JSObject();
                    fileObj.put("absolutePath", file.absolutePath);
                    fileObj.put("name", file.name);
                    fileObj.put("type", file.type);
                    fileObj.put("size", file.size);
                    filesArray.put(fileObj);
                }

                JSObject result = new JSObject();
                result.put("files", filesArray);

                main.post(() -> call.resolve(result));

            } catch (Exception e) {
                main.post(() -> call.reject("Extraction failed: " + e.getMessage()));
            }
        }).start();
    }

    private List<ExtractedFileInfo> extractRecursive(File zipFile, File destDir, int depth, int maxDepth) throws Exception {
        List<ExtractedFileInfo> extractedFiles = new ArrayList<>();
        
        if (depth > maxDepth) {
            return extractedFiles; // Skip if too deep
        }

        byte[] buffer = new byte[8192];
        
        try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new FileInputStream(zipFile)))) {
            ZipEntry entry;
            
            while ((entry = zis.getNextEntry()) != null) {
                String entryName = entry.getName();
                
                // Skip directory entries
                if (entry.isDirectory()) {
                    continue;
                }

                // Handle nested ZIPs
                if (entryName.toLowerCase().endsWith(".zip")) {
                    String zipFileName = new File(entryName).getName(); // Get just the filename
                    
                    // For ZIPs, extract recursively
                    File tempZip = new File(destDir, "temp_" + System.currentTimeMillis() + "_" + zipFileName);
                    
                    try (FileOutputStream fos = new FileOutputStream(tempZip);
                         BufferedOutputStream bos = new BufferedOutputStream(fos)) {
                        int len;
                        while ((len = zis.read(buffer)) > 0) {
                            bos.write(buffer, 0, len);
                        }
                    }
                    
                    // Recursively extract nested ZIP
                    List<ExtractedFileInfo> nestedFiles = extractRecursive(tempZip, destDir, depth + 1, maxDepth);
                    extractedFiles.addAll(nestedFiles);
                    
                    // Delete temp ZIP file (and ensure it's deleted)
                    if (tempZip.exists()) {
                        boolean deleted = tempZip.delete();
                        if (!deleted) {
                            // If delete fails, try to delete on exit (best effort cleanup)
                            tempZip.deleteOnExit();
                        }
                    }
                } else {
                    // Extract regular file
                    String fileName = new File(entryName).getName();
                    
                    // Check if file extension is allowed
                    String lowerName = fileName.toLowerCase();
                    int lastDot = lowerName.lastIndexOf('.');
                    if (lastDot > 0 && lastDot < lowerName.length() - 1) {
                        String extension = lowerName.substring(lastDot + 1);
                        Set<String> allowedExtensions = new HashSet<>(Arrays.asList(
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
                        ));
                        
                        if (!allowedExtensions.contains(extension)) {
                            // Skip this file - don't extract it
                            zis.closeEntry();
                            continue;
                        }
                    }
                    
                    File outputFile = new File(destDir, fileName);
                    
                    // Handle duplicate names
                    int counter = 1;
                    String baseName = fileName;
                    String extension = "";
                    int dotIndex = fileName.lastIndexOf('.');
                    if (dotIndex > 0) {
                        baseName = fileName.substring(0, dotIndex);
                        extension = fileName.substring(dotIndex);
                    }
                    
                    while (outputFile.exists()) {
                        outputFile = new File(destDir, baseName + "_" + counter + extension);
                        counter++;
                    }
                    
                    outputFile.getParentFile().mkdirs();
                    
                    try (FileOutputStream fos = new FileOutputStream(outputFile);
                         BufferedOutputStream bos = new BufferedOutputStream(fos)) {
                        int len;
                        while ((len = zis.read(buffer)) > 0) {
                            bos.write(buffer, 0, len);
                        }
                    }
                    
                    // Determine file type
                    lowerName = outputFile.getName().toLowerCase();
                    String fileType = "vector"; // default
                    
                    if (lowerName.endsWith(".tif") || lowerName.endsWith(".tiff") || 
                        lowerName.endsWith(".hgt") || lowerName.endsWith(".dett")) {
                        fileType = "tiff";
                    } else if (lowerName.endsWith(".shp") || lowerName.endsWith(".shx") || 
                               lowerName.endsWith(".dbf") || lowerName.endsWith(".prj")) {
                        fileType = "shapefile_component";
                    }
                    
                    ExtractedFileInfo fileInfo = new ExtractedFileInfo();
                    fileInfo.absolutePath = outputFile.getAbsolutePath();
                    fileInfo.name = outputFile.getName();
                    fileInfo.type = fileType;
                    fileInfo.size = outputFile.length();
                    
                    extractedFiles.add(fileInfo);
                }
                
                zis.closeEntry();
            }
        }
        
        return extractedFiles;
    }

    private List<ExtractedFileInfo> processShapefiles(List<ExtractedFileInfo> files, File destDir) throws Exception {
        // Group shapefile components by base name
        Map<String, List<ExtractedFileInfo>> shapefileGroups = new HashMap<>();
        
        for (ExtractedFileInfo file : files) {
            String lowerName = file.name.toLowerCase();
            if (lowerName.endsWith(".shp") || lowerName.endsWith(".shx") || 
                lowerName.endsWith(".dbf") || lowerName.endsWith(".prj")) {
                
                String baseName = lowerName.replaceAll("\\.(shp|shx|dbf|prj)$", "");
                shapefileGroups.computeIfAbsent(baseName, k -> new ArrayList<>()).add(file);
            }
        }
        
        List<ExtractedFileInfo> result = new ArrayList<>();
        // Track which files were processed as part of complete shapefile groups
        java.util.Set<String> processedComponentPaths = new java.util.HashSet<>();
        
        // Process each shapefile group
        for (Map.Entry<String, List<ExtractedFileInfo>> group : shapefileGroups.entrySet()) {
            List<ExtractedFileInfo> components = group.getValue();
            
            // Check if we have required components
            boolean hasShp = false, hasShx = false, hasDbf = false;
            for (ExtractedFileInfo comp : components) {
                String lower = comp.name.toLowerCase();
                if (lower.endsWith(".shp")) hasShp = true;
                if (lower.endsWith(".shx")) hasShx = true;
                if (lower.endsWith(".dbf")) hasDbf = true;
            }
            
            if (hasShp && hasShx && hasDbf) {
                // Create ZIP with all components
                String zipName = group.getKey() + ".zip";
                File zipFile = new File(destDir, zipName);
                
                // Handle duplicate names
                int counter = 1;
                while (zipFile.exists()) {
                    zipFile = new File(destDir, group.getKey() + "_" + counter + ".zip");
                    counter++;
                }
                
                try (ZipOutputStream zos = new ZipOutputStream(new FileOutputStream(zipFile))) {
                    byte[] buffer = new byte[8192];
                    
                    for (ExtractedFileInfo component : components) {
                        File compFile = new File(component.absolutePath);
                        if (!compFile.exists()) continue;
                        
                        ZipEntry entry = new ZipEntry(component.name);
                        zos.putNextEntry(entry);
                        
                        try (FileInputStream fis = new FileInputStream(compFile);
                             BufferedInputStream bis = new BufferedInputStream(fis)) {
                            int len;
                            while ((len = bis.read(buffer)) > 0) {
                                zos.write(buffer, 0, len);
                            }
                        }
                        zos.closeEntry();
                    }
                }
                
                // Delete individual component files and mark them as processed
                for (ExtractedFileInfo component : components) {
                    File compFile = new File(component.absolutePath);
                    if (compFile.exists()) {
                        compFile.delete();
                    }
                    processedComponentPaths.add(component.absolutePath);
                }
                
                // Add ZIP to results
                ExtractedFileInfo zipInfo = new ExtractedFileInfo();
                zipInfo.absolutePath = zipFile.getAbsolutePath();
                zipInfo.name = zipFile.getName();
                zipInfo.type = "shapefile";
                zipInfo.size = zipFile.length();
                result.add(zipInfo);
                
            } else {
                // Incomplete shapefile, keep as individual files (but mark as vector for processing)
                for (ExtractedFileInfo comp : components) {
                    comp.type = "vector"; // Change type so it can be processed
                    result.add(comp);
                }
            }
        }
        
        // Add non-shapefile files, excluding those that were processed as part of complete shapefile groups
        for (ExtractedFileInfo file : files) {
            // Skip shapefile components that were already processed and zipped
            if (file.type.equals("shapefile_component") && processedComponentPaths.contains(file.absolutePath)) {
                continue;
            }
            // Add all other files (non-shapefile files, or incomplete shapefile components that weren't processed)
            result.add(file);
        }
        
        return result;
    }
}

