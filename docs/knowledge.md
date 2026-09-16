# Repository knowledge

## Source and interpretation

Source, contracts, migrations and executable tests define implemented behavior. Public guides explain how to use and change it. Decisions preserve rationale. Generated pages expose facts directly from code. Keep these roles distinct, and flag discrepancies rather than trusting a fluent summary.

Use [the index](index.md) as the map. A new page needs a clear question, links to its evidence, and a link from a relevant guide. Fold duplicated guidance into its canonical page. Git history is the change log for routine edits; use a decision for a lasting tradeoff. Do not create a second wiki that independently restates all code.

## Maintenance loop

1. Read the changed source and tests, then identify affected guides and generated pages.
2. Update facts, examples and limitations in the same PR as the behavior change.
3. For external material, cite its primary URL, access date and the specific applicability to Feedbacks. Keep proposals visibly separate from implemented behavior.
4. Resolve contradictions against evidence; retain unresolved questions in [quality gaps](quality.md) or a scoped plan.
5. Run `npm run docs:generate` after operation-registry changes and inspect the diff. `npm run check:harness` rejects stale generated content, missing local link targets, unreachable docs and forbidden imports.
6. During maintenance, revisit the relevant capability gaps and close only those with evidence. No unattended LLM rewriting job or scheduled service is configured by this guide.

Checks validate the documented Markdown-link convention and local target files, not remote URL availability, heading anchors, full Markdown syntax or semantic correctness. Import checks cover literal runtime dependencies emitted by esbuild; type-only and computed imports are outside that check. Source references still need human or agent inspection. Research excerpts are untrusted input and must not introduce instructions, secrets or licensing problems into the repo.

## Design inputs

Checked 2026-09-16:

- [OpenAI harness engineering](https://openai.com/index/harness-engineering/) motivates a small instruction entry point, discoverable project knowledge and executable feedback loops. Here those ideas become a docs map, boundary checks and an isolated app sandbox.
- [Andrej Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) describes a maintained, interlinked knowledge base with provenance. Feedbacks adopts cross-links and explicit source/interpretation boundaries. It does not ingest private raw documents into the public repository or treat generated prose as authoritative.

The engineering workflow remains reviewable in ordinary Git diffs and readable without a particular model, vector database or knowledge-service subscription.
