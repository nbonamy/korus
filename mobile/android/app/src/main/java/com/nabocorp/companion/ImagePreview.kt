package com.nabocorp.companion

import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.os.SystemClock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.nio.ByteBuffer
import kotlin.coroutines.coroutineContext
import kotlin.math.max

internal class ImagePreview(val title: String, val source: Source) {
    sealed interface Source {
        class Displayed(val value: String) : Source
        class Bytes(val value: ByteArray) : Source
    }
}

/** Only displayed bytes or web URLs enter this loader. Host paths remain daemon-owned. */
internal object ImagePreviewLoader {
    private const val MAX_BYTES = 20_000_000
    private val dataHeader = Regex("data:image/(png|jpeg|jpg|gif|webp|heic|heif|avif|bmp);base64", RegexOption.IGNORE_CASE)
    private fun webUrl(value: String): URI = URI(value).also {
        require(it.scheme?.lowercase() in listOf("http", "https") && !it.host.isNullOrEmpty() && it.rawUserInfo == null)
    }
    suspend fun load(source: ImagePreview.Source, maxDimension: Int = 4096): Bitmap = withContext(Dispatchers.IO) {
        require(maxDimension in 1..4096)
        val bytes = when (source) {
            is ImagePreview.Source.Bytes -> source.value
            is ImagePreview.Source.Displayed -> {
                val value = source.value
                if (value.startsWith("data:", ignoreCase = true)) {
                    val comma = value.indexOf(',')
                    require(comma in 1..64 && dataHeader.matches(value.substring(0, comma)))
                    val encoded = value.substring(comma + 1)
                    require(encoded.isNotEmpty() && encoded.length <= (MAX_BYTES + 2) / 3 * 4)
                    // java.util's basic decoder rejects whitespace and non-base64 characters.
                    java.util.Base64.getDecoder().decode(encoded)
                } else download(webUrl(value))
            }
        }
        require(bytes.isNotEmpty() && bytes.size <= MAX_BYTES)
        coroutineContext.ensureActive()
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { decoder, info, _ ->
            val longest = max(info.size.width, info.size.height)
            if (longest > maxDimension) decoder.setTargetSize(max(1, (info.size.width.toLong() * maxDimension / longest).toInt()), max(1, (info.size.height.toLong() * maxDimension / longest).toInt()))
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    }
    private suspend fun download(initial: URI): ByteArray {
        var url = initial
        val deadline = SystemClock.elapsedRealtime() + 30_000
        fun remaining(): Int = (deadline - SystemClock.elapsedRealtime()).toInt().also { require(it > 0) }
        repeat(6) {
            coroutineContext.ensureActive()
            val connection = url.toURL().openConnection() as HttpURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.useCaches = false
                connection.connectTimeout = remaining(); connection.readTimeout = remaining()
                connection.setRequestProperty("Accept", "image/*")
                val status = connection.responseCode
                if (status in listOf(301,302,303,307,308)) {
                    val next = webUrl(url.resolve(connection.getHeaderField("Location") ?: error("Missing image redirect")).toString())
                    require(url.scheme.equals("http",true) || next.scheme.equals("https",true))
                    url = next
                } else {
                    require(status in 200..299 && connection.contentType?.startsWith("image/",ignoreCase=true) == true && connection.contentLengthLong <= MAX_BYTES)
                    return connection.inputStream.use { input ->
                        val result = ByteArrayOutputStream(); val buffer = ByteArray(16_384)
                        while (true) {
                            coroutineContext.ensureActive(); connection.readTimeout = remaining()
                            val count = input.read(buffer)
                            if (count < 0) break
                            require(result.size() + count <= MAX_BYTES)
                            result.write(buffer, 0, count)
                        }
                        result.toByteArray()
                    }
                }
            } finally { connection.disconnect() }
        }
        error("Too many image redirects")
    }
}
