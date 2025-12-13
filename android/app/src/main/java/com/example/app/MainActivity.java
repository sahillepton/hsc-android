package com.example.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register plugins BEFORE super
        registerPlugin(UdpPlugin.class);
        registerPlugin(NativeUploaderPlugin.class);

        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();

        // Optional: test event (your existing code)
        PluginHandle handle = getBridge().getPlugin("Udp");
        if (handle != null) {
            UdpPlugin plugin = (UdpPlugin) handle.getInstance();
            if (plugin != null) {
                plugin.sendTestEvent("Hello from Android!");
            }
        }
    }
}
