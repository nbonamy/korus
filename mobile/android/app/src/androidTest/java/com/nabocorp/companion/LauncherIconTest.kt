package com.nabocorp.companion

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.AdaptiveIconDrawable
import android.os.Build
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test

/** Packaging failures: flat icons ignore launcher masks, cropped artwork loses the brand,
 * and a missing monochrome layer prevents the system from applying the user's theme.
 * Inspect the installed resource through Android; no screenshots or source assertions. */
class LauncherIconTest {
    @Test fun installedLauncherArtworkSupportsMasksSafeBoundsAndThemedIcons() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val icon = context.packageManager.getApplicationIcon(context.applicationInfo)
        assertTrue("The installed app must provide an adaptive launcher icon", icon is AdaptiveIconDrawable)
        icon as AdaptiveIconDrawable
        assertNotNull(icon.background)
        if (Build.VERSION.SDK_INT >= 33) assertNotNull("Themed launchers need monochrome artwork", icon.monochrome)
        // Android's foreground canvas is 108 dp with a centered 66 dp safe circle.
        val pixels = Bitmap.createBitmap(108, 108, Bitmap.Config.ARGB_8888)
        try {
            icon.foreground.setBounds(0, 0, 108, 108)
            icon.foreground.draw(Canvas(pixels))
            var painted = 0
            for (y in 0 until 108) for (x in 0 until 108) if (Color.alpha(pixels.getPixel(x, y)) > 0) {
                painted++
                val dx = x + .5f - 54; val dy = y + .5f - 54
                assertTrue("Launcher masks must not crop the brand", dx * dx + dy * dy <= 33 * 33)
            }
            assertTrue("The foreground must contain visible artwork", painted > 0)
        } finally { pixels.recycle() }
    }
}
