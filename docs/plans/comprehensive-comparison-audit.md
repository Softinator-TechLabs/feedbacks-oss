# Plan: comprehensive competitor evidence and comparison

Status: implementation verified; CI and release in progress. Date: 2026-09-30.

## Outcome and scope

Restore one comprehensive comparison matrix containing Feedbacks and all 15 listed competitors. Audit all existing capabilities plus the free complete product, Apache license, multiple GitHub Apps, assigned/priority MCP queue, session-only capture, screenshot diagnostic bundles and native clients. Put distinctive Feedbacks workflows first without making an unsupported global exclusivity claim.

## Evidence and approach

The previous refresh split the matrix into five tables and retained large gaps in vendor research. Review official vendor feature documentation, APIs, pricing and accessible open-source repositories separately for each product. Store dated evidence for every cell, including negative verdicts and unresolved gaps. Open-source audits name the reviewed commit and source locations. Hosted-product claims describe the publicly documented native product surface, not hypothetical custom integrations.

Use the existing comparison generator and CSS/JavaScript. One semantic matrix groups feature rows under product columns, with sticky labels and keyboard-accessible horizontal navigation. Individual comparison pages use the same facts. Evidence details expose the source, date, qualification and audit basis without relying on a hover tooltip.

## Steps and progress

- [x] Establish all vendor and feature scopes; inspect existing generator and research gaps.
- [x] Audit open-source products, hosted capture products and visual review products against the complete feature list.
- [x] Verify current Feedbacks source and identify distinctive workflows.
- [x] Generate one comprehensive matrix and synchronized individual comparisons.
- [x] Validate evidence completeness, sourced negatives, external links and desktop/mobile accessibility.
- [ ] Review, pass required CI, deploy and verify live assets and content.

## Decision log

A cross means the reviewed product surface does not implement the named capability, supported by a documented limit, architectural requirement or bounded source/API inventory. A missing keyword alone does not justify a cross. Partial support and paid-only availability remain visible. Rare unresolved cases retain a precise reason, the reviewed sources and their date.

## Compatibility and recovery

Static website data and presentation only. No application permissions or persistence changes. Regenerate comparisons from canonical evidence; rollback uses the previous website source revision.

## Completion receipt

Research covers all 15 alternatives and 49 features per tool. Official documentation, pinned open-source code and current public editor/recorder clients were reviewed. Independent review corrected native SDKs, image exports, recording controls, full-page capture, scope definitions and keyboard focus. `npm run check` passed (463 tests passed; 33 opt-in browser/native checks skipped locally), including builds, documentation, sandbox and release checks. `npm run qa:public-site` passed across 10 routes, desktop/mobile, narrow table boundaries, keyboard evidence and no-JavaScript comparison disclosure. Layout detector returned no findings. The 784 dated verdicts contain 41 precisely scoped evidence gaps. Required CI, deployment and live verification remain pending and are recorded with the pull request and delivery receipt.
