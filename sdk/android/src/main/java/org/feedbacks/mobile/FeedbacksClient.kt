package org.feedbacks.mobile

import android.graphics.Bitmap
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.Window
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.Base64

data class FeedbacksCredential(val token: String, val expiresAt: String)
data class FeedbacksPairing(
    val pairingId: String,
    val deviceSecret: String,
    val expiresAt: String,
    val intervalSeconds: Int,
    val approvalUrl: String
)
sealed interface FeedbacksPairingState {
    data object Pending : FeedbacksPairingState
    data class Approved(val credential: FeedbacksCredential) : FeedbacksPairingState
}
data class FeedbacksViewport(val width: Int, val height: Int, val pixelRatio: Double)
data class FeedbacksThread(val id: String, val revision: Int)
data class FeedbacksUpload(val assetId: String, val thread: FeedbacksThread)
data class FeedbacksProject(val id: String, val name: String, val origins: List<String>, val canWrite: Boolean)
class FeedbacksApiException(val code: String, override val message: String, val status: Int) : Exception(message)

/** Call network methods on a background executor. The host owns screenshot review and retry drafts. */
class FeedbacksClient(serverUrl: String, allowInsecureLocalhost: Boolean = false) {
    private val root: URI = URI(serverUrl).normalize()

    init {
        val local = root.host == "localhost" || root.host == "127.0.0.1" || root.host == "::1"
        require(root.scheme == "https" || (allowInsecureLocalhost && local && root.scheme == "http")) {
            "Feedbacks requires HTTPS outside local development"
        }
        require(root.host != null && root.userInfo == null && root.rawQuery == null && root.rawFragment == null &&
            (root.path.isNullOrEmpty() || root.path == "/")) { "Use a server origin without path or credentials" }
    }

    fun startPairing(name: String): FeedbacksPairing {
        val data = post("pairing.request", JSONObject().put("name", name))
        val path = data.getString("approvalPath")
        val approval = root.resolve(path)
        require(path.startsWith("/pair?") && approval.host == root.host && approval.scheme == root.scheme &&
            approval.port == root.port) { "Invalid pairing approval URL" }
        return FeedbacksPairing(data.getString("pairingId"), data.getString("deviceSecret"),
            data.getString("expiresAt"), data.getInt("intervalSeconds"), approval.toString())
    }

    fun pollPairing(pairing: FeedbacksPairing): FeedbacksPairingState {
        val data = post("pairing.poll", JSONObject()
            .put("pairingId", pairing.pairingId)
            .put("deviceSecret", pairing.deviceSecret))
        return when (data.getString("status")) {
            "pending" -> FeedbacksPairingState.Pending
            "approved" -> FeedbacksPairingState.Approved(
                FeedbacksCredential(data.getString("token"), data.getString("expiresAt")))
            else -> throw IllegalStateException("Unknown pairing state")
        }
    }

    fun listProjects(credential: FeedbacksCredential): List<FeedbacksProject> {
        val items = post("projects.list", JSONObject(), credential).getJSONArray("items")
        return (0 until items.length()).map { index ->
            val item = items.getJSONObject(index)
            val origins = item.getJSONArray("origins")
            FeedbacksProject(item.getString("id"), item.getString("name"),
                (0 until origins.length()).map { origins.getString(it) },
                item.getJSONObject("permissions").getBoolean("canWrite"))
        }
    }

    fun createFeedback(credential: FeedbacksCredential, projectId: String, body: String,
        screenUrl: String, title: String, viewport: FeedbacksViewport,
        idempotencyKey: String): FeedbacksThread {
        val context = JSONObject()
            .put("url", sanitizedScreenUrl(screenUrl))
            .put("title", title)
            .put("viewport", JSONObject().put("width", viewport.width).put("height", viewport.height))
            .put("devicePixelRatio", viewport.pixelRatio)
        val data = post("threads.create", JSONObject()
            .put("projectId", projectId).put("body", body).put("context", context)
            .put("idempotencyKey", idempotencyKey), credential)
        return FeedbacksThread(data.getString("id"), data.getInt("revision"))
    }

    private fun sanitizedScreenUrl(input: String): String {
        val parsed = URI(input)
        require((parsed.scheme == "http" || parsed.scheme == "https") && parsed.host != null &&
            parsed.userInfo == null) { "A public HTTP(S) screen URL is required" }
        val uri = Uri.parse(input)
        val builder = uri.buildUpon().clearQuery().fragment(null)
        val sensitive = Regex("token|secret|password|passwd|auth|session|cookie|email|key|code|signature|jwt|credential",
            RegexOption.IGNORE_CASE)
        for (name in uri.queryParameterNames) {
            if (!sensitive.containsMatchIn(name)) {
                for (value in uri.getQueryParameters(name)) builder.appendQueryParameter(name, value)
            }
        }
        return builder.build().toString()
    }

    fun uploadScreenshot(credential: FeedbacksCredential, thread: FeedbacksThread,
        imageBytes: ByteArray, idempotencyKey: String): FeedbacksUpload {
        require(imageBytes.isNotEmpty() && imageBytes.size <= 10 * 1024 * 1024) {
            "Screenshot must be 1 byte to 10 MiB"
        }
        val data = post("assets.upload", JSONObject()
            .put("threadId", thread.id).put("revision", thread.revision)
            .put("imageBase64", Base64.getEncoder().encodeToString(imageBytes))
            .put("rendition", "screenshot").put("idempotencyKey", idempotencyKey), credential)
        val current = data.getJSONObject("thread")
        return FeedbacksUpload(data.getJSONObject("asset").getString("id"),
            FeedbacksThread(current.getString("id"), current.getInt("revision")))
    }

    private fun post(operation: String, body: JSONObject, credential: FeedbacksCredential? = null): JSONObject {
        val connection = URL(root.resolve("/api/$operation").toString()).openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.instanceFollowRedirects = false // Never forward a bearer token to a redirect target.
        connection.connectTimeout = 15000
        connection.readTimeout = 15000
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        connection.setRequestProperty("Accept", "application/json")
        credential?.let { connection.setRequestProperty("Authorization", "Bearer ${it.token}") }
        try {
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val bytes = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.use { it.readBytes() } ?: ByteArray(0)
            val response = try { JSONObject(String(bytes, Charsets.UTF_8)) }
                catch (_: Exception) { throw IllegalStateException("Invalid Feedbacks response (HTTP $status)") }
            if (!response.optBoolean("ok", false)) {
                val error = response.optJSONObject("error")
                throw FeedbacksApiException(error?.optString("code") ?: "HTTP_ERROR",
                    error?.optString("message") ?: "Feedbacks request failed", status)
            }
            require(status in 200..299) { "Unexpected Feedbacks response (HTTP $status)" }
            return response.getJSONObject("data")
        } finally {
            connection.disconnect()
        }
    }
}

/** Captures only the supplied app window after the host's explicit user action. */
object FeedbacksScreenshot {
    fun capture(window: Window, finished: (Result<Bitmap>) -> Unit) {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Capture must start on the UI thread" }
        val view = window.decorView
        require(view.width > 0 && view.height > 0) { "Window must be laid out before capture" }
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        PixelCopy.request(window, bitmap, { status ->
            if (status == PixelCopy.SUCCESS) finished(Result.success(bitmap))
            else { bitmap.recycle(); finished(Result.failure(IllegalStateException("PixelCopy failed: $status"))) }
        }, Handler(Looper.getMainLooper()))
    }

    fun pngBytes(bitmap: Bitmap): ByteArray {
        val output = ByteArrayOutputStream()
        check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) { "PNG encoding failed" }
        return output.toByteArray()
    }
}
