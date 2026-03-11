package org.deal.mcsa.presentation.ui.screens

import android.util.Log
import android.view.View
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.fragment.app.FragmentContainerView
import org.deal.mcsa.GisCapacitorFragment

@Composable
fun GisScreen() {
    val activity = LocalActivity.current as androidx.fragment.app.FragmentActivity
    val fragmentManager = activity.supportFragmentManager
    
    // Use a unique ID for the container - must be positive and unique
    val containerId = remember { 
        View.generateViewId().takeIf { it > 0 } ?: android.R.id.content 
    }
    
    Log.d("GisScreen", "GisScreen composable called - Activity: ${activity.javaClass.simpleName}")
    Log.d("GisScreen", "Container ID: $containerId")
    
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            Log.d("GisScreen", "AndroidView factory called")
            
            FragmentContainerView(ctx).apply {
                id = containerId
                Log.d("GisScreen", "FragmentContainerView created with ID: $containerId")
            }
        },
        update = { view ->
            Log.d("GisScreen", "AndroidView update called - View ID: ${view.id}")
            
            // Check if fragment is already attached to this view
            val existingFragment = fragmentManager.findFragmentByTag("gis_fragment")
            if (existingFragment?.view?.id == view.id) {
                Log.d("GisScreen", "Fragment already attached to this view")
                return@AndroidView
            }
            
            // Add fragment only after view is properly attached
            view.post {
                // Double-check fragment doesn't exist
                val fragment = fragmentManager.findFragmentByTag("gis_fragment")
                if (fragment == null && view.parent != null && view.id != View.NO_ID) {
                    Log.d("GisScreen", "View is attached (parent: ${view.parent}), adding fragment")
                    try {
                        val newFragment = GisCapacitorFragment.newInstance()
                        fragmentManager.beginTransaction()
                            .add(view.id, newFragment, "gis_fragment")
                            .commitNowAllowingStateLoss()
                        Log.d("GisScreen", "GisCapacitorFragment added successfully to view ID: ${view.id}")
                    } catch (e: Exception) {
                        Log.e("GisScreen", "Error adding fragment: ${e.message}", e)
                        e.printStackTrace()
                    }
                } else {
                    if (fragment != null) {
                        Log.d("GisScreen", "Fragment already exists, not adding again")
                    } else if (view.parent == null) {
                        Log.d("GisScreen", "View not yet attached (parent is null)")
                    } else {
                        Log.d("GisScreen", "View ID is invalid: ${view.id}")
                    }
                }
            }
        }
    )
    
    // The GisScreen composable is kept alive across tab switches (always in composition tree).
    // Do NOT remove the fragment on dispose — it keeps the Capacitor WebView/Bridge alive,
    // preserving all map state, sketches, layers, and UDP connections.
    // The fragment will be cleaned up naturally when the Activity is destroyed.
    DisposableEffect(Unit) {
        Log.d("GisScreen", "DisposableEffect created — fragment will be kept alive across tab switches")
        onDispose {
            Log.d("GisScreen", "GisScreen being disposed — keeping fragment alive for state preservation")
            // Intentionally NOT removing the fragment here.
            // The fragment and its WebView survive tab switches to preserve user work.
        }
    }
}
