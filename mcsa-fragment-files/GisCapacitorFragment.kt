package org.deal.mcsa

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.ConsoleMessage
import androidx.fragment.app.Fragment
import com.getcapacitor.Bridge
import com.getcapacitor.Logger
import com.getcapacitor.Plugin
import com.getcapacitor.PluginLoadException
import com.getcapacitor.PluginManager
import com.getcapacitor.PluginHandle
import com.getcapacitor.android.R as CapacitorR

// Custom plugins ONLY (official plugins are loaded via PluginManager from capacitor.plugins.json)
import org.deal.mcsa.plugins.UdpPlugin
import org.deal.mcsa.plugins.NativeUploaderPlugin
import org.deal.mcsa.plugins.ZipFolderPlugin
import org.deal.mcsa.plugins.MemberActionPlugin
import org.deal.mcsa.plugins.OfflineTileServerPlugin
import org.deal.mcsa.plugins.ScreenshotPlugin

/**
 * GisCapacitorFragment - A fragment that hosts the Capacitor WebView
 * for the hsc-android GIS application with FULL plugin support.
 * 
 * This mirrors BridgeActivity's approach:
 * - Official plugins are loaded via PluginManager from capacitor.plugins.json
 * - Custom plugins are registered manually via registerPlugin()
 */
class GisCapacitorFragment : Fragment() {

    private var bridge: Bridge? = null
    private var keepRunning = true
    
    // Only for CUSTOM plugins (not in capacitor.plugins.json)
    private val initialPlugins = mutableListOf<Class<out Plugin>>()
    
    // Bridge builder - initialized when fragment is attached
    private val bridgeBuilder: Bridge.Builder by lazy { 
        Bridge.Builder(this)
    }

    companion object {
        private const val TAG = "GisCapacitorFragment"
        
        fun newInstance(): GisCapacitorFragment {
            return GisCapacitorFragment()
        }
    }
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Register ONLY custom plugins (same as hsc-android MainActivity does)
        // Official plugins are loaded from capacitor.plugins.json by PluginManager
        registerPlugin(UdpPlugin::class.java)
        registerPlugin(NativeUploaderPlugin::class.java)
        registerPlugin(ZipFolderPlugin::class.java)
        registerPlugin(MemberActionPlugin::class.java)
        registerPlugin(OfflineTileServerPlugin::class.java)
        registerPlugin(ScreenshotPlugin::class.java)
        
        Logger.debug("$TAG: Registered ${initialPlugins.size} custom plugins")
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        return try {
            val view = inflater.inflate(CapacitorR.layout.capacitor_bridge_layout_main, container, false)
            Logger.debug("$TAG: Capacitor layout inflated")
            view
        } catch (e: Exception) {
            Logger.error("$TAG: Error inflating Capacitor layout", e)
            null
        }
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        
        Logger.debug("$TAG: onViewCreated - initializing bridge")
        
        bridgeBuilder.setInstanceState(savedInstanceState)
        
        // Load OFFICIAL plugins from capacitor.plugins.json (same as BridgeActivity)
        val loader = PluginManager(requireActivity().assets)
        try {
            val plugins = loader.loadPluginClasses()
            bridgeBuilder.addPlugins(plugins)
            Logger.debug("$TAG: Loaded ${plugins.size} plugins from capacitor.plugins.json")
            
            // Log plugin names for debugging
            plugins.forEach { pluginClass ->
                Logger.debug("$TAG: Auto-loaded plugin: ${pluginClass.simpleName}")
            }
        } catch (ex: PluginLoadException) {
            Logger.error("$TAG: Error loading plugins from capacitor.plugins.json", ex)
        }
        
        // Load the bridge
        load()
    }
    
    /**
     * Load the bridge - mirrors BridgeActivity.load()
         * Catches PluginLoadException to handle individual plugin failures gracefully
     */
    private fun load() {
        Logger.debug("$TAG: Starting bridge load")
            Logger.debug("$TAG: Custom plugins count: ${initialPlugins.size}")
        
        // Add custom plugins and create bridge
            // Wrap in try-catch to handle GeolocationPlugin load failures gracefully
            try {
        bridge = bridgeBuilder
            .addPlugins(initialPlugins)  // Custom plugins
            .setConfig(null)             // Use default config from assets/capacitor.config.json
            .create()
        
        keepRunning = bridge?.shouldKeepRunning() ?: true
                Logger.debug("$TAG: Bridge created successfully")
            } catch (e: com.getcapacitor.PluginLoadException) {
                Logger.error("$TAG: Plugin load exception (likely GeolocationPlugin): ${e.message}", e)
                // Try to create bridge without the failing plugin
                // The plugin that failed won't be loaded, but others will work
                try {
                    // Rebuild bridge builder without problematic plugins
                    bridge = bridgeBuilder
                        .addPlugins(initialPlugins)
                        .setConfig(null)
                        .create()
                    keepRunning = bridge?.shouldKeepRunning() ?: true
                    Logger.warn("$TAG: Bridge created with reduced plugin set")
                } catch (e2: Exception) {
                    Logger.error("$TAG: Failed to create bridge even after retry: ${e2.message}", e2)
                }
            } catch (e: Exception) {
                Logger.error("$TAG: Unexpected error creating bridge: ${e.message}", e)
            }
        
        // Suppress verbose console logs from WebView (Udp.addListener result logs)
        bridge?.webView?.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                val message = consoleMessage?.message() ?: ""
                // Suppress verbose Capacitor logs only (keep actual errors visible)
                if (message.contains("result Udp.addListener", ignoreCase = true)) {
                    // Silently ignore verbose result logs
                    return true
                }
                // Allow other console messages through (including Geolocation errors if they occur)
                return super.onConsoleMessage(consoleMessage)
            }
        }
        
        Logger.debug("$TAG: Bridge created successfully")
    }
    
    /**
     * Register a custom plugin (call before bridge is created)
     */
    fun registerPlugin(plugin: Class<out Plugin>) {
        initialPlugins.add(plugin)
    }

    fun getBridge(): Bridge? = bridge

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        bridge?.saveInstanceState(outState)
    }

    override fun onStart() {
        super.onStart()
        bridge?.onStart()
        Logger.debug("$TAG: onStart")
    }

    override fun onResume() {
        super.onResume()
        bridge?.let {
            it.app?.fireStatusChange(true)
            it.onResume()
        }
        Logger.debug("$TAG: onResume")
    }

    override fun onPause() {
        super.onPause()
        bridge?.onPause()
        Logger.debug("$TAG: onPause")
    }

    override fun onStop() {
        super.onStop()
        bridge?.let {
            it.app?.fireStatusChange(false)
            it.onStop()
        }
        Logger.debug("$TAG: onStop")
    }

    override fun onDestroy() {
        super.onDestroy()
        bridge?.onDestroy()
        Logger.debug("$TAG: onDestroy")
    }

    fun handleBackPress(): Boolean {
        val webView = bridge?.webView
        if (webView?.canGoBack() == true) {
            webView.goBack()
            return true
        }
        return false
    }

    fun reload() {
        bridge?.webView?.reload()
    }
}
