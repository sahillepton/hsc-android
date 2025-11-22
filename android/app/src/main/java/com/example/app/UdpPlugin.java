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
import java.net.InetAddress;

@CapacitorPlugin(name = "Udp")
public class UdpPlugin extends Plugin {

    private DatagramSocket socket;
    private InetAddress serverAddress;
    private int serverPort;
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
            // Match your JS: { address, port }
            String host = call.getString("address");
            if (host == null) host = call.getString("host");  // fallback
            Integer port = call.getInt("port");
            if (port == null) port = call.getInt("remotePort");

            if (host == null || port == null) {
                JSObject data = call.getData();
                Log.e("UdpPlugin", "Host or port missing. Got: " + data.toString());
                call.reject("Host or port missing");
                return;
            }

            serverAddress = InetAddress.getByName(host);
            serverPort = port;

            socket = new DatagramSocket(); // UDP client socket

            startListening();

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("host", host);
            ret.put("port", port);
            call.resolve(ret);

        } catch (Exception e) {
            call.reject("UDP create failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void send(PluginCall call) {
        try {
            String msg = call.getString("data");
            if (msg == null) {
                call.reject("No data");
                return;
            }

            // Allow overriding address/port per send (since JS passes them)
            String host = call.getString("address");
            Integer port = call.getInt("port");
            InetAddress addr = serverAddress;
            int p = serverPort;

            if (host != null) {
                addr = InetAddress.getByName(host);
            }
            if (port != null) {
                p = port;
            }

            if (socket == null || addr == null) {
                call.reject("Socket not created. Call create() first.");
                return;
            }

            byte[] buf = msg.getBytes();
            DatagramPacket packet = new DatagramPacket(buf, buf.length, addr, p);
            socket.send(packet);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("bytesSent", buf.length);
            call.resolve(ret);

        } catch (Exception e) {
            call.reject("UDP send failed: " + e.getMessage());
        }
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
                    data.put("buffer", jsBytes);    // 👈 your JS will see event.buffer
                    data.put("byteLength", len);    // helper if needed

                    notifyListeners("udpMessage", data, true);
                }

            } catch (Exception e) {
                Log.e("UdpPlugin", "Error in UDP listen loop: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void close(PluginCall call) {
        listening = false;

        if (socket != null && !socket.isClosed()) {
            socket.close();
        }

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