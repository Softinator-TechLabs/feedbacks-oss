# Chrome Web Store update worksheet

Use this copy for the public, server-neutral extension. Verify the uploaded ZIP, live privacy page and dashboard fields before submission. Packaging a ZIP does not publish a Store update.

## Package identity

- Existing Store item: `dcpfpkfmegpgbfkeeileabpcbbmnoobo`.
- Title: **Feedbacks: UI Context for AI Agents** (match `extension/manifest.json`).
- Short description (match the manifest; below 132 characters):

```text
Capture website feedback, screenshots and session replay for AI coding agents. Connect to your team's Feedbacks server.
```

- Category: **Developer Tools**. Language: **English**.
- Website: `https://feedbacks.softinator.ai/`
- Support: `https://github.com/Softinator-TechLabs/feedbacks-oss/issues`
- Privacy: `https://feedbacks.softinator.ai/privacy.html`

The title preserves the product's AI-agent context. The summary names the relevant website-review features in natural language. Google recommends a concise title and summary, and prohibits keyword stuffing ([listing advice](https://developer.chrome.com/docs/webstore/best-listing), [listing policy](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements)).

## Store listing → Detailed description

Paste the text in this block:

```text
Turn website feedback into context your team and AI coding agents can act on.

Feedbacks connects a Chrome review to your team's Feedbacks server. Clients and teammates can point to a specific element, comment on a screenshot, or capture a complete page. Developers can inspect the same page context, discussion and approved evidence before making a change.

CAPTURE AND REVIEW
• Right-click a point on a page to comment, or open the compact popup to capture the current view.
• Keep several points in a local draft, then review the screenshots before sending.
• Mark screenshots with pencil, shapes, arrows and text; redact visible private information before sharing.
• Capture a full page when one view is not enough. Open page comments and resolved points when you need the team's history.

VIDEO AND SESSION CONTEXT
• Record a short tab video with a synchronized browser session, or choose session-only capture in the recording options.
• Review activity, console, network and page replay on a shared timeline. Coverage labels show when a channel or part of the session was unavailable.
• Network request and response bodies are a separate recording option. Page text and input masking can be enabled. Video pixels need their own visual review before sending.

FOR DEVELOPERS
Feedbacks keeps submitted comments, screenshots, page URLs and recording evidence in the project on your chosen server. Authorized developers and coding agents can read the relevant thread through Feedbacks MCP or API. Connecting an agent does not automatically make changes or send data to an AI provider.

SETUP
Your organization needs a Feedbacks server and an account first. Self-host the open-source application or ask your team for its server URL and project access. Pin the extension, connect it to that server, open a website, start review, and send only after inspecting the draft.

A screenshot review collects point-in-time page diagnostics. You can turn off their inclusion before sending; start diagnostics separately if you need earlier console and network events. Recording starts through an explicit action. Optional all-website access enables right-click review; you can review from the toolbar without granting it. Browser-protected pages cannot be captured. The server operator controls access, storage and retention.

Setup: https://feedbacks.softinator.ai/docs/guide/getting-started
Extension guide: https://feedbacks.softinator.ai/docs/guide/chrome-extension
Privacy: https://feedbacks.softinator.ai/privacy.html
Source: https://github.com/Softinator-TechLabs/feedbacks-oss
```

This copy describes the current merged recording feature. Add a complete thread-bundle claim only after that separate work has merged and passed the release checks.

## Privacy practices → Single purpose

```text
Feedbacks lets a person review a website, annotate screenshots or record a short browser session, and send the chosen evidence to their team's Feedbacks project so teammates and authorized coding agents can understand and resolve the feedback.
```

### Permission justifications

Use these for the actual uploaded manifest. Recheck any permission added or removed before submission.

