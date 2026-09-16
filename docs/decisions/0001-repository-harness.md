# Decision 0001: a portable repository harness

Date: 2026-09-16. Status: accepted.

## Context

The application, extension and site share a repository, but have different runtime boundaries. Coding agents need reliable entry points, a safe way to reproduce behavior and concise completion evidence. Duplicated client instructions and unverified generated documentation would introduce drift.

## Decision

Use one root AGENTS.md with thin Claude/Gemini import adapters. Maintain linked Markdown guides in the existing docs directory. Generate the operation catalog from contracts. Enforce runtime import directions and docs reachability in the existing quality command. Provide a disposable, loopback-only PGlite app with synthetic data for local reproduction.

Use installed Superpowers for development techniques and Impeccable for UI work as described in [agent tools](../agent-tools.md). Keep skill installation separate from application dependencies and builds. Preserve required CI and PRs, without mandatory independent maintainer approval.

## Consequences

Contributors can use the same commands without a specific model subscription. The sandbox cannot certify production PostgreSQL/S3 behavior. Documentation structure is checked mechanically, while semantic accuracy remains a review obligation. We avoid adding a second knowledge service, a vendored skill distribution or a mandatory orchestration framework at this scale.

See [architecture](../architecture.md), [knowledge maintenance](../knowledge.md) and [quality gaps](../quality.md). Revisit this decision when measured coordination or retrieval problems justify additional tooling.
