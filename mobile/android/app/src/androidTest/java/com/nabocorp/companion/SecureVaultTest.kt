package com.nabocorp.companion

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore

/** Protects pairing persistence, removal and ciphertext integrity at the Android storage boundary. */
@RunWith(AndroidJUnit4::class)
class SecureVaultTest {
    @Test fun acknowledgedPairingSurvivesReopenAndTamperingIsRejected() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "vault-test-${System.nanoTime()}"
        val vault = SecureVault(context, name)
        try {
            assertTrue(vault.write("pairing", "private-pairing-grant"))
            assertEquals("private-pairing-grant", SecureVault(context, name).read("pairing"))
            val disk = context.getSharedPreferences(name, 0)
            assertFalse(disk.getString("pairing", "")!!.contains("private-pairing-grant"))
            disk.edit().putString("pairing", "corrupt").commit()
            assertThrows(Exception::class.java) { vault.read("pairing") }
            assertTrue(vault.remove("pairing"))
            assertNull(SecureVault(context, name).read("pairing"))
        } finally {
            context.deleteSharedPreferences(name)
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry("${context.packageName}.$name") }
        }
    }
}
