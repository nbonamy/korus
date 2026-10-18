package com.nabocorp.companion

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Real content-provider reads must be bounded; images become small opaque JPEGs before upload. */
@RunWith(AndroidJUnit4::class)
class AttachmentLoaderTest {
    @Test fun pickedImageIsResizedAndTransparencyIsFlattenedBeforeUpload() {
        val context = ApplicationProvider.getApplicationContext<CompanionApplication>()
        val file = File(context.cacheDir, "camera/transparent.png").apply { parentFile!!.mkdirs() }
        val bitmap = Bitmap.createBitmap(3000, 1500, Bitmap.Config.ARGB_8888)
        try {
            file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            val image = AttachmentLoader.load(context, FileProvider.getUriForFile(context, "${context.packageName}.attachments", file), true)
            assertEquals("image", image.type); assertEquals("image/jpeg", image.mimeType); assertEquals("transparent.jpg", image.name)
            assertTrue(image.data.size <= 500_000)
            val decoded = BitmapFactory.decodeByteArray(image.data, 0, image.data.size)
            try { assertTrue(maxOf(decoded.width, decoded.height) <= 2048); assertEquals(Color.WHITE, decoded.getPixel(10, 10)) } finally { decoded.recycle() }
        } finally { bitmap.recycle(); file.delete() }
    }
    @Test fun oversizedFilesAndUntrustedUriSchemesAreRejected() {
        val context = ApplicationProvider.getApplicationContext<CompanionApplication>()
        val file = File(context.cacheDir, "camera/too-large.bin").apply { parentFile!!.mkdirs(); writeBytes(ByteArray(2_500_001)) }
        try {
            assertThrows(Exception::class.java) { AttachmentLoader.load(context, FileProvider.getUriForFile(context, "${context.packageName}.attachments", file), false) }
            assertThrows(Exception::class.java) { AttachmentLoader.load(context, android.net.Uri.fromFile(file), false) }
        } finally { file.delete() }
    }
}
