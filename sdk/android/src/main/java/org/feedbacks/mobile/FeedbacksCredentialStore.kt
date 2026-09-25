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
        saveValue(account(serverUrl), JSONObject().put("token", credential.token)
            .put("expiresAt", credential.expiresAt))
    }

    fun load(serverUrl: String): FeedbacksCredential? = loadValue(account(serverUrl))?.let {
        FeedbacksCredential(it.getString("token"), it.getString("expiresAt"))
    }

    fun clear(serverUrl: String) = clearValue(account(serverUrl))

    /** Save before opening the system browser so an approved pairing can be polled after process death. */
    fun savePending(serverUrl: String, pairing: FeedbacksPairing) {
        saveValue(pendingAccount(serverUrl), JSONObject()
            .put("pairingId", pairing.pairingId)
            .put("deviceSecret", pairing.deviceSecret)
            .put("expiresAt", pairing.expiresAt)
            .put("intervalSeconds", pairing.intervalSeconds)
            .put("approvalUrl", pairing.approvalUrl))
    }

    fun loadPending(serverUrl: String): FeedbacksPairing? = loadValue(pendingAccount(serverUrl))?.let {
        FeedbacksPairing(it.getString("pairingId"), it.getString("deviceSecret"),
            it.getString("expiresAt"), it.getInt("intervalSeconds"), it.getString("approvalUrl"))
    }

    fun clearPending(serverUrl: String) = clearValue(pendingAccount(serverUrl))

    private fun saveValue(account: String, value: JSONObject) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val plaintext = value.toString().toByteArray(Charsets.UTF_8)
        val packed = cipher.iv + cipher.doFinal(plaintext)
        check(prefs.edit().putString(account, Base64.getEncoder().encodeToString(packed)).commit()) {
            "Could not persist Feedbacks credential"
        }
    }

    private fun loadValue(account: String): JSONObject? {
        val packed = prefs.getString(account, null) ?: return null
        return try {
            val bytes = Base64.getDecoder().decode(packed)
            require(bytes.size > 12)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
        } catch (_: Exception) {
            clearValue(account)
            null
        }
    }

    private fun clearValue(account: String) {
        check(prefs.edit().remove(account).commit()) {
            "Could not clear Feedbacks credential"
        }
    }

    private fun account(serverUrl: String): String = URI(serverUrl).normalize().toString()
    private fun pendingAccount(serverUrl: String): String = account(serverUrl) + ":pending"

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
