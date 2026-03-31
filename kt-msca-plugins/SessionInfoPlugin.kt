package org.deal.mcsa.plugins

import android.util.Log
import com.getcapacitor.Plugin
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.deal.mcsa.utility.UserPreferencesManager

/**
 * Exposes MCSA login session (username) to the Capacitor GIS WebView.
 * Copy kept in sync with app/src/main/java/org/deal/mcsa/plugins/SessionInfoPlugin.kt
 */
@CapacitorPlugin(name = "SessionInfo")
class SessionInfoPlugin : Plugin() {

    companion object {
        private const val TAG = "SessionInfoPlugin"
    }

    @PluginMethod
    fun getSession(call: PluginCall) {
        try {
            val ctx = context
            if (ctx == null) {
                call.reject("No context")
                return
            }
            val loggedIn = UserPreferencesManager.isLoggedIn(ctx)
            val username = UserPreferencesManager.getUsername(ctx)
            val result = JSObject().apply {
                put("isLoggedIn", loggedIn)
                put("username", username ?: "")
            }
            Log.d(TAG, "getSession: isLoggedIn=$loggedIn username=${username ?: ""}")
            call.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "getSession failed", e)
            call.reject(e.message ?: "getSession failed")
        }
    }
}
