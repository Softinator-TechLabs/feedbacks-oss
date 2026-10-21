# Analytics definitions and coverage

The global **Analytics** page aggregates currently accessible projects; a project's **Analytics** tab selects one project. Human members with current read access can inspect its metrics. `analytics.get` is an optional read scope for agents, intersected with current project grants and token project restrictions. Existing keys gain no new scope automatically. The server authorizes each request and drilldown; client project selectors are not access controls.

Choose explicit inclusive `from` and exclusive `to` instants, at most 366 elapsed days apart, and an IANA `timeZone` for daily grouping. The UI interprets its From/Through calendar dates in that timezone and converts them to instants, including daylight-saving changes. Refresh reads live data and shows generation time. A response can include `detail {metric,dimension?,key?,offset,limit}` for an exact filtered list of authorized thread IDs without copying their discussion text. Server results remain authoritative when a thread moves or access changes before opening it.

## Counts and cohorts

| Metric              | Definition                                                                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incoming            | Threads created within the period                                                                                                                                                                                |
| First triaged       | First retained organization, planning, assignment, priority change or departure from Open occurs within the period                                                                                               |
| Resolved / declined | Distinct threads with a recorded transition into that work state within the period                                                                                                                               |
| Reopened            | Distinct threads with a recorded transition from a closed work state into an active state within the period                                                                                                      |
| Marked duplicate    | Distinct threads whose retained history changes from not marked duplicate to marked duplicate within the period                                                                                                  |
| Active backlog now  | Current non-archived Open, In progress or Ready for review threads, independent of the period                                                                                                                    |
| Stalled             | Current backlog with at least seven elapsed days in the same board column, deriving retained status transitions through the current column mapping; a change between states in the same column does not reset it |

Period counts use distinct threads. A thread resolved on two local days appears once in the period total and once on each daily row, so daily rows can sum above the period total. Archived threads can still contribute historical lifecycle events. Duplicate and resolved/declined counts are independent. Resolved is the displayed throughput measure; no historical backlog snapshot or handoff duration is inferred. Classification supplied during initial capture alone has no separate first-triage timestamp, so it is not backdated from current labels.

Category, tag, priority, project, origin, page, browser and device breakdowns describe the incoming cohort using current metadata. State, current board column, age and assignee describe the current backlog. Age is complete elapsed days from creation at generation time, grouped 0–2, 3–7, 8–14, 15–30 and 31+. A still-open thread can appear under multiple active point assignees; a tag row can overlap other tags. Workload is sorted by name and is not an employee performance ranking. Browser identity was not collected and is explicitly Unknown; missing context also remains Unknown rather than being guessed. Page labels omit credentials, query strings and fragments.

## Duration formulas

The duration cohort is threads created within the selected period. Each completed observation is elapsed hours from creation to the first retained response, recorded triage or resolution, observed through generation time, even if that completion falls after the selected period. Pending observations are excluded; the completed sample is always shown. This is a completed-observation distribution, not a forecast or an uncensored service-level measure.

A response is a currently retained response-intent reply from a different participant, or a legacy agent reply without an explicit intent. Own replies and human request-intent replies do not count. First triage uses the earliest retained applicable event or work-history change; first resolution uses the first retained Resolved entry. Median averages the middle pair for even sample sizes. P90 uses nearest rank, at index `ceil(0.9 × sample)` in one-based ascending order. Zero is valid; no sample displays no value. Samples of one through four are marked Small sample.

## Privacy, limits and retention

CSV and print include aggregate totals and dates, excluding discussion content, project/member labels, page URLs and matching thread IDs. Drilldowns and context labels stay within current project access. CSV labels are fixed application text, avoiding user-supplied spreadsheet formulas. Query/fragment stripping cannot remove private identifiers that a website embeds in its URL path.

Reads have no analytics cache or extra analytics retention. A deleted thread or reply removes its observation. Edits, moves, archival and later classification can change a historical report; original first-triage events may be unavailable after a project move. Column dwell uses the current board configuration, including any current grouping of multiple states; it does not reconstruct historical column configurations. With no saved configuration the default board mapping applies. No immutable audit snapshot is claimed.

The server caps one read at 1,000 accessible projects, 10,000 candidate threads, 100,000 retained status-history entries and 100,000 active thread/assignee pairs. Wider requests fail with narrowing guidance; totals are never silently sampled. The candidate cohort includes current active backlog plus threads created or updated since the period start. Breakdowns show thirty labels plus Other. Thread drilldowns page at up to 100 rows. A narrower project, and for closed historic work a shorter period, can reduce the cohort.

[Implementation](../src/server/analytics.ts), [shared contract](../src/shared/contracts/domains/analytics.ts), [synthetic history and access tests](../tests/analytics.test.ts), [rendered browser checks](../tests/analytics-browser.test.ts). The browser checks use a disposable synthetic installation; they do not certify a production workspace's data quality.
