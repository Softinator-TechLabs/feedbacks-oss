# Chrome extension

## Install and pair

1. [Install Feedbacks from the Chrome Web Store](https://chromewebstore.google.com/detail/feedbacks-website-review/dcpfpkfmegpgbfkeeileabpcbbmnoobo), then pin it in Chrome.
2. Open the extension and enter your team's Feedbacks server address, for example `https://feedback.example.com`.
3. Choose **Connect to server**. Chrome asks for access to that specific server; allow it.
4. Sign in to the server and approve the pending pairing request.
5. Open an approved website and capture a page or point. Review the image and comment before **Send**.

The public Store extension starts without a preset server. An unpacked developer build is separate and must be updated manually. For source installation, run `npm ci` and `npm run build:extension`, then select the repository's `extension/` folder in `chrome://extensions` → **Developer mode** → **Load unpacked**.

## What Chrome asks for

| Permission               | Purpose                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| Active tab and scripting | Capture or mark the page only after you start a review.                                        |
| Storage                  | Keep the paired server and an unfinished local draft.                                          |
| Context menus            | Start an inline comment on the selected element; keep adding points before screenshot review.  |
| Alarms                   | Poll a pairing request while it is pending.                                                    |
| Selected server host     | Connect the extension to the server you entered.                                               |
| All websites (optional)  | Pre-approve site access. Review still starts only when you open Feedbacks or use its shortcut. |

Browser-protected pages cannot be captured. Some inaccessible frames permit coordinate-only evidence rather than a precise element. For local HTTP development, open the extension's **Advanced** section and enable the separate local-server allowance; use HTTPS for team servers.

The popup keeps **Turn off review**, capture actions, viewport sizes and shortcuts together near the top. Expand **Chrome access** to inspect permissions and **More review tools** for QA and pin controls. A connected server appears as a short row; expand it to change the address. The address field suggests up to five recently connected servers from Chrome sync when available. A new unpacked extension with a different Chrome extension ID has separate storage, so its server address and authorization may need to be entered again. Chrome controls toolbar pinning: open its Extensions menu and pin Feedbacks there.

Hover an element to see its outline, then right-click it, write its note, and choose **Save point**. The orange dashed point and **not sent** count mean it is only on this browser. Hover or focus the point to see its note, unsent status and **Edit point** action. Click it to edit before capture. Add more points, choose **Review screenshots**, inspect the image, then **Send feedback**. The shared thread is created before its screenshots finish uploading. If an upload stops, the editor identifies the already published thread and **Retry Send** finishes the remaining images without creating another thread. Team members with access to the same Feedbacks project see published points when reviewing that page. Hover or focus a point for its author, time, note and thread link. A member allowed to resolve feedback can use **Resolve**; older connections open the thread for resolution until they pair again with an updated server. Pins on underlying content disappear while a website menu covers that content.

## Simple review keys

While review is on and you are not typing: **M** mobile, **T** tablet, **D** desktop, **W** reset width, **S** screenshot, **P** full page, **R** stop review. Typing in forms, comments and editors does not trigger these actions. Use the popup or **Command+Shift+Y** on Mac (**Ctrl+Shift+Y** elsewhere) to open Feedbacks; Chrome requires modifiers for the opening shortcut. The popup shows your actual assigned shortcut and a link to customize it.

## Keep every point's original view

Right-clicking captures that visible view locally before the comment editor opens. **Save point** keeps the note and its original screenshot together, including a temporary menu or a different screen size. The pin follows the same element when it moves on a responsive page. When an element is hidden, covered, removed or offscreen, the bottom-right **Feedbacks** handle shows how many points are outside this view. Open the list to edit them or view their original images.

When you choose **Review screenshots**, the final editor includes both the new page capture and each point's labeled original image. Even a visible-area capture retains original views from points elsewhere on the page. Choose **View original image** beside a note to annotate or redact its screenshot. A failed screenshot is labeled **No original image**; its text is retained. Once the final editor is open, edit the notes there. Nothing is shared until **Send feedback**.

Original point views are separate evidence. They are not stitched into the continuous full-page image, because a menu view and a mobile view may describe different states of the same page. Point IDs link each screenshot's markings to its note in the Feedbacks platform and agent tools.

## Full-page screenshots

Choose **Capture full page** to scroll through the current tab. The editor shows numbered screenshots in page order. Choose **Full page preview** to inspect the captured page as one scrollable image before sending; this local preview does not upload it. Return to a section from the list beside the image, then draw or redact on that section. The same marks appear in the optional combined full-page image. Use **Remove screenshot** to leave out a section before sending. Each retained image keeps its own numbered filename. If the page changes during capture, the editor keeps the pages collected so far and marks the capture incomplete; you can review those pages or retry on the original tab.

Keep the original website tab active until capture finishes. The extension scrolls it from top to bottom and restores your position afterward, including on pages with smooth scrolling or clipped carousels. If you already have an unfinished draft, review or discard it before starting a new capture of another page.

Separate screenshots are recommended for AI review. You can also select **Also include one combined image**. This copy is scaled to the server's image limits when the page is long; numbered screenshots keep their full resolution. Very tall images can be difficult for an LLM agent to inspect. During Send, the progress bar reports how many images the server has confirmed and the corresponding percentage, not network-byte progress. If an upload fails, **Retry Send** resumes the same draft and thread from the first unsent image. The capture has no fixed page-count cutoff, but a page or browser can still change while scrolling. No image leaves the browser until you select **Send feedback**.

## Video and updates

**Record a short tab video** opens Chrome's tab picker. Stop after at most five minutes, preview the clip, add a comment and send it. The clip is stored privately with the thread. Tab audio and microphone are separate options, off by default. Recordings above 40 MiB are discarded. Trim and crop locally from the preview before sending; Restore original undoes edits. Navigation continues recording in the selected tab. Chrome Web Store installs update through Chrome; after an update, refresh pages you are reviewing. An unpacked build requires **Reload** in `chrome://extensions`.

Read [access and privacy](/guide/access-privacy) before capturing sensitive pages. For complete extension behavior, see the [source guide](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/extension.md).

## Settings and unobtrusive page controls

Open **Settings** beside the version in the popup, or choose **Options** from Chrome’s extension menu. The full settings page contains the server/account connection, recent server addresses, website permissions, review shortcuts and update help. **Customize opening shortcut** opens Chrome’s shortcut controls. The opening shortcut is assigned by Chrome; the simple review keys run only during review. Disable **Use single-key shortcuts during review** when you prefer buttons; open reviews update immediately.

Drag the dock’s grip to move it, or focus the grip and use arrow keys. **Collapse** keeps the small Feedbacks/Exit dock; **Hide** removes it until you open the Chrome extension again. **Exit** stops review. Draft points stay on the same page for when you resume. The primary capture is the visible view with each point’s saved original image. **More review tools → Capture full page** (P) is optional and creates additional images.

The popup’s **Team feedback** shows project totals for the exact page, its hostname, or the page at the current mobile/tablet/desktop size. Open the link to see the matching threads on your configured server. Individual point resolution needs the updated server and an extension token with `threads.annotationStatus`; older connections can use the web thread or reconnect.
