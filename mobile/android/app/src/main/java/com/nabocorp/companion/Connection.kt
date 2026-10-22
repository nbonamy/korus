package com.nabocorp.companion

/** The engine's view of the link to the paired laptop; the same states the iOS app names. */
enum class Connection {
    Unpaired, Connecting, Connected, Disconnected, Reconnecting, Revoked, Error;

    val isConnected get() = this == Connected
    /** There is no laptop to reach until the person pairs again. */
    val needsPairing get() = this == Unpaired || this == Revoked

    companion object {
        /** Anything the engine has not said yet, or says unexpectedly, counts as an error rather than as a link. */
        fun of(value: String) = entries.firstOrNull { it.name.equals(value, ignoreCase = true) } ?: Error
    }
}
