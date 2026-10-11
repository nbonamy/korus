package com.nabocorp.korus.companion;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "CompanionVault")
public class CompanionVaultPlugin extends Plugin {
    private static final String ALIAS = "companion-vault-v1";
    private SharedPreferences records() { return getContext().getSharedPreferences("companion-vault", Context.MODE_PRIVATE); }
    private String key(PluginCall call) throws Exception {
        String key = call.getString("key");
        if (key == null || !key.matches("[a-zA-Z0-9:._-]{1,128}")) throw new Exception("Invalid key");
        return key;
    }
    private SecretKey secret() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setRandomizedEncryptionRequired(true).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
    @PluginMethod public synchronized void read(PluginCall call) {
        try {
            String key = key(call);
            String encoded = records().getString(key, null);
            JSObject result = new JSObject();
            if (encoded == null) { result.put("value", org.json.JSONObject.NULL); call.resolve(result); return; }
            String[] parts = encoded.split(":", -1);
            if (parts.length != 2) throw new Exception("Invalid record");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, secret(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
            result.put("value", new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception error) { call.reject("Protected storage is unavailable."); }
    }
    @PluginMethod public synchronized void write(PluginCall call) {
        try {
            String key = key(call);
            String value = call.getString("value");
            if (value == null || value.getBytes(StandardCharsets.UTF_8).length > 4 * 1024 * 1024) throw new Exception("Invalid value");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, secret());
            cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
            String encoded = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" +
                Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!records().edit().putString(key, encoded).commit()) throw new Exception("Write failed");
            call.resolve();
        } catch (Exception error) { call.reject("Protected storage is unavailable."); }
    }
    @PluginMethod public synchronized void remove(PluginCall call) {
        try {
            if (!records().edit().remove(key(call)).commit()) throw new Exception("Remove failed");
            call.resolve();
        } catch (Exception error) { call.reject("Protected storage is unavailable."); }
    }
}
