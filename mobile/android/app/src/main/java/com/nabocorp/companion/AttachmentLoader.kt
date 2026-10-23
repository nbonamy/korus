package com.nabocorp.companion

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.net.Uri
import android.provider.OpenableColumns
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import kotlin.math.roundToInt

/** Reads only granted content URIs. Images lose metadata and become bounded opaque JPEGs. */
object AttachmentLoader {
    private const val MAX_IMAGE_BYTES = 500_000
    private const val MAX_SOURCE_BYTES = 50_000_000
    fun load(context: Context, uri: Uri, image: Boolean): ComposerAttachment {
        require(uri.scheme == "content") { "Couldn’t read that attachment. Select it again using Photos or Files." }
        val resolver = context.contentResolver
        val rawName = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        } ?: "Attachment"
        val name = rawName.substringAfterLast('/').substringAfterLast('\\').filterNot(Char::isISOControl).take(100).ifBlank { "Attachment" }
        val mime = resolver.getType(uri)?.lowercase()?.takeIf { it.matches(Regex("[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+")) } ?: "application/octet-stream"
        val isImage = image || mime.startsWith("image/")
        val limit = if (isImage) MAX_SOURCE_BYTES else ComposerDrafts.MAX_BYTES
        val data = resolver.openInputStream(uri)?.use { input ->
            val bytes = ByteArrayOutputStream()
            val buffer = ByteArray(16_384)
            while (true) {
                val read = input.read(buffer, 0, minOf(buffer.size, limit + 1 - bytes.size()))
                if (read < 0) break
                bytes.write(buffer, 0, read)
                require(bytes.size() <= limit) { "That file is too large. Attachments must total 2.5 MB or less." }
            }
            bytes.toByteArray()
        } ?: throw IllegalArgumentException("Couldn’t read that attachment. Try selecting it again.")
        if (!isImage) return ComposerAttachment(name, mime, "file", data)
        for (dimension in listOf(2048, 1536, 1024)) {
            val decoded = ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(data))) { decoder, info, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                val scale = minOf(1.0, dimension.toDouble() / maxOf(info.size.width, info.size.height))
                decoder.setTargetSize(maxOf(1, (info.size.width * scale).roundToInt()), maxOf(1, (info.size.height * scale).roundToInt()))
            }
            val opaque = Bitmap.createBitmap(decoded.width, decoded.height, Bitmap.Config.ARGB_8888)
            try {
                Canvas(opaque).apply { drawColor(Color.WHITE); drawBitmap(decoded, 0f, 0f, null) }
                for (quality in listOf(85, 65, 45)) {
                    val output = ByteArrayOutputStream()
                    if (opaque.compress(Bitmap.CompressFormat.JPEG, quality, output) && output.size() <= MAX_IMAGE_BYTES) {
                        val base = name.substringBeforeLast('.', name).ifBlank { "Photo" }.take(90)
                        return ComposerAttachment("$base.jpg", "image/jpeg", "image", output.toByteArray())
                    }
                }
            } finally { opaque.recycle(); decoded.recycle() }
        }
        throw IllegalArgumentException("That photo is too large. Try a smaller image.")
    }
}
