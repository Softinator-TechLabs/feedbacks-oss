# Chrome extension

## Install and pair

1. [Install Feedbacks from the Chrome Web Store](https://chromewebstore.google.com/detail/feedbacks-website-review/dcpfpkfmegpgbfkeeileabpcbbmnoobo), then pin it in Chrome.
2. Open the extension and enter your team's Feedbacks server address, for example `https://feedback.example.com`.
3. Choose **Connect to server**. Chrome asks for access to that specific server; allow it.
4. Sign in to the server and approve the pending pairing request.
5. Open an approved website and capture a page or point. Review the image and comment before **Send**.

The public Store extension starts without a preset server. An unpacked developer build is separate and must be updated manually. For source installation, run `npm ci` and `npm run build:extension`, then select the repository's `extension/` folder in `chrome://extensions` → **Developer mode** → **Load unpacked**.

## What Chrome asks for

| Permission               | Purpose                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| Active tab and scripting | Capture or mark the page only after you start a review.                                           |
| Storage                  | Keep the paired server and an unfinished local draft.                                             |
| Context menus            | Offer **Add feedback here** on right-click.                                                       |
| Alarms                   | Poll a pairing request while it is pending.                                                       |
| Selected server host     | Connect the extension to the server you entered.                                                  |
| All websites (optional)  | Enable the instant right-click flow across HTTP(S) pages. Turn it on explicitly in the extension. |

Browser-protected pages cannot be captured. Some inaccessible frames permit coordinate-only evidence rather than a precise element. For local HTTP development, open the extension's **Advanced** section and enable the separate local-server allowance; use HTTPS for team servers.

## Full-page screenshots

Choose **Capture full page** to scroll through the current tab. The editor shows the results in page order with numbered previews and pixel ranges. Open each preview to annotate or redact it, and use **Remove** to leave out a screenshot before sending. Each retained image keeps its own numbered filename. If the page changes during capture, the editor keeps the pages collected so far and marks the capture incomplete; you can review those pages or retry on the original tab.

Separate screenshots are recommended for AI review. You can also select **Also include one combined image** in the editor. Very tall images can be difficult for an LLM agent to inspect; if the browser cannot create a combined image within the server's per-image size, turn that option off and send the ordered screenshots. The capture has no fixed page-count cutoff, but a page or browser can still change while scrolling. No image leaves the browser until you select **Send feedback**.

## Video and updates

**Record a short tab video** opens Chrome's tab picker. Stop after at most 30 seconds, preview the clip, add a comment and send it. The clip is stored privately with the thread. Recordings above 8 MiB are discarded. Chrome Web Store installs update through Chrome; after an update, refresh pages you are reviewing. An unpacked build requires **Reload** in `chrome://extensions`.

Read [access and privacy](/guide/access-privacy) before capturing sensitive pages. For complete extension behavior, see the [source guide](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/extension.md).
