# Browser extension

## Install from Chrome Web Store

Open the [Feedbacks Chrome Web Store listing](https://chromewebstore.google.com/detail/feedbacks-website-review/dcpfpkfmegpgbfkeeileabpcbbmnoobo) and choose **Add to Chrome**. Pin and open Feedbacks, enter your team's Feedbacks server address, then choose **Connect to server**. Grant access to that server, sign in and approve pairing. Chrome updates the Store installation after a new version is published there. The signed-in app's `/help` page shows its own server address and these steps.

## Install from source

1. Run `npm ci` and `npm run build:extension`.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/`.
3. Open Feedbacks from Chrome's toolbar. Enter your server's origin, such as `https://feedback.example.com`.
4. Choose **Connect to server**, grant permission to that server and approve pairing in its web application.
5. Open a website registered in a project you can access. Start a review, capture or select a point, redact sensitive content, and send the feedback.

The public Store installation and a first source installation start without a server address. Existing installations retain their saved server address and account connections. For local development, enter a loopback address such as `http://localhost:3000` and enable **Advanced → Allow local HTTP development server** before connecting. Use HTTPS for shared team servers.

## Private preset build

For a separate internal distribution, set `FEEDBACKS_EXTENSION_DEFAULT_SERVER=https://feedback.example.com` when running `npm run build:extension`. The build produces `feedbacks-extension-internal-VERSION.zip` with an Internal label and that server preset. It does not overwrite the public server download ZIP or its release metadata. Saved connections take precedence over the preset. Build without this variable for a public, server-neutral package; never include credentials in a preset.

## Permissions and data

`activeTab` and `scripting` support user-initiated review; `storage` keeps connections and drafts in trusted extension contexts; `contextMenus` provides the review action; `alarms` polls pending pairing. Pairing requests access only to the server you entered. The popup's **Chrome access** rows show whether server access is allowed, review and capture are ready on the current tab, and automatic right-click is on for all sites. If server access was revoked, choose **Allow server access** there. **Enable right-click on all websites** is a separate optional action for automatic injection. You can turn it off in the extension. A green current-tab row means review started using the temporary `activeTab` grant; there is no separate persistent screenshot permission. Full-page capture errors are independent of Chrome permissions.

Captured pixels, selected element context and comments are sent to the chosen server when you submit. Review screenshots before sending; masking is not a guarantee that all sensitive information was detected. Tokens and pending drafts are stored locally. Server access is scoped to your project grants.

**Record a short tab video** opens a separate recorder. Click **Start recording**, select a Chrome tab in Chrome's picker, and stop explicitly or let the 30-second limit stop it. The recorder captures no audio and discards recordings above 8 MiB. Preview the clip, write a comment, then choose **Send video** to create feedback and upload it to private project storage. **Discard recording** or closing the recorder tab clears the local clip. A submitted video follows the server operator's project retention and backup policy; there is no automatic deletion timer. If upload fails after thread creation, keep the recorder tab open and retry Send video. Server access is checked again when a teammate opens the attachment. Video cannot be redacted by the screenshot tools, so review the whole clip for sensitive information before sending.

Recorder preview visual checks: [desktop, 1440 × 1200](screenshots/video-feedback/desktop.png) and [mobile, 390 × 1100](screenshots/video-feedback/mobile.png). These show the actual recorder HTML and CSS in a local browser with a synthetic project, comment and generated test video. The preview state was set by the fixture. These screenshots verify layout at those sizes; they do not verify Chrome's tab picker, recording permission or upload flow.

**Capture this page** takes the visible browser area. **Capture full page** scrolls the top-level page and saves a sequence of separate screenshots, then restores your scroll position. Each screenshot is named in order, such as `full-page-001-of-043.webp`, and adjacent captures are cropped to avoid repeated overlap. In the editor, choose a numbered section beside the image to annotate or redact it. Choose **Full page preview** to see all retained sections as one scrollable image before sending; return to a numbered section to change its marks. The preview is made locally and does not upload anything. If you select **Also include one combined image**, those same marks appear in the combined copy; you do not need to annotate it a second time. Long combined copies are scaled to the server's decoder limits, while numbered screenshots stay at their captured resolution. The screenshots stay as local browser Blobs until Send; Feedbacks uploads them in order as individual private attachments. The editor shows the number and percentage of images confirmed uploaded by the server; it does not claim to measure network bytes. If a send fails, **Retry Send** resumes the same draft and thread from the first unsent image. The thread groups numbered screenshots in a compact gallery; open any image for its full resolution. Agents can request each asset individually rather than decode one oversized combined image. There is no arbitrary screenshot-count cap, but browser storage, page stability and the server's 10 MiB per-image limit still apply. A page that moves or a capture that fails keeps the pages captured so far for review and allows a retry on the original tab. The full-page option captures cross-origin frames only as the browser renders them in each screenshot. Sticky elements may appear more than once, and lazy loading can shift content. Restricted browser pages cannot be captured. The extension loads no remote executable code.

## Release and updates

The build produces a versioned ZIP, SHA-256 checksum and server download metadata. Unpacked installations require a manual update/reload. Server update checks offer an archive; they never execute a downloaded update automatically. Chrome-managed installations use their configured update channel and do not show manual ZIP update notices. Chrome Web Store publication is a separate release step and is not implied by the ZIP build.

Before a release, check pairing, capture, redaction, submit/retry, project routing, existing connection persistence, origin rejection, permission denial and update notices in Chrome. Include license/notice files in the archive. See [releasing](releasing.md).

## Optional console and network context

Collection is off by default. In the popup's **Console & network** section, choose **Start collection**, reproduce the issue, then capture. Stop and discard is available before capture. The recorder ends on capture, navigation, review-session change or after five minutes. It uses the existing `activeTab`/scripting capability; this feature adds no Chrome permission.

Only the top-level page is observed. Up to 25 console warning/error messages and 50 resource timing entries are retained. Console arguments other than the first string are not serialized. Network entries contain the URL origin, resource type, timing and HTTP status when the browser exposes it. Headers, bodies, cookies, storage contents and prior browsing history are not collected. Requests or console events that occur before collection starts are absent.

URL credentials, paths, query strings and fragments are stripped; common secrets and email patterns are redacted from messages. Redaction is best effort: unusual console text and even a hostname can still contain private information. In the editor, inspect each entry. You can select private text in a console message and choose **Mask selected text**, which replaces it in the local draft. Uncheck any entry that should not be shared, then explicitly select **Share the selected diagnostics with this project**. Sharing starts unchecked. Unshared entries stay in the local draft and are discarded with it. Submitted entries are part of the thread and follow that instance's retention and access policy.

The target page can influence or fabricate its own console and performance data. The server validates and bounds the packet and labels it untrusted. A missing status does not mean a request succeeded. Cross-origin requests and browser restrictions can limit what is available; this is not a complete network trace or a session recording.

Category and comma-separated tags are optional in the capture editor. See [review workflow](review-workflow.md) for navigation, saved filters and screenshot comparisons.

## Optional page QA scan

While reviewing a project, choose **Scan page for QA findings** in the extension popup. This is a one-time scan of the current page, not a background monitor. It lists up to ten images without an `alt` attribute and checks up to twelve distinct same-origin links with HTTP HEAD requests, three at a time. Only 404 and 410 responses are reported as broken. Unsupported HEAD responses, timeouts, redirects and cross-origin links are unknown, not passing results. The requests use the current site's credentials and do not contact Feedbacks until you choose Send.

When findings exist, the extension opens an ordinary screenshot draft with a prefilled report. Inspect the report, image and any private URL paths before sending; edit or discard the draft as needed. No issue or feedback thread is created automatically. The scan runs only on the active page and selected project after an explicit button press.
