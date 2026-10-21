# Upcoming

The [app screenshot pilot](app-capture.md) is implemented in the web application. Wider native capture and debugging remain phased work. Each item lists its current status. Proposed items are not released features or delivery-date commitments. Check [platform compatibility](platform-compatibility.md) for current integrations and the distinction between visual capture and internal diagnostics.

Upcoming desktop companions target Windows, Ubuntu and macOS, followed by Android/iOS sharing. Planned diagnostics reuse Windows Event Log, the Linux journal and macOS Unified Logging for reviewed snapshots beside app screenshots. These are limited to OS-accessible messages; full crash dumps, deeper tracing and broad application/device verification remain separate work.

## Proposed sequence

| Work                         | Intended outcome                                                                               | Status                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Desktop app screenshot pilot | Choose a window/display or import an image, annotate/mask it, and send feedback                | Implemented pilot; real OS picker acceptance pending |
| Mobile SDK verification      | Complete pairing, screenshot review and upload in real iOS/Android host apps                   | Source available; real-device verification pending   |
| Desktop companions           | Start capture from a shortcut, tray or menu bar on Windows, Ubuntu and macOS                   | Proposed                                             |
| Mobile sharing and capture   | Share screenshots/video to Feedbacks, with optional Android projection and iOS broadcasting    | Proposed                                             |
| App-integrated diagnostics   | Include selected logs, recent actions, network failures and platform crash/performance context | Proposed                                             |

The sequence prioritizes a complete visual feedback workflow before adding deeper OS-specific integrations. Scope can change after the desktop pilot and real-device testing. Detailed acceptance criteria are in the [cross-platform capture plan](plans/cross-platform-capture.md).

## What stays consistent

Use the same organization installation, project access, review threads, private evidence and agent workflow. Each client must enforce explicit capture, preview before submission, current server authorization, revocable credentials and recoverable retries. Existing browser and mobile integrations must continue to work.

## Platform boundaries

Universal feedback collection does not imply universal debugging privileges. Native screen pixels do not reveal another app's internal logs, HTTPS bodies, database state or stack traces. App/backend integrations are needed for those channels. Historical activity exists only when collection was already enabled. Protected surfaces and OS restrictions remain applicable.

Only move a proposed item to available after implementation and its stated acceptance checks have evidence. A source package, successful compilation, synthetic stream, published ZIP and Store-installed application are distinct milestones.
