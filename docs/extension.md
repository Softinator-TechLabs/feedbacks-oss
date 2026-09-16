# Browser extension

## Install from source

1. Run `npm ci` and `npm run build:extension`.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/`.
3. Open Feedbacks from Chrome's toolbar. Enter your server's origin, such as `https://feedback.example.com`.
4. Choose **Connect to server**, grant permission to that server and approve pairing in its web application.
5. Open a website registered in a project you can access. Start a review, capture or select a point, redact sensitive content, and send the feedback.

The first installation starts without a server address. Existing installations retain their saved server address and account connections. For local development, enter a loopback address such as `http://localhost:3000` and enable **Advanced → Allow local HTTP development server** before connecting. Use HTTPS for shared team servers.

## Private preset build

For a separate internal distribution, set `FEEDBACKS_EXTENSION_DEFAULT_SERVER=https://feedback.example.com` when running `npm run build:extension`. The build produces `feedbacks-extension-internal-VERSION.zip` with an Internal label and that server preset. It does not overwrite the public server download ZIP or its release metadata. Saved connections take precedence over the preset. Build without this variable for a public, server-neutral package; never include credentials in a preset.

## Permissions and data

`activeTab` and `scripting` support user-initiated review; `storage` keeps connections and drafts in trusted extension contexts; `contextMenus` provides the review action; `alarms` polls pending pairing. Pairing requests access only to the server you entered. **Enable right-click on all websites** is a separate optional action for automatic injection. You can turn it off in the extension.

Captured pixels, selected element context and comments are sent to the chosen server when you submit. Review screenshots before sending; masking is not a guarantee that all sensitive information was detected. Tokens and pending drafts are stored locally. Server access is scoped to your project grants.

Restricted browser pages cannot be captured. Cross-origin frames, moving content and responsive layouts may affect element targeting; verify the submitted screenshot and context. The extension loads no remote executable code.

## Release and updates

The build produces a versioned ZIP, SHA-256 checksum and server download metadata. Unpacked installations require a manual update/reload. Server update checks offer an archive; they never execute a downloaded update automatically. Chrome-managed installations use their configured update channel and do not show manual ZIP update notices. Chrome Web Store publication is a separate release step and is not implied by the ZIP build.

Before a release, check pairing, capture, redaction, submit/retry, project routing, existing connection persistence, origin rejection, permission denial and update notices in Chrome. Include license/notice files in the archive. See [releasing](releasing.md).

## Optional console and network context

Collection is off by default. In the popup's **Console & network** section, choose **Start collection**, reproduce the issue, then capture. Stop and discard is available before capture. The recorder ends on capture, navigation, review-session change or after five minutes. It uses the existing `activeTab`/scripting capability; this feature adds no Chrome permission.

Only the top-level page is observed. Up to 25 console warning/error messages and 50 resource timing entries are retained. Console arguments other than the first string are not serialized. Network entries contain the URL origin/path, resource type, timing and HTTP status when the browser exposes it. Headers, bodies, cookies, storage contents and prior browsing history are not collected. Requests or console events that occur before collection starts are absent.

URL credentials, query strings and fragments are stripped; common secrets and email patterns are redacted from messages. Redaction is best effort: URL paths and unusual console text can still contain private information. In the editor, inspect each entry, uncheck anything unsuitable and explicitly select **Share selected diagnostics with this feedback**. Sharing starts unchecked. Unshared entries stay in the local draft and are discarded with it. Submitted entries are part of the thread and follow that instance's retention and access policy.

The target page can influence or fabricate its own console and performance data. The server validates and bounds the packet and labels it untrusted. A missing status does not mean a request succeeded. Cross-origin requests and browser restrictions can limit what is available; this is not a complete network trace or a session recording.

Category and comma-separated tags are optional in the capture editor. See [review workflow](review-workflow.md) for navigation, saved filters and screenshot comparisons.
