package org.feedbacks.mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.net.URI
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Encrypts a device token with Android Keystore. Use a unique server origin per account. */
class FeedbacksCredentialStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("feedbacks_mobile_credentials", Context.MODE_PRIVATE)
    private val alias = "org.feedbacks.mobile.device-token"

    fun save(serverUrl: String, credential: FeedbacksCredential) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val plaintext = JSONObject().put("token", credential.token)
            .put("expiresAt", credential.expiresAt).toString().toByteArray(Charsets.UTF_8)
        val packed = cipher.iv + cipher.doFinal(plaintext)
        check(prefs.edit().putString(account(serverUrl), Base64.getEncoder().encodeToString(packed)).commit()) {
            "Could not persist Feedbacks credential"
        }
    }

    fun load(serverUrl: String): FeedbacksCredential? {
        val packed = prefs.getString(account(serverUrl), null) ?: return null
        return try {
            val bytes = Base64.getDecoder().decode(packed)
            require(bytes.size > 12)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            val value = JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
            FeedbacksCredential(value.getString("token"), value.getString("expiresAt"))
        } catch (_: Exception) {
            clear(serverUrl)
            null
        }
    }

    fun clear(serverUrl: String) {
        check(prefs.edit().remove(account(serverUrl)).commit()) {
            "Could not clear Feedbacks credential"
        }
    }

    private fun account(serverUrl: String): String = URI(serverUrl).normalize().toString()

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build())
        return generator.generateKey()
    }
}
