# App screenshots without the extension

The web application includes an app screenshot pilot. A signed-in project reviewer can import a PNG, JPEG or WebP screenshot, or use **Capture window** in a browser that supports screen sharing. This workflow sends visual feedback without a fabricated website URL. It does not collect native app internals, audio, DOM, console or network traffic.

## Capture, review and send

1. Open a writable project and select **App screenshot** beside **New feedback**.
2. Choose **Capture window** and select a window/display in the browser's system picker, or **Import screenshot**. Imports accept PNG, JPEG and WebP up to 10 MB. Window capture stops its media tracks after taking one image; it is not a background recorder.
3. Enter the app name and choose the target platform. App version is optional. These details are supplied by the reviewer, including for an image imported from another device.
4. The preview fits within the viewport without enlarging the imported image; export retains the original resolution. Click it to add numbered notes. Drag a point to move it, or focus it and use arrow keys (Shift moves farther). Use **Remove selected point** beside the screenshot tools or press Delete on a focused point. Position controls below the image remain available. Use **Hide area** and drag over private information, or expand the coordinate controls to place notes and black rectangles with the keyboard. Inspect the entire image. A hidden area is burned into the approved image before upload; the unmasked source is not uploaded by this flow.
5. Write the feedback and choose **Send feedback**. The service creates the thread and uploads the approved image as two separate, idempotent operations.

Use the operating system's screenshot tools and import the result when the browser does not offer window capture, including mobile browsers. Protected surfaces can be blank or unavailable. Imported images do not invent a capture timestamp or identify the source device automatically.

## Drafts and recovery

Before a send attempt, the approved pixels, notes, app context and stable request keys are stored locally in IndexedDB, scoped to the current account and project. Closing/reloading during an uncertain result can resume that approved draft on the same browser profile. It is separate from the local unapproved preview. No background upload is started on page load.

A failed upload can leave a published thread without its image. **Retry Send** continues that thread. The approved draft is locked to preserve request identity. If the thread changed, open the existing feedback, use **Load latest feedback revision**, review it and retry with the refreshed upload revision. Discarding the local capture removes the local draft; it does not delete an already created thread. A successful send removes the local draft where browser storage permits it. Server revocation/project access checks still apply on every operation.

## Data and compatibility

`threads.create` accepts optional `appCapture` instead of website context, a document position or a page URL. It contains app/platform identity, image dimensions, capture/import method and coordinate notes. The service labels the context `app_capture` and the app details `reviewer_supplied`. Browser diagnostics cannot be included with this source. Image bytes use the existing `assets.upload` operation and private project storage. No migration, new token scope, native executable or extension permission is introduced.

Existing browser contexts and project origin checks remain unchanged. Imported images are normalized locally and again by the server. Native points refer to saved pixels; they do not follow live controls in another app.

See the [platform matrix](platform-compatibility.md) for OS restrictions. Browser fixtures and API checks do not certify real Windows/macOS/Ubuntu system pickers or physical mobile devices. Native companions, app-integrated diagnostics and mobile capture SDK acceptance remain separate work in [Upcoming](upcoming.md).

## Implementation and evidence

- [Shared app capture schema](../src/shared/app-capture.ts), [thread creation](../src/server/feedback.ts) and [capture page](../src/web/capture/index.tsx).
- [Image capture/redaction](../src/web/capture/image.ts) and [approved draft storage](../src/web/capture/draft.ts).
- [Contract/access/retry tests](../tests/app-capture.test.ts); the [cross-platform plan](plans/cross-platform-capture.md) records remaining acceptance gates.
