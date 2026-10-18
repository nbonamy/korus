package com.nabocorp.companion

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.util.Size
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import java.util.concurrent.Executors

/** The internal camera activity returns only a validated code. Frames never leave the device. */
class PairingScannerActivity : FragmentActivity() {
    private val lock get() = (application as CompanionApplication).appLock
    private var authorized by mutableStateOf(false)
    private var denied by mutableStateOf(false)
    private var failure by mutableStateOf<String?>(null)
    private var retry by mutableIntStateOf(0)
    private var requested = false
    private lateinit var analyzer: PairingQrAnalyzer
    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!isFinishing) {
            authorized = granted; denied = !granted
            if (granted) failure = null else cameraUnavailable("Allow camera access in Settings to scan, or enter the code manually.")
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        analyzer = PairingQrAnalyzer(ContextCompat.getMainExecutor(this)) { code ->
            if (!isFinishing && authorized && failure == null && !lock.isLocked && lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                setResult(RESULT_OK,Intent().putExtra("pairingCode",code)); analyzer.close(); finish()
            }
        }
        requested = savedInstanceState?.getBoolean("requested") == true
        denied = savedInstanceState?.getBoolean("denied") == true
        authorized = checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        val supported = packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        if (!supported) failure = "This device has no camera. Enter the code shown on your computer."
        else if (denied && !authorized) failure = "Allow camera access in Settings to scan, or enter the code manually."
        setContent { CompanionTheme { ScannerContent() } }
        if (supported && !authorized && !requested) { requested = true; permission.launch(Manifest.permission.CAMERA) }
    }
    override fun onStart() { super.onStart(); if (lock.isLocked) finish() }
    override fun onResume() {
        super.onResume()
        if (lock.isLocked || isFinishing) { finish(); return }
        val granted = checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        if (granted != authorized) {
            authorized = granted; denied = !granted
            if (granted) failure = null else cameraUnavailable("Allow camera access in Settings to scan, or enter the code manually.")
            retry++
        }
        if (authorized && failure == null) analyzer.resume() else analyzer.pause()
    }
    override fun onPause() { analyzer.pause(); super.onPause() }
    override fun onDestroy() { analyzer.close(); super.onDestroy() }
    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean("requested",requested); outState.putBoolean("denied",denied); super.onSaveInstanceState(outState)
    }
    private fun cameraUnavailable(message: String) { analyzer.pause(); failure = message }

    @OptIn(ExperimentalMaterial3Api::class)
    @Composable private fun ScannerContent() {
        BackHandler { finish() }
        Scaffold(topBar = {
            TopAppBar(title = { Text("Scan pairing code") }, navigationIcon = { IconButton(onClick = { finish() }) { Icon(Icons.Outlined.Close,"Cancel scanner") } })
        }) { padding ->
            when {
                failure != null -> Column(Modifier.padding(padding).fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp,Alignment.CenterVertically)) {
                    Text("Camera unavailable",style = MaterialTheme.typography.titleLarge)
                    Text(failure.orEmpty(),color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (denied) TextButton(onClick = { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:$packageName"))) }) { Text("Open Settings") }
                    else if (authorized) TextButton(onClick = { failure = null; retry++ }) { Text("Try again") }
                    Button(onClick = { finish() }) { Text("Enter code manually") }
                }
                authorized -> key(retry) {
                    var ready by remember { mutableStateOf(false) }
                    Box(Modifier.padding(padding).fillMaxSize().background(MaterialTheme.colorScheme.scrim)) {
                        PairingCameraPreview(this@PairingScannerActivity,analyzer,{ ready = it }, { cameraUnavailable("The camera is unavailable. Enter the code shown on your computer.") })
                        CameraStartupIndicator(this@PairingScannerActivity,ready,{ cameraUnavailable("The camera didn’t become ready. Try again or enter the code manually.") },Modifier.align(Alignment.Center))
                        Surface(Modifier.align(Alignment.BottomCenter).padding(20.dp),shape = MaterialTheme.shapes.large) {
                            Text(if (ready) "Point your camera at the QR code on your computer." else "Opening camera…",Modifier.padding(16.dp))
                        }
                    }
                }
                else -> Box(Modifier.padding(padding).fillMaxSize(),contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            }
        }
    }
}

@Composable private fun PairingCameraPreview(owner: LifecycleOwner, analyzer: PairingQrAnalyzer, ready: (Boolean) -> Unit, failed: () -> Unit) {
    val context = LocalContext.current
    val previewView = remember { PreviewView(context).apply { implementationMode = PreviewView.ImplementationMode.COMPATIBLE; contentDescription = "Pairing code camera" } }
    val currentReady by rememberUpdatedState(ready)
    val currentFailed by rememberUpdatedState(failed)
    AndroidView(factory = { previewView },modifier = Modifier.fillMaxSize())
    DisposableEffect(previewView,owner,analyzer) {
        if (owner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) analyzer.resume()
        val worker = Executors.newSingleThreadExecutor()
        val main = ContextCompat.getMainExecutor(context)
        val preview = Preview.Builder().build()
        val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setResolutionSelector(ResolutionSelector.Builder().setResolutionStrategy(ResolutionStrategy(Size(1280,720),ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)).build()).build()
        var lastFrameAt = 0L
        analysis.setAnalyzer(worker) { frame ->
            val now = SystemClock.elapsedRealtime()
            if (now - lastFrameAt < 150) frame.close()
            else { lastFrameAt = now; analyzer.analyze(frame) }
        }
        val provider = ProcessCameraProvider.getInstance(context)
        var disposed = false
        var bound: ProcessCameraProvider? = null
        var cameraState: androidx.lifecycle.LiveData<androidx.camera.core.CameraState>? = null
        val stream = Observer<PreviewView.StreamState> { currentReady(it == PreviewView.StreamState.STREAMING) }
        val camera = Observer<androidx.camera.core.CameraState> { if (it.error != null) currentFailed() }
        previewView.previewStreamState.observe(owner,stream)
        provider.addListener({
            if (!disposed && owner.lifecycle.currentState != Lifecycle.State.DESTROYED) try {
                val available = provider.get()
                val selector = if (available.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)) CameraSelector.DEFAULT_BACK_CAMERA else CameraSelector.DEFAULT_FRONT_CAMERA
                preview.surfaceProvider = previewView.surfaceProvider
                val selected = available.bindToLifecycle(owner,selector,preview,analysis)
                bound = available; cameraState = selected.cameraInfo.cameraState
                cameraState?.observe(owner,camera)
            } catch (_: Exception) { currentFailed() }
        },main)
        onDispose {
            analyzer.pause()
            disposed = true; analysis.clearAnalyzer(); bound?.unbind(preview,analysis)
            previewView.previewStreamState.removeObserver(stream); cameraState?.removeObserver(camera)
            worker.shutdown()
        }
    }
}
