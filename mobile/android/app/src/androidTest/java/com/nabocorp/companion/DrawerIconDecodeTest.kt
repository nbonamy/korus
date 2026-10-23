package com.nabocorp.companion

import android.graphics.Bitmap
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream

/** Tiny drawer icons must not allocate full-size preview bitmaps; decoding a
 * thumbnail must preserve aspect ratio and leave normal preview resolution intact.
 * This tests Android's decoder directly because UI bounds cannot reveal allocation size. */
class DrawerIconDecodeTest {
    @Test fun thumbnailDecodeBoundsMemoryWithoutReducingNormalPreviewResolution() = runBlocking {
        val original = Bitmap.createBitmap(800, 400, Bitmap.Config.ARGB_8888)
        val bytes = ByteArrayOutputStream().also { original.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        original.recycle()
        val source = ImagePreview.Source.Bytes(bytes)
        val preview = ImagePreviewLoader.load(source)
        val thumbnail = ImagePreviewLoader.load(source, maxDimension = 128)
        try {
            assertEquals(800, preview.width); assertEquals(400, preview.height)
            assertEquals(128, thumbnail.width); assertEquals(64, thumbnail.height)
            assertTrue(thumbnail.allocationByteCount < preview.allocationByteCount)
        } finally { preview.recycle(); thumbnail.recycle() }
        for (size in listOf(0, 4097)) {
            try { ImagePreviewLoader.load(source, maxDimension = size); fail("Unsafe decode size accepted") }
            catch (_: IllegalArgumentException) { /* Caller bounds are enforced before decoding. */ }
        }
    }
}
