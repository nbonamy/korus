package com.nabocorp.companion

import java.util.Locale

/** Native display and camera validation; the engine owns pairing and authenticates the host. */
internal object PairingCode {
    private const val alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    fun format(input: String): String {
        val symbols = input.uppercase(Locale.ROOT).filter { it in alphabet }.take(8)
        return if (symbols.length > 4) symbols.take(4) + "-" + symbols.drop(4) else symbols
    }
    fun complete(input: String) = scanned(input) != null
    fun scanned(input: String): String? {
        val value = input.trim().uppercase(Locale.ROOT)
        val symbols = if (value.length == 9 && value[4] == '-') value.take(4) + value.drop(5) else value
        if (symbols.length != 8 || symbols.any { it !in alphabet }) return null
        return format(symbols)
    }
}
