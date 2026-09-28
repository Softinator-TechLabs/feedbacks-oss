---
description: Install and pin the Feedbacks Chrome extension, connect your team server, right-click a website element, finalize the draft and send feedback.
---

# Install the extension and send your first feedback

For clients, colleagues and testers. Feedbacks captures the evidence your developer and AI coding agent need to understand a UI change or bug.

## Before you install

**Your team must have a running Feedbacks server first.** DevOps installs it once on your company's infrastructure using the [server installation guide](/guide/self-host). You need its URL, a sign-in account and access to a project. If your team already has a server, ask the owner for access; you do not install another one.

The server URL is your team's Feedbacks address, such as `https://feedback.example.com`. It is **not** the website you are reviewing, the public documentation site or the `/mcp` endpoint.

## Install, pin and connect

1. [Open Feedbacks in the Chrome Web Store](https://chromewebstore.google.com/detail/feedbacks-website-review/dcpfpkfmegpgbfkeeileabpcbbmnoobo). Choose **Add to Chrome**, then confirm **Add extension**.
2. In Chrome's toolbar, open **Extensions** (the puzzle-piece button). Find **Feedbacks** and click its **pin**. The Feedbacks icon now stays in your toolbar. Chrome controls pinning; the extension cannot pin itself.
3. Sign in to your team's Feedbacks web app. Open **Help** and choose **Copy server URL**.
4. Click the pinned Feedbacks icon. Paste the URL into **Your Feedbacks server** and choose **Connect to server**. You can also use **Settings → Server & account**.
5. Allow Chrome to connect to that server. Sign in on the page that opens and approve the pending extension connection.
6. Return to the website you want to review. If no project matches, ask the owner to add its website origin and grant your account access. See [project setup](/guide/team-setup).

## Your first point: click, right-click, save

1. **Open the website**, then **left-click the pinned Feedbacks icon**. On an allowed page, opening the connected extension starts review and displays the page controls. Choose the project if more than one is available.
2. **Move your pointer onto the element** you want changed. With highlighting enabled, its outline shows the target.
3. **Right-click the element** to open the Feedbacks note editor. On a trackpad, use your system's secondary click; macOS Control-click is also supported.
4. **Write the problem and the expected result.** For example: “On mobile, add more space above this payment button.” Choose **Save point**.
5. Add more points the same way. The **unsent** count means these notes are still drafts on this browser.

While review is active, a normal left-click is not the add-comment action. Right-click adds the note; **Shift + right-click** keeps the browser's usual context menu. You can also begin from Chrome's **Add feedback on this page** context-menu entry.

## Finalize and send to Feedbacks

1. On the page, choose **Review & send** beside the Feedbacks controls. This is the finalization step: it opens your saved points and their original screenshots for review.
2. Check the notes and images. Use **View original image** to inspect a point. Annotate or redact private information before sharing.
3. Choose **Send feedback** in the editor. Wait for upload completion, then open the thread on your team's Feedbacks server.

**Save point → Review & send → Send feedback**

Saving a point or opening the editor does not send feedback. If sending stops after the thread was created, use **Retry Send** in the same draft to finish the remaining uploads without creating another thread.

The developer can now [read the feedback through MCP](/guide/mcp), fix the agreed work and record verification. Clients and testers do not need to configure MCP themselves.

## Developer-only: load an unpacked build

The Store extension starts without a preset server and updates through Chrome. To test from source, run `npm ci` and `npm run build:extension`, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the repository's `extension/` folder. Unpacked builds require manual updates.

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

The popup keeps **Exit review**, capture actions, viewport sizes and shortcuts together near the top. Expand **Chrome access** to inspect permissions and **More review tools** for QA and pin controls. A connected server appears as a short row; expand it to change the address. The address field suggests up to five recently connected servers from Chrome sync when available. A new unpacked extension with a different Chrome extension ID has separate storage, so its server address and authorization may need to be entered again. Chrome controls toolbar pinning: open its Extensions menu and pin Feedbacks there.

Hover an element to see its outline, then right-click it, write its note, and choose **Save point**. The orange dashed point and **not sent** count mean it is only on this browser. Hover or focus the point to see its note, unsent status and **Edit point** action. Click it to edit before capture. Add more points, choose **Review & send** beside the movable controls icon, inspect the saved images, then **Send feedback**. The shared thread is created before its screenshots finish uploading. If an upload stops, the editor identifies the already published thread and **Retry Send** finishes the remaining images without creating another thread. Team members with access to the same Feedbacks project see published points when reviewing that page. Hover or focus a point for its author, time, note and thread link. A member allowed to resolve feedback can use **Resolve**; older connections open the thread for resolution until they pair again with an updated server. Pins on underlying content disappear while a website menu covers that content.

## Simple review keys

While review is on and you are not typing: **M** mobile, **T** tablet, **D** desktop, **W** reset width, **S** screenshot, **P** full page, **R** stop review. Typing in forms, comments and editors does not trigger these actions. Use the popup or **Command+Shift+Y** on Mac (**Ctrl+Shift+Y** elsewhere) to open Feedbacks; Chrome requires modifiers for the opening shortcut. The popup shows your actual assigned shortcut and a link to customize it.

## Keep every point's original view

Right-clicking opens the comment editor immediately while capturing that visible view locally. A Capturing indicator changes to an original-image thumbnail when ready. **Save point** keeps the note and its original screenshot together, including a temporary menu or a different screen size. The pin follows the same element when it moves on a responsive page. When an element is hidden, covered, removed or offscreen, the bottom-right **Feedbacks** handle shows how many points are outside this view. Open the list to edit them or view their original images.

The **Review & send** button stays outside Page Controls with an **N unsent** count. It opens each point's labeled original image without taking an extra screenshot. **Screenshot** and **Full page** remain separate actions when you want an additional page capture. Even a visible-area capture retains original views from points elsewhere on the page. Choose **View original image** beside a note to annotate or redact its screenshot. A failed screenshot is labeled **No original image**; its text is retained. Once the final editor is open, edit the notes there. Nothing is shared until **Send feedback**.

Original point views are separate evidence. They are not stitched into the continuous full-page image, because a menu view and a mobile view may describe different states of the same page. Point IDs link each screenshot's markings to its note in the Feedbacks platform and agent tools.

## Full-page screenshots

Choose **Capture full page** to scroll through the current tab. The editor shows numbered screenshots in page order. Choose **Full page preview** to inspect the captured page as one scrollable image before sending; this local preview does not upload it. Return to a section from the list beside the image, then draw or redact on that section. The same marks appear in the optional combined full-page image. Use **Remove screenshot** to leave out a section before sending. Each retained image keeps its own numbered filename. If the page changes during capture, the editor keeps the pages collected so far and marks the capture incomplete; you can review those pages or retry on the original tab.

Keep the original website tab active until capture finishes. The extension scrolls it from top to bottom and restores your position afterward, including on pages with smooth scrolling or clipped carousels. If you already have an unfinished draft, review or discard it before starting a new capture of another page.

Separate screenshots are recommended for AI review. You can also select **Also include one combined image**. This copy is scaled to the server's image limits when the page is long; numbered screenshots keep their full resolution. Very tall images can be difficult for an LLM agent to inspect. During Send, both Send buttons fill as uploads complete. The progress bar reports how many images the server has confirmed and the corresponding percentage, not network-byte progress. If an upload fails, **Retry Send** resumes the same draft and thread from the first unsent image. The capture has no fixed page-count cutoff, but a page or browser can still change while scrolling. No image leaves the browser until you select **Send feedback**.

## Edit, copy and download

The full-page preview keeps sections at original resolution. Choose Fit width, 100% or 200% to inspect them. Use Copy image or Download to export the annotated current screenshot or full page as PNG, JPEG, WebP or PDF. PDF puts each section on a separate page; oversized raster exports offer PDF or individual images instead of shrinking the result.

Use highlighter, numbered steps, text, blur, simple stamps or an inserted local image to explain a change. Drag an inserted image to move it and its corner to resize. Crop export affects only local copies/downloads; sent feedback keeps the complete screenshot and point locations. Use Redact, rather than reversible blur, to remove private pixels.

## Video and updates

**Record a short tab video** opens Chrome's tab picker. Stop after at most five minutes, preview the clip, add a comment and send it. The clip is stored privately with the thread. Tab audio and microphone are separate options, off by default. Recordings above 40 MiB are discarded. Drag either timeline handle to trim, scrub to inspect a frame and choose Play selection to preview the range. Crop frame is available below. Apply edits before sending; Restore original undoes edits. Navigation continues recording in the selected tab. Chrome Web Store installs update through Chrome; after an update, refresh pages you are reviewing. An unpacked build requires **Reload** in `chrome://extensions`.

Read [access and privacy](/guide/access-privacy) before capturing sensitive pages. For complete extension behavior, see the [complete extension guide](/reference/manual/extension).

## Settings and unobtrusive page controls

Open **Settings** beside the version in the popup, or choose **Options** from Chrome’s extension menu. The full settings page contains the server/account connection, recent server addresses, website permissions, review shortcuts and update help. **Customize opening shortcut** opens Chrome’s shortcut controls. The opening shortcut is assigned by Chrome; the simple review keys run only during review. Disable **Use single-key shortcuts during review** when you prefer buttons; open reviews update immediately.

Drag the dock’s grip to move it, or focus the grip and use arrow keys. **Collapse** keeps the small Feedbacks/Exit dock; **Hide** removes it until you open the Chrome extension again. **Exit** stops review. Draft points stay on the same page for when you resume. The primary capture is the visible view with each point’s saved original image. **More review tools → Capture full page** (P) is optional and creates additional images.

The popup’s **Team feedback** shows project totals for the exact page, its hostname, or the page at the current mobile/tablet/desktop size. Open the link to see the matching threads on your configured server. Individual point resolution needs the updated server and an extension token with `threads.annotationStatus`; older connections can use the web thread or reconnect.

## Review defaults and page controls

Open **Settings → Review defaults** to choose navigation locking, element highlighting, click indicators, pin visibility and resolved points for new reviews. Recording has separate navigation, highlighting and click-indicator defaults. Controls on the page change the current session; your earlier controls return after recording.

The floating Page Controls includes pins, resolved points, **Page comments** and **Start diagnostics**. Page comments opens the configured server with threads filtered to this page across screen sizes. Diagnostics stay local until you inspect and select entries to share with a capture; Stop discards the collection.

**Full page** and **Record video** are directly available in the extension popup. They can create more media for an agent to process and may increase token use. Visible capture remains the primary action.
