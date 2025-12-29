package com.example.app;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register plugins BEFORE super
        registerPlugin(UdpPlugin.class);
        registerPlugin(NativeUploaderPlugin.class);
        registerPlugin(ZipFolderPlugin.class);

        super.onCreate(savedInstanceState);
        
        // Enable immersive fullscreen mode (hide status bar and navigation bar)
        enableImmersiveMode();
    }
    
    private void enableImmersiveMode() {
        View decorView = getWindow().getDecorView();
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11+ (API 30+) - Use modern API
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                // Hide both status bar and navigation bar
                controller.hide(android.view.WindowInsets.Type.statusBars() | android.view.WindowInsets.Type.navigationBars());
                // Make bars show transiently when user swipes (like games)
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            // Android 10 and below - Use legacy API
            int uiOptions = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN;
            
            decorView.setSystemUiVisibility(uiOptions);
            
            // Set listener to re-enable immersive mode when user interacts
            decorView.setOnSystemUiVisibilityChangeListener(new View.OnSystemUiVisibilityChangeListener() {
                @Override
                public void onSystemUiVisibilityChange(int visibility) {
                    if ((visibility & View.SYSTEM_UI_FLAG_FULLSCREEN) == 0) {
                        // System bars are visible, re-hide them after a short delay
                        decorView.postDelayed(new Runnable() {
                            @Override
                            public void run() {
                                enableImmersiveMode();
                            }
                        }, 2000); // Re-hide after 2 seconds
                    }
                }
            });
        }
        
        // Keep screen on
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override
    public void onResume() {
        super.onResume();
        
        // Re-enable immersive mode when app resumes
        enableImmersiveMode();

        // Optional: test event (your existing code)
        PluginHandle handle = getBridge().getPlugin("Udp");
        if (handle != null) {
            UdpPlugin plugin = (UdpPlugin) handle.getInstance();
            if (plugin != null) {
                plugin.sendTestEvent("Hello from Android!");
            }
        }
    }
    
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            // Re-enable immersive mode when window gains focus
            enableImmersiveMode();
        }
    }
}
