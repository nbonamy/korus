package com.nabocorp.companion

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.min
import kotlin.math.roundToInt

@Composable internal fun ImagePreviewDialog(preview: ImagePreview, dismiss: () -> Unit) {
    var attempt by remember(preview) { mutableIntStateOf(0) }
    var image by remember(preview) { mutableStateOf<ImageBitmap?>(null) }
    var failed by remember(preview) { mutableStateOf(false) }
    LaunchedEffect(preview, attempt) {
        image = null; failed = false
        try {
            val loaded = ImagePreviewLoader.load(preview.source).asImageBitmap()
            withContext(Dispatchers.Main.immediate) { image = loaded }
        }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { withContext(Dispatchers.Main.immediate) { failed = true } }
    }
    Dialog(onDismissRequest = dismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val view = LocalView.current
        DisposableEffect(view) {
            val window = (view.parent as DialogWindowProvider).window
            WindowCompat.enableEdgeToEdge(window)
            window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(android.graphics.Color.BLACK))
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = false
                isAppearanceLightNavigationBars = false
            }
            onDispose { }
        }
        Box(Modifier.fillMaxSize().background(Color.Black).safeDrawingPadding()) {
            val loaded = image
            when {
                loaded != null -> ZoomableImage(loaded, preview.title)
                failed -> Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Image unavailable", color = Color.White, style = MaterialTheme.typography.titleLarge)
                    Text("The image couldn’t be loaded.", Modifier.padding(vertical = 12.dp), color = Color.White)
                    TextButton(onClick = { attempt++ }) { Text("Retry") }
                }
                else -> Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(); Text("Loading image…", Modifier.padding(top = 12.dp), color = Color.White)
                }
            }
            Row(Modifier.align(Alignment.TopCenter).fillMaxWidth().background(Color.Black.copy(alpha=.65f)).padding(horizontal=16.dp,vertical=4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(preview.title, Modifier.weight(1f), maxLines=1, overflow=TextOverflow.Ellipsis, color=Color.White, style=MaterialTheme.typography.titleMedium)
                IconButton(onClick=dismiss) { Icon(Icons.Outlined.Close,"Close image",tint=Color.White) }
            }
        }
    }
}

@Composable private fun ZoomableImage(image: ImageBitmap, title: String) {
    var scale by remember(image) { mutableFloatStateOf(1f) }
    var offset by remember(image) { mutableStateOf(Offset.Zero) }
    var viewport by remember(image) { mutableStateOf(Size.Zero) }
    fun bounded(value: Offset, zoom: Float): Offset {
        val fit = min(viewport.width / image.width, viewport.height / image.height)
        val horizontal = maxOf(0f, (image.width * fit * zoom - viewport.width) / 2)
        val vertical = maxOf(0f, (image.height * fit * zoom - viewport.height) / 2)
        return Offset(value.x.coerceIn(-horizontal,horizontal),value.y.coerceIn(-vertical,vertical))
    }
    fun zoom(value: Float, point: Offset = Offset(viewport.width/2,viewport.height/2), pan: Offset = Offset.Zero) {
        val next = value.coerceIn(1f,6f)
        val anchor = point - Offset(viewport.width/2,viewport.height/2)
        offset = bounded(anchor - (anchor - offset) * (next/scale) + pan,next)
        scale = next
    }
    Box(Modifier.fillMaxSize().clipToBounds().onSizeChanged {
        // Keyboard and system-inset animations can resize an already interactive
        // viewer. Keep the user's zoom and constrain pan to the new viewport.
        viewport=Size(it.width.toFloat(),it.height.toFloat()); offset=bounded(offset,scale)
    }.testTag("image-preview").semantics {
        contentDescription=title; stateDescription="${(scale*100).roundToInt()}%"
        customActions=listOf(CustomAccessibilityAction("Zoom in") { zoom(scale*1.5f);true },CustomAccessibilityAction("Reset zoom") { zoom(1f);true })
    }.pointerInput(image) { detectTapGestures(onDoubleTap={ zoom(if(scale>1.1f) 1f else 3f,it) }) }
        .pointerInput(image) { detectTransformGestures { centroid,pan,factor,_ -> zoom(scale*factor,centroid,pan) } }) {
        Image(image,null,Modifier.fillMaxSize().graphicsLayer(scaleX=scale,scaleY=scale,translationX=offset.x,translationY=offset.y),contentScale=ContentScale.Fit)
    }
}
