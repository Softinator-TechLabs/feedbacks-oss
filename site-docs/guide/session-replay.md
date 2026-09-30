---
title: Video feedback and session replay
description: Record a browser bug with video, DOM replay and a synchronized timeline of clicks, console messages, network requests and performance events. Free and self-hosted.
---

# Replay the moment. Inspect the evidence.

Record what happened, then jump to the click, request or error that matters. Feedbacks keeps **video, session replay and diagnostics on one timeline** in the feedback thread.

<Evidence />

## Capture a session

1. On the website, open your connected Chrome extension and choose **Record video + session**. For replay without video, choose **Session only** in the source page’s recording options.
2. Reproduce the problem. Use the on-page controls to pause, resume or stop. You can right-click to add screenshot comments during capture.
3. Choose **Stop & review**. Inspect the recording, notes and captured events before sending.

Recordings are limited to five minutes and bounded local storage. Tab audio and microphone are separate opt-ins. For a flow that redirects to another website, add its exact origin under **Capture across redirect sites** before recording. Unapproved origins produce an explained gap.

## Read the timeline

| What you need           | Where to look                                |
| ----------------------- | -------------------------------------------- |
| What the reviewer saw   | Video, or DOM replay for an unedited session |
| Which control they used | Activity and its timestamped timeline marker |
| What failed             | Console and Network, at the selected moment  |
| What loaded slowly      | Captured performance and loading events      |
| What is missing         | Coverage and environment details             |

The **Everything** feed brings the channels together. Select an event or timeline marker to seek to that moment. Use **Larger** for more video space or **Beside** for a wide-screen inspector. In both the capture review and thread player, the timeline stays attached directly beneath the video, even with a taller inspector beside it. The playhead keeps events in context; an empty channel is not proof that nothing happened.

![Actual Feedbacks recording inspector showing synthetic activity, network, console and performance events.](/media/story/recording-inspector.webp)

## Point at a frame

Use **Save frame** to keep a screenshot from the video. In the thread, **Annotate frame** adds a point, comment and Pencil or Circle marks at the selected recording time. The image and its timestamp stay with the thread and exported evidence.

Before sending, trim or crop video if needed. Trimming keeps diagnostics inside the retained intervals; edited clips omit DOM replay because an original replay baseline could reveal excluded content.

## Choose what you share

Session capture starts explicitly. Review text/input masking and optional network bodies before starting. Recognized credentials are masked in session evidence, but **DOM masking does not mask video pixels**. Preview everything before sending.

This is a reviewer-started recording, not always-on visitor analytics. DOM replay may miss external assets or inaccessible frames; coverage states those limits.

[Download a debugging bundle](/guide/debug-bundles) · [Recording limits and exact behavior](/reference/manual/session-replay) · [Access and privacy](/guide/access-privacy)
