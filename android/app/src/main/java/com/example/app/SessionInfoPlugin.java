package com.example.app;

import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Standalone GIS APK: no MCSA {@code UserPreferencesManager} — returns empty session.
 * Integrated build uses {@code org.deal.mcsa.plugins.SessionInfoPlugin} instead.
 */
@CapacitorPlugin(name = "SessionInfo")
public class SessionInfoPlugin extends Plugin {

    private static final String TAG = "SessionInfoPlugin";

    @PluginMethod
    public void getSession(PluginCall call) {
        JSObject result = new JSObject();
        result.put("isLoggedIn", false);
        result.put("username", "");
        Log.d(TAG, "getSession: standalone stub (no MCSA prefs)");
        call.resolve(result);
    }
}
