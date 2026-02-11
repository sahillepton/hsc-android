package com.example.app;

import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * MemberActionPlugin - Bridge between Web App and Native Android
 * 
 * This plugin receives member action events (call, message, info) from the web app
 * and can notify the host Android app (MainActivity) to handle them.
 * 
 * Usage from JavaScript:
 *   MemberAction.notifyAction({
 *     memberId: "GLOBAL_ID_123",
 *     action: "call",
 *     memberName: "John Doe",
 *     phoneNumber: "+1234567890"
 *   });
 */
@CapacitorPlugin(name = "MemberAction")
public class MemberActionPlugin extends Plugin {

    private static final String TAG = "MemberActionPlugin";

    // Interface for host app to receive member actions
    public interface MemberActionListener {
        void onMemberAction(String memberId, String action, String memberName, String phoneNumber, String metadata);
    }

    // Static listener that host app can set
    private static MemberActionListener externalListener;

    /**
     * Set a listener from the host app (e.g., MainActivity in integrationApp)
     * Call this from your MainActivity to receive member action events
     */
    public static void setMemberActionListener(MemberActionListener listener) {
        externalListener = listener;
        Log.d(TAG, "MemberActionListener set: " + (listener != null));
    }

    /**
     * Called from JavaScript when user clicks Call/Message button
     */
    @PluginMethod
    public void notifyAction(PluginCall call) {
        try {
            String memberId = call.getString("memberId", "");
            String action = call.getString("action", "");
            String memberName = call.getString("memberName", "");
            String phoneNumber = call.getString("phoneNumber", "");
            String metadata = call.getString("metadata", "");

            Log.d(TAG, "Member Action Received:");
            Log.d(TAG, "  - Member ID: " + memberId);
            Log.d(TAG, "  - Action: " + action);
            Log.d(TAG, "  - Name: " + memberName);
            Log.d(TAG, "  - Phone: " + phoneNumber);

            // Notify external listener (host app) if set
            if (externalListener != null) {
                getActivity().runOnUiThread(() -> {
                    externalListener.onMemberAction(memberId, action, memberName, phoneNumber, metadata);
                });
            }

            // Return success to JavaScript
            JSObject result = new JSObject();
            result.put("success", true);
            result.put("memberId", memberId);
            result.put("action", action);
            call.resolve(result);

        } catch (Exception e) {
            Log.e(TAG, "Error in notifyAction: " + e.getMessage());
            call.reject("Failed to process member action: " + e.getMessage());
        }
    }

    /**
     * Send a response back to the web app (optional)
     * Can be called from native code to notify JS about action status
     */
    public void sendActionResponse(String memberId, String status) {
        JSObject data = new JSObject();
        data.put("memberId", memberId);
        data.put("status", status);
        notifyListeners("actionResponse", data, true);
    }
}

