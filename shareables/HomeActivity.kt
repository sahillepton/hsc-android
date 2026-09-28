package org.deal.mcsa.presentation.ui.activity


import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.remember
import androidx.core.view.WindowCompat
import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.core.app.ActivityCompat
import androidx.appcompat.app.AlertDialog
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.withContext
import org.deal.mcsa.presentation.ui.components.ConsentDialogHost
import org.deal.mcsa.database.config.AppDependencies
import org.deal.mcsa.database.utils.IntentUtility
import org.deal.mcsa.presentation.ui.screens.HomeScreen
import org.deal.mcsa.presentation.ui.theme.DealMCSATheme
import org.deal.mcsa.presentation.viewmodel.CallViewModel
import org.deal.mcsa.presentation.viewmodel.HomeViewModel
import org.deal.mcsa.presentation.ui.components.ConsentListener
import org.deal.mcsa.presentation.viewmodel.ConsentViewModel
import org.deal.mcsa.presentation.viewmodel.SMSViewModel
import org.deal.mcsa.presentation.viewmodel.SipRegistrationViewModel
// MemberActionPlugin import
import org.deal.mcsa.plugins.MemberActionPlugin
import org.deal.mcsa.utility.LogoutManager
import org.deal.mcsa.utility.MultiDeviceUdpManager

/**
 * @author Sonal Chauhan
 *
 * Single–activity host that sets up the Compose hierarchy.
 */
@AndroidEntryPoint
class HomeActivity : BaseActivity() {

    companion object {
        // Log tag for MemberActionPlugin example logs (filter Logcat: HomeActivity.MemberAction).
        private const val TAG_MEMBER_ACTION = "HomeActivity.MemberAction"
    }

    private val callViewModel: CallViewModel by viewModels()
    private val sipRegistrationViewModel: SipRegistrationViewModel by viewModels()
    private val homeViewModel: HomeViewModel by viewModels()
    private val smsViewModel: SMSViewModel by viewModels()

    // ADD UDP MANAGER
    private var multiDeviceUdpManager: MultiDeviceUdpManager? = null
    private val activityScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        AppDependencies.init(applicationContext)

        if (!LogoutManager.isUserLoggedIn(this)) {
            IntentUtility.startActivity(
                context = this,
                targetActivity = LoginActivity::class.java,
                finishCurrent = true
            )
            return
        }
        checkPermissions()
        checkStoragePermission()

        // UDP manager setup
        initializeMultiDeviceUdpManager()
        multiDeviceUdpManager?.let { homeViewModel.setUdpManager(it) }

        homeViewModel.initializeUserData(this)
        sipRegistrationViewModel.loadCredentialsFromPreferences(context = this)

        // Required for MemberActionPlugin: register here so GIS tooltip taps (globalId + action) reach native.
        // Example usage only (Log)—replace onMemberAction with call/FTP/message handling for integration.
        MemberActionPlugin.setMemberActionListener(object : MemberActionPlugin.MemberActionListener {
            override fun onMemberAction(globalId: String, action: String) {
                Log.i(
                    TAG_MEMBER_ACTION,
                    "GIS tooltip — globalId=$globalId action=$action",
                )
            }
        })

        setContent {
            val consentViewModel = remember { ConsentViewModel() }
            DealMCSATheme {
                ConsentListener(consentViewModel)
                ConsentDialogHost(applicationContext, consentViewModel)
                multiDeviceUdpManager?.let { manager ->
                    HomeScreen(homeViewModel, callViewModel, smsViewModel, manager, activityScope)
                }
                SMSListener(smsViewModel, applicationContext)
            }
        }
    }

    private fun checkPermissions() {
        val permissions = mutableListOf<String>()
        
        // Camera, Audio, Bluetooth permissions
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.CAMERA) 
            != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.CAMERA)
        }
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) 
            != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.RECORD_AUDIO)
        }
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) 
            != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
        }
        
        // Location permissions (required for Geolocation plugin)
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) 
            != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) 
            != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.ACCESS_COARSE_LOCATION)
        }
        
        if (permissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, permissions.toTypedArray(), 0)
        }
    }
    
    private fun checkStoragePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11+ (API 30+) - Need MANAGE_EXTERNAL_STORAGE for TileServer
            if (!Environment.isExternalStorageManager()) {
                showStoragePermissionDialog()
            } else {
                Log.d("HomeActivity", "Storage permission already granted")
            }
        }
    }
    
    private fun showStoragePermissionDialog() {
        AlertDialog.Builder(this)
            .setTitle("Storage Permission Required")
            .setMessage("This app needs access to manage all files for the GIS map tile server.\n\nWithout this permission, the map cannot:\n• Load offline map tiles\n• Access tile files\n• Display the map correctly\n\nPlease tap 'Open Settings' and enable 'Allow access to manage all files'.")
            .setPositiveButton("Open Settings") { _, _ ->
                requestManageStoragePermission()
            }
            .setNegativeButton("Cancel") { dialog, _ ->
                dialog.dismiss()
                Toast.makeText(this, "Map may not work without storage permission", Toast.LENGTH_LONG).show()
            }
            .setIcon(android.R.drawable.ic_dialog_alert)
            .setCancelable(false)
            .show()
    }
    
    private fun requestManageStoragePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
                intent.data = Uri.parse("package:$packageName")
                startActivity(intent)
            } catch (e: Exception) {
                // Fallback for devices that don't support the specific intent
                try {
                    val intent = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
                    startActivity(intent)
                } catch (e2: Exception) {
                    Log.e("HomeActivity", "Failed to open storage settings: ${e2.message}", e2)
                    Toast.makeText(this, "Could not open settings. Please grant storage permission manually.", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun initializeMultiDeviceUdpManager() {
        try {
            val addressBookDao = AppDependencies.database.addressBookDao()
            multiDeviceUdpManager = MultiDeviceUdpManager(this, addressBookDao)
            multiDeviceUdpManager?.testUdpConnection()
            Log.d("HomeActivity", "Multi-device UDP manager initialized")
        } catch (e: Exception) {
            Log.e("HomeActivity", "Error initializing multi-device UDP manager", e)
        }
    }

    override fun onDestroy() {
        MemberActionPlugin.setMemberActionListener(null) // clear MemberActionPlugin listener
        multiDeviceUdpManager?.stopAll()
        activityScope.cancel()
        Log.d("HomeActivity", "Multi-device UDP operations stopped and activity scope cancelled")
        super.onDestroy()
    }
}

@Composable
fun SMSListener(smsViewModel: SMSViewModel, context: Context) {

    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            while (true) {
                try {
                    smsViewModel.receivePacket(context)
                    //logParsed(packet)}
                } catch (e: Exception) {
                    Log.e("SMSListener", "Error receiving UDP message: ${e.message}", e)
                }
            }
        }
    }
}
