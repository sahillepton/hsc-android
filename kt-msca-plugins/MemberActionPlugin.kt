package org.deal.mcsa.plugins

import android.util.Log
import com.getcapacitor.Plugin
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "MemberAction")
class MemberActionPlugin : Plugin() {

    companion object {
        private const val TAG = "MemberActionPlugin"

        private var externalListener: MemberActionListener? = null

        @JvmStatic
        fun setMemberActionListener(listener: MemberActionListener?) {
            externalListener = listener
            Log.d(TAG, "MemberActionListener set: ${listener != null}")
        }
    }

    /** GIS tooltip sends only [globalId] and [action] (e.g. video, ftp, call, message). */
    interface MemberActionListener {
        fun onMemberAction(globalId: String, action: String)
    }

    @PluginMethod
    fun notifyAction(call: PluginCall) {
        try {
            val globalId = call.getString("globalId") ?: ""
            val action = call.getString("action") ?: ""

            Log.d(TAG, "Member Action: globalId=$globalId action=$action")

            externalListener?.let { listener ->
                activity?.runOnUiThread {
                    listener.onMemberAction(globalId, action)
                }
            }

            val result = JSObject().apply {
                put("success", true)
                put("globalId", globalId)
                put("action", action)
            }
            call.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Error in notifyAction: ${e.message}")
            call.reject("Failed to process member action: ${e.message}")
        }
    }

    fun sendActionResponse(globalId: String, status: String) {
        val data = JSObject().apply {
            put("globalId", globalId)
            put("status", status)
        }
        notifyListeners("actionResponse", data, true)
    }
}
