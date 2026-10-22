# Upcoming

The web workspace, Chrome extension and coding-agent integrations are available today. The native apps below are **Coming soon: planned, not released**, with no confirmed delivery dates. Check [platform compatibility](platform-compatibility.md) for capture and diagnostic limits.

## Available today

| Capability                                                                                                                                                      | Current status                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Project Kanban board](project-board.md), [visual analytics](analytics.md), [subscribed email](email-notifications.md) and [task integrations](integrations.md) | Released web features                                                                          |
| [Codex and Claude Code plugins / MCP](agents.md)                                                                                                                | Direct installation and MCP available; official directory publication is a separate gate       |
| [App screenshot pilot](app-capture.md)                                                                                                                          | Web image import and browser window/display capture; real OS picker acceptance remains pending |
| [iOS/Android integration kits](mobile-sdk.md)                                                                                                                   | Host-app SDK source available; real-device verification remains pending                        |

## Coming soon: native apps

| Planned client          | Intended workflow                                                   | Status                                        |
| ----------------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| Windows companion       | Start app/window capture from a desktop shortcut or tray            | Planned; no released installer                |
| Ubuntu companion        | Start app/window capture through the supported desktop capture path | Planned; no released package                  |
| macOS companion         | Start app/window capture from a menu-bar companion                  | Planned; no released app                      |
| Android app and sharing | Share screenshots/video, with optional user-approved projection     | Planned; no standalone app or share target    |
| iOS app and sharing     | Share screenshots/video, with optional user-started broadcasting    | Planned; no standalone app or share extension |

Scope and order can change. The existing web pilot and host-app SDKs are separate from these native clients. Detailed acceptance criteria are in the [cross-platform capture plan](plans/cross-platform-capture.md).

## Diagnostics and device verification

Reviewed OS-log snapshots have an [open, unreleased development PR](https://github.com/Softinator-TechLabs/feedbacks-oss/pull/219). Those diagnostic changes are unreleased. The proposed Windows Event Log, Linux journal and macOS Unified Logging paths cover only accessible messages; full crash dumps, deeper tracing and broad device acceptance remain separate work.

App-integrated logs, recent actions, network failures and platform crash/performance context remain proposed. The existing mobile SDKs still need pairing, screenshot review and upload acceptance on real iOS/Android devices.

## What stays consistent

Use the same organization installation, project access, review threads, private evidence and agent workflow. Each client must enforce explicit capture, preview before submission, current server authorization, revocable credentials and recoverable retries. Existing browser and mobile integrations must continue to work.

## Platform boundaries

Universal feedback collection does not imply universal debugging privileges. Native screen pixels do not reveal another app's internal logs, HTTPS bodies, database state or stack traces. App/backend integrations are needed for those channels. Historical activity exists only when collection was already enabled. Protected surfaces and OS restrictions remain applicable.

Only move a proposed item to available after implementation and its stated acceptance checks have evidence. A source package, successful compilation, synthetic stream, published ZIP and Store-installed application are distinct milestones.
