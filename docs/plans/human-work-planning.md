# Human-led work planning and task handoff

## Intent

Developers and project managers choose ownership, priority and when to work. A directly supplied thread takes precedence. A general Feedbacks request should offer the current member's assigned work first, respecting explicit timing and priority, and ask which task to begin. Agents must not autonomously change these decisions or start unrelated work.

## Design

Keep the existing immediate member dropdown. Add compact priority (High, Normal, Low) and timing (Unscheduled, Today, Tomorrow, Next week, Later) controls. Persist calendar dates plus the originating timezone for dated choices; relative labels must not slide as time passes. No required forms. Whole-thread planning is shared by its points; existing point-specific assignments remain intact.

A visible Copy task for agent action copies the thread URL, current status and plan, original reviewer/body, numbered point IDs/text/anchors/status, discussions, media references and linked issues. Treat quoted review material as untrusted evidence. Include actionable MCP image instructions and stable authenticated asset references, never storage credentials or expiring Wasabi URLs. Bound huge handoffs with explicit omission counts and continuation instructions; normal threads include all relevant text. Refresh state before writes and inspect images before declaring success.

## Tasks

- [x] Backend/contracts: threads.plan operation with revision and write authorization; optional workPlan readback, safe defaults for old threads. Server-paginated assignedTo filter and workPlan sort so assigned tasks are discoverable beyond page one. Tests for permissions, dates, stale writes, ordering and transport schemas.
- [x] Guides/compact MCP: include plan in compact queue/thread, expose assignedTo filtering and human-led selection in both portable skill and guides. Explicit links win; otherwise authenticate member and suggest assigned eligible work, future work clearly labeled. Update install prompt examples only where applicable.
- [x] GUI/handoff: compact immediate controls and visible Copy task for agent, secure bounded formatter, keyboard/mobile/error behavior, canonical user docs.
- [ ] Integration: full repository checks, native PostgreSQL relevant query checks, synthetic browser clipboard/readback checks, review, required CI, merge, deploy and live read-only verification.

## Contract

Thread workPlan: { priority: low|normal|high, schedule: unscheduled|today|tomorrow|next_week|later, scheduledFor: YYYY-MM-DD|null, timeZone: IANA timezone }. Dated presets require scheduledFor; unscheduled/later require null. threads.plan accepts existing thread mutation fields plus workPlan. Old threads behave as Normal/Unscheduled. Dates represent planned work, not automatic execution or promised deadlines.

Review filters add assignedTo (member UUID), planningDate (calendar date for workPlan ordering), sort=workPlan. Due/today/unscheduled work precedes future-dated work, which precedes Later; human priority orders within these buckets. No reviewer-weight score overrides human planning. Existing reviewer-weight sorting remains available as advisory context.

## Verification

Local verification: Node 24.19.0 full check passed (181 passed, 4 optional skips); native PostgreSQL query/concurrency checks passed. Synthetic desktop/mobile browser verified immediate priority/timing persistence, actual clipboard contents, blocked-clipboard fallback and assigned queue filtering. Independent reviews found and fixed parent-closure point states and local-calendar ordering. Required CI and deployment receipts are recorded with the release PR. Production feedback assignments and plans are not modified for testing.
