# Bounded minutes backlog processing

Implemented on 2026-10-24. The observed baseline was 1,928 transcripts,
62 completed documents, and 1,866 incomplete documents. A recent batch completed
19 documents and 157 groups in about 15 minutes. These are observations from one
batch, not a guaranteed rate for the historical corpus.

## Execution and budgets

- The existing mirror dispatch remains the normal recent-data path. Normal
  selection prioritizes the target date and the preceding 14 days, then rotates
  unattempted work ahead of previously attempted work. It publishes and refreshes
  derived analyses immediately.
- Historical batches run at 02:15, 05:15, 08:15, 11:15, 14:15, 17:15, 20:15,
  and 23:15 KST. They select the oldest eligible documents first and do not
  consult the recent-success recovery gate.
- Each historical batch is capped at 20 documents, 160 groups, a shared
  20-minute inference deadline, and a 30-minute job timeout. Individual model
  retries and multi-chunk groups share that deadline. Unfinished groups remain
  pending, without being recorded as failed or complete just because time ran out.
- Before model startup, the workflow commits a 30-minute reservation to
  `manifests/minutes_backfill_budget.json`. At most eight reservations and
  240 reserved minutes are admitted per Korean calendar date. Failed, canceled,
  and forcibly terminated attempts retain their reservation. Backfill failures
  wait for the next scheduled slot; they do not recursively dispatch retries.
  This budget covers historical worker jobs; existing recent-data ingestion,
  analysis builds, and deployments have separate existing limits.
- The 03:30 KST recovery trigger is retained for missed or failed processing.
  Its document/group settings are aligned to 20/160 with the normal dispatch.
- Shared data-repository concurrency remains in place. This initial rollout
  intentionally uses one inference job at a time; parallel inference requires
  separate immutable partitions and a validated merge stage first.

## Publication

Historical batches commit validated source excerpts without dispatching a full
analysis build after every batch. Refresh-only runs at 09:45 and 21:45 KST compare
the summary index timestamp/count against the analysis index and dispatch the
existing live-data build only when needed. These runs do not load the model.
Normal ingest-driven builds can also incorporate the accumulated excerpts.
Successful data builds retain the explicit web deployment dispatch.

Between refreshes, summary exports may be newer than member analyses. A failed
refresh is retried by the next scheduled slot; monitoring rejects an outstanding
analysis refresh once the last analytical publication is older than 24 hours.

Manual operations use the existing workflow:

```sh
gh workflow run summarize-minutes.yml --ref main -f run_mode=backfill
gh workflow run summarize-minutes.yml --ref main -f run_mode=refresh
```

Manual historical work also consumes the same daily reservation budget.

## Measurement and expansion

`manifests/minutes_summary_state.json` includes remaining, ready, and deferred
group counts, the oldest pending meeting date, elapsed processing time, and a
time-limit flag. Grouping is counted without model calls and cached by transcript
SHA-256, grouping policy version, and member identity. Changed source bytes or
member context invalidate cached counts. A cached count never establishes that
a group was processed.

`manifests/minutes_summary_history.json` retains 14 days of completed batch
measurements. The state includes a seven-day observed rate, incoming document
delta, net backlog change, and estimated remaining processing minutes. No
arrival-rate claim is made from one observation; estimates exclude future
discovery, deployment overhead, and retry waiting time.

Review after 24–48 hours of observed historical batches. Keep the initial
eight-slot ceiling until measured failure rate, job duration, and repository
queue delay support expansion. A move to 12 slots must explicitly revise the
daily reservation policy and time budget together. It is not an automatic,
unbounded continuation. Preserve transcript hashes, original source anchors,
extractive validation, exact bill joins, and retry cooling periods.
