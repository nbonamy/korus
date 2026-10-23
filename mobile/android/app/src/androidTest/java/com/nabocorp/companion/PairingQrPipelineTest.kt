package com.nabocorp.companion

import android.graphics.ImageFormat
import androidx.camera.core.ImageProxy
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import org.junit.Assert.*
import org.junit.Test
import java.lang.reflect.Proxy
import java.nio.ByteBuffer
import java.util.concurrent.Executor

/** Camera frame adapter failure modes: padded/strided/rotated luminance is misread, unrelated QR
 * payloads become codes, frames leak, or queued/background results escape after cancellation.
 * Uses real generated QR pixels and ZXing; substitutes only the CameraX image/executor ports. */
class PairingQrPipelineTest {
    private class Frame(payload: String, rotation: Int = 0, val validBuffer: Boolean = true) {
        var closed = false
        private val width = 320
        private val stride = width * 2 + 13
        private val matrix = QRCodeWriter().encode(payload, BarcodeFormat.QR_CODE,width,width)
        private val buffer = ByteBuffer.allocate(if (validBuffer) 7 + stride * width else 9).apply {
            if (validBuffer) for (y in 0 until width) for (x in 0 until width) {
                val (sx,sy) = when (rotation) { 90 -> y to width-1-x; 180 -> width-1-x to width-1-y; 270 -> width-1-y to x; else -> x to y }
                put(7 + y * stride + x * 2, if (matrix[sx,sy]) 0 else 255.toByte())
            }
            position(7)
        }
        private val plane = Proxy.newProxyInstance(ImageProxy.PlaneProxy::class.java.classLoader,arrayOf(ImageProxy.PlaneProxy::class.java)) { _,method,_ -> when (method.name) {
            "getBuffer" -> buffer.duplicate()
            "getRowStride" -> stride
            "getPixelStride" -> 2
            else -> error("Unexpected plane operation: ${method.name}")
        } } as ImageProxy.PlaneProxy
        val image = Proxy.newProxyInstance(ImageProxy::class.java.classLoader,arrayOf(ImageProxy::class.java)) { _,method,_ -> when (method.name) {
            "getWidth", "getHeight" -> width
            "getFormat" -> ImageFormat.YUV_420_888
            "getPlanes" -> arrayOf(plane)
            "close" -> { closed = true; null }
            else -> error("Unexpected camera operation: ${method.name}")
        } } as ImageProxy
    }

    @Test fun stridedRotatedQrFramesAcceptOnlyACompleteDesktopCodeAndAlwaysClose() {
        val codes = mutableListOf<String>()
        val analyzer = PairingQrAnalyzer(Executor { it.run() }) { codes += it }
        analyzer.resume()
        for (payload in listOf("https://example.com/ABCD-23EF", "{\"code\":\"ABCD-23EF\"}", "ABCD-23EF-extra", "ABCD-01IO", "AB-CD23EF", "ABCD 23EF")) {
            val frame = Frame(payload); analyzer.analyze(frame.image); assertTrue(frame.closed)
        }
        val short = Frame("ABCD-23EF",validBuffer = false); analyzer.analyze(short.image); assertTrue(short.closed)
        assertTrue(codes.isEmpty())
        analyzer.close()
        for (rotation in listOf(0,90,180,270)) {
            val accepted = mutableListOf<String>()
            PairingQrAnalyzer(Executor { it.run() }) { accepted += it }.use { camera ->
                camera.resume()
                val frame = Frame(" abcd23ef\n",rotation); camera.analyze(frame.image)
                assertTrue(frame.closed); assertEquals(listOf("ABCD-23EF"),accepted)
            }
        }
    }

    @Test fun queuedResultsCannotEscapePauseOrCloseAndRepeatedFramesDeliverOnce() {
        val tasks = mutableListOf<Runnable>()
        val codes = mutableListOf<String>()
        val analyzer = PairingQrAnalyzer(Executor { tasks += it }) { codes += it }
        analyzer.resume()
        val first = Frame("ABCD-23EF"); analyzer.analyze(first.image); assertTrue(first.closed)
        assertEquals(1,tasks.size)
        analyzer.pause(); analyzer.resume(); tasks.removeAt(0).run()
        assertTrue(codes.isEmpty())
        val second = Frame("WXYZ-6789"); analyzer.analyze(second.image)
        val repeated = Frame("WXYZ-6789"); analyzer.analyze(repeated.image)
        assertTrue(second.closed && repeated.closed); assertEquals(1,tasks.size)
        tasks.removeAt(0).run(); assertEquals(listOf("WXYZ-6789"),codes)
        val after = Frame("ABCD-23EF"); analyzer.analyze(after.image); assertTrue(after.closed); assertTrue(tasks.isEmpty())
        analyzer.close(); analyzer.resume()
        val closed = Frame("ABCD-23EF"); analyzer.analyze(closed.image); assertTrue(closed.closed); assertTrue(tasks.isEmpty())
        assertEquals(listOf("WXYZ-6789"),codes)
    }
}
