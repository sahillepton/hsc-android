package com.example.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult; // ✅ this is the one you need

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "NativeUploader")
public class NativeUploaderPlugin extends Plugin {

    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void pickAndStageMany(PluginCall call) {
        call.setKeepAlive(true);

        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);

        startActivityForResult(call, intent, "onPickedFiles");
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        String absolutePath = call.getString("absolutePath");
        if (absolutePath == null || absolutePath.isEmpty()) {
            call.reject("absolutePath is required");
            return;
        }

        ioExecutor.execute(() -> {
            try {
                File file = new File(absolutePath);
                if (!file.exists()) {
                    rejectOnMain(call, "File does not exist: " + absolutePath);
                    return;
                }

                boolean deleted = file.delete();
                if (deleted) {
                    resolveOnMain(call, new JSObject());
                } else {
                    rejectOnMain(call, "Failed to delete file: " + absolutePath);
                }
            } catch (Exception e) {
                rejectOnMain(call, "Error deleting file: " + e.getMessage());
            }
        });
    }

    // ✅ correct signature for Capacitor v3+
    @ActivityCallback
    private void onPickedFiles(PluginCall call, ActivityResult result) {
        int resultCode = result.getResultCode();
        Intent data = result.getData();

        if (resultCode == Activity.RESULT_CANCELED) {
            rejectOnMain(call, "User cancelled");
            return;
        }

        if (data == null) {
            rejectOnMain(call, "No intent data returned");
            return;
        }

        int maxFiles = 2;
        try {
            Integer mf = call.getInt("maxFiles");
            if (mf != null) maxFiles = mf;
        } catch (Exception ignored) {}
        if (maxFiles < 1) maxFiles = 1;
        if (maxFiles > 2) maxFiles = 2;

        List<Uri> uris = new ArrayList<>();
        ClipData clipData = data.getClipData();

        if (clipData != null) {
            for (int i = 0; i < clipData.getItemCount() && uris.size() < maxFiles; i++) {
                Uri u = clipData.getItemAt(i).getUri();
                if (u != null) uris.add(u);
            }
        } else {
            Uri u = data.getData();
            if (u != null) uris.add(u);
        }

        if (uris.isEmpty()) {
            rejectOnMain(call, "No file(s) selected");
            return;
        }

        final List<Uri> finalUris = uris;

        ioExecutor.execute(() -> {
            try {
                // Use external files directory with documents subdirectory (accessible via file manager)
                File docsRoot = getContext().getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
                if (docsRoot == null) docsRoot = getContext().getFilesDir();

                File destDir = new File(docsRoot, "HSC-SESSIONS/FILES");
                //noinspection ResultOfMethodCallIgnored
                destDir.mkdirs();

                JSArray results = new JSArray();
                long stamp = System.currentTimeMillis();

                for (int idx = 0; idx < finalUris.size(); idx++) {
                    Uri uri = finalUris.get(idx);

                    String originalName = getDisplayName(uri);
                    if (originalName == null || originalName.trim().isEmpty()) {
                        originalName = "upload_" + stamp + "_" + idx;
                    }

                    String safeName = originalName.replaceAll("[^a-zA-Z0-9._-]", "_");
                    String stampedName = stamp + "_" + idx + "_" + safeName;

                    File partial = new File(destDir, stampedName + ".partial");
                    File finalFile = new File(destDir, stampedName);

                    long expectedSize = getSize(uri); // -1 if unknown
                    long written = 0L;
                    long lastEmitMs = 0L;

                    try (InputStream in = getContext().getContentResolver().openInputStream(uri);
                         FileOutputStream out = new FileOutputStream(partial)) {

                        if (in == null) throw new IllegalStateException("Unable to open input stream");

                        byte[] buf = new byte[1024 * 1024]; // 1MB chunks
                        int read;
                        while ((read = in.read(buf)) != -1) {
                            out.write(buf, 0, read);
                            written += read;

                            long nowMs = SystemClock.uptimeMillis();
                            if (nowMs - lastEmitMs >= 250) {
                                lastEmitMs = nowMs;
                                JSObject ev = new JSObject();
                                ev.put("fileIndex", idx);
                                ev.put("bytesWritten", written);
                                ev.put("totalBytes", expectedSize);
                                ev.put("originalName", originalName);
                                notifyOnMain("uploadProgress", ev);
                            }
                        }
                        out.flush();
                    }

                    if (finalFile.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        finalFile.delete();
                    }
                    if (!partial.renameTo(finalFile)) {
                        throw new IllegalStateException("Rename failed");
                    }

                    String mimeType = getContext().getContentResolver().getType(uri);
                    if (mimeType == null) mimeType = "application/octet-stream";

                    JSObject one = new JSObject();
                    one.put("absolutePath", finalFile.getAbsolutePath());
                    one.put("logicalPath", "DOCUMENTS/HSC-SESSIONS/FILES/" + finalFile.getName());
                    one.put("size", finalFile.length());
                    one.put("mimeType", mimeType);
                    one.put("status", "staged");
                    one.put("originalName", originalName);

                    results.put(one);
                }

                JSObject ret = new JSObject();
                ret.put("files", results);
                resolveOnMain(call, ret);

            } catch (Exception e) {
                rejectOnMain(call, "Stage failed: " + e.getMessage());
            }
        });
    }

    private void resolveOnMain(PluginCall call, JSObject ret) {
        main.post(() -> {
            try { call.resolve(ret); }
            finally { call.setKeepAlive(false); }
        });
    }

    private void rejectOnMain(PluginCall call, String msg) {
        main.post(() -> {
            try { call.reject(msg); }
            finally { call.setKeepAlive(false); }
        });
    }

    private void notifyOnMain(String eventName, JSObject data) {
        main.post(() -> notifyListeners(eventName, data));
    }

    private String getDisplayName(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) return cursor.getString(idx);
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
        return null;
    }

    private long getSize(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (idx >= 0) return cursor.getLong(idx);
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
        return -1L;
    }
}
