package com.example.app;

import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;

@CapacitorPlugin(name = "Udp")
public class UdpPlugin extends Plugin {

    private DatagramSocket socket;
    private static final int LISTEN_PORT = 40074; // Fixed port for receiving topology data from intranet
    private boolean listening = false;

    // Optional: test event from MainActivity
    public void sendTestEvent(String msg) {
        JSObject data = new JSObject();
        data.put("message", msg);
        notifyListeners("udpMessage", data, true);
    }

    @PluginMethod
    public void create(PluginCall call) {
        try {
            // Close existing socket if any
            if (socket != null && !socket.isClosed()) {
                listening = false;
                socket.close();
                socket = null;
            }

            // Bind to fixed port 40074 to receive data from intranet
            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(LISTEN_PORT));

            Log.d("UdpPlugin", "UDP socket bound to port " + LISTEN_PORT);

            startListening();

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("port", LISTEN_PORT);
            call.resolve(ret);

        } catch (Exception e) {
            Log.e("UdpPlugin", "UDP create failed: " + e.getMessage(), e);
            call.reject("UDP create failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void send(PluginCall call) {
        // No longer needed - receive-only socket on port 40074
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    private void startListening() {
        if (listening || socket == null) return;

        listening = true;

        new Thread(() -> {
            try {
                byte[] buffer = new byte[4096];

                while (listening) {
                    DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                    socket.receive(packet);

                    int len = packet.getLength();
                    byte[] raw = new byte[len];
                    System.arraycopy(packet.getData(), packet.getOffset(), raw, 0, len);

                    // Convert bytes -> JS array so we can reconstruct ArrayBuffer in JS
                    JSArray jsBytes = new JSArray();
                    for (int i = 0; i < raw.length; i++) {
                        jsBytes.put(raw[i] & 0xFF);
                    }

                    JSObject data = new JSObject();
                    data.put("buffer", jsBytes);    // your JS will see event.buffer
                    data.put("byteLength", len);    // helper if needed

                    notifyListeners("udpMessage", data, true);
                }

            } catch (Exception e) {
                Log.e("UdpPlugin", "Error in UDP listen loop: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void close(PluginCall call) {
        listening = false;

        if (socket != null && !socket.isClosed()) {
            socket.close();
        }
        socket = null;

        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    // Your React code calls Udp.closeAllSockets()
    @PluginMethod
    public void closeAllSockets(PluginCall call) {
        close(call);
    }
}
