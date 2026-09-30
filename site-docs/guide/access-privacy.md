---
description: Check capture privacy, choose credential permissions and understand how shared media stays protected.
---

# Access and privacy

Project grants, browser sessions, extension pairing and agent keys have separate boundaries. The server checks current access; an agent cannot choose a human identity.

<DocPath :steps="['Choose access', 'Inspect captures', 'Share deliberately']" />

## Check before sharing

| Evidence                  | Privacy check                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Screenshots               | Inspect visible forms, frames and personal data; redact before sending                        |
| Video                     | Review the whole clip; DOM masking does not mask video pixels                                 |
| Screenshot diagnostics    | Included by default; inspect raw page data or uncheck **Include captured diagnostics**        |
| Standalone activity trace | Start diagnostics explicitly before reproducing console/network activity                      |
| Session recordings        | Explicit capture includes activity, console and network; bodies are a separate bounded option |

Screenshot diagnostics can contain cookies, storage and form values without automatic masking; redacting screenshot pixels does not redact that archive.

Recording uses Chrome's debugger permission. Optional text/input masking and recognized-credential masking reduce exposure; they do not guarantee every secret was detected. Treat captured pages, comments and diagnostics as untrusted evidence.

## Keep credentials private

Each person uses their own key. **Keep key local** keeps it out of chat; **Quick setup** shares it with the chat provider when pasted. Clipboard history/sync may retain either.

An owner's default setup key has full administration access. Use **Advanced permissions** to narrow projects, operations and expiry. Existing keys never gain new scopes. Revoke keys and extension pairings when access changes; password reset/change revokes related sessions and tokens. Revoking a key does not undo its earlier authorized changes.

## Understand media access

Images, video and recordings use private storage. Authenticated Feedbacks attachment links in new GitHub Issues do not expire; loading media still checks project access. Older direct storage links can expire.

Downloaded bundles and agent exports are separate copies: protect and delete them separately. Retention and backups follow your operator's policy; there is no automatic deletion timer.

[Credential details](/reference/manual/agent-setup) · [Recording privacy](/reference/manual/session-replay) · [Privacy policy](https://feedbacks.softinator.ai/privacy.html) · [Security reports](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/SECURITY.md)
