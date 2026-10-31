package com.nabocorp.companion

import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID

/** Disposable binary images; file modification times implement the on-device LRU. */
class DeviceImageCache(private val directory: File, private val maxBytes: Long = 256L * 1024 * 1024, private val now: () -> Long = System::currentTimeMillis) {
    companion object {
        private val lock = Any()
        private val identity = Regex("[a-f0-9]{64}")
        private val formats = setOf("image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/heic", "image/heif", "image/avif", "image/bmp")
        private const val MAX_IMAGE_BYTES = 20_000_000
    }
    private fun file(host: String, key: String): File {
        require(identity.matches(host) && identity.matches(key))
        return File(directory, "$host-$key.image")
    }
    private fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }

    fun read(host: String, key: String): String? = synchronized(lock) {
        val file = file(host, key)
        if (!file.exists()) return@synchronized null
        if (!file.isFile || java.nio.file.Files.isSymbolicLink(file.toPath()) || file.length() > MAX_IMAGE_BYTES + 128) { file.delete(); return@synchronized null }
        val record = file.readBytes()
        val first = record.indexOf(10.toByte())
        val second = if (first >= 0) (first + 1 until record.size).firstOrNull { record[it] == 10.toByte() } ?: -1 else -1
        if (first !in 1..31 || second != first + 65 || second + 1 >= record.size) { file.delete(); return@synchronized null }
        val mime = String(record, 0, first, Charsets.US_ASCII)
        val fingerprint = String(record, first + 1, 64, Charsets.US_ASCII)
        val bytes = record.copyOfRange(second + 1, record.size)
        if (mime !in formats || bytes.size > MAX_IMAGE_BYTES || hash(bytes) != fingerprint) { file.delete(); return@synchronized null }
        check(file.setLastModified(now()))
        "data:$mime;base64,${Base64.getEncoder().encodeToString(bytes)}"
    }

    fun write(host: String, key: String, dataUrl: String) = synchronized(lock) {
        val file = file(host, key)
        require(dataUrl.length <= (MAX_IMAGE_BYTES + 2) / 3 * 4 + 64)
        val comma = dataUrl.indexOf(','); require(comma in 1..63)
        val prefix = dataUrl.substring(0, comma).lowercase()
        require(prefix.startsWith("data:") && prefix.endsWith(";base64"))
        val mime = prefix.removePrefix("data:").removeSuffix(";base64"); require(mime in formats)
        val bytes = Base64.getDecoder().decode(dataUrl.substring(comma + 1)); require(bytes.isNotEmpty() && bytes.size <= MAX_IMAGE_BYTES)
        val header = "$mime\n${hash(bytes)}\n".toByteArray(Charsets.US_ASCII)
        val size = bytes.size + header.size
        if (size > maxBytes) return@synchronized
        check(directory.mkdirs() || directory.isDirectory)
        if (file.exists()) check(file.delete())
        val records = entries(); var retained = records.sumOf { it.length() }
        for (candidate in records.sortedBy { it.lastModified() }) {
            if (retained + size <= maxBytes) break
            val removed = candidate.length(); check(candidate.delete()); retained -= removed
        }
        val temporary = File(directory, ".pending-${UUID.randomUUID()}")
        try {
            FileOutputStream(temporary).use { it.write(header); it.write(bytes) }
            check(temporary.renameTo(file)); check(file.setLastModified(now()))
        } finally { temporary.delete() }
    }

    fun forget(host: String) = synchronized(lock) {
        require(identity.matches(host))
        for (file in entries()) if (file.name.startsWith("$host-")) check(file.delete())
    }
    private fun entries(): List<File> = directory.listFiles()?.filter {
        if (it.extension == "image" && it.isFile && !java.nio.file.Files.isSymbolicLink(it.toPath())) true
        else { check(it.delete()); false }
    } ?: emptyList()
}
