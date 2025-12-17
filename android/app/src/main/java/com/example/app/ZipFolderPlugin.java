package com.example.app;

import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.zip.ZipEntry;
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
}

