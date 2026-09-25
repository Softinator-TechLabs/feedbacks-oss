# Quality and capability gaps

Baseline reviewed 2026-09-16. This is an evidence inventory, not a certification, coverage percentage or uptime promise. Update the affected row when evidence changes.

| Area                           | Executable evidence                                                                                         | Remaining limitation                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Identity and project isolation | [Security tests](../tests/security.test.ts), [HTTP tests](../tests/http.test.ts)                            | Does not establish shared-database customer tenancy                                   |
| Transactions and cursors       | [Native PostgreSQL tests](../tests/cursor-concurrency.test.ts)                                              | PGlite cannot establish concurrent commit ordering                                    |
| Agent contracts                | [Shared registry](../src/shared/contracts.ts), HTTP/MCP tests                                               | Client import/discovery behavior still needs actual-client verification               |
| Extension onboarding           | [Connection](../tests/extension-connection.test.ts) and [pairing](../tests/extension-pairing.test.ts) tests | Real Chrome permissions, editor and Store release need manual/browser evidence        |
| Asset storage                  | [S3 adapter tests](../tests/s3-adapter.test.ts), [asset implementation](../src/server/assets.ts)            | Provider credentials and restore procedures need deployment-specific tests            |
| Scheduled project QA           | [Focused QA tests](../tests/scheduled-qa.test.ts), [worker and comparison](../src/server/scheduled-qa.ts)   | Static public pages only; no unattended browser capture or live external-site proof   |
| Architecture and knowledge     | [Harness checks](../scripts/check-harness.mjs), [guard tests](../tests/harness.test.ts)                     | Import rules do not prove internal server layering; docs prose can still become stale |
| Reproduction                   | [Disposable sandbox](../scripts/dev-sandbox.mjs)                                                            | Built UI without hot reload; no persistent fixtures or production data                |
| Operations and scale           | [Container smoke](../scripts/smoke-containers.mjs), [operations](operations.md)                             | No measured SLO/load baseline, shared rate limiter or verified HA claim               |

Prioritize new work from actual failure evidence. For material gaps, create a scoped [plan](plans/README.md) with acceptance criteria, compatibility and recovery. Do not turn this list into promises about unimplemented enterprise features.
