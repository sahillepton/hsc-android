package org.deal.mcsa.plugins

import android.util.Log
import com.getcapacitor.Plugin
import com.getcapacitor.JSObject
import com.getcapacitor.JSArray
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress

@CapacitorPlugin(name = "Udp")
class UdpPlugin : Plugin() {

    private var socket: DatagramSocket? = null
    private var serverAddress: InetAddress? = null
    private var serverPort: Int = 0
    private var listening = false

    // Optional: test event from MainActivity
    fun sendTestEvent(msg: String) {
        val data = JSObject()
        data.put("message", msg)
        notifyListeners("udpMessage", data, true)
    }

    @PluginMethod
    fun create(call: PluginCall) {
        try {
            // Match your JS: { address, port }
            var host = call.getString("address")
            if (host == null) host = call.getString("host") // fallback
            var port = call.getInt("port")
            if (port == null) port = call.getInt("remotePort")

            if (host == null || port == null) {
                val data = call.data
                Log.e("UdpPlugin", "Host or port missing. Got: $data")
                call.reject("Host or port missing")
                return
            }

            serverAddress = InetAddress.getByName(host)
            serverPort = port

            socket = DatagramSocket() // UDP client socket

            startListening()

            val ret = JSObject()
            ret.put("ok", true)
            ret.put("host", host)
            ret.put("port", port)
            call.resolve(ret)

        } catch (e: Exception) {
            call.reject("UDP create failed: ${e.message}")
        }
    }

    @PluginMethod
    fun send(call: PluginCall) {
        try {
            val msg = call.getString("data")
            if (msg == null) {
                call.reject("No data")
                return
            }

            // Allow overriding address/port per send (since JS passes them)
            val host = call.getString("address")
            val port = call.getInt("port")
            var addr = serverAddress
            var p = serverPort

            if (host != null) {
                addr = InetAddress.getByName(host)
            }
            if (port != null) {
                p = port
            }

            if (socket == null || addr == null) {
                call.reject("Socket not created. Call create() first.")
                return
            }

            val buf = msg.toByteArray()
            val packet = DatagramPacket(buf, buf.size, addr, p)
            socket?.send(packet)

            val ret = JSObject()
            ret.put("ok", true)
            ret.put("bytesSent", buf.size)
            call.resolve(ret)

        } catch (e: Exception) {
            call.reject("UDP send failed: ${e.message}")
        }
    }

    private fun startListening() {
        if (listening || socket == null) return

        listening = true

        Thread {
            try {
                val buffer = ByteArray(4096)

                while (listening) {
                    val packet = DatagramPacket(buffer, buffer.size)
                    socket?.receive(packet)

                    val len = packet.length
                    val raw = ByteArray(len)
                    System.arraycopy(packet.data, packet.offset, raw, 0, len)

                    // Convert bytes -> JS array so we can reconstruct ArrayBuffer in JS
                    val jsBytes = JSArray()
                    for (b in raw) {
                        jsBytes.put(b.toInt() and 0xFF)
                    }

                    val data = JSObject()
                    data.put("buffer", jsBytes) // your JS will see event.buffer
                    data.put("byteLength", len) // helper if needed

                    notifyListeners("udpMessage", data, true)
                }

            } catch (e: Exception) {
                Log.e("UdpPlugin", "Error in UDP listen loop: ${e.message}")
            }
        }.start()
    }

    @PluginMethod
    fun close(call: PluginCall) {
        listening = false

        socket?.let {
            if (!it.isClosed) {
                it.close()
            }
        }

        val ret = JSObject()
        ret.put("ok", true)
        call.resolve(ret)
    }

    // Your React code calls Udp.closeAllSockets()
    @PluginMethod
    fun closeAllSockets(call: PluginCall) {
        close(call)
    }
}

