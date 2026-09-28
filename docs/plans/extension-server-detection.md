# Detect the active Feedbacks server

Status: implemented; deployment pending. Date: 2026-09-28.

## Outcome and approach

Opening the extension on a Feedbacks installation fills an empty server setting. Setup adds **Set in extension** beside the copy action. The server exposes a public, credential-free product marker; the activeTab grant lets the extension read it in the top-level page. An isolated-world bridge handles the page button after that activation and opens extension Settings. Before activation, the button gives toolbar instructions. Existing servers, drafts, pairing and local HTTP policy remain protected.

No new manifest permissions, always-on content script or externally connectable API is needed. Discovery never pairs an account, sends credentials, reads other tabs or accepts a page-supplied server URL. Older servers/extensions retain copy/paste setup.

## Steps

- [x] Trace manual-only connection and reproduce missing detection.
- [x] Add detection, serialized settings writes and setup action.
- [x] Update the canonical extension guide and design description.
- [x] Verify focused tests, full checks, package and isolated Chromium desktop/mobile flow.

## Verification

Node 22 full `npm run check`: 208 passed, 5 skipped, zero failures; typecheck, builds, sandbox smoke and release checks passed. Isolated Chromium setup checks passed for detection, HTTP policy, bridge fallback, Settings handoff, saved-server protection and desktop/mobile layout. ZIP 0.1.35 includes the discovery module with unchanged permissions. Focused review found a misleading local HTTP recovery instruction, which now directs fresh local installations to paste the URL and enable the local option. The extension browser regression script also passed. Synthetic layout evidence: [desktop](../screenshots/server-setup/desktop.png) and [mobile](../screenshots/server-setup/mobile.png).

Focused tests cover empty setup, ordinary/insecure origins, existing configuration, typing races and navigation. Browser verification must use a disposable profile and synthetic server; headless host grants do not prove Chrome's permission prompts. No database migration or storage-format change is involved. Reverting restores manual setup while preserving saved settings.

Release, Store publication and live deployment remain separate gates.
