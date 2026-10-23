package com.nabocorp.companion

import android.os.SystemClock
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.SemanticsNodeInteraction

/** Keyboard and window-inset animations are outside Compose's test clock. A
 * synthetic touch must target the settled control, rather than coordinates that
 * move onto another choice while Android is delivering the gesture. */
internal fun SemanticsNodeInteraction.awaitStableBounds(rule: ComposeTestRule): SemanticsNodeInteraction {
    fun bounds() = fetchSemanticsNode().let { node ->
        Rect(node.positionOnScreen, Size(node.size.width.toFloat(), node.size.height.toFloat()))
    }
    val first = bounds()
    var previous = first
    var changedAt = SystemClock.uptimeMillis()
    var changes = 0
    rule.waitUntil(5_000) {
        val bounds = bounds()
        val now = SystemClock.uptimeMillis()
        if (bounds != previous) { previous = bounds; changedAt = now; changes++ }
        now - changedAt >= 500
    }
    android.util.Log.i("NativeLayoutCheck", "changes=$changes first=$first settled=$previous")
    return this
}
