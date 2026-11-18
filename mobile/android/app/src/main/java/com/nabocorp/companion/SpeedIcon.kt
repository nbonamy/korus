package com.nabocorp.companion

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.VectorPainter
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.unit.dp

/** The speed icons: a bolt for standard, a filled bolt for a faster tier and, as on the desktop, a pair for ultrafast.
 * Stepping up fills the bolt, then splits it in two; stepping back to standard merges them. */
@Composable
internal fun SpeedIcon(tier: String?, color: Color, modifier: Modifier = Modifier) {
    val outline = rememberVectorPainter(Icons.Outlined.Bolt)
    val filled = rememberVectorPainter(Icons.Filled.Bolt)
    val motion = spring<Float>(dampingRatio = 0.55f, stiffness = Spring.StiffnessMediumLow)
    val split by animateFloatAsState(if (tier == "ultrafast") 1f else 0f, motion, label = "split")
    val fill by animateFloatAsState(if (tier == null) 0f else 1f, motion, label = "fill")
    val bounce = remember { Animatable(1f) }
    var first by remember { mutableStateOf(true) }
    LaunchedEffect(tier) {
        if (first) { first = false; return@LaunchedEffect }
        bounce.animateTo(1.2f, spring(stiffness = Spring.StiffnessHigh)); bounce.animateTo(1f, spring(dampingRatio = 0.4f))
    }
    Canvas(modifier.size(24.dp).graphicsLayer { scaleX = bounce.value; scaleY = bounce.value }) {
        fun DrawScope.glyph(painter: VectorPainter, dx: Float, alpha: Float = 1f) =
            translate(left = dx) { with(painter) { draw(size, alpha = alpha.coerceIn(0f, 1f), colorFilter = ColorFilter.tint(color)) } }
        val shift = 3.dp.toPx() * split
        drawIntoCanvas { canvas ->
            canvas.saveLayer(Rect(Offset.Zero, size), Paint())
            glyph(outline, -shift, maxOf(1f - fill, split))
            // Cut the back bolt where the front one overlaps it, as the desktop icon does.
            canvas.saveLayer(Rect(Offset.Zero, size), Paint().apply { blendMode = BlendMode.DstOut })
            scale(1.25f, pivot = center.copy(x = center.x + shift)) { glyph(filled, shift, split) }
            canvas.restore()
            glyph(filled, shift, fill)
            canvas.restore()
        }
    }
}
