---
description: Install Feedbacks, connect your team server, capture a point and check the evidence before sending.
---

# Point it out. Send it over.

Ask your team for its running server URL, your sign-in and project access. [DevOps installs the server first.](/guide/self-host)

<Demo step="connect" />

<DocPath :steps="['Install & pin', 'Connect to server', 'Save point', 'Send feedback']" />

## Install, pin and connect {#install-pin-and-connect}

1. [Add Feedbacks to Chrome](https://chromewebstore.google.com/detail/feedbacks-website-review/dcpfpkfmegpgbfkeeileabpcbbmnoobo). Open Chrome’s puzzle icon and pin Feedbacks to your toolbar.
2. In the team app, choose **Setup → Copy server URL**. Paste it into the extension.
3. Choose **Connect to server**, allow server access, sign in and approve pairing.

## Your first point {#your-first-point-click-right-click-save}

Open your website and click the pinned icon. Right-click an element, write the change and choose **Save point**. For wording changes, [select text and suggest a replacement](/guide/text-suggestions).

The default review shortcut is **⌘ Shift Y** on Mac or **Ctrl Shift Y** on Windows. Change it in **Settings → Keyboard shortcuts** if it conflicts.

## Check and send {#finalize-and-send-to-feedbacks}

Choose **Review & send**, inspect the screenshots, then **Send feedback**. Points stay local until sending. You can show or hide **Points**, **Element outline** and **Text selection** separately.

New screenshot reviews include captured diagnostics by default. Check their preview and coverage, or **Download diagnostics**. Raw values can include cookies, storage and request bodies; screenshot redaction does not redact that archive. Uncheck **Include captured diagnostics** to omit it; change future defaults in **Settings → Review defaults**.

Use **Start diagnostics** before reproducing earlier console/network activity. If uploading is interrupted, keep the draft open and choose **Retry Send**.

[Capture tools, permissions, exit controls and shortcuts](/reference/manual/extension) · [Troubleshooting](/guide/troubleshooting)
