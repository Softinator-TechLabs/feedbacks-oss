package org.feedbacks.mobile.smoke

import android.app.Activity
import android.graphics.Bitmap
import org.feedbacks.mobile.FeedbacksClient
import org.feedbacks.mobile.FeedbacksCredentialStore
import org.feedbacks.mobile.FeedbacksScreenshot

/** Compile-only host: no pairing, capture or submission starts automatically. */
class SmokeActivity : Activity() {
    val client = FeedbacksClient("https://feedback.example.com")
    val credentials by lazy { FeedbacksCredentialStore(applicationContext) }

    fun captureForReview(onReady: (Bitmap) -> Unit) {
        FeedbacksScreenshot.capture(window) { result -> result.onSuccess(onReady) }
    }
}
