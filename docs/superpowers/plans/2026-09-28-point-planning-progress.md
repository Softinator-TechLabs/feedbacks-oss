# Point Planning and Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let project writers plan each feedback point and show an accessible resolved/urgent/later/remaining progress ring on the thread and its project list row.

**Architecture:** Store each point's human work plan beside annotation status in the thread JSON, with revision-checked `threads.annotationPlan` writes and event history. Derive one shared progress model from points, statuses, and plans for both ring placements. Use the existing priority and timing vocabulary; dated presets remain fixed calendar dates.

**Tech Stack:** TypeScript, React, Zod, PostgreSQL JSONB, CSS, Node tests, Playwright browser QA.

**Spec:** User request in this chat on 2026-09-28: developers choose when to do each point; thread header and project list show completed versus remaining points with a colored ring and hover counts (example: 8 total, 2 resolved, 2 later, 1 urgent).

## Global Constraints

- Preserve original point evidence and existing status semantics.
- Human planning is an explicit write; reading a thread never changes a plan.
- Dates are saved calendar dates in the chosen timezone, not rolling labels.
- Removed points are excluded from the ring denominator.
- The ring's count and color categories must also have accessible text.

## Review Focus

- A resolved or removed point with a saved plan must not appear as urgent/later.
- A closed thread must count its points as resolved or closed consistently with the detail view.
- A concurrent thread update must reject stale point-plan writes and preserve the user's choice for retry.
- A zero-point thread must not render a misleading `0/0` progress ring.
- Future-dated and explicit Later work must not appear urgent, even if priority is High.

---

### Task 1: Persist point plans

**Files:** `src/shared/contracts.ts`, `src/server/feedback.ts`, `src/server/annotation-status.ts`, `src/shared/operation-descriptions.ts`, `src/web/api.ts`, `tests/work-planning.test.ts`.

**Interfaces:** `annotationPlans?: Record<string, WorkPlan>` on `Thread`; `threads.annotationPlan` accepts `threadId`, `revision`, `annotationId`, and `workPlan`, returning the updated thread.

- [x] Add a failing server test for plan save/read, missing point, stale revision, and project write permission.
- [x] Run the focused test to observe failure.
- [x] Implement the contract, point existence check, write, event payload, and scope description.
- [x] Run the focused test to pass and commit.

### Task 2: Derive and display progress

**Files:** `src/web/point-progress.ts`, `src/web/point-progress-ring.tsx`, `src/web/point-progress.css`, `src/web/threads.tsx`, `tests/point-progress.test.ts`.

**Interfaces:** `pointProgress(thread, now)` returns total, resolved, urgent, later, remaining, unscheduled, closed counts; `<PointProgressRing thread={thread} />` renders the accessible ring.

- [x] Add failing category tests for the example and the five review-focus cases.
- [x] Run them to observe failure.
- [x] Implement the shared model, ring, tooltip and header/list placements.
- [x] Run focused tests and commit.

### Task 3: Plan each point

**Files:** `src/web/point-work-plan.tsx`, `src/web/thread-detail.css`, `src/web/review-evidence.tsx`, `scripts/extension-browser-qa.mjs`.

**Interfaces:** `<PointWorkPlan thread={thread} annotationId={id} number={number} onSaved={setThread} />` uses the Task 1 operation and existing work-plan model; the parent renders it only for writable open points.

- [x] Add browser assertions that a point timing/priority choice persists and changes both rings.
- [x] Run to observe failure.
- [x] Implement compact point controls and revision-conflict recovery.
- [x] Run browser QA and inspect desktop/mobile light/dark screenshots.
- [ ] Run `npm run check`, commit, open PR, pass CI, merge and verify deployment/live behavior.
