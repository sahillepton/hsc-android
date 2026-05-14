package org.deal.mcsa.plugins

import android.util.Log
import com.getcapacitor.Plugin
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import org.json.JSONArray
import org.deal.mcsa.utility.observeFeatureMap

/**
 * Bridges {@link org.deal.mcsa.utility.observeFeatureMap} to the GIS WebView as JSON:
 * `{ "map": { "<ip>": [1,2,4], ... } }`.
 *
 * Copy into the integrated app module and register in [org.deal.mcsa.GisCapacitorFragment]
 * next to other custom plugins.
 */
@CapacitorPlugin(name = "FeatureAccessMap")
class FeatureAccessMapPlugin : Plugin() {

    companion object {
        private const val TAG = "FeatureAccessMapPlugin"
    }

    @PluginMethod
    fun getFeatureMap(call: PluginCall) {
        val ctx = context
        if (ctx == null) {
            call.reject("No context")
            return
        }
        try {
            val snapshot = runBlocking {
                observeFeatureMap(ctx).first()
            }
            val mapObj = JSObject()
            snapshot.forEach { (ip, ids) ->
                val arr = JSONArray()
                ids.forEach { arr.put(it) }
                mapObj.put(ip, arr)
            }
            val result = JSObject().apply {
                put("map", mapObj)
            }
            Log.d(TAG, "getFeatureMap: ${snapshot.size} IPs")
            call.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "getFeatureMap failed", e)
            call.reject(e.message ?: "getFeatureMap failed")
        }
    }
}
