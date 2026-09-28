package com.example.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Standalone GIS: empty map. Integrated MCSA copies {@code kt-msca-plugins/FeatureAccessMapPlugin.kt}.
 */
@CapacitorPlugin(name = "FeatureAccessMap")
public class FeatureAccessMapPlugin extends Plugin {

    @PluginMethod
    public void getFeatureMap(PluginCall call) {
        JSObject inner = new JSObject();
        JSObject result = new JSObject();
        result.put("map", inner);
        call.resolve(result);
    }
}
