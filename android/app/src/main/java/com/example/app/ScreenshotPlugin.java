package com.example.app;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.PixelCopy;
import android.view.View;
import android.view.Window;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

@CapacitorPlugin(name = "Screenshot")
public class ScreenshotPlugin extends Plugin {

    @PluginMethod
    public void captureAndSave(PluginCall call) {
        call.setKeepAlive(true);
        
        try {
            // Get the Activity from the plugin context
            Activity activity = getActivity();
            if (activity == null) {
                call.reject("Activity is not available");
                return;
            }

            Window window = activity.getWindow();
            if (window == null) {
                call.reject("Window is not available");
                return;
            }

            // Get window dimensions
            View decorView = window.getDecorView();
            int width = decorView.getWidth();
            int height = decorView.getHeight();

            if (width <= 0 || height <= 0) {
                android.util.Log.e("ScreenshotPlugin", "Invalid window dimensions: " + width + "x" + height);
                call.reject("Invalid window dimensions");
                return;
            }

            // Create bitmap with window dimensions
            final Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);

            // Use PixelCopy to capture the actual rendered window surface (API 26+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                PixelCopy.request(window, bitmap, new PixelCopy.OnPixelCopyFinishedListener() {
                    @Override
                    public void onPixelCopyFinished(int copyResult) {
                        if (copyResult == PixelCopy.SUCCESS) {
                            // Successfully captured the window surface (including WebView)
                            String savedPath = saveToGallery(bitmap);
                            if (savedPath != null) {
                                JSObject result = new JSObject();
                                result.put("success", true);
                                result.put("path", savedPath);
                                call.resolve(result);
                            } else {
                                call.reject("Failed to save screenshot to gallery");
                            }
                        } else {
                            android.util.Log.e("ScreenshotPlugin", "PixelCopy failed: " + copyResult);
                            call.reject("Failed to capture screenshot: PixelCopy error " + copyResult);
                        }
                        call.setKeepAlive(false);
                    }
                }, new Handler(Looper.getMainLooper()));
            } else {
                call.reject("Screenshot requires Android API 26 or higher");
                call.setKeepAlive(false);
            }

        } catch (Exception e) {
            android.util.Log.e("ScreenshotPlugin", "Error capturing screenshot", e);
            call.reject("Screenshot failed: " + e.getMessage());
            call.setKeepAlive(false);
        }
    }


    private String saveToGallery(Bitmap bitmap) {
        Context context = getContext();
        if (context == null) {
            return null;
        }

        try {
            String fileName = "HSC_Map_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date()) + ".png";
            String mimeType = "image/png";

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10+ (API 29+) - Use MediaStore API
                ContentValues contentValues = new ContentValues();
                contentValues.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                contentValues.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
                contentValues.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/HSC Maps");

                Uri uri = context.getContentResolver().insert(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    contentValues
                );

                if (uri == null) {
                    android.util.Log.e("ScreenshotPlugin", "Failed to create MediaStore entry");
                    return null;
                }

                try (OutputStream outputStream = context.getContentResolver().openOutputStream(uri)) {
                    if (outputStream == null) {
                        android.util.Log.e("ScreenshotPlugin", "Failed to open output stream");
                        return null;
                    }
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream);
                    outputStream.flush();
                }

                // Return the URI path
                return uri.toString();
            } else {
                // Android 9 and below - Use legacy file system
                File picturesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES);
                File hscDir = new File(picturesDir, "HSC Maps");
                if (!hscDir.exists()) {
                    if (!hscDir.mkdirs()) {
                        android.util.Log.e("ScreenshotPlugin", "Failed to create directory");
                        return null;
                    }
                }

                File imageFile = new File(hscDir, fileName);
                try (FileOutputStream fos = new FileOutputStream(imageFile)) {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, fos);
                    fos.flush();
                }

                // Notify media scanner
                android.content.Intent mediaScanIntent = new android.content.Intent(android.content.Intent.ACTION_MEDIA_SCANNER_SCAN_FILE);
                mediaScanIntent.setData(Uri.fromFile(imageFile));
                context.sendBroadcast(mediaScanIntent);

                return imageFile.getAbsolutePath();
            }
        } catch (IOException e) {
            android.util.Log.e("ScreenshotPlugin", "Error saving bitmap", e);
            return null;
        }
    }
}

