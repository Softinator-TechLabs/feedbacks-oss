# Native app feedback integration

The [iOS Swift package](../sdk/ios/Package.swift) and [Android Kotlin library module](../sdk/android/build.gradle.kts) let a **signed-in team reviewer** send feedback and a screenshot from inside their own app. They use the same [public HTTP API](api.md) as the Chrome extension. This does not give anonymous app users a feedback widget, capture another app, or record the whole device.

## Prepare a project and connect a device

1. Create a Feedbacks project whose approved origin matches a canonical HTTPS URL for each app screen, such as `https://app.example.com/screens/cart`. The URL is a review location, preferably a real universal/app link. It is not a request to load that page. A project set to **Any website** also accepts a canonical HTTPS screen URL, but project membership still applies.
2. Give the reviewer write access to that project. The app calls `startPairing(name:)` / `startPairing(name)`, saves the returned pairing ID and device secret with `savePending`, then opens the approval URL in the **system browser**. An existing signed-in Feedbacks user approves the device there. On app resume, load the pending pairing and poll no faster than `intervalSeconds` until approved or expired. Clear it on expiry or cancellation.
3. Save the one-time device token immediately in the iOS Keychain or Android Keystore, then clear the pending pairing. The helpers below store each encrypted value per server origin so process termination during browser approval can be recovered. Never ship an owner or agent token in the app bundle, logs, analytics, crash reports or URL. `listProjects` shows the projects currently authorized for the paired user; select only one with `canWrite == true`.

The server issues the existing revocable 30-day paired-device token with a snapshot of current project IDs. Current account activity and project grants are checked on every request. New project grants need a fresh pairing. A reviewer can revoke the device in **Account**. Both SDKs require HTTPS outside explicit localhost development.

## Send feedback from an app screen

On a user action, capture only your app's visible view/window. Show the image and comment in an app-owned preview. Let the user mask sensitive regions or discard it. The SDK does not automatically detect secrets in pixels. Use the app's canonical HTTPS screen URL and viewport size in points on iOS or dp on Android. The server classifies the width under 600 as mobile. The clients remove fragments and sensitive query keys before transmission; the host should avoid sensitive URL values altogether.

Send two separate operations:

1. `createFeedback` calls `threads.create` with comment, screen context and a stable random `idempotencyKey`. Keep the exact request data until the server acknowledges the thread.
2. After the user approves the preview, `uploadScreenshot` calls `assets.upload` with the returned thread ID and revision, image bytes and a **different** stable idempotency key. It accepts PNG, JPEG or WebP up to 10 MiB; the server validates dimensions, removes metadata and stores private WebP. A feedback thread can exist even when the screenshot upload fails. Keep the draft and exact upload request to retry an uncertain outcome; never create a second thread just to recover the image. On an explicit `CONFLICT`, fetch the current thread, review the new revision and make a new upload attempt with a new idempotency key. No retry occurs automatically.

The host needs the Internet permission on Android. Its networking and storage controls still apply. The Android client methods are blocking and must run on a background executor; the screenshot callback starts on the UI thread. iOS network methods are `async`; `FeedbacksScreenshot.capture` runs on the main actor. Both capture helpers see only their own app's visible content. System-secure views, overlays and protected media may be omitted by the operating system. Test the intended app screen on a real device before shipping.

### Swift

Add `sdk/ios` as a local Swift package, or publish/version it as a separate package after your own release review. A host flow can use:

```swift
import FeedbacksMobile

let server = URL(string: "https://feedback.example.com")!
let client = try FeedbacksClient(serverURL: server)
let pairing = try await client.startPairing(name: "My iPhone")
try FeedbacksKeychain.savePending(pairing, for: server)
// Open pairing.approvalURL in Safari. On app resume, loadPending(for: server)
// and poll at its intervalSeconds. On .approved(let credential):
try FeedbacksKeychain.save(credential, for: server)
try FeedbacksKeychain.clearPending(for: server)

// On an explicit capture action, on the main actor:
let screenshot = FeedbacksScreenshot.capture(view: view)!
// The host's preview returns approvedComment and approvedImage after redaction.
// Load credential from Keychain and choose a writable project before Send.
let draftKey = UUID().uuidString
let uploadKey = UUID().uuidString
let thread = try await client.createFeedback(
    credential: credential, projectId: selectedProjectId,
    body: approvedComment, screenURL: URL(string: "https://app.example.com/screens/cart")!,
    title: "Cart", viewport: .init(width: 390, height: 844, pixelRatio: 3),
    idempotencyKey: draftKey)
let receipt = try await client.uploadScreenshot(
    credential: credential, thread: thread, imageData: approvedImage,
    idempotencyKey: uploadKey)
```

Persist the pending comment, image bytes, project ID, thread receipt and idempotency keys privately if the app must survive termination during upload. `FeedbacksKeychain.clear(for:)` deletes the local token on disconnect; also revoke it on the server if the device is no longer trusted.

### Android

This repository also contains a compile-only [Android host](../sdk/android-host/build.gradle.kts) that links the library without starting pairing, capture or submission. With JDK 17 and Android SDK 35 installed, run `./gradlew :feedbacks-android-host:assembleDebug --no-daemon` from the repository root. CI runs the same build. It checks source compatibility; device behavior still needs a real host app and device.

Include `sdk/android` as a Gradle library module in a host build that supplies Android and Kotlin plugin versions. Minimum Android API is 26 because the capture helper uses `PixelCopy`. Do network work off the main thread:

```kotlin
val executor = Executors.newSingleThreadExecutor()
val client = FeedbacksClient("https://feedback.example.com")
executor.execute {
    val pairing = client.startPairing("My Android phone")
    val credentials = FeedbacksCredentialStore(applicationContext)
    credentials.savePending("https://feedback.example.com", pairing)
    // Open pairing.approvalUrl in the system browser. On app resume,
    // loadPending and poll no faster than intervalSeconds.
    val state = client.pollPairing(pairing)
    if (state is FeedbacksPairingState.Approved) {
        credentials.save("https://feedback.example.com", state.credential)
        credentials.clearPending("https://feedback.example.com")
    }
}

// On an explicit user action, start on the UI thread:
FeedbacksScreenshot.capture(window) { result ->
    val bitmap = result.getOrThrow()
    // The host's preview returns approvedComment and approvedPng after redaction.
    // Load credential from Keystore and choose a writable project before Send.
    val screenshotPng = FeedbacksScreenshot.pngBytes(bitmap)
    executor.execute {
        val createKey = UUID.randomUUID().toString()
        val uploadKey = UUID.randomUUID().toString()
        val thread = client.createFeedback(credential, selectedProjectId, approvedComment,
            "https://app.example.com/screens/cart", "Cart",
            FeedbacksViewport(390, 844, 3.0), createKey)
        client.uploadScreenshot(credential, thread, approvedPng, uploadKey)
    }
}
```

The snippet omits the host's preview UI and draft persistence. Save the exact keys and approved pixels with your retry draft. `FeedbacksCredentialStore.clear(serverUrl)` removes the local encrypted record.

## Verification and boundaries

`tests/mobile-sdk-contract.test.ts` exercises pairing, approval, scoped project listing, origin denial, thread and screenshot idempotency, private attachment listing and revocation against a synthetic local server. The Swift package includes a stub-transport executable smoke check for its request envelope and an XCTest target for Xcode builds. Android source needs a host Android build and device test before a public SDK release; this repository does not include a simulator or Android toolchain. This integration does not change the server API or the Chrome Web Store extension.
