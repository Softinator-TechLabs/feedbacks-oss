---
title: How we audit comparisons
description: Dated primary-source evidence, precise feature definitions and honest boundaries for Feedbacks comparisons.
---

# How we audit comparisons

The [complete comparison](https://feedbacks.softinator.ai/compare/) groups all 16 tools into category tables, with products as rows and capabilities as columns. All 49 capabilities have a dated verdict, source and qualification for every tool. Hover over a mark for its review date; open it for its source and qualifications. On touch screens, opening a mark also shows the date. The current audit was reviewed on **30 September 2026**.

## What the marks mean

| Mark             | Meaning                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| ✓                | The named capability is available in the reviewed product surface.                                                            |
| ×                | An explicit limitation, complete tool/workflow inventory or inspected implementation establishes absence in the stated scope. |
| Paid             | Available in a paid edition.                                                                                                  |
| Partial          | Related support exists, but does not cover every part of the named capability.                                                |
| External / Parts | Requires another product, connector or components to assemble.                                                                |
| Not verified     | The reviewed evidence cannot settle the exact capability. The cell explains why.                                              |

A missing search keyword alone never justifies a cross. Scope matters: a public Community-source audit cannot prove absence in a proprietary Enterprise module. Open a verdict to see the edition, workflow and qualifications. A documentation review date is not a claim that every product was installed or tested with a customer account.

## Evidence we use

We inspect official product guides, editor and recorder walkthroughs, API/MCP inventories, plan/edition limits and accessible public implementation. Open-source findings link to the inspected commit and file. Hosted-product findings link to the published guide or deployed tool inventory. We retain unresolved contradictions rather than choosing a favorable claim.

All individual comparisons use the same evidence as the comprehensive table. The public generator rejects missing cells, sources, dates or qualifications. A capability can differ by browser, plan, setup or release after the review date.

## Precise definitions

- **Session replay** reconstructs recorded page activity. A manually recorded video, page version or uploaded video review is a different capability.
- **Shared timeline** aligns playback with captured diagnostic events; comment history alone does not qualify.
- **Screenshot diagnostic bundle** includes DOM, console and network artifacts, not only URL/browser metadata. Partial channel coverage stays qualified.
- **Complete thread archive** carries discussion, original media and available diagnostics. CSV rows or media URLs alone are partial exports.
- **Selected-text suggestions** retain original text and a replacement. Live text editing or an ordinary comment is related support.
- **Reviewer guidance** means owner-approved subject weights available to authorized agents. An AI persona, team role or private biography is different.
- **Assigned/priority MCP queue** exposes task assignment and prioritization to an authorized coding agent. Human instructions remain authoritative.
- **Project guidance** requires agent-readable instructions with version/revision provenance. A brand-guideline upload alone is partial.
- **Multiple GitHub Apps** means distinct App configurations on one server. Multiple destinations under a single OAuth/PAT connection are different.
- **Local review queue** stages multiple unsent page points for a deliberate review-and-send step. A single draft comment or a failed-delivery retry queue is related support.
- **Image tools and exports** are assessed individually. PDF input is not PDF export; a freehand pen is not a highlighter; attaching an image is not inserting a movable image layer.
- **Whole-service self-hosting** includes the backend. A public SDK, browser extension, WordPress plugin or docs repository alone does not qualify.
- **No license fee** describes product licensing. Your infrastructure and any optional external services can still cost money.

The first group highlights Feedbacks’ distinctive combination of workflows. It does not claim every row is exclusive: other tools also offer MCP, replay, annotations, self-hosting and related capabilities. Feedbacks’ own limitations are included, including the host-owned integration and UI required by its native mobile libraries.

## Corrections and maintenance

If a source changed or a verdict misses a supported workflow, [open a source-backed correction](https://github.com/Softinator-TechLabs/feedbacks-oss/issues). Include the tool, capability, edition and official documentation or source path. Maintain the canonical evidence in `site/comparison-evidence/`, then regenerate the pages; never edit generated tables directly.
