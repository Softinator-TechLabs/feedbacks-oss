# Agent development workflow

## Understand and reproduce

Read [AGENTS.md](../AGENTS.md), the [map](index.md), relevant code and existing tests. Record the requested outcome and boundaries. Reproduce a reported defect using synthetic data before choosing a fix. Search existing implementations before adding a new helper or dependency.

Use [Superpowers](agent-tools.md) for planning, systematic debugging, regression coverage and verification when installed. Scale planning to the task: a small repair needs a short checklist; a cross-component change needs an [execution plan](plans/README.md). Do not repeat questions already answered by the user.

## Work in isolation

Preserve unrelated changes. Use a dedicated branch/worktree for parallel changes. Run `npm ci`, then `npm run harness:dev` for a disposable app with its own database, assets and automatically allocated loopback port. It does not read `.env` or use external databases/storage. Stop it with Ctrl+C; the instance's files are removed. SIGKILL may leave an ignored sandbox directory; remove only that instance's directory after confirming its process has stopped.

The sandbox runs the built application. Rebuild/restart after source changes. It uses PGlite for convenient reproduction, not for PostgreSQL concurrency certification. Persistent local PostgreSQL and live frontend development remain available through [development](development.md).

## Implement and verify

Make the smallest complete change. Put stable data schemas in shared contracts and authorization in server operations. Keep the extension and public site independently buildable. Add a regression test that fails for the old behavior, including denied/invalid input when relevant. Use the [verification matrix](verification.md) to select checks.

For UI changes, use Impeccable against the existing product/design context and the user's brief. Capture desktop/mobile and keyboard evidence using synthetic content. Tool restrictions or a blocked browser flow must be reported as unverified, not passed.

Review the diff for unintended files, public/private boundaries, permissions, compatibility and failure behavior. An available reviewer agent can be used for a concrete independent review when delegation is authorized; it is not a mandatory extra maintainer gate.

## Integrate and deliver

Update affected docs and [quality gaps](quality.md) when material evidence changes. Use PRs with passing required CI. A second maintainer's approval is optional; check [governance](../GOVERNANCE.md). Do not bypass failed CI or loosen branch protection as an implementation shortcut.

Where deployment is in scope, record the merged revision and deployment result, then verify the actual domain and packaged version. Check authenticated access and image storage separately from readiness. Keep operational receipts private. Report exactly what was changed, what passed and what remains unverified. No public completion claim should rely only on a plan, package build or successful tool invocation.
