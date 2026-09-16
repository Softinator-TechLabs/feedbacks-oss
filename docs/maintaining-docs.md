# Maintaining repository knowledge

Start from [the documentation index](index.md). Keep existing canonical guides rather than creating overlapping summaries.

- Describe implemented behavior from source and tests. Label proposals and unverified assumptions explicitly.
- Link to the relevant source module, executable check or decision. Prefer stable file links to fragile line numbers.
- Update the canonical page when changing behavior, then update its inbound links. New pages must be reachable from the index.
- Preserve a decision's original context; supersede it with a new decision when direction changes.
- Generated pages under `generated/` come from repository commands. Regenerate and review the diff; never hand-edit them.
- For external research, record the original author/source, access date, what applies here and what does not. Link instead of copying whole articles.
- Resolve contradictory claims against implementation and reproducible evidence. Do not silently elevate an LLM summary to a product guarantee.
- Raw customer material, credentials, incident evidence and private launch plans stay outside the public knowledge base.
- Use ordinary Markdown links so GitHub and all supported coding agents can navigate the same documents.
- Keep client adapters thin. Follow [knowledge maintenance](knowledge.md) and the [verification matrix](verification.md).
- Run `npm run check:harness` after edits and `npm run check:release` after a build to validate exported links.
