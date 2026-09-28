package com.example.app;

import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * GIS tooltip → native: only {@code globalId} and {@code action} (video, ftp, call, message).
 */
@CapacitorPlugin(name = "MemberAction")
public class MemberActionPlugin extends Plugin {

    private static final String TAG = "MemberActionPlugin";

    public interface MemberActionListener {
        void onMemberAction(String globalId, String action);
    }

    private static MemberActionListener externalListener;

    public static void setMemberActionListener(MemberActionListener listener) {
        externalListener = listener;
        Log.d(TAG, "MemberActionListener set: " + (listener != null));
    }

    @PluginMethod
    public void notifyAction(PluginCall call) {
        try {
            String globalId = call.getString("globalId", "");
            String action = call.getString("action", "");

            Log.d(TAG, "Member Action: globalId=" + globalId + " action=" + action);

            if (externalListener != null) {
                getActivity().runOnUiThread(() ->
                        externalListener.onMemberAction(globalId, action));
            }

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("globalId", globalId);
            result.put("action", action);
            call.resolve(result);

        } catch (Exception e) {
            Log.e(TAG, "Error in notifyAction: " + e.getMessage());
            call.reject("Failed to process member action: " + e.getMessage());
        }
    }

    public void sendActionResponse(String globalId, String status) {
        JSObject data = new JSObject();
        data.put("globalId", globalId);
        data.put("status", status);
        notifyListeners("actionResponse", data, true);
    }
}
