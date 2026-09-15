# Browser extension

## Install from source

1. Run `npm ci` and `npm run build:extension`.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/`.
3. Open Feedbacks from Chrome's toolbar. Enter your server's origin, such as `https://feedback.example.com`.
4. Choose **Connect to server**, grant permission to that server and approve pairing in its web application.
5. Open a website registered in a project you can access. Start a review, capture or select a point, redact sensitive content, and send the feedback.

The default loopback address supports local development. It does not send data to an official or internal hosted instance. Existing installations retain their saved server address and account connections.

## Permissions and data

`activeTab` and `scripting` support user-initiated review; `storage` keeps connections and drafts in trusted extension contexts; `contextMenus` provides the review action; `alarms` polls pending pairing. Pairing requests access only to the server you entered. **Enable right-click on all websites** is a separate optional action for automatic injection. You can turn it off in the extension.

Captured pixels, selected element context and comments are sent to the chosen server when you submit. Review screenshots before sending; masking is not a guarantee that all sensitive information was detected. Tokens and pending drafts are stored locally. Server access is scoped to your project grants.

Restricted browser pages cannot be captured. Cross-origin frames, moving content and responsive layouts may affect element targeting; verify the submitted screenshot and context. The extension loads no remote executable code.

## Release and updates

The build produces a versioned ZIP, SHA-256 checksum and server download metadata. Unpacked installations require a manual update/reload. Server update checks offer an archive; they never execute a downloaded update automatically. Chrome Web Store publication is a separate release step and is not implied by the ZIP build.

Before a release, check pairing, capture, redaction, submit/retry, project routing, existing connection persistence, origin rejection, permission denial and update notices in Chrome. Include license/notice files in the archive. See [releasing](releasing.md).
