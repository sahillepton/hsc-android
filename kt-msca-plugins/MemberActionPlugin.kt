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
        
        // Static listener that host app can set
        private var externalListener: MemberActionListener? = null
        
        /**
         * Set a listener from the host app (e.g., MainActivity)
         * Call this to receive member action events
         */
        @JvmStatic
        fun setMemberActionListener(listener: MemberActionListener?) {
            externalListener = listener
            Log.d(TAG, "MemberActionListener set: ${listener != null}")
        }
    }
    
    /**
     * Interface for host app to receive member actions
     */
    interface MemberActionListener {
        fun onMemberAction(
            memberId: String,
            action: String,
            memberName: String,
            phoneNumber: String,
            metadata: String
        )
    }

    /**
     * Called from JavaScript when user clicks Call/Message button
     */
    @PluginMethod
    fun notifyAction(call: PluginCall) {
        try {
            val memberId = call.getString("memberId") ?: ""
            val action = call.getString("action") ?: ""
            val memberName = call.getString("memberName") ?: ""
            val phoneNumber = call.getString("phoneNumber") ?: ""
            val metadata = call.getString("metadata") ?: ""

            Log.d(TAG, "Member Action Received:")
            Log.d(TAG, "  - Member ID: $memberId")
            Log.d(TAG, "  - Action: $action")
            Log.d(TAG, "  - Name: $memberName")
            Log.d(TAG, "  - Phone: $phoneNumber")

            // Notify external listener (host app) if set
            externalListener?.let { listener ->
                activity?.runOnUiThread {
                    listener.onMemberAction(memberId, action, memberName, phoneNumber, metadata)
                }
            }

            // Return success to JavaScript
            val result = JSObject().apply {
                put("success", true)
                put("memberId", memberId)
                put("action", action)
            }
            call.resolve(result)

        } catch (e: Exception) {
            Log.e(TAG, "Error in notifyAction: ${e.message}")
            call.reject("Failed to process member action: ${e.message}")
        }
    }

    /**
     * Send a response back to the web app (optional)
     * Can be called from native code to notify JS about action status
     */
    fun sendActionResponse(memberId: String, status: String) {
        val data = JSObject().apply {
            put("memberId", memberId)
            put("status", status)
        }
        notifyListeners("actionResponse", data, true)
    }
}

