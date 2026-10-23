package com.nabocorp.companion

import android.graphics.ImageFormat
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.zxing.BinaryBitmap
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** CameraX owns frame scheduling. Only a current, foreground presentation may deliver a code. */
internal class PairingQrAnalyzer(private val main: Executor, private val onCode: (String) -> Unit) : ImageAnalysis.Analyzer, AutoCloseable {
    private val generation = AtomicLong()
    private val active = AtomicBoolean(false)
    private val closed = AtomicBoolean(false)
    private val delivered = AtomicBoolean(false)
    private val pending = AtomicBoolean(false)
    private val reader = QRCodeReader()
    fun resume() { if (!closed.get()) { generation.incrementAndGet(); active.set(true) } }
    fun pause() { active.set(false); generation.incrementAndGet() }
    override fun close() { closed.set(true); pause() }

    override fun analyze(image: ImageProxy) {
        try {
            if (!active.get() || closed.get() || delivered.get() || pending.get()) return
            val stamp = generation.get()
            val code = decode(image) ?: return
            if (!pending.compareAndSet(false,true)) return
            main.execute {
                try {
                    if (active.get() && !closed.get() && stamp == generation.get() && delivered.compareAndSet(false,true)) onCode(code)
                } finally { pending.set(false) }
            }
        } finally { image.close() }
    }

    private fun decode(image: ImageProxy): String? {
        if (image.format != ImageFormat.YUV_420_888) return null
        val width = image.width; val height = image.height
        if (width <= 0 || height <= 0 || width.toLong() * height > 4_194_304) return null
        val plane = image.planes.firstOrNull() ?: return null
        val row = plane.rowStride; val pixel = plane.pixelStride
        if (row <= 0 || pixel <= 0 || (width - 1L) * pixel + 1 > row) return null
        val buffer = plane.buffer.duplicate()
        val required = (height - 1L) * row + (width - 1L) * pixel + 1
        if (required > buffer.remaining()) return null
        val origin = buffer.position()
        val luminance = ByteArray(width * height)
        for (y in 0 until height) {
            if (pixel == 1) { buffer.position(origin + y * row); buffer.get(luminance,y * width,width) }
            else for (x in 0 until width) luminance[y * width + x] = buffer.get(origin + y * row + x * pixel)
        }
        return try {
            val source = PlanarYUVLuminanceSource(luminance,width,height,0,0,width,height,false)
            PairingCode.scanned(reader.decode(BinaryBitmap(HybridBinarizer(source))).text)
        } catch (_: ReaderException) { null }
        finally { reader.reset() }
    }
}
