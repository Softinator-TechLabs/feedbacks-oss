# Reference provenance

Inspected on 2026-09-08. Reference repositories were cloned without running dependency installs, hooks, or application startup.

| Reference                                                 | Pinned commit                              | Intended learning                                          |
| --------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| [BugPin](https://github.com/aranticlabs/bugpin)           | `20e271d77df1bc22c235cd5bf8e23dc5f6aaa065` | Capture and annotation interactions; report workflow       |
| [FasterFixes](https://github.com/manucoffin/faster-fixes) | `f52a1dae45a80dc3ff6e4d2129eecd63b1d409b6` | Project feedback organization and MCP interaction patterns |

## Licensing boundary

The reference READMEs identify AGPL application code and separately licensed MIT widgets. BugPin additionally identifies proprietary Enterprise code. These descriptions do not authorize copying a whole repository into this product.

The implementation should be independently authored from the approved specification and established web-platform interfaces. If a specific reusable file is later selected, verify its applicable license, preserve the required notices, record the exact source path and commit, and review the resulting distribution obligations before inclusion. No proprietary Enterprise implementation is in scope.

Do not claim a clean-room process: developers have inspected references. No external application source has been incorporated at this documentation checkpoint.

## Important reference gaps

- A same-origin iframe screenshot renderer is not universal browser capture.
- Marketing claims about S3 compatibility do not prove private Wasabi upload and readback.
- An MCP tool list does not prove authorization, threaded replies, change cursors, or cross-client operation.
- A local prototype identity based on browser storage or IP address is not production authentication.
- A successful clone or documentation review is not a deployed or tested product.