| Permission               | Justification                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`              | Temporarily accesses the tab the person explicitly opens for review or capture. It reads page context and captures the selected tab; it does not read Chrome's history database.                                                            |
| `scripting`              | Injects bundled review controls, point selection and session capture into the selected page or an optionally approved website. No executable script is downloaded from a server.                                                            |
| `storage`                | Saves the chosen server, scoped connection token, preferences, pending drafts and bounded local recording data so an interrupted review can resume.                                                                                         |
| `contextMenus`           | Adds an explicit right-click action to start feedback on the current page.                                                                                                                                                                  |
| `alarms`                 | Continues a short-lived connection approval while the popup is closed and enforces bounded recording and cleanup work. It does not schedule background screenshots.                                                                         |
| `debugger`               | After an explicit diagnostic or recording action, collects available console and network events for that review. Chrome shows its debugger indicator; capture ends at stop, navigation, review exit or its limit.                           |
| `tabCapture`             | Captures video and optional tab audio from the tab selected by the user for a short recording.                                                                                                                                              |
| `offscreen`              | Keeps the user-initiated MediaRecorder stream alive in a bundled offscreen extension document while the MV3 service worker may suspend.                                                                                                     |
| Optional website origins | Access to the team's selected server is requested when connecting. Broader HTTP/HTTPS website access is optional for automatic right-click review and approved cross-origin capture; the toolbar can start review without that broad grant. |

### Remote code

Select **No, I am not using remote code**.

```text
All executable JavaScript, including the pinned rrweb recording and replay bundle, ships inside the uploaded ZIP. Feedbacks fetches project data, images and release metadata from the selected server as data; it does not fetch or execute remote scripts or use remote evaluation.
```

### Data usage and policy

The current public Store listing discloses **personally identifiable information, authentication information, personal communications, web history, user activity and website content**. Keep those categories selected: account identity, comments, page URLs, screenshots, session events, DOM/page text, console output and network evidence can contain them. Website content and URLs also count when handled locally; do not select “no data collected” ([Google's privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [user-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)).

Review **financial/payment, health and location** against the pages your organization permits reviewers to capture and the server's access logs; raw screenshots, DOM and optional network bodies can contain these incidentally. Select any additional category that applies in practice. Publisher certifications about sale, advertising, unrelated transfer, creditworthiness and human access must reflect the actual operator and hosting arrangements.

The [public privacy page](https://feedbacks.softinator.ai/privacy.html) must describe the current screenshot-diagnostic default, raw evidence, optional recording masks, video pixels, project access and retention before submitting. Compare its live content with the dashboard declarations.

## Store listing → Images

Upload four current synthetic, browser-rendered 1280 × 800 screenshots in order: review controls, point comment, saved draft and screenshot editor. Keep screenshots full bleed, with no private server addresses or credentials. Provide the 128 × 128 icon and 440 × 280 promo tile from the same verified package build. Google accepts one to five 1280 × 800 or 640 × 400 screenshots and requires a small promo tile ([image requirements](https://developer.chrome.com/docs/webstore/images)). Leave the optional marquee and promo video blank unless current assets exist.

## Distribution and reviewer instructions

This updates the existing item. Keep its current visibility and region settings unless the publisher intentionally changes them; an upgrade normally stays on the same channel ([update guide](https://developer.chrome.com/docs/webstore/update)). Do not switch to Private merely because an older worksheet described a tester-only submission.

If the dashboard asks for reviewer access, provide a separate non-sensitive demonstration account through Google's private reviewer fields. Do not put credentials in the public listing or this repository. Suggested test instructions:

```text
1. Sign in to the supplied demonstration Feedbacks server with the private reviewer credentials.
2. Open its Setup page, copy the server URL, and connect the extension. Approve server access and the connection.
3. Open the supplied demonstration website. Use the pinned Feedbacks popup to start review, right-click a point, save a comment, then open Review & send.
4. Inspect or mark the screenshot and send the synthetic feedback. Open the resulting thread to view its page context and discussion.
5. On the demonstration website, start Record video + session, stop after a few seconds, inspect the event timeline and discard the sample. No payment or real customer data is needed.
```

## Dashboard update order

1. Confirm the published Store version and this ZIP's higher manifest version. The ZIP must contain `manifest.json` at its root with all extension files ([package guidance](https://developer.chrome.com/docs/webstore/prepare)).
2. In the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), open existing Feedbacks item `dcpfpkfmegpgbfkeeileabpcbbmnoobo` → **Package** → **Upload New Package**. Upload the extension ZIP itself, not the outer handoff bundle.
3. **Store listing**: update description, category/language if needed, URLs, icon, promo tile and ordered screenshots. Verify the uploaded package's manifest title and short description in the dashboard.
4. **Privacy practices**: review the single purpose, every permission justification, remote-code answer, data categories, certifications and live privacy-policy URL. Resolve every dashboard warning.
5. **Distribution**: verify existing visibility, countries and rollout setting. **Test instructions**: update demonstration steps and private reviewer access if requested.
6. Save the draft, inspect its preview and **Submit for Review**. Submission alone does not update the published listing; publication follows review or a deferred publish action ([Google update guide](https://developer.chrome.com/docs/webstore/update)). Verify the published version, listing, screenshots and privacy panel after approval.

## Release gates

- Source revision and local ZIP checksum recorded; ZIP manifest version exceeds the published version.
- `npm run check`, packaged-extension browser QA, required CI and package content inspection pass.
- Screenshots, icon and promo meet actual dimensions and contain only synthetic evidence.
- Live privacy page matches this copy; dashboard privacy categories and permission answers match uploaded code.
- Reviewer account, dashboard submission, Google approval, publication and Store-installed Chrome behavior are separate receipts.
