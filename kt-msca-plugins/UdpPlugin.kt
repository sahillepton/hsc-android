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
import java.net.InetSocketAddress

@CapacitorPlugin(name = "Udp")
class UdpPlugin : Plugin() {

    private var socket: DatagramSocket? = null
    private val LISTEN_PORT = 40074 // Fixed port for receiving topology data from intranet
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
            // Close existing socket if any
            if (socket != null && !socket!!.isClosed) {
                listening = false
                socket?.close()
                socket = null
            }

            // Bind to fixed port 40074 to receive data from intranet
            socket = DatagramSocket(null).apply {
                reuseAddress = true
                bind(InetSocketAddress(LISTEN_PORT))
            }

            Log.d("UdpPlugin", "UDP socket bound to port $LISTEN_PORT")

            startListening()

            val ret = JSObject()
            ret.put("ok", true)
            ret.put("port", LISTEN_PORT)
            call.resolve(ret)

        } catch (e: Exception) {
            Log.e("UdpPlugin", "UDP create failed: ${e.message}", e)
            call.reject("UDP create failed: ${e.message}")
        }
    }

    @PluginMethod
    fun send(call: PluginCall) {
        // No longer needed - receive-only socket on port 40074
        val ret = JSObject()
        ret.put("ok", true)
        call.resolve(ret)
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
                Log.e("UdpPlugin", "Error in UDP listen loop: ${e.message}", e)
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
        socket = null

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
